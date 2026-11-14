/**
 * Presentation helpers for durable jobs (`GET /api/v1/jobs`). Job results are arbitrary
 * JSON on the wire, so the UI only ever reads an allowlist of known fields per kind and
 * never renders raw payloads.
 */
import { describeError, isJobActive, type Job, type JobState } from '#lib/api/index.js';
import { formatBytes } from '#lib/metrics.js';

export const JOB_KIND_LABELS: Record<string, string> = {
	'java.install': 'Install Java runtime',
	'server.install': 'Install server software',
	'server.start': 'Start server',
	'server.stop': 'Stop server',
	'server.restart': 'Restart server',
	'server.kill': 'Kill server',
	'server.delete': 'Delete server',
	'server.export': 'Export server'
};

export const JOB_STATE_LABELS: Record<JobState, string> = {
	queued: 'Queued',
	running: 'Running',
	succeeded: 'Succeeded',
	failed: 'Failed',
	cancelled: 'Cancelled'
};

/** Human name for a job kind; unknown kinds fall back to a readable form of the raw kind. */
export function jobKindLabel(kind: string): string {
	const known = JOB_KIND_LABELS[kind];
	if (known) return known;
	const words = kind.replace(/[._-]+/g, ' ').trim();
	return words ? words[0].toUpperCase() + words.slice(1) : 'Job';
}

export { isJobActive };

// Time ---------------------------------------------------------------------------

export function parseTime(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? null : ms;
}

/** Compact duration such as `850 ms`, `12.4 s`, `3m 05s` or `2h 10m`. */
export function formatDuration(ms: number | null): string {
	if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
	if (ms < 1000) return `${Math.round(ms)} ms`;
	const s = ms / 1000;
	if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.floor(s)} s`;
	const total = Math.floor(s);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
	return `${m}m ${String(total % 60).padStart(2, '0')}s`;
}

export interface JobTiming {
	/** Run time (start → finish, or start → now while running). */
	runMs: number | null;
	/** Time spent waiting in the queue (created → start, or created → now while queued). */
	waitMs: number | null;
	/** True when the duration is still growing. */
	live: boolean;
}

export function jobTiming(job: Job, now: number): JobTiming {
	const created = parseTime(job.createdAt);
	const started = parseTime(job.startedAt);
	const finished = parseTime(job.finishedAt);
	const live = isJobActive(job);
	const runEnd = finished ?? (live ? now : null);
	const runMs = started !== null && runEnd !== null ? Math.max(0, runEnd - started) : null;
	const waitEnd = started ?? (job.state === 'queued' ? now : finished);
	const waitMs = created !== null && waitEnd !== null ? Math.max(0, waitEnd - created) : null;
	return { runMs, waitMs, live };
}

export function formatJobTime(iso: string | null): string {
	const ms = parseTime(iso);
	if (ms === null) return '—';
	return new Date(ms).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

/** "just now", "5 min ago", "3 h ago", or a date for anything older than a day. */
export function formatRelative(iso: string | null, now: number): string {
	const ms = parseTime(iso);
	if (ms === null) return '—';
	const diff = Math.max(0, now - ms) / 1000;
	if (diff < 45) return 'just now';
	if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
	if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
	return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Failures -----------------------------------------------------------------------

const MAX_DETAIL = 400;

/** Removes control characters and bounds the length of backend-provided text. */
export function sanitizeText(text: string, max = MAX_DETAIL): string {
	// eslint-disable-next-line no-control-regex -- stripping control characters is the point
	const clean = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export interface JobFailureView {
	code: string;
	title: string;
	detail: string;
}

/** The backend already sanitizes `detail`; this adds known titles and bounds the text. */
export function jobFailure(job: Job): JobFailureView | null {
	if (job.state !== 'failed' && job.state !== 'cancelled') return null;
	const error = job.error;
	if (!error || typeof error.code !== 'string') {
		return job.state === 'cancelled'
			? { code: 'job.cancelled', title: 'Cancelled', detail: 'The job was cancelled.' }
			: { code: 'job.failed', title: 'Failed', detail: 'The job failed without details.' };
	}
	const message = describeError({
		code: error.code,
		detail: typeof error.detail === 'string' ? error.detail : ''
	});
	return {
		code: sanitizeText(error.code, 80),
		title: message.title,
		detail: sanitizeText(message.detail)
	};
}

// Result summaries ---------------------------------------------------------------

export interface SummaryRow {
	label: string;
	value: string;
	mono?: boolean;
}

function obj(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function str(value: unknown, max = 160): string | null {
	return typeof value === 'string' && value.trim() ? sanitizeText(value, max) : null;
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const SCOPE_TEXT: Record<string, string> = {
	world: 'World',
	selected: 'Selected paths',
	all: 'Full instance'
};
const DESTINATION_TEXT: Record<string, string> = { local: 'Manager host', s3: 'S3' };

/**
 * A short, allowlisted description of a succeeded job's `result`. Unknown kinds or shapes
 * yield no rows: arbitrary payloads are never rendered.
 */
export function jobResultSummary(job: Job): SummaryRow[] {
	if (job.state !== 'succeeded') return [];
	const result = obj(job.result);
	if (!result) return [];
	const rows: SummaryRow[] = [];
	const push = (label: string, value: string | null, mono = false) => {
		if (value) rows.push({ label, value, mono });
	};

	switch (job.kind) {
		case 'java.install': {
			const runtime = obj(result.runtime);
			if (!runtime) break;
			const major = num(runtime.major);
			push('Runtime', major !== null ? `Java ${major}` : null);
			push('Vendor', str(runtime.vendor, 60));
			push('Version', str(runtime.fullVersion, 60), true);
			const os = str(runtime.os, 30);
			const arch = str(runtime.arch, 30);
			push('Platform', os && arch ? `${os} / ${arch}` : (os ?? arch));
			break;
		}
		case 'server.install':
		case 'server.start':
		case 'server.stop':
		case 'server.restart':
		case 'server.kill': {
			const server = obj(result.server);
			if (!server) break;
			push('Server', str(server.name, 80));
			push('Status after', str(obj(server.status)?.state, 30));
			if (job.kind === 'server.install') {
				const launch = obj(server.launch);
				push('Game version', str(launch?.version, 40));
				const build = launch?.build;
				push(
					'Build',
					typeof build === 'string' || typeof build === 'number' ? String(build) : null
				);
			}
			break;
		}
		case 'server.delete': {
			const deleted = obj(result.deleted);
			if (!deleted) break;
			if (typeof deleted.filesDeleted === 'boolean') {
				push('Files', deleted.filesDeleted ? 'Deleted' : 'Kept on the manager host');
			}
			push('Kept at', str(deleted.retainedDirectory, 240), true);
			break;
		}
		case 'server.export': {
			push('Archive', str(result.fileName, 120), true);
			push('Contents', SCOPE_TEXT[String(result.scope)] ?? null);
			push('Destination', DESTINATION_TEXT[String(result.destination)] ?? null);
			const size = num(result.size);
			push('Size', size !== null ? formatBytes(size) : null);
			const sha = str(result.sha256, 64);
			push('SHA-256', sha ? sha.slice(0, 16) : null, true);
			break;
		}
	}
	return rows;
}

/** One-line status message shown in lists (sanitized; never raw JSON). */
export function jobHeadline(job: Job): string | null {
	if (job.state === 'failed' || job.state === 'cancelled') return jobFailure(job)?.detail ?? null;
	return job.message ? sanitizeText(job.message, 160) : null;
}

// Filters ------------------------------------------------------------------------

export type StateFilter = 'all' | 'active' | JobState;
/** `all`, `none` (jobs without a server, e.g. Java installs) or a server id. */
export type ServerFilter = string;

export interface JobFilters {
	server: ServerFilter;
	state: StateFilter;
	kind: string;
}

export const DEFAULT_FILTERS: JobFilters = { server: 'all', state: 'all', kind: 'all' };

export function filterJobs(jobs: readonly Job[], filters: JobFilters): Job[] {
	return jobs.filter((job) => {
		if (filters.server === 'none' && job.serverId !== null) return false;
		if (filters.server !== 'all' && filters.server !== 'none' && job.serverId !== filters.server)
			return false;
		if (filters.state === 'active' && !isJobActive(job)) return false;
		if (filters.state !== 'all' && filters.state !== 'active' && job.state !== filters.state)
			return false;
		if (filters.kind !== 'all' && job.kind !== filters.kind) return false;
		return true;
	});
}

export function filtersActive(filters: JobFilters): boolean {
	return (
		filters.server !== DEFAULT_FILTERS.server ||
		filters.state !== DEFAULT_FILTERS.state ||
		filters.kind !== DEFAULT_FILTERS.kind
	);
}

/** Distinct kinds among loaded jobs, known kinds first in a stable order. */
export function jobKinds(jobs: readonly Job[]): string[] {
	const order = Object.keys(JOB_KIND_LABELS);
	const kinds = [...new Set(jobs.map((job) => job.kind))];
	return kinds.sort((a, b) => {
		const ia = order.indexOf(a);
		const ib = order.indexOf(b);
		if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
		return a.localeCompare(b);
	});
}

// List merging -------------------------------------------------------------------

/** Newest first by `(createdAt, id)`, matching the backend's cursor order. */
export function compareJobs(a: Job, b: Job): number {
	if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Inserts or replaces by id; later arguments win. Keeps backend order. */
export function mergeJobs(current: readonly Job[], incoming: readonly Job[]): Job[] {
	const byId = new Map(current.map((job) => [job.id, job]));
	for (const job of incoming) byId.set(job.id, job);
	return [...byId.values()].sort(compareJobs);
}

// Server links -------------------------------------------------------------------

/**
 * Whether the job's server can be linked: it must still exist, and a successful delete
 * means the record is gone even if the list is stale.
 */
export function canLinkServer(job: Job, knownServerIds: ReadonlySet<string>): boolean {
	if (!job.serverId || !knownServerIds.has(job.serverId)) return false;
	return !(job.kind === 'server.delete' && job.state === 'succeeded');
}
