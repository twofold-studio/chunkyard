/**
 * Per-server Files → Export selection shared by the Files and Exports tabs. Kept in memory
 * for this browser tab, so it survives tab switches and in-app navigation (and returning
 * to the server) but not a reload. Each server has its own isolated selection.
 */
import { MAX_SELECTED_PATHS } from './exports.js';
import {
	addToSelection,
	removeFromSelection,
	selectionPaths,
	type AddResult,
	type SelectedPath
} from './selection.js';

export class ExportSelectionStore {
	#byServer = $state<Record<string, SelectedPath[]>>({});

	items(serverId: string): SelectedPath[] {
		return this.#byServer[serverId] ?? [];
	}

	paths(serverId: string): string[] {
		return selectionPaths(this.items(serverId));
	}

	count(serverId: string): number {
		return this.items(serverId).length;
	}

	has(serverId: string, path: string): boolean {
		return this.items(serverId).some((item) => item.path === path);
	}

	add(serverId: string, entries: readonly SelectedPath[], cap = MAX_SELECTED_PATHS): AddResult {
		const result = addToSelection(this.items(serverId), entries, cap);
		if (result.added.length) this.#byServer[serverId] = result.next;
		return result;
	}

	remove(serverId: string, paths: readonly string[]) {
		const next = removeFromSelection(this.items(serverId), paths);
		if (next.length) this.#byServer[serverId] = next;
		else delete this.#byServer[serverId];
	}

	clear(serverId: string) {
		delete this.#byServer[serverId];
	}
}

/** Client-rendered app (`ssr = false`): one instance per browser tab is safe. */
export const exportSelection = new ExportSelectionStore();
