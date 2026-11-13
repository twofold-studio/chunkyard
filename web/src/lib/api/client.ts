/**
 * Minimal same-origin JSON client for the Rust backend.
 *
 * - Always uses relative `/api/...` paths and `credentials: 'same-origin'`; the
 *   backend has no CORS support, so the SPA must share its origin (Vite proxy in dev).
 * - Every mutation sends `X-MCM-CSRF: 1`. The browser adds the matching `Origin`.
 * - Errors are normalised into {@link ApiError} with the backend's stable `code`.
 */

export type Fetch = typeof fetch;

/** Codes produced locally when no problem+json body is available. */
export const NETWORK_UNAVAILABLE = 'network.unavailable';
export const BACKEND_UNAVAILABLE = 'backend.unavailable';
export const UNEXPECTED_RESPONSE = 'response.unexpected';

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly detail: string;

	constructor(status: number, code: string, detail: string) {
		super(detail);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.detail = detail;
	}

	/** True when the backend could not be reached at all (or a proxy reported it down). */
	get unreachable(): boolean {
		return this.code === NETWORK_UNAVAILABLE || this.code === BACKEND_UNAVAILABLE;
	}
}

export function isApiError(error: unknown): error is ApiError {
	return error instanceof ApiError;
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

export interface RequestOptions {
	method?: 'GET' | 'POST';
	body?: unknown;
	signal?: AbortSignal;
	/** SvelteKit's `fetch` inside load functions; defaults to the global. */
	fetch?: Fetch;
}

type AuthListener = (error: ApiError) => void;
let authListener: AuthListener | null = null;

/**
 * Registers a single handler invoked when a protected request reports that the
 * session is missing/expired (`auth.required`) or setup is pending (`setup_required`).
 * Returns an unsubscribe function.
 */
export function onAuthLost(listener: AuthListener): () => void {
	authListener = listener;
	return () => {
		if (authListener === listener) authListener = null;
	};
}

export function isAuthLost(error: unknown): error is ApiError {
	return isApiError(error) && (error.code === 'auth.required' || error.code === 'setup_required');
}

async function parseProblem(response: Response): Promise<ApiError> {
	const type = response.headers.get('content-type') ?? '';
	if (type.includes('json')) {
		try {
			const body = (await response.json()) as { code?: unknown; detail?: unknown };
			if (typeof body.code === 'string') {
				return new ApiError(
					response.status,
					body.code,
					typeof body.detail === 'string' ? body.detail : response.statusText
				);
			}
		} catch {
			// fall through to the generic mapping below
		}
	}
	// No problem body: a proxy (e.g. the Vite dev proxy) answered because the backend is down.
	if (
		response.status === 502 ||
		response.status === 503 ||
		response.status === 504 ||
		response.status === 500
	) {
		return new ApiError(
			response.status,
			BACKEND_UNAVAILABLE,
			'The Chunkyard backend did not respond.'
		);
	}
	return new ApiError(
		response.status,
		UNEXPECTED_RESPONSE,
		`Unexpected response (${response.status}).`
	);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const method = options.method ?? 'GET';
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (method !== 'GET') headers['X-MCM-CSRF'] = '1';
	let body: string | undefined;
	if (options.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(options.body);
	}

	const doFetch = options.fetch ?? fetch;
	let response: Response;
	try {
		response = await doFetch(path, {
			method,
			headers,
			body,
			credentials: 'same-origin',
			signal: options.signal
		});
	} catch (error) {
		if (isAbortError(error)) throw error;
		throw new ApiError(0, NETWORK_UNAVAILABLE, 'The Chunkyard backend is unreachable.');
	}

	if (!response.ok) {
		const error = await parseProblem(response);
		if (isAuthLost(error)) authListener?.(error);
		throw error;
	}
	if (response.status === 204) return undefined as T;
	try {
		return (await response.json()) as T;
	} catch (error) {
		if (isAbortError(error)) throw error;
		throw new ApiError(response.status, UNEXPECTED_RESPONSE, 'The backend returned invalid JSON.');
	}
}
