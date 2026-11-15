import { untrack } from 'svelte';
import { getServerStatus, isAbortError, sleep, type GameStatus } from '#lib/api/index.js';
import { documentAttention, type DocumentAttention } from '#lib/attention.svelte.js';
import { readiness, STATUS_POLL_MS, type Readiness } from './game-status.js';

export type StatusFetcher = (id: string, signal: AbortSignal) => Promise<GameStatus>;

const defaultFetch: StatusFetcher = (id, signal) => getServerStatus(id, { signal });

/**
 * The single readiness poll of a server page, shared by the header and Overview. It asks the
 * backend at most every {@link STATUS_POLL_MS} while the window is visible and focused, never
 * overlaps requests, and stops on server switch, deactivation or unmount. Nothing here probes
 * other servers.
 */
export class GameStatusSource {
	status = $state.raw<GameStatus | null>(null);
	error = $state.raw<unknown>(null);
	/** When the current `status` was received (ms since the epoch). */
	receivedAt = $state<number | null>(null);
	/** Clock for staleness, advanced on every poll iteration (also while unattended). */
	now = $state(Date.now());
	serverId = $state<string | null>(null);
	active = $state(false);

	#fetch: StatusFetcher;
	#attention: DocumentAttention;
	#intervalMs: number;
	#loop: AbortController | null = null;
	#request: AbortController | null = null;

	constructor(
		options: { fetch?: StatusFetcher; attention?: DocumentAttention; intervalMs?: number } = {}
	) {
		this.#fetch = options.fetch ?? defaultFetch;
		this.#attention = options.attention ?? documentAttention;
		this.#intervalMs = options.intervalMs ?? STATUS_POLL_MS;
	}

	get readiness(): Readiness {
		return readiness(this.status, this.receivedAt, this.now, this.error !== null);
	}

	/** (Re)targets the poll. A different server clears everything the previous one showed. */
	configure(serverId: string, active: boolean) {
		if (this.serverId === serverId && this.active === active) return;
		this.stop();
		if (this.serverId !== serverId || !active) {
			this.status = null;
			this.receivedAt = null;
			this.error = null;
		}
		this.serverId = serverId;
		this.active = active;
		if (!active) return;
		const loop = (this.#loop = new AbortController());
		void this.#run(serverId, loop.signal);
	}

	/** Fetch now when attended (e.g. focus returned), unless a request is in flight. */
	refresh() {
		const id = this.serverId;
		if (!this.active || id === null || !this.#loop || this.#request) return;
		void this.#tick(id, this.#loop.signal);
	}

	stop() {
		this.#loop?.abort();
		this.#loop = null;
		this.#request?.abort();
		this.#request = null;
	}

	async #run(serverId: string, signal: AbortSignal) {
		let first = true;
		while (!signal.aborted) {
			try {
				if (!first) await sleep(this.#intervalMs, signal);
				first = false;
				this.now = Date.now();
				if (!this.#attention.attentive || this.#request) continue;
				await this.#tick(serverId, signal);
			} catch (error) {
				if (isAbortError(error) || signal.aborted) return;
			}
		}
	}

	async #tick(serverId: string, loopSignal: AbortSignal) {
		const request = (this.#request = new AbortController());
		const abort = () => request.abort();
		loopSignal.addEventListener('abort', abort, { once: true });
		try {
			const status = await this.#fetch(serverId, request.signal);
			if (request.signal.aborted || this.serverId !== serverId) return;
			this.status = status;
			this.error = null;
			this.receivedAt = this.now = Date.now();
		} catch (error) {
			if (isAbortError(error) || request.signal.aborted || this.serverId !== serverId) return;
			this.error = error;
			this.now = Date.now();
		} finally {
			loopSignal.removeEventListener('abort', abort);
			if (this.#request === request) this.#request = null;
		}
	}
}

/**
 * Creates the page's readiness source and keeps it targeted. `active` should be false while
 * the container is stopped, the record is archived or deleted: nothing is polled then.
 */
export function useGameStatus(
	params: () => { serverId: string; active: boolean },
	options: { fetch?: StatusFetcher; attention?: DocumentAttention; intervalMs?: number } = {}
) {
	const attention = options.attention ?? documentAttention;
	const source = new GameStatusSource({ ...options, attention });
	$effect(() => {
		const { serverId, active } = params();
		untrack(() => source.configure(serverId, active));
	});
	// Attention regained: refresh at once instead of waiting for the next tick.
	$effect(() => {
		if (attention.attentive) untrack(() => source.refresh());
	});
	$effect(() => () => source.stop());
	return source;
}
