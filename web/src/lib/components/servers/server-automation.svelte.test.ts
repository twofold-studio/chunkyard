import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerAutomation, { type AutomationApi } from './server-automation.svelte';
import type { AutomationState } from '#lib/api/index.js';

const automation = (extra: Partial<AutomationState> = {}): AutomationState => ({
	intentAt: 0,
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
	const stub: AutomationApi = {
		load: vi.fn(async () => initial),
		saveRecovery: vi.fn(async (_id, recovery) => automation({ recovery: { ...recovery } })),
		saveHistory: vi.fn(async (_id, enabled) => automation({ historyEnabled: enabled }))
	};
	return stub;
}

const saveButton = () => page.getByRole('button', { name: 'Save recovery' });

describe('ServerAutomation', () => {
	it('shows the off-by-default policies and saves nothing on load', async () => {
		const stub = api();
		render(ServerAutomation, { serverId: 's1', api: stub });
		await expect
			.element(page.getByRole('switch', { name: /Start when the manager starts/ }))
			.toHaveAttribute('aria-checked', 'false');
		await expect
			.element(page.getByRole('switch', { name: /Restart after a crash/ }))
			.toHaveAttribute('aria-checked', 'false');
		await expect.element(saveButton()).toBeDisabled();
		await new Promise((r) => setTimeout(r, 100));
		expect(stub.saveRecovery).not.toHaveBeenCalled();
		expect(stub.saveHistory).not.toHaveBeenCalled();
	});

	it('saves the full recovery policy only when asked, within limits', async () => {
		const stub = api();
		render(ServerAutomation, { serverId: 's1', api: stub });
		await page.getByRole('switch', { name: /Restart after a crash/ }).click();
		const attempts = page.getByRole('spinbutton', { name: 'Attempts', exact: true });
		await attempts.fill('11');
		await expect
			.element(page.getByTestId('recovery-hint'))
			.toHaveTextContent('Use 1–10 restart attempts.');
		await expect.element(saveButton()).toBeDisabled();
		await attempts.fill('5');
		await page.getByRole('spinbutton', { name: 'Seconds between attempts' }).fill('60');
		await saveButton().click();
		await vi.waitFor(() =>
			expect(stub.saveRecovery).toHaveBeenCalledWith(
				's1',
				{ autoStart: false, restartOnCrash: true, maxAttempts: 5, retryDelaySeconds: 60 },
				expect.any(AbortSignal)
			)
		);
		await expect.element(saveButton()).toBeDisabled();
	});

	it('switches background history independently', async () => {
		const stub = api();
		render(ServerAutomation, { serverId: 's1', api: stub });
		const history = page.getByRole('switch', { name: 'Resource history' });
		await expect.element(history).toHaveAttribute('aria-checked', 'true');
		await history.click();
		await vi.waitFor(() =>
			expect(stub.saveHistory).toHaveBeenCalledWith('s1', false, expect.any(AbortSignal))
		);
		await expect.element(history).toHaveAttribute('aria-checked', 'false');
		expect(stub.saveRecovery).not.toHaveBeenCalled();
	});
});
