import { ApiError, isAbortError, isApiError } from './client';

export interface ErrorMessage {
	title: string;
	detail: string;
	/** Optional next step for the operator. */
	hint?: string;
}

const ORIGIN_HINT =
	'Open the UI at the exact origin configured as CHUNKYARD_HTTP__PUBLIC_URL (for development, http://localhost:5173).';

const KNOWN: Record<string, Omit<ErrorMessage, 'detail'> & { detail?: string }> = {
	'network.unavailable': {
		title: 'Backend unreachable',
		hint: 'Make sure the Rust backend is running and reachable from this origin.'
	},
	'backend.unavailable': {
		title: 'Backend unavailable',
		hint: 'Make sure the Rust backend is running (default http://127.0.0.1:8420).'
	},
	'auth.csrf': { title: 'Request blocked by origin check', hint: ORIGIN_HINT },
	'http.host': { title: 'Host does not match configuration', hint: ORIGIN_HINT },
	'auth.invalid_credentials': { title: 'Sign-in failed' },
	'auth.throttled': { title: 'Too many attempts', hint: 'Wait a minute before trying again.' },
	'auth.weak_password': { title: 'Password rejected' },
	'setup.invalid_token': {
		title: 'Invalid setup token',
		hint: 'Read the token from <data-dir>/setup-token on the manager host.'
	},
	'setup.already_done': { title: 'Setup already completed', hint: 'Sign in instead.' },
	'auth.disabled': { title: 'Authentication is disabled' },
	'server.jar_missing': {
		title: 'Server JAR missing',
		hint: 'Copy the server JAR into the server directory on the manager host, then start again.'
	},
	'server.eula_required': {
		title: 'EULA not accepted',
		hint: 'Accept the Minecraft EULA in the server configuration while it is stopped.'
	},
	'server.busy': {
		title: 'Operation in progress',
		hint: 'Wait for the current operation to finish.'
	},
	'server.not_installed': {
		title: 'Server software not installed',
		hint: 'Install the server software from the server page, then start again.'
	},
	'server.already_installed': { title: 'Already installed' },
	'software.upstream': { title: 'Software provider unavailable' },
	'software.download_failed': { title: 'Software download failed' },
	'server.running': { title: 'Server is running' },
	'server.not_running': { title: 'Server is not running' },
	'server.port_in_use': {
		title: 'Port already in use',
		hint: 'Another server using this port is running. Stop that server, or choose another port.'
	},
	'server.not_found': { title: 'Server not found' },
	'docker.unavailable': {
		title: 'Docker unavailable',
		hint: 'The manager needs a reachable Linux Docker engine. Check DOCKER_HOST and CHUNKYARD_DOCKER__ENABLED.'
	},
	'docker.identity_mismatch': { title: 'Container ownership mismatch' },
	'docker.failed': { title: 'Docker operation failed' },
	'job.busy': {
		title: 'Job queue is full',
		hint: 'At most four jobs run at once. Try again shortly.'
	},
	'job.interrupted': {
		title: 'Job interrupted',
		hint: 'The manager restarted while the job was running.'
	},
	'java.discovery_disabled': {
		title: 'Discovery disabled',
		hint: 'System Java discovery is turned off with java.allow_system_java = false.'
	},
	'java.installing': { title: 'Install already running' },
	'download.failed': { title: 'Download failed' },
	'version.disabled': {
		title: 'Version information disabled',
		hint: 'The manager hides its version and changelog (CHUNKYARD_HTTP__SHOW_VERSION=false).'
	},
	validation: { title: 'Invalid input' }
};

/** Converts any thrown value or job failure into user-facing text. */
export function describeError(error: unknown): ErrorMessage {
	let code = 'unknown';
	let detail = 'Something went wrong.';
	if (isApiError(error)) {
		code = error.code;
		detail = error.detail;
	} else if (isFailure(error)) {
		code = error.code;
		detail = error.detail;
	} else if (isAbortError(error)) {
		return { title: 'Cancelled', detail: 'The request was cancelled.' };
	} else if (error instanceof Error) {
		detail = error.message;
	}
	const known = KNOWN[code];
	return {
		title: known?.title ?? 'Request failed',
		detail: known?.detail ?? detail,
		hint: known?.hint
	};
}

function isFailure(value: unknown): value is { code: string; detail: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		!(value instanceof ApiError) &&
		typeof (value as { code?: unknown }).code === 'string' &&
		typeof (value as { detail?: unknown }).detail === 'string'
	);
}

export function errorCode(error: unknown): string | undefined {
	if (isApiError(error) || isFailure(error)) return error.code;
	return undefined;
}
