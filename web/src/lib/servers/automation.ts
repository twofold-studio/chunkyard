/**
 * Per-server automation policies (`/api/v1/servers/{id}/automation`). Every `*At` field of
 * the automation state is **Unix seconds**; convert before formatting. Policies stay off until
 * the owner saves them; nothing here saves on load.
 */
import type {
	AutomationState,
	BackupPolicy,
	BackupScheduleRequest,
	RecoveryPolicy
} from '#lib/api/index.js';

export const RECOVERY_LIMITS = {
	attempts: { min: 1, max: 10 },
	delay: { min: 5, max: 300 }
} as const;
export const SCHEDULE_LIMITS = {
	interval: { min: 1, max: 10_080 },
	keep: { min: 1, max: 100 }
} as const;

export const DEFAULT_RECOVERY: RecoveryPolicy = {
	autoStart: false,
	restartOnCrash: false,
	maxAttempts: 3,
	retryDelaySeconds: 30
};
export const DEFAULT_BACKUP: BackupPolicy = {
	enabled: false,
	intervalMinutes: 1440,
	keepLast: null
};

export const INTERVAL_PRESETS = [
	{ minutes: 60, label: 'Hourly' },
	{ minutes: 360, label: 'Every 6 hours' },
	{ minutes: 720, label: 'Every 12 hours' },
	{ minutes: 1440, label: 'Daily' },
	{ minutes: 10_080, label: 'Weekly' }
] as const;

/** Unix seconds → ms since the epoch, or `null`. */
export function unixToMs(seconds: number | null | undefined): number | null {
	return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
		? seconds * 1000
		: null;
}

/** Absolute local time for a Unix-seconds value, or `—`. */
export function formatUnix(seconds: number | null | undefined): string {
	const ms = unixToMs(seconds);
	if (ms === null) return '—';
	return new Date(ms).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

/** `in 5 min`, `3 h ago`, … for a Unix-seconds value relative to `now` (ms). */
export function relativeUnix(seconds: number | null | undefined, now: number): string | null {
	const ms = unixToMs(seconds);
	if (ms === null) return null;
	const diff = (ms - now) / 1000;
	const abs = Math.abs(diff);
	const text =
		abs < 45
			? null
			: abs < 3600
				? `${Math.round(abs / 60)} min`
				: abs < 86_400
					? `${Math.round(abs / 3600)} h`
					: `${Math.round(abs / 86_400)} d`;
	if (text === null) return diff >= 0 ? 'now' : 'just now';
	return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export function formatInterval(minutes: number): string {
	const preset = INTERVAL_PRESETS.find((p) => p.minutes === minutes);
	if (preset) return preset.label;
	if (minutes % 1440 === 0) return `Every ${minutes / 1440} days`;
	if (minutes % 60 === 0) return `Every ${minutes / 60} hours`;
	return `Every ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function inRange(value: number | undefined, { min, max }: { min: number; max: number }) {
	return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validateRecovery(policy: RecoveryPolicy): string | null {
	if (!inRange(policy.maxAttempts, RECOVERY_LIMITS.attempts)) return 'Use 1–10 restart attempts.';
	if (!inRange(policy.retryDelaySeconds, RECOVERY_LIMITS.delay))
		return 'Use a retry delay of 5–300 seconds.';
	return null;
}

export function sameRecovery(a: RecoveryPolicy, b: RecoveryPolicy): boolean {
	return (
		a.autoStart === b.autoStart &&
		a.restartOnCrash === b.restartOnCrash &&
		a.maxAttempts === b.maxAttempts &&
		a.retryDelaySeconds === b.retryDelaySeconds
	);
}

export function sameBackup(a: BackupPolicy, b: BackupPolicy): boolean {
	return (
		a.enabled === b.enabled && a.intervalMinutes === b.intervalMinutes && a.keepLast === b.keepLast
	);
}

/** Setting or changing a numeric retention deletes older scheduled archives: confirm it. */
export function retentionNeedsConfirmation(saved: BackupPolicy, draft: BackupPolicy): boolean {
	return draft.keepLast !== null && draft.keepLast !== saved.keepLast;
}

export type BuiltSchedule =
	{ ok: true; request: BackupScheduleRequest } | { ok: false; error: string };

/**
 * The exact `PUT …/backup-schedule` body. `confirmRetentionDeletion` is true only when the
 * owner acknowledged a new numeric retention; enabling needs configured S3 storage.
 */
export function buildSchedule(
	saved: BackupPolicy,
	draft: BackupPolicy,
	acknowledged: boolean,
	storageConfigured: boolean
): BuiltSchedule {
	if (!inRange(draft.intervalMinutes, SCHEDULE_LIMITS.interval))
		return { ok: false, error: 'Use an interval of 1–10080 minutes (up to a week).' };
	if (draft.keepLast !== null && !inRange(draft.keepLast, SCHEDULE_LIMITS.keep))
		return { ok: false, error: 'Keep 1–100 scheduled backups, or keep all.' };
	if (draft.enabled && !storageConfigured)
		return { ok: false, error: 'Configure S3 storage before enabling scheduled backups.' };
	const confirm = retentionNeedsConfirmation(saved, draft);
	if (confirm && !acknowledged)
		return {
			ok: false,
			error: 'Confirm that older scheduled backups beyond this count will be deleted.'
		};
	return {
		ok: true,
		request: {
			enabled: draft.enabled,
			intervalMinutes: draft.intervalMinutes,
			keepLast: draft.keepLast,
			confirmRetentionDeletion: confirm && acknowledged
		}
	};
}

const BACKUP_RESULTS: Record<string, string> = {
	succeeded: 'Succeeded',
	failed: 'Failed',
	queued: 'Queued',
	skipped_running: 'Skipped: the server was running',
	busy: 'Deferred: job capacity busy'
};

export function backupResultText(result: string | null): string | null {
	if (!result) return null;
	return BACKUP_RESULTS[result] ?? result.replace(/[._-]+/g, ' ');
}

export function backupResultTone(
	result: string | null
): 'success' | 'warning' | 'danger' | 'muted' {
	if (result === 'succeeded') return 'success';
	if (result === 'failed') return 'danger';
	if (result === 'skipped_running' || result === 'busy') return 'warning';
	return 'muted';
}

/** A one-line recovery status for Settings, or `null` when there is nothing to report. */
export function recoveryStatus(state: AutomationState, now: number): string | null {
	const { recovery } = state;
	if (!recovery.restartOnCrash && !recovery.autoStart) return null;
	const parts: string[] = [];
	if (state.restartAttempts > 0)
		parts.push(`${state.restartAttempts} of ${recovery.maxAttempts} restart attempts used`);
	const retry = relativeUnix(state.nextRetryAt, now);
	if (retry) parts.push(`next retry ${retry}`);
	const stable = unixToMs(state.stableSince);
	if (stable !== null && state.restartAttempts > 0)
		parts.push(`stable since ${formatUnix(state.stableSince)}; the budget resets after 5 minutes`);
	return parts.length ? `${parts.join(' · ')}.` : null;
}
