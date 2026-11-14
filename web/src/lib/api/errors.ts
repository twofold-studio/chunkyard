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
		hint: 'Accept the Minecraft EULA in the server settings while it is stopped.'
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
	'software.download_unavailable': {
		title: 'Download not allowed',
		hint: 'The pack author disabled third-party downloads for this file. Choose another release or upload the server files yourself.'
	},
	'software.pack_unsupported': {
		title: 'Server pack not supported',
		hint: 'Retry with Advanced options (Minecraft version, loader, Java or a launch target), or create a Custom JAR server and upload the files.'
	},
	'software.files_conflict': {
		title: 'Files already exist',
		hint: 'The install never overwrites unrelated files. Move or delete the conflicting files in Files, then retry.'
	},
	'software.install_failed': {
		title: 'Install failed',
		hint: 'Check the details, adjust Advanced options if the pack needs it, and retry. The server record is kept.'
	},
	'server.launch_missing': {
		title: 'Launch target missing',
		hint: 'The configured launch file does not exist. Fix it in Files or in Settings → Launch, then start again.'
	},
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
	'files.path_invalid': { title: 'Invalid path' },
	'files.symlink': {
		title: 'Symbolic link',
		hint: 'Links are listed but never followed. Change them on the manager host.'
	},
	'files.protected': { title: 'Protected file' },
	'files.not_found': { title: 'File not found', hint: 'Refresh the listing; it may have changed.' },
	'files.exists': { title: 'Already exists' },
	'files.conflict': {
		title: 'File changed elsewhere',
		hint: 'Reload the file to see the latest version before saving again.'
	},
	'files.not_empty': { title: 'Folder is not empty' },
	'properties.conflict': {
		title: 'Properties changed elsewhere',
		hint: 'Reload the latest version, or keep yours to save it on top.'
	},
	'properties.not_found': { title: 'Properties version not found' },
	'properties.invalid': { title: 'Properties rejected' },
	'properties.too_large': {
		title: 'Properties too large',
		hint: 'server.properties is limited to 1 MiB.'
	},
	'properties.storage': { title: 'Could not store properties' },
	'files.server_running': {
		title: 'Server is running',
		hint: 'Stop the server to change its files. Changes take effect on the next start.'
	},
	'files.too_large': { title: 'File too large' },
	'files.binary': {
		title: 'Not a text file',
		hint: 'Only UTF-8 text can be edited here. Download the file instead.'
	},
	'files.io': { title: 'File operation failed' },
	'exports.invalid': { title: 'Export rejected' },
	'exports.not_found': {
		title: 'Archive not found',
		hint: 'It may have been deleted. Refresh the archive list.'
	},
	'exports.limit': {
		title: 'Export too large',
		hint: 'Archives are limited to 100 GiB of input, 5 GiB compressed and 100,000 entries. Export the world or selected paths instead.'
	},
	'exports.storage': {
		title: 'Storage unavailable',
		hint: 'Check the S3 connection under Storage & exports and test it. Instance files are never removed when an upload fails.'
	},
	'exports.busy': {
		title: 'Export in progress',
		hint: 'Wait for the current export or storage change to finish.'
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
