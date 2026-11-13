import { isAbortError, sleep } from '#lib/api/index.js';

export interface PollOptions {
	intervalMs: number;
	signal: AbortSignal;
	/** Run the first tick immediately (default true). */
	immediate?: boolean;
	/** Return false to pause polling (e.g. while a section is not relevant). */
	enabled?: () => boolean;
	/** Injected for tests; defaults to the document visibility state. */
	isVisible?: () => boolean;
	onError?: (error: unknown) => void;
}

function documentVisible(): boolean {
	return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Sequential polling loop: never overlaps requests, pauses while the tab is hidden
 * or `enabled()` is false, and stops when `signal` aborts.
 */
export async function poll(
	tick: (signal: AbortSignal) => Promise<void>,
	options: PollOptions
): Promise<void> {
	const visible = options.isVisible ?? documentVisible;
	const enabled = options.enabled ?? (() => true);
	let first = options.immediate ?? true;
	while (!options.signal.aborted) {
		try {
			if (!first) await sleep(options.intervalMs, options.signal);
			first = false;
			if (!visible() || !enabled()) continue;
			await tick(options.signal);
		} catch (error) {
			if (isAbortError(error) || options.signal.aborted) return;
			options.onError?.(error);
		}
	}
}
