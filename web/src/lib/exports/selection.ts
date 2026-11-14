/**
 * Pure helpers for the Files → Export selection. A selection is a set of instance-relative
 * file and folder paths taken from real directory listings. Folders are exported
 * recursively by the backend, so a selected folder covers everything beneath it and its
 * descendants are never listed separately.
 */
import type { FileEntry } from '#lib/api/index.js';
import { MAX_SELECTED_PATHS } from './exports.js';

export interface SelectedPath {
	path: string;
	kind: 'file' | 'directory';
}

/** Only regular files and folders can be exported; symlinks/special files fail the job. */
export function isSelectable(
	entry: Pick<FileEntry, 'kind'>
): entry is { kind: 'file' | 'directory' } {
	return entry.kind === 'file' || entry.kind === 'directory';
}

/** The selected folder that already includes `path` (a strict ancestor), if any. */
export function coveringFolder(selection: readonly SelectedPath[], path: string): string | null {
	for (const item of selection) {
		if (item.kind === 'directory' && path.startsWith(`${item.path}/`)) return item.path;
	}
	return null;
}

export interface AddResult {
	next: SelectedPath[];
	/** Paths newly added. */
	added: string[];
	/** Paths skipped because a selected folder already includes them. */
	covered: string[];
	/** Paths not added because the cap was reached. */
	overflow: string[];
}

/**
 * Adds entries in order. Selecting a folder replaces any of its selected descendants (they
 * are included anyway); entries already covered by a selected folder are skipped. Never
 * exceeds `cap` paths.
 */
export function addToSelection(
	current: readonly SelectedPath[],
	entries: readonly SelectedPath[],
	cap = MAX_SELECTED_PATHS
): AddResult {
	let next = [...current];
	const added: string[] = [];
	const covered: string[] = [];
	const overflow: string[] = [];
	for (const entry of entries) {
		if (next.some((item) => item.path === entry.path)) continue;
		if (coveringFolder(next, entry.path)) {
			covered.push(entry.path);
			continue;
		}
		const withoutDescendants =
			entry.kind === 'directory'
				? next.filter((item) => !item.path.startsWith(`${entry.path}/`))
				: next;
		if (withoutDescendants.length >= cap) {
			overflow.push(entry.path);
			continue;
		}
		next = [...withoutDescendants, entry];
		added.push(entry.path);
	}
	return { next, added, covered, overflow };
}

export function removeFromSelection(
	current: readonly SelectedPath[],
	paths: readonly string[]
): SelectedPath[] {
	const drop = new Set(paths);
	return current.filter((item) => !drop.has(item.path));
}

/** Sorted paths, as sent to `POST /servers/{id}/exports`. */
export function selectionPaths(selection: readonly SelectedPath[]): string[] {
	return selection.map((item) => item.path).sort((a, b) => a.localeCompare(b));
}

export type HeaderState = 'none' | 'some' | 'all';

/** Tri-state of the "select all visible" checkbox for the given visible selectable entries. */
export function headerState(
	selection: readonly SelectedPath[],
	visible: readonly Pick<FileEntry, 'path'>[]
): HeaderState {
	if (visible.length === 0) return 'none';
	let hit = 0;
	for (const entry of visible) {
		if (
			selection.some((item) => item.path === entry.path) ||
			coveringFolder(selection, entry.path)
		) {
			hit++;
		}
	}
	return hit === 0 ? 'none' : hit === visible.length ? 'all' : 'some';
}
