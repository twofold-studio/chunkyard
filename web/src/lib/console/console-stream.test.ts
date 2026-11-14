import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ConsoleBuffer,
	connectConsoleStream,
	consoleStreamUrl,
	parseConsoleFrame,
	type ConsoleStreamHandlers,
	type SocketLike
} from './console-stream';

class FakeSocket implements SocketLike {
	static all: FakeSocket[] = [];
	onopen: SocketLike['onopen'] = null;
	onmessage: SocketLike['onmessage'] = null;
	onclose: SocketLike['onclose'] = null;
	onerror: SocketLike['onerror'] = null;
	closed = false;
	constructor(readonly url: string) {
		FakeSocket.all.push(this);
	}
	close() {
		this.closed = true;
	}
	open() {
		this.onopen?.(new Event('open'));
	}
	send(frame: unknown) {
		this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
	}
	drop(code = 1006) {
		this.onclose?.({ code } as CloseEvent);
	}
}

const line = (text: string) => ({ stream: 'stdout', text });

function handlers() {
	return {
		onSnapshot: vi.fn(),
		onLine: vi.fn(),
		onStatus: vi.fn(),
		onError: vi.fn(),
		onFallback: vi.fn()
	};
}

function connect(h: ConsoleStreamHandlers, abort = new AbortController(), delays = [100, 200]) {
	connectConsoleStream(h, {
		signal: abort.signal,
		createSocket: (url) => new FakeSocket(url),
		url: 'ws://x/api/v1/servers/s/console/stream',
		retryDelaysMs: delays
	});
	return abort;
}

beforeEach(() => {
	vi.useFakeTimers();
	FakeSocket.all = [];
});
afterEach(() => vi.useRealTimers());

describe('parseConsoleFrame', () => {
	it('accepts the documented frames and ignores anything else', () => {
		expect(parseConsoleFrame(JSON.stringify({ type: 'snapshot', lines: [line('a')] }))).toEqual({
			type: 'snapshot',
			lines: [line('a')]
		});
		expect(parseConsoleFrame(JSON.stringify({ type: 'end' }))).toEqual({ type: 'end' });
		expect(parseConsoleFrame('not json')).toBeNull();
		expect(parseConsoleFrame(JSON.stringify({ type: 'line', line: { text: 1 } }))).toBeNull();
		expect(parseConsoleFrame(JSON.stringify({ type: 'other' }))).toBeNull();
		expect(parseConsoleFrame(new ArrayBuffer(2))).toBeNull();
	});

	it('builds a same-origin ws/wss URL', () => {
		expect(consoleStreamUrl('a b', { protocol: 'https:', host: 'mc.example:8443' })).toBe(
			'wss://mc.example:8443/api/v1/servers/a%20b/console/stream'
		);
		expect(consoleStreamUrl('s', { protocol: 'http:', host: 'localhost:5173' })).toBe(
			'ws://localhost:5173/api/v1/servers/s/console/stream'
		);
	});
});

describe('ConsoleBuffer', () => {
	it('replaces on snapshot and caps appended lines', () => {
		const buffer = new ConsoleBuffer(3);
		buffer.replace([line('a'), line('b')]);
		buffer.replace([line('a'), line('b')]);
		expect(buffer.entries.map((e) => e.line.text)).toEqual(['a', 'b']);
		buffer.append(line('c'));
		buffer.append(line('d'));
		expect(buffer.entries.map((e) => e.line.text)).toEqual(['b', 'c', 'd']);
		expect(new Set(buffer.entries.map((e) => e.id)).size).toBe(3);
	});
});

describe('connectConsoleStream', () => {
	it('delivers snapshot and lines over one socket', () => {
		const h = handlers();
		connect(h);
		const socket = FakeSocket.all[0];
		socket.open();
		socket.send({ type: 'snapshot', lines: [line('a')] });
		socket.send({ type: 'line', line: line('b') });
		expect(h.onStatus).toHaveBeenLastCalledWith('live');
		expect(h.onSnapshot).toHaveBeenCalledWith([line('a')]);
		expect(h.onLine).toHaveBeenCalledWith(line('b'));
	});

	it('reconnects with bounded backoff, then falls back to polling', () => {
		const h = handlers();
		connect(h);
		FakeSocket.all[0].drop();
		expect(h.onStatus).toHaveBeenLastCalledWith('reconnecting');
		vi.advanceTimersByTime(99);
		expect(FakeSocket.all).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(FakeSocket.all).toHaveLength(2);
		FakeSocket.all[1].drop();
		vi.advanceTimersByTime(200);
		expect(FakeSocket.all).toHaveLength(3);
		FakeSocket.all[2].drop();
		expect(h.onFallback).toHaveBeenCalledWith('unreachable');
		vi.advanceTimersByTime(10_000);
		expect(FakeSocket.all).toHaveLength(3);
	});

	it('a working snapshot resets the backoff', () => {
		const h = handlers();
		connect(h);
		FakeSocket.all[0].drop();
		vi.advanceTimersByTime(100);
		FakeSocket.all[1].send({ type: 'snapshot', lines: [] });
		FakeSocket.all[1].drop();
		vi.advanceTimersByTime(100);
		expect(FakeSocket.all).toHaveLength(3);
	});

	it('reconnects after container output ends, but stops on auth failures', () => {
		const h = handlers();
		connect(h);
		FakeSocket.all[0].send({ type: 'end' });
		expect(h.onStatus).toHaveBeenLastCalledWith('ended');
		expect(FakeSocket.all[0].closed).toBe(true);
		FakeSocket.all[0].drop(1000);
		vi.advanceTimersByTime(1000);
		expect(FakeSocket.all).toHaveLength(2);

		const auth = handlers();
		connect(auth);
		FakeSocket.all[2].drop(4401);
		expect(auth.onFallback).toHaveBeenCalledWith('auth');
	});

	it('closes the socket and cancels reconnects when aborted', () => {
		const h = handlers();
		const abort = connect(h);
		FakeSocket.all[0].drop();
		abort.abort();
		vi.advanceTimersByTime(10_000);
		expect(FakeSocket.all).toHaveLength(1);

		const live = handlers();
		const second = connect(live);
		second.abort();
		expect(FakeSocket.all[1].closed).toBe(true);
	});

	it('falls back immediately without WebSocket support', () => {
		const h = handlers();
		connectConsoleStream(h, {
			signal: new AbortController().signal,
			createSocket: null,
			url: 'ws://x'
		});
		expect(h.onFallback).toHaveBeenCalledWith('unsupported');
	});
});
