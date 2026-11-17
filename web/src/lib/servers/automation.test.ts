import { describe, expect, it } from 'vitest';
import type { AutomationState } from '#lib/api/index.js';
import {
	backupResultText,
	buildSchedule,
	DEFAULT_BACKUP,
	DEFAULT_RECOVERY,
	formatInterval,
	formatUnix,
	recoveryStatus,
	relativeUnix,
	retentionNeedsConfirmation,
	unixToMs,
	validateRecovery
} from './automation';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const S = NOW / 1000;

describe('timestamps', () => {
	it('treats automation times as Unix seconds', () => {
		expect(unixToMs(S)).toBe(NOW);
		expect(unixToMs(null)).toBeNull();
		expect(unixToMs(0)).toBeNull();
		// Seconds, not ms: a value in seconds is in 2026, not January 1970.
		expect(new Date(unixToMs(1794744000)!).getUTCFullYear()).toBe(2026);
		expect(formatUnix(null)).toBe('—');
		expect(formatUnix(S)).toBe(
			new Date(NOW).toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			})
		);
	});

	it('describes relative times both ways', () => {
		expect(relativeUnix(S + 600, NOW)).toBe('in 10 min');
		expect(relativeUnix(S - 7200, NOW)).toBe('2 h ago');
		expect(relativeUnix(S + 2 * 86_400, NOW)).toBe('in 2 d');
		expect(relativeUnix(S + 10, NOW)).toBe('now');
		expect(relativeUnix(null, NOW)).toBeNull();
	});
});

describe('policies', () => {
	it('defaults are off and keep every backup', () => {
		expect(DEFAULT_RECOVERY).toEqual({
			autoStart: false,
			restartOnCrash: false,
			maxAttempts: 3,
			retryDelaySeconds: 30
		});
		expect(DEFAULT_BACKUP).toEqual({ enabled: false, intervalMinutes: 1440, keepLast: null });
	});

	it('validates recovery limits', () => {
		expect(validateRecovery(DEFAULT_RECOVERY)).toBeNull();
		expect(validateRecovery({ ...DEFAULT_RECOVERY, maxAttempts: 11 })).toMatch(/1–10/);
		expect(validateRecovery({ ...DEFAULT_RECOVERY, maxAttempts: 0 })).toMatch(/1–10/);
		expect(validateRecovery({ ...DEFAULT_RECOVERY, retryDelaySeconds: 4 })).toMatch(/5–300/);
		expect(validateRecovery({ ...DEFAULT_RECOVERY, retryDelaySeconds: 2.5 })).toMatch(/5–300/);
	});

	it('requires acknowledgement only when a numeric retention is set or changed', () => {
		const keep5 = { ...DEFAULT_BACKUP, keepLast: 5 };
		expect(retentionNeedsConfirmation(DEFAULT_BACKUP, keep5)).toBe(true);
		expect(retentionNeedsConfirmation(keep5, { ...keep5, keepLast: 6 })).toBe(true);
		expect(retentionNeedsConfirmation(keep5, { ...keep5, intervalMinutes: 60 })).toBe(false);
		expect(retentionNeedsConfirmation(keep5, DEFAULT_BACKUP)).toBe(false);
	});

	it('builds the exact schedule request', () => {
		const enabled = { enabled: true, intervalMinutes: 60, keepLast: null };
		expect(buildSchedule(DEFAULT_BACKUP, enabled, false, true)).toEqual({
			ok: true,
			request: { ...enabled, confirmRetentionDeletion: false }
		});
		expect(buildSchedule(DEFAULT_BACKUP, enabled, false, false)).toEqual({
			ok: false,
			error: expect.stringMatching(/S3/)
		});
		// Saving a disabled schedule never needs storage.
		expect(
			buildSchedule(DEFAULT_BACKUP, { ...DEFAULT_BACKUP, intervalMinutes: 30 }, false, false).ok
		).toBe(true);
		const keep3 = { ...enabled, keepLast: 3 };
		expect(buildSchedule(DEFAULT_BACKUP, keep3, false, true)).toEqual({
			ok: false,
			error: expect.stringMatching(/Confirm/)
		});
		expect(buildSchedule(DEFAULT_BACKUP, keep3, true, true)).toEqual({
			ok: true,
			request: { ...keep3, confirmRetentionDeletion: true }
		});
		expect(
			buildSchedule(DEFAULT_BACKUP, { ...enabled, intervalMinutes: 10_081 }, false, true).ok
		).toBe(false);
		expect(buildSchedule(DEFAULT_BACKUP, { ...enabled, keepLast: 101 }, true, true).ok).toBe(false);
	});

	it('labels intervals and results', () => {
		expect(formatInterval(1440)).toBe('Daily');
		expect(formatInterval(2880)).toBe('Every 2 days');
		expect(formatInterval(120)).toBe('Every 2 hours');
		expect(formatInterval(1)).toBe('Every 1 minute');
		expect(backupResultText('skipped_running')).toMatch(/running/);
		expect(backupResultText(null)).toBeNull();
	});

	it('summarises recovery runtime state only when a policy is on', () => {
		const base: AutomationState = {
			intentAt: 0,
			recovery: DEFAULT_RECOVERY,
			backup: DEFAULT_BACKUP,
			historyEnabled: true,
			desiredRunning: false,
			restartAttempts: 2,
			nextRetryAt: S + 30,
			stableSince: null,
			nextBackupAt: null,
			lastBackupAt: null,
			lastBackupJob: null,
			lastBackupExportId: null,
			lastBackupResult: null,
			lastBackupError: null,
			lastHistoryAt: null
		};
		expect(recoveryStatus(base, NOW)).toBeNull();
		const on = { ...base, recovery: { ...DEFAULT_RECOVERY, restartOnCrash: true } };
		expect(recoveryStatus(on, NOW)).toBe('2 of 3 restart attempts used · next retry now.');
	});
});
