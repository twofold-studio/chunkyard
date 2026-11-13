import { getJob } from './endpoints';
import type { Job } from './types';

export function isJobActive(job: Pick<Job, 'state'>): boolean {
	return job.state === 'queued' || job.state === 'running';
}

/** Resolves after `ms`, or rejects with an AbortError when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
		}
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

export interface WaitForJobOptions {
	signal?: AbortSignal;
	intervalMs?: number;
	onUpdate?: (job: Job) => void;
	/** Injected for tests. */
	fetchJob?: (id: string, signal?: AbortSignal) => Promise<Job>;
}

/**
 * Polls `GET /api/v1/jobs/{id}` until the job leaves `queued`/`running`.
 * Progress stays indeterminate; callers must not invent percentages.
 */
export async function waitForJob(initial: Job, options: WaitForJobOptions = {}): Promise<Job> {
	const interval = options.intervalMs ?? 1000;
	const fetchJob = options.fetchJob ?? ((id, signal) => getJob(id, { signal }));
	let job = initial;
	options.onUpdate?.(job);
	while (isJobActive(job)) {
		await sleep(interval, options.signal);
		job = await fetchJob(job.id, options.signal);
		options.onUpdate?.(job);
	}
	return job;
}
