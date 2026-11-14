import type { ConsoleLine } from '#lib/api/index.js';

/**
 * Live console over `GET /api/v1/servers/{id}/console/stream` (WebSocket, same-origin
 * cookie auth). Frames: `snapshot` (last lines; replaces the buffer), `line` (append),
 * `error` and `end` (container logs ended). The caller falls back to the snapshot
 * endpoint when WebSockets are unavailable or keep failing.
 */

export type ConsoleFrame =
	| { type: 'snapshot'; lines: ConsoleLine[] }
	| { type: 'line'; line: ConsoleLine }
	| { type: 'error'; code: string; detail: string }
	| { type: 'end' };

function isLine(value: unknown): value is ConsoleLine {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as ConsoleLine).text === 'string' &&
		typeof (value as ConsoleLine).stream === 'string'
	);
}

/** Validates one text frame; anything unexpected is ignored rather than trusted. */
export function parseConsoleFrame(data: unknown): ConsoleFrame | null {
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
		case 'snapshot':
			return Array.isArray(value.lines) && value.lines.every(isLine)
				? { type: 'snapshot', lines: value.lines }
				: null;
		case 'line':
			return isLine(value.line) ? { type: 'line', line: value.line } : null;
		case 'error':
			return {
				type: 'error',
				code: typeof value.code === 'string' ? value.code : 'console.error',
				detail: typeof value.detail === 'string' ? value.detail : ''
			};
		case 'end':
			return { type: 'end' };
		default:
			return null;
	}
}

/** Same-origin WebSocket URL for a server's console stream. */
export function consoleStreamUrl(
	serverId: string,
	location: Pick<Location, 'protocol' | 'host'> = window.location
): string {
	const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${scheme}//${location.host}/api/v1/servers/${encodeURIComponent(serverId)}/console/stream`;
}

export interface ConsoleEntry {
	/** Monotonic key for keyed rendering. */
	id: number;
	line: ConsoleLine;
}

/** Lines kept in the browser; older lines drop off the top. */
export const CONSOLE_BUFFER_LIMIT = 1000;

/** Bounded console buffer: snapshots replace (no duplicates), lines append. */
export class ConsoleBuffer {
	#next = 0;
	readonly limit: number;
	entries: ConsoleEntry[] = [];

	constructor(limit = CONSOLE_BUFFER_LIMIT) {
		this.limit = limit;
	}

	replace(lines: readonly ConsoleLine[]): ConsoleEntry[] {
		this.entries = lines.slice(-this.limit).map((line) => ({ id: this.#next++, line }));
		return this.entries;
	}

	append(line: ConsoleLine): ConsoleEntry[] {
		const next = [...this.entries, { id: this.#next++, line }];
		this.entries = next.length > this.limit ? next.slice(next.length - this.limit) : next;
		return this.entries;
	}
}

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'ended';

export interface ConsoleStreamHandlers {
	onSnapshot: (lines: ConsoleLine[]) => void;
	onLine: (line: ConsoleLine) => void;
	onStatus: (status: StreamStatus) => void;
	onError?: (code: string, detail: string) => void;
	/** WebSockets are unavailable or keep failing: switch to snapshot polling. */
	onFallback: (reason: string) => void;
}

/** Minimal WebSocket surface, so tests can inject a fake. */
export interface SocketLike {
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface ConsoleStreamOptions {
	signal: AbortSignal;
	/** `null` means WebSockets are unavailable (fallback immediately). */
	createSocket: SocketFactory | null;
	url: string;
	/** Backoff between reconnects; exhausting it falls back to polling. */
	retryDelaysMs?: readonly number[];
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 20000] as const;
/** Close codes / error codes that mean the session is gone: stop, let HTTP handle auth. */
const AUTH_CLOSE_CODES = new Set([1008, 4401, 4403]);

/** The browser's WebSocket, or `null` where it does not exist. */
export function browserSocketFactory(): SocketFactory | null {
	if (typeof WebSocket === 'undefined') return null;
	return (url) => new WebSocket(url) as unknown as SocketLike;
}

/**
 * Opens the stream and keeps it alive with bounded backoff until `signal` aborts.
 * Never runs two sockets at once. A container ending reconnects while the caller
 * still considers the instance running; its abort signal stops a normal shutdown.
 */
export function connectConsoleStream(
	handlers: ConsoleStreamHandlers,
	options: ConsoleStreamOptions
): void {
	const delays = options.retryDelaysMs ?? RECONNECT_DELAYS_MS;
	let socket: SocketLike | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let attempt = 0;
	let done = false;

	const stop = () => {
		done = true;
		if (timer !== null) clearTimeout(timer);
		timer = null;
		const current = socket;
		socket = null;
		if (current) {
			current.onopen = current.onmessage = current.onclose = current.onerror = null;
			current.close(1000, 'client closed');
		}
	};

	const fallback = (reason: string) => {
		if (done) return;
		stop();
		handlers.onFallback(reason);
	};

	if (options.signal.aborted) return;
	options.signal.addEventListener('abort', stop, { once: true });

	if (!options.createSocket) {
		fallback('unsupported');
		return;
	}
	const create = options.createSocket;

	const open = () => {
		if (done) return;
		handlers.onStatus(attempt === 0 ? 'connecting' : 'reconnecting');
		let ws: SocketLike;
		try {
			ws = create(options.url);
		} catch {
			fallback('unsupported');
			return;
		}
		socket = ws;
		ws.onopen = () => handlers.onStatus('live');
		ws.onmessage = (event) => {
			const frame = parseConsoleFrame(event.data);
			if (!frame) return;
			if (frame.type === 'snapshot') {
				// Only a working stream resets the backoff, so a flapping socket cannot spin.
				attempt = 0;
				handlers.onSnapshot(frame.lines);
			} else if (frame.type === 'line') handlers.onLine(frame.line);
			else if (frame.type === 'error') {
				handlers.onError?.(frame.code, frame.detail);
				if (frame.code.startsWith('auth.')) fallback('auth');
			} else if (frame.type === 'end') {
				handlers.onStatus('ended');
				ws.close(1000, 'container output ended');
			}
		};
		ws.onerror = () => {
			// A close event always follows; reconnect logic lives there.
		};
		ws.onclose = (event) => {
			if (done || socket !== ws) return;
			socket = null;
			if (AUTH_CLOSE_CODES.has(event.code)) return fallback('auth');
			if (attempt >= delays.length) return fallback('unreachable');
			handlers.onStatus('reconnecting');
			timer = setTimeout(() => {
				timer = null;
				open();
			}, delays[attempt]);
			attempt += 1;
		};
	};

	open();
}
