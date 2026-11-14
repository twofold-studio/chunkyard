import { describe, expect, it } from 'vitest';
import { buildExportRequest, parseExportPaths } from './exports';
import { ExportSelectionStore } from './export-selection.svelte';
import {
	addToSelection,
	coveringFolder,
	headerState,
	isSelectable,
	removeFromSelection,
	selectionPaths,
	type SelectedPath
} from './selection';

const dir = (path: string): SelectedPath => ({ path, kind: 'directory' });
const file = (path: string): SelectedPath => ({ path, kind: 'file' });

describe('addToSelection', () => {
	it('selecting a folder replaces its selected descendants', () => {
		const { next, added } = addToSelection(
			[file('world/level.dat'), file('ops.json'), file('world2/x')],
			[dir('world')]
		);
		expect(selectionPaths(next)).toEqual(['ops.json', 'world', 'world2/x']);
		expect(added).toEqual(['world']);
	});

	it('skips entries already covered by a selected folder and duplicates', () => {
		const result = addToSelection([dir('world')], [file('world/level.dat'), dir('world')]);
		expect(result.added).toEqual([]);
		expect(result.covered).toEqual(['world/level.dat']);
		expect(coveringFolder(result.next, 'world/region/r.0.0.mca')).toBe('world');
		expect(coveringFolder(result.next, 'world')).toBeNull();
		expect(coveringFolder(result.next, 'worldedit/config.yml')).toBeNull();
	});

	it('never exceeds the cap and reports the overflow', () => {
		const many = Array.from({ length: 105 }, (_, i) => file(`f${i}`));
		const result = addToSelection([], many);
		expect(result.next).toHaveLength(100);
		expect(result.overflow).toHaveLength(5);
		expect(addToSelection(result.next, [file('extra')]).overflow).toEqual(['extra']);
		// A folder that absorbs selected descendants can still fit at the cap.
		const nested = Array.from({ length: 100 }, (_, i) => file(`logs/${i}.log`));
		expect(addToSelection(nested, [dir('logs')]).next).toEqual([dir('logs')]);
	});

	it('removes paths and computes the tri-state header', () => {
		const sel = [dir('world'), file('ops.json')];
		expect(removeFromSelection(sel, ['ops.json'])).toEqual([dir('world')]);
		expect(headerState(sel, [])).toBe('none');
		expect(headerState(sel, [{ path: 'world' }, { path: 'ops.json' }])).toBe('all');
		expect(headerState(sel, [{ path: 'ops.json' }, { path: 'eula.txt' }])).toBe('some');
		expect(headerState([dir('world')], [{ path: 'world/level.dat' }])).toBe('all');
		expect(headerState([], [{ path: 'x' }])).toBe('none');
	});

	it('allows only regular files and folders', () => {
		expect(isSelectable({ kind: 'file' })).toBe(true);
		expect(isSelectable({ kind: 'directory' })).toBe(true);
		expect(isSelectable({ kind: 'symlink' })).toBe(false);
		expect(isSelectable({ kind: 'other' })).toBe(false);
	});
});

describe('ExportSelectionStore', () => {
	it('keeps selections isolated per server', () => {
		const store = new ExportSelectionStore();
		store.add('a', [dir('world')]);
		store.add('b', [file('ops.json')]);
		expect(store.paths('a')).toEqual(['world']);
		expect(store.paths('b')).toEqual(['ops.json']);
		store.clear('a');
		expect(store.count('a')).toBe(0);
		expect(store.has('b', 'ops.json')).toBe(true);
		store.remove('b', ['ops.json']);
		expect(store.items('b')).toEqual([]);
	});
});

describe('selected paths in export requests', () => {
	it('merges Files selections before typed paths, deduped', () => {
		expect(
			buildExportRequest('selected', 's3', 'ops.json\nplugins/\n', ['ops.json', 'world'])
		).toEqual({
			ok: true,
			request: { scope: 'selected', destination: 's3', paths: ['ops.json', 'world', 'plugins'] }
		});
	});

	it('accepts a selection with no typed paths and enforces the combined cap', () => {
		expect(parseExportPaths('', ['world'])).toEqual({ ok: true, paths: ['world'] });
		const selected = Array.from({ length: 100 }, (_, i) => `f${i}`);
		const result = parseExportPaths('one-more', selected);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('currently 101');
	});

	it('rejects invalid selected paths defensively', () => {
		expect(parseExportPaths('', ['../etc']).ok).toBe(false);
	});

	it('ignores the selection for world and full exports', () => {
		expect(buildExportRequest('all', 'local', '', ['world'])).toEqual({
			ok: true,
			request: { scope: 'all', destination: 'local' }
		});
	});
});
