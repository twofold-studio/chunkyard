import { describe, expect, it } from 'vitest';
import type { ServerView } from '#lib/api/index.js';
import { createServerSource, searchDestinations, serverHref } from './palette.js';

const server = (id: string, extra: Partial<ServerView> = {}): ServerView => ({
	archive: null,
	autoJava: false,
	launchOverride: null,
	publishIp: null,
	icon: null,
	id,
	name: id,
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'img',
	port: 25565,
	memoryMinMb: 1024,
	memoryMaxMb: 2048,
	cpus: 1,
	acceptEula: true,
	directory: '/d',
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	software: null,
	launch: null,
	...extra
});

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
};

describe('palette destinations', () => {
	it('lists app pages and one overview per server without a query', () => {
		const labels = searchDestinations([server('a', { name: 'Alpha' })], '').map((d) => d.label);
		expect(labels).toContain('Servers');
		expect(labels).toContain('New server');
		expect(labels).toContain('Storage & exports');
		expect(labels).toContain('API reference');
		expect(labels).toContain('Alpha — Overview');
		expect(labels).not.toContain('Alpha — Console');
	});

	it('matches servers by software, version, port and tab name with deep links', () => {
		const list = [
			server('p1', { name: 'Paper', port: 25570, software: { type: 'paper', version: '1.21.1' } }),
			server('v1', { name: 'Plain' })
		];
		const console = searchDestinations(list, '1.21 console');
		expect(console.map((d) => d.label)).toEqual(['Paper — Console']);
		expect(console[0].href).toMatch(/\/servers\/p1\?tab=console$/);
		expect(searchDestinations(list, '25570 files')[0].href).toMatch(/\?tab=files$/);
		expect(searchDestinations(list, 'zzz')).toEqual([]);
	});

	it('percent-encodes server IDs so a hostile ID cannot change the route', () => {
		expect(serverHref('../x?y', 'overview')).toMatch(/\/servers\/\.\.%2Fx%3Fy$/);
	});
});

describe('server source', () => {
	it('caches per session key and expires', async () => {
		let t = 0;
		let calls = 0;
		const source = createServerSource(
			async () => (calls++, [server('a')]),
			1000,
			() => t
		);
		await source.fetch('s1');
		expect(source.cached('s1')).toHaveLength(1);
		expect(source.cached('s2')).toBeNull();
		t = 2000;
		expect(source.cached('s1')).toBeNull();
		expect(calls).toBe(1);
	});

	it('drops a late response after cancel and aborts the request', async () => {
		const pending = deferred<ServerView[]>();
		let signal!: AbortSignal;
		const source = createServerSource((s) => ((signal = s), pending.promise));
		const result = source.fetch('s1');
		source.cancel();
		expect(signal.aborted).toBe(true);
		pending.resolve([server('late')]);
		expect(await result).toBeNull();
		expect(source.cached('s1')).toBeNull();
	});

	it('clear forgets cached servers', async () => {
		const source = createServerSource(async () => [server('a')]);
		await source.fetch('s1');
		source.clear();
		expect(source.cached('s1')).toBeNull();
	});
});
