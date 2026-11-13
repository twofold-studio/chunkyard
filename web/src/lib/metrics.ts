/** Formatting for `GET /api/v1/servers/{id}/metrics`. `null` is never shown as zero. */

export const UNAVAILABLE = '—';

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

function known(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function formatBytes(bytes: number | null | undefined): string {
	if (!known(bytes)) return UNAVAILABLE;
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	if (unit === 0) return `${value} B`;
	return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** CPU is relative to one logical core, so 250% means two and a half cores busy. */
export function formatCpu(percent: number | null | undefined): string {
	if (!known(percent)) return UNAVAILABLE;
	return `${percent >= 100 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

export function formatUptime(seconds: number | null | undefined): string {
	if (!known(seconds)) return UNAVAILABLE;
	const s = Math.floor(seconds);
	const days = Math.floor(s / 86_400);
	const hours = Math.floor((s % 86_400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const secs = s % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, '0')}s`;
	return `${secs}s`;
}

export function formatCount(value: number | null | undefined): string {
	return known(value) ? String(Math.round(value)) : UNAVAILABLE;
}

/** Fill ratio in [0, 1] for a bar, or `null` when either side is unknown. */
export function ratio(
	value: number | null | undefined,
	max: number | null | undefined
): number | null {
	if (!known(value) || !known(max) || max === 0) return null;
	return Math.min(1, value / max);
}
