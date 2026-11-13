import {
	installServer,
	waitForJob,
	type Job,
	type JobFailure,
	type ServerView
} from '#lib/api/index.js';

export interface InstallApi {
	installServer: typeof installServer;
	waitForJob: typeof waitForJob;
}

export const defaultInstallApi: InstallApi = { installServer, waitForJob };

export interface InstallOutcome {
	job: Job;
	/** Updated record from the job result, when the job succeeded and returned one. */
	server: ServerView | null;
	/** Sanitized job failure; `null` on success. */
	error: JobFailure | null;
}

export function serverFromResult(result: unknown): ServerView | null {
	if (result && typeof result === 'object' && 'server' in result) {
		const server = (result as { server: unknown }).server;
		if (server && typeof server === 'object' && 'id' in server) return server as ServerView;
	}
	return null;
}

/**
 * `POST /api/v1/servers/{id}/install` (202), then polls the job until it finishes.
 * Request rejections and aborts throw; a failed job resolves with `error` set.
 * Never starts the server or touches EULA acceptance.
 */
export async function installAndWait(
	id: string,
	options: {
		signal?: AbortSignal;
		intervalMs?: number;
		onUpdate?: (job: Job) => void;
		api?: Partial<InstallApi>;
	} = {}
): Promise<InstallOutcome> {
	const api = { ...defaultInstallApi, ...options.api };
	const { job } = await api.installServer(id, { signal: options.signal });
	const final = await api.waitForJob(job, {
		signal: options.signal,
		intervalMs: options.intervalMs ?? 1000,
		onUpdate: options.onUpdate
	});
	if (final.state === 'succeeded') {
		const server = serverFromResult(final.result);
		return { job: final, server: server?.id === id ? server : null, error: null };
	}
	return {
		job: final,
		server: null,
		error: final.error ?? { code: `job.${final.state}`, detail: `The install job ${final.state}.` }
	};
}
