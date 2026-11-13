import {
	deleteServer,
	waitForJob,
	type DeletedServer,
	type Job,
	type JobFailure
} from '#lib/api/index.js';

export interface DeleteApi {
	deleteServer: typeof deleteServer;
	waitForJob: typeof waitForJob;
}

export interface DeleteOutcome {
	job: Job;
	/** `result.deleted` of a succeeded job; `null` otherwise. */
	deleted: DeletedServer | null;
	/** Sanitized job failure; `null` on success. Cleanup may have partially completed. */
	error: JobFailure | null;
}

export function deletedFromResult(result: unknown, id: string): DeletedServer | null {
	if (!result || typeof result !== 'object' || !('deleted' in result)) return null;
	const deleted = (result as { deleted: unknown }).deleted;
	if (!deleted || typeof deleted !== 'object') return null;
	const d = deleted as Record<string, unknown>;
	if (d.id !== id || typeof d.filesDeleted !== 'boolean') return null;
	return {
		id,
		filesDeleted: d.filesDeleted,
		retainedDirectory: typeof d.retainedDirectory === 'string' ? d.retainedDirectory : null
	};
}

/**
 * `DELETE /api/v1/servers/{id}?deleteFiles=…` (202), then polls only the job until it
 * finishes. The deleted server itself is never fetched again. Request rejections and aborts
 * throw; a failed job resolves with `error` set.
 */
export async function deleteAndWait(
	id: string,
	deleteFiles: boolean,
	options: {
		signal?: AbortSignal;
		intervalMs?: number;
		onUpdate?: (job: Job) => void;
		api?: Partial<DeleteApi>;
	} = {}
): Promise<DeleteOutcome> {
	const api: DeleteApi = { deleteServer, waitForJob, ...options.api };
	const { job } = await api.deleteServer(id, deleteFiles, { signal: options.signal });
	const final = await api.waitForJob(job, {
		signal: options.signal,
		intervalMs: options.intervalMs ?? 1000,
		onUpdate: options.onUpdate
	});
	if (final.state === 'succeeded') {
		return {
			job: final,
			// Older/unknown result shapes still count as deleted; fall back to what was requested.
			deleted: deletedFromResult(final.result, id) ?? {
				id,
				filesDeleted: deleteFiles,
				retainedDirectory: null
			},
			error: null
		};
	}
	return {
		job: final,
		deleted: null,
		error: final.error ?? { code: `job.${final.state}`, detail: `The delete job ${final.state}.` }
	};
}
