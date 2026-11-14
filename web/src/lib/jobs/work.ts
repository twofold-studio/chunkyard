/**
 * Stage/byte observations of a job (`Job.work`). The backend reports what it actually saw:
 * the current stage, byte counts of that stage only, and earlier transitions. The UI never
 * derives an overall percentage from them, never fills in skipped steps, and treats the job
 * state (queued/running/succeeded/failed) as authoritative over the last observation.
 */
import type { Job, JobState, JobWorkStage } from '#lib/api/index.js';
import { formatBytes } from '#lib/metrics.js';

/** Mirrors the backend bound on `completedStages`. */
export const WORK_HISTORY_LIMIT = 32;

interface StageText {
	/** Current-stage wording, e.g. "Downloading". */
	active: string;
	/** Completed-step wording, e.g. "Download". */
	done: string;
	/** What the stage's byte count measures. */
	bytes: string;
}

export const WORK_STAGES: Record<JobWorkStage, StageText> = {
	resolve: { active: 'Resolving release', done: 'Resolve', bytes: 'processed' },
	download: { active: 'Downloading', done: 'Download', bytes: 'downloaded' },
	verify: { active: 'Verifying checksum', done: 'Verify', bytes: 'checked' },
	extract: { active: 'Extracting', done: 'Extract', bytes: 'extracted' },
	prepare_loader: { active: 'Preparing loader', done: 'Prepare loader', bytes: 'processed' },
	finalize: { active: 'Finalizing', done: 'Finalize', bytes: 'processed' },
	scan: { active: 'Scanning files', done: 'Scan', bytes: 'scanned' },
	compress: { active: 'Compressing', done: 'Compress', bytes: 'written' },
	upload: { active: 'Uploading to storage', done: 'Upload', bytes: 'sent' },
	verify_upload: {
		active: 'Verifying upload (checksum read-back)',
		done: 'Verify upload',
		bytes: 'read back'
	},
	// Restore and local-file removal (archive) jobs.
	fetch_archive: { active: 'Fetching archive', done: 'Fetch archive', bytes: 'fetched' },
	verify_archive: { active: 'Verifying archive', done: 'Verify archive', bytes: 'checked' },
	restore: { active: 'Restoring files', done: 'Restore', bytes: 'restored' }
};

/** Stage names a newer backend might add: short snake_case only, anything else is rejected. */
const STAGE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function isKnownStage(stage: string): stage is JobWorkStage {
	return Object.hasOwn(WORK_STAGES, stage);
}

function humanize(stage: string): string {
	const words = stage.replace(/_+/g, ' ').trim();
	return words[0].toUpperCase() + words.slice(1);
}

export function stageText(stage: string): StageText {
	if (isKnownStage(stage)) return WORK_STAGES[stage];
	const label = humanize(stage);
	return { active: label, done: label, bytes: 'processed' };
}

function readStage(value: unknown): string | null {
	return typeof value === 'string' && STAGE_PATTERN.test(value) ? value : null;
}

function readBytes(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** A validated observation. Unknown-but-well-formed stages are kept with a readable label. */
export interface WorkObservation {
	stage: string;
	completedBytes: number | null;
	/** Positive known size of the current stage, else `null`. */
	totalBytes: number | null;
	completedStages: string[];
}

/**
 * Validates `Job.work`. Old builds omit it, older jobs return `null`; anything malformed
 * (wrong types, unsafe stage names) yields `null` so callers fall back to generic states.
 */
export function readJobWork(value: unknown): WorkObservation | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	const stage = readStage(raw.stage);
	if (!stage) return null;
	const total = readBytes(raw.totalBytes);
	const history = Array.isArray(raw.completedStages) ? raw.completedStages : [];
	return {
		stage,
		completedBytes: readBytes(raw.completedBytes),
		totalBytes: total !== null && total > 0 ? total : null,
		completedStages: history
			.slice(-WORK_HISTORY_LIMIT)
			.map(readStage)
			.filter((s): s is string => s !== null)
	};
}

/**
 * Percent of the current stage only. Requires a positive known total and a count within it;
 * a count beyond the total is inconsistent and shows bytes without a percentage.
 */
export function stagePercent(work: WorkObservation): number | null {
	const { completedBytes: done, totalBytes: total } = work;
	if (done === null || total === null || done > total) return null;
	return Math.floor((done / total) * 100);
}

/** "40.0 MB of 95.0 MB sent", "12.0 MB written" (unknown size), or `null` without a count. */
export function workBytesText(work: WorkObservation): string | null {
	if (work.completedBytes === null) return null;
	const noun = stageText(work.stage).bytes;
	const done = formatBytes(work.completedBytes);
	if (work.totalBytes !== null && work.completedBytes <= work.totalBytes) {
		return `${done} of ${formatBytes(work.totalBytes)} ${noun}`;
	}
	return `${done} ${noun}`;
}

export interface WorkStep {
	stage: string;
	label: string;
	/** Consecutive repeats (e.g. several downloaded artifacts). */
	count: number;
}

/** Observed earlier steps with consecutive repeats merged. */
export function workHistory(work: WorkObservation): WorkStep[] {
	const steps: WorkStep[] = [];
	for (const stage of work.completedStages) {
		const last = steps.at(-1);
		if (last && last.stage === stage) last.count++;
		else steps.push({ stage, label: stageText(stage).done, count: 1 });
	}
	return steps;
}

/** True when the backend's bounded history may have dropped earlier steps. */
export function historyTruncated(work: WorkObservation): boolean {
	return work.completedStages.length >= WORK_HISTORY_LIMIT;
}

export type WorkPhase = JobState | 'interrupted';

export interface JobWorkView {
	phase: WorkPhase;
	headline: string;
	work: WorkObservation | null;
	/** Current-stage percent; only while running with a positive known total. */
	percent: number | null;
	bytes: string | null;
	history: WorkStep[];
	truncated: boolean;
}

function phaseOf(job: Job): WorkPhase {
	if (job.state === 'failed' && job.error?.code === 'job.interrupted') return 'interrupted';
	return job.state;
}

/**
 * Combines the authoritative job state with the last observation. `fallback` names running
 * work when no stage was observed (older builds or jobs).
 */
export function describeJobWork(job: Job, fallback = 'Working'): JobWorkView {
	const work = readJobWork(job.work);
	const phase = phaseOf(job);
	const label = work ? stageText(work.stage).active : null;
	let headline: string;
	switch (phase) {
		case 'queued':
			headline = 'Queued · waiting for a free worker';
			break;
		case 'running':
			headline = label ?? fallback;
			break;
		case 'succeeded':
			headline = 'Completed';
			break;
		case 'interrupted':
			headline = label ? `Interrupted during ${lower(label)}` : 'Interrupted';
			break;
		case 'failed':
			headline = label ? `Failed during ${lower(label)}` : 'Failed';
			break;
		default:
			headline = 'Cancelled';
	}
	// Byte counts describe the stage in flight; after success they would read as unfinished.
	const showBytes = work !== null && phase !== 'succeeded' && phase !== 'queued';
	return {
		phase,
		headline,
		work,
		percent: work && phase === 'running' ? stagePercent(work) : null,
		bytes: showBytes ? workBytesText(work) : null,
		history: work ? workHistory(work) : [],
		truncated: work ? historyTruncated(work) : false
	};
}

function lower(label: string): string {
	return label[0].toLowerCase() + label.slice(1);
}
