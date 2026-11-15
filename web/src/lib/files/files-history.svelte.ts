/**
 * Folder and open-file locations of the Files browser, recorded in the browser history so the
 * browser's Back/Forward (toolbar, keyboard, mouse side buttons) step through folders.
 *
 * Each location is a SvelteKit shallow entry (`goto(url, { shallow: true, state })`) on the
 * current server page: the URL stays the same, `page.state.files` carries the location. Only
 * real navigation creates entries, so Back from the first folder leaves the page as usual.
 * Entries carry the server ID and are ignored on other servers.
 */
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { ROOT } from './paths.js';

export interface FilesLocation {
	/** Folder shown in the browser (`''` is the server directory). */
	dir: string;
	/** File open in the editor, if any. */
	file: string | null;
}

export interface FilesHistoryEntry extends FilesLocation {
	/** Entries pushed since the page's own entry (0 there). Used to undo a traversal. */
	step: number;
}

/** Shape stored in `page.state.files`. */
export interface FilesPageState extends FilesHistoryEntry {
	server: string;
}

export interface FilesHistory {
	/** Location of the current history entry; the root folder when it records none. */
	readonly current: FilesHistoryEntry;
	/** Records a new location the user navigated to (drops any forward entries). */
	push(location: FilesLocation): void;
	/** Rewrites the current entry without adding one. */
	replace(location: FilesLocation): void;
	/** Moves through history (e.g. back to the entry a cancelled traversal left). */
	go(delta: number): void;
	/** Leaves the current entry for the previous one. */
	back(): void;
}

export const ROOT_ENTRY: FilesHistoryEntry = Object.freeze({ dir: ROOT, file: null, step: 0 });

/** Reads a stored location, accepting it only for this server and well-formed values. */
export function readFilesState(state: unknown, serverId: string): FilesHistoryEntry {
	const files = (state as { files?: unknown } | null | undefined)?.files;
	if (!files || typeof files !== 'object') return ROOT_ENTRY;
	const { server, dir, file, step } = files as Partial<FilesPageState>;
	if (server !== serverId || typeof dir !== 'string') return ROOT_ENTRY;
	return {
		dir,
		file: typeof file === 'string' && file ? file : null,
		step: typeof step === 'number' && Number.isInteger(step) && step >= 0 ? step : 0
	};
}

export function sameLocation(a: FilesLocation, b: FilesLocation): boolean {
	return a.dir === b.dir && a.file === b.file;
}

/** History backed by SvelteKit shallow routing on the current page. */
export function kitFilesHistory(serverId: () => string): FilesHistory {
	const current = $derived(readFilesState(page.state, serverId()));

	function write(location: FilesLocation, replace: boolean) {
		const step = replace ? current.step : current.step + 1;
		const files: FilesPageState = { server: serverId(), ...location, step };
		// Same URL (tab and all): the location lives in the entry's state.
		// SvelteKit supplied this URL; the copy is passed straight to goto, never rendered.
		// eslint-disable-next-line svelte/no-navigation-without-resolve, svelte/prefer-svelte-reactivity
		void goto(new URL((page.shallow?.url ?? page.url).href), {
			shallow: true,
			replace,
			reset: false,
			state: { ...page.state, files }
		});
	}

	return {
		get current() {
			return current;
		},
		push: (location) => write(location, false),
		replace: (location) => write(location, true),
		go: (delta) => history.go(delta),
		back: () => history.back()
	};
}

/** In-memory history with the same semantics (component tests, isolated renders). */
export class MemoryFilesHistory implements FilesHistory {
	entries = $state<FilesHistoryEntry[]>([ROOT_ENTRY]);
	index = $state(0);

	get current() {
		return this.entries[this.index] ?? ROOT_ENTRY;
	}

	push(location: FilesLocation) {
		const step = this.current.step + 1;
		this.entries = [...this.entries.slice(0, this.index + 1), { ...location, step }];
		this.index += 1;
	}

	replace(location: FilesLocation) {
		const next = [...this.entries];
		next[this.index] = { ...location, step: this.current.step };
		this.entries = next;
	}

	go(delta: number) {
		this.index = Math.max(0, Math.min(this.entries.length - 1, this.index + delta));
	}

	back() {
		this.go(-1);
	}
}
