import { describe, expect, it } from 'vitest';
import type { ServerView } from '#lib/api/index.js';
import {
	applyView,
	countLabel,
	DEFAULT_VIEW,
	isFiltered,
	loadSortPreference,
	matchesQuery,
	saveSortPreference,
	softwareOptions
} from './list-view.js';

const server = (id: string, extra: Partial<ServerView> = {}): ServerView => ({
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

const running = { state: 'running', containerId: 'c', exitCode: null, oomKilled: false } as const;
const servers = [
	server('b', { name: 'Survival 10', port: 25570, software: { type: 'paper', version: '1.21.1' } }),
	server('a', { name: 'creative', port: 25566, status: running }),
	server('c', { name: 'Survival 2', port: 25566, software: { type: 'vanilla', version: '1.20.4' } })
];

describe('server list view', () => {
	it('matches name, software, version and port with every term', () => {
		expect(matchesQuery(servers[0], 'paper 1.21')).toBe(true);
		expect(matchesQuery(servers[0], 'SURVIVAL')).toBe(true);
		expect(matchesQuery(servers[0], '25570')).toBe(true);
		expect(matchesQuery(servers[1], 'custom')).toBe(true);
		expect(matchesQuery(servers[0], 'paper vanilla')).toBe(false);
		expect(matchesQuery(servers[0], '   ')).toBe(true);
	});

	it('sorts deterministically by name (numeric), state and port', () => {
		const ids = (sort: 'name' | 'state' | 'port') =>
			applyView(servers, { ...DEFAULT_VIEW, sort }).map((s) => s.id);
		expect(ids('name')).toEqual(['a', 'c', 'b']);
		expect(ids('state')).toEqual(['a', 'c', 'b']);
		expect(ids('port')).toEqual(['a', 'c', 'b']);
		expect(applyView([...servers].reverse(), { ...DEFAULT_VIEW, sort: 'port' })).toEqual(
			applyView(servers, { ...DEFAULT_VIEW, sort: 'port' })
		);
	});

	it('filters by state and software without mutating the input', () => {
		const before = servers.map((s) => s.id);
		expect(applyView(servers, { ...DEFAULT_VIEW, state: 'running' }).map((s) => s.id)).toEqual([
			'a'
		]);
		expect(applyView(servers, { ...DEFAULT_VIEW, software: 'custom' }).map((s) => s.id)).toEqual([
			'a'
		]);
		expect(servers.map((s) => s.id)).toEqual(before);
		expect(softwareOptions(servers)).toEqual(['custom', 'paper', 'vanilla']);
	});

	it('labels counts relative to the loaded records only', () => {
		expect(countLabel(3, 3, false)).toBe('3 servers');
		expect(countLabel(1, 1, false)).toBe('1 server');
		expect(countLabel(2, 5, true)).toBe('2 of 5 loaded servers');
		expect(isFiltered(DEFAULT_VIEW)).toBe(false);
		expect(isFiltered({ ...DEFAULT_VIEW, query: ' x ' })).toBe(true);
	});

	it('persists only a valid sort preference and survives broken storage', () => {
		const map = new Map<string, string>();
		const storage = {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v)
		};
		saveSortPreference(storage, 'port');
		expect(loadSortPreference(storage)).toBe('port');
		expect([...map.values()]).toEqual(['port']);
		map.set([...map.keys()][0], 'evil');
		expect(loadSortPreference(storage)).toBe('name');
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};
		expect(loadSortPreference(broken)).toBe('name');
		expect(() => saveSortPreference(broken, 'state')).not.toThrow();
		expect(loadSortPreference(undefined)).toBe('name');
	});
});
