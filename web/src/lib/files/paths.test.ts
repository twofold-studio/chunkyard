import { describe, expect, it } from 'vitest';
import type { FileEntry } from '#lib/api/index.js';
import {
	baseName,
	breadcrumbs,
	filterEntries,
	formatBytes,
	joinPath,
	parentPath,
	parseRelativePath,
	sortEntries,
	validateName
} from './paths';

const entry = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({
	name,
	path: name,
	kind: 'file',
	size: 0,
	modifiedAt: null,
	readOnly: false,
	...extra
});

describe('validateName', () => {
	it('accepts ordinary names, including dots and spaces', () => {
		for (const name of ['server.properties', 'world_nether', '.hidden', 'My World', 'a..b']) {
			expect(validateName(name)).toBeNull();
		}
	});

	it('rejects traversal, separators, control characters and empty names', () => {
		for (const name of [
			'',
			'   ',
			'.',
			'..',
			'a/b',
			'a\\b',
			'bad\u0000name',
			'x\ny',
			'a'.repeat(256)
		]) {
			expect(validateName(name)).not.toBeNull();
		}
	});
});

describe('parseRelativePath', () => {
	it('normalises leading and trailing slashes', () => {
		expect(parseRelativePath('/plugins/old/')).toEqual({ ok: true, path: 'plugins/old' });
	});

	it('never yields a path that escapes the server directory', () => {
		for (const input of ['..', '../etc/passwd', 'a/../../b', 'a/./b', 'a//b', 'C:\\x', '', '/']) {
			expect(parseRelativePath(input).ok).toBe(false);
		}
	});
});

describe('path helpers', () => {
	it('joins, splits and builds breadcrumbs from the root', () => {
		expect(joinPath('', 'world')).toBe('world');
		expect(joinPath('world', 'region')).toBe('world/region');
		expect(parentPath('world/region/r.0.0.mca')).toBe('world/region');
		expect(parentPath('world')).toBe('');
		expect(baseName('world/region/r.0.0.mca')).toBe('r.0.0.mca');
		expect(breadcrumbs('world/region')).toEqual([
			{ name: 'Server', path: '' },
			{ name: 'world', path: 'world' },
			{ name: 'region', path: 'world/region' }
		]);
	});

	it('sorts directories first, then by the chosen key', () => {
		const items = [
			entry('b.txt', { size: 10, modifiedAt: '2026-01-02T00:00:00Z' }),
			entry('world', { kind: 'directory' }),
			entry('a10.txt', { size: 5, modifiedAt: '2026-01-03T00:00:00Z' }),
			entry('a2.txt', { size: 50, modifiedAt: '2026-01-01T00:00:00Z' })
		];
		expect(sortEntries(items, 'name', 'asc').map((e) => e.name)).toEqual([
			'world',
			'a2.txt',
			'a10.txt',
			'b.txt'
		]);
		expect(sortEntries(items, 'size', 'desc').map((e) => e.name)).toEqual([
			'world',
			'a2.txt',
			'b.txt',
			'a10.txt'
		]);
		expect(sortEntries(items, 'modified', 'desc')[1].name).toBe('a10.txt');
		expect(filterEntries(items, 'A1').map((e) => e.name)).toEqual(['a10.txt']);
	});

	it('formats sizes in binary units', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1536)).toBe('1.5 KiB');
		expect(formatBytes(128 * 1024 * 1024)).toBe('128 MiB');
	});
});
