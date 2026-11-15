import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import BackupSchedule, { type ScheduleApi } from './backup-schedule.svelte';
import type { AutomationState, StorageConnection } from '#lib/api/index.js';
import { formatUnix } from '#lib/servers/automation.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const S = NOW / 1000;

const storage = (configured: boolean): StorageConnection => ({
	configured,
	endpoint: configured ? 'http://10.0.0.5:9000' : '',
	region: '',
	bucket: configured ? 'mc' : '',
	prefix: '',
	accessKeyId: '',
	hasSecret: configured
});

const automation = (extra: Partial<AutomationState> = {}): AutomationState => ({
	recovery: { autoStart: false, restartOnCrash: false, maxAttempts: 3, retryDelaySeconds: 30 },
	backup: { enabled: false, intervalMinutes: 1440, keepLast: null },
	historyEnabled: true,
	desiredRunning: false,
	restartAttempts: 0,
	nextRetryAt: null,
	stableSince: null,
	nextBackupAt: null,
	lastBackupAt: null,
	lastBackupJob: null,
	lastBackupExportId: null,
	lastBackupResult: null,
	lastBackupError: null,
	lastHistoryAt: null,
	...extra
});

function api(initial = automation()) {
	const stub: ScheduleApi = {
		load: vi.fn(async () => initial),
		save: vi.fn(async (_id, body) => automation({ backup: { ...body }, nextBackupAt: S + 3600 }))
	};
	return stub;
}

const enable = () => page.getByRole('switch', { name: /Back up on a schedule/ });
const save = () => page.getByRole('button', { name: 'Save schedule' });

describe('BackupSchedule', () => {
	it('starts disabled, keeping all, and never saves on load', async () => {
		const stub = api();
		render(BackupSchedule, { serverId: 's1', storage: storage(true), api: stub, now: NOW });
		await expect.element(enable()).toHaveAttribute('aria-checked', 'false');
		await expect.element(page.getByRole('radio', { name: 'Keep all' })).toBeChecked();
		await expect.element(save()).toBeDisabled();
		await expect
			.element(page.getByTestId('schedule-status'))
			.toHaveTextContent('No scheduled backup yet');
		await new Promise((r) => setTimeout(r, 100));
		expect(stub.save).not.toHaveBeenCalled();
	});

	it('cannot be enabled without S3 storage and links to its setup', async () => {
		render(BackupSchedule, { serverId: 's1', storage: storage(false), api: api(), now: NOW });
		await expect.element(enable()).toBeDisabled();
		await expect
			.element(page.getByTestId('schedule-no-storage'))
			.toHaveTextContent('Scheduled backups need S3 storage.');
		await expect
			.element(page.getByRole('link', { name: 'Set up and test storage' }))
			.toHaveAttribute('href', expect.stringMatching(/\/exports$/));
	});

	it('saves an explicit schedule with the exact body', async () => {
		const stub = api();
		render(BackupSchedule, { serverId: 's1', storage: storage(true), api: stub, now: NOW });
		await enable().click();
		await save().click();
		await vi.waitFor(() =>
			expect(stub.save).toHaveBeenCalledWith(
				's1',
				{ enabled: true, intervalMinutes: 1440, keepLast: null, confirmRetentionDeletion: false },
				expect.any(AbortSignal)
			)
		);
		await expect
			.element(page.getByTestId('schedule-status'))
			.toHaveTextContent(formatUnix(S + 3600));
		await expect.element(page.getByTestId('schedule-status')).toHaveTextContent('(in 1 h)');
	});

	it('requires an explicit acknowledgement before numeric retention', async () => {
		const stub = api(
			automation({ backup: { enabled: true, intervalMinutes: 60, keepLast: null } })
		);
		render(BackupSchedule, { serverId: 's1', storage: storage(true), api: stub, now: NOW });
		await page.getByRole('radio', { name: 'Keep last' }).click();
		await page.getByRole('spinbutton', { name: 'Scheduled backups to keep' }).fill('3');
		const ack = page.getByTestId('retention-ack');
		await expect
			.element(ack)
			.toHaveTextContent(
				/delete older scheduled\s+backups.*newest 3.*Manual exports and pinned restore points are never deleted/
			);
		await expect.element(save()).toBeDisabled();
		await ack.getByRole('checkbox').click();
		await expect.element(save()).toBeEnabled();
		await save().click();
		await vi.waitFor(() =>
			expect(stub.save).toHaveBeenCalledWith(
				's1',
				{ enabled: true, intervalMinutes: 60, keepLast: 3, confirmRetentionDeletion: true },
				expect.any(AbortSignal)
			)
		);
	});

	it('shows last results from Unix-second timestamps with the job link', async () => {
		render(BackupSchedule, {
			serverId: 's1',
			storage: storage(true),
			now: NOW,
			api: api(
				automation({
					backup: { enabled: true, intervalMinutes: 1440, keepLast: 5 },
					nextBackupAt: S + 7200,
					lastBackupAt: S - 86_400,
					lastBackupJob: 'job-9',
					lastBackupResult: 'skipped_running',
					lastBackupError:
						'Scheduled backups require a stopped instance; no server was stopped automatically.'
				})
			)
		});
		const status = page.getByTestId('schedule-status');
		await expect.element(status).toHaveTextContent(formatUnix(S + 7200));
		await expect.element(status).toHaveTextContent(formatUnix(S - 86_400));
		await expect.element(status).toHaveTextContent('Skipped: the server was running');
		await expect.element(status).toHaveTextContent('no server was stopped automatically');
		await expect
			.element(page.getByTestId('schedule-job-link'))
			.toHaveAttribute('href', expect.stringContaining('activity/job-9'));
		// An unchanged retention needs no new acknowledgement.
		await expect.element(page.getByTestId('retention-ack')).not.toBeInTheDocument();
	});
});
