import type { ServerMetrics } from '#lib/api/index.js';

/**
 * Live metrics over `GET /api/v1/servers/{id}/metrics/stream?intervalMs=` (same-origin,
 * authenticated WebSocket). Frames: `sample`, `error`, `end`. The backend only sends fresh
 * Docker measurements; the interval requests shared one-shot sampling, subject to Docker
 * response time. Slow responses never cause queued sampling requests.
 */
export type MetricsFrame =
	| { type: 'sample'; sample: ServerMetrics }
	| { type: 'error'; code: string; detail: string }
	| { type: 'end' };

export const STREAM_MIN_MS = 100;
export const STREAM_MAX_MS = 60000;

function isSample(value: unknown): value is ServerMetrics {
	if (typeof value !== 'object' || value === null) return false;
	const sample = value as Partial<ServerMetrics>;
	return (
		typeof sample.serverId === 'string' &&
		typeof sample.sampledAt === 'string' &&
		!Number.isNaN(Date.parse(sample.sampledAt)) &&
		typeof sample.status === 'object' &&
		sample.status !== null
	);
}

/** Validates one text frame; anything unexpected is ignored rather than trusted. */
export function parseMetricsFrame(data: unknown): MetricsFrame | null {
	if (typeof data !== 'string') return null;
	let frame: unknown;
	try {
		frame = JSON.parse(data);
	} catch {
		return null;
	}
	if (typeof frame !== 'object' || frame === null) return null;
	const value = frame as Record<string, unknown>;
	switch (value.type) {
		case 'sample':
			return isSample(value.sample) ? { type: 'sample', sample: value.sample } : null;
		case 'error':
			return {
				type: 'error',
				code: typeof value.code === 'string' ? value.code : 'metrics.error',
				detail: typeof value.detail === 'string' ? value.detail : ''
			};
		case 'end':
			return { type: 'end' };
		default:
			return null;
	}
}

/** Same-origin WebSocket URL, with the interval clamped to the accepted range. */
export function metricsStreamUrl(
	serverId: string,
	intervalMs: number,
	location: Pick<Location, 'protocol' | 'host'> = window.location
): string {
	const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
	const interval = Math.min(STREAM_MAX_MS, Math.max(STREAM_MIN_MS, Math.round(intervalMs)));
	return `${scheme}//${location.host}/api/v1/servers/${encodeURIComponent(serverId)}/metrics/stream?intervalMs=${interval}`;
}
