import { getCurseForgeModpack, type CurseForgeModpack } from '#lib/api/index.js';

/**
 * Pack metadata by CurseForge project ID, shared by the header, Overview and Settings so a
 * server page fetches each pack once. Failures are not cached, so a later view retries.
 */
// Not reactive state: an in-flight/settled request cache read only from code.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const cache = new Map<number, Promise<CurseForgeModpack>>();

export function loadCurseForgePack(projectId: number): Promise<CurseForgeModpack> {
	let pending = cache.get(projectId);
	if (!pending) {
		pending = getCurseForgeModpack(projectId);
		cache.set(projectId, pending);
		pending.catch(() => {
			if (cache.get(projectId) === pending) cache.delete(projectId);
		});
	}
	return pending;
}

/** Test helper: forget cached packs. */
export function clearPackCache() {
	cache.clear();
}

/**
 * Reactive pack metadata for the current project ID (`null` for non-CurseForge servers).
 * Call during component initialisation. Stale responses for a previous ID are ignored.
 */
export function usePackMetadata(projectId: () => number | null) {
	let pack = $state.raw<CurseForgeModpack | null>(null);
	let error = $state.raw<unknown>(null);
	let loading = $state(false);

	$effect(() => {
		const id = projectId();
		pack = null;
		error = null;
		loading = id !== null;
		if (id === null) return;
		let current = true;
		loadCurseForgePack(id).then(
			(value) => {
				if (!current) return;
				// A response must describe the pack that was asked for.
				if (value?.id === id) pack = value;
				loading = false;
			},
			(cause) => {
				if (!current) return;
				error = cause;
				loading = false;
			}
		);
		return () => {
			current = false;
		};
	});

	return {
		get pack() {
			return pack;
		},
		get error() {
			return error;
		},
		get loading() {
			return loading;
		}
	};
}
