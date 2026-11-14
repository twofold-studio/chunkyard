import {
	errorCode,
	getProperties,
	getPropertiesVersion,
	isAbortError,
	listPropertiesVersions,
	restoreProperties,
	saveProperties,
	sleep,
	type PropertiesDocument
} from '#lib/api/index.js';

export interface PropertiesApi {
	getProperties: typeof getProperties;
	saveProperties: typeof saveProperties;
	listPropertiesVersions: typeof listPropertiesVersions;
	getPropertiesVersion: typeof getPropertiesVersion;
	restoreProperties: typeof restoreProperties;
}

const defaultApi: PropertiesApi = {
	getProperties,
	saveProperties,
	listPropertiesVersions,
	getPropertiesVersion,
	restoreProperties
};

export type SaveState =
	'loading' | 'saved' | 'pending' | 'saving' | 'retrying' | 'error' | 'conflict';

export interface PropertiesStoreOptions {
	api?: Partial<PropertiesApi>;
	/** Inactivity before an edit is saved. */
	delayMs?: number;
	/** Backoff for transient `server.busy` replies; then the save stops with an error. */
	retryDelaysMs?: readonly number[];
}

/** Autosave cadence for typing; switches, selects and Enter save immediately. */
export const AUTOSAVE_DELAY_MS = 900;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000] as const;

/**
 * Desired `server.properties` for one server, with autosave. Saves are serialised and
 * always send the etag of the latest saved version, so a concurrent change stops with a
 * conflict instead of being overwritten. Edits made while a save is in flight are kept
 * and saved next. Saves are never aborted: {@link destroy} flushes pending text.
 * Saving never restarts the server; versions apply on the next explicit start/restart.
 */
export class PropertiesStore {
	readonly serverId: string;

	/** Local desired text (possibly not saved yet). */
	content = $state('');
	/** Text of the latest version the backend confirmed. */
	saved = $state('');
	/** Latest document metadata (version, applied version, etag). */
	doc = $state.raw<PropertiesDocument | null>(null);
	loading = $state(true);
	loadError = $state.raw<unknown>(null);
	saving = $state(false);
	retrying = $state(false);
	/** Last save failure other than a conflict; cleared by the next attempt. */
	error = $state.raw<unknown>(null);
	/** The latest version changed elsewhere; saving stops until reload or keep-mine. */
	conflict = $state(false);
	/** Epoch ms of the last successful save. */
	savedAt = $state<number | null>(null);

	#api: PropertiesApi;
	#delayMs: number;
	#retryDelays: readonly number[];
	#timer: ReturnType<typeof setTimeout> | null = null;
	#running: Promise<void> | null = null;
	#loadAbort = new AbortController();
	#destroyed = false;

	constructor(serverId: string, options: PropertiesStoreOptions = {}) {
		this.serverId = serverId;
		this.#api = { ...defaultApi, ...options.api };
		this.#delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
		this.#retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
	}

	get api(): PropertiesApi {
		return this.#api;
	}

	/** Local text differs from the latest saved version. */
	get pending(): boolean {
		return this.doc !== null && this.content !== this.saved;
	}

	/** Editing is allowed (loaded, no conflict). Works while the server runs. */
	get editable(): boolean {
		return this.doc !== null && !this.loading && !this.conflict;
	}

	get state(): SaveState {
		if (this.loading && !this.doc) return 'loading';
		if (this.conflict) return 'conflict';
		if (this.retrying) return 'retrying';
		if (this.saving) return 'saving';
		if (this.error && this.pending) return 'error';
		if (this.pending) return 'pending';
		return 'saved';
	}

	#accept(doc: PropertiesDocument) {
		this.doc = doc;
		this.content = doc.content;
		this.saved = doc.content;
	}

	async load(): Promise<void> {
		this.loading = true;
		this.loadError = null;
		try {
			const doc = await this.#api.getProperties(this.serverId, { signal: this.#loadAbort.signal });
			this.#accept(doc);
			this.conflict = false;
			this.error = null;
		} catch (error) {
			if (!isAbortError(error)) this.loadError = error;
		} finally {
			if (!this.#loadAbort.signal.aborted) this.loading = false;
		}
	}

	/**
	 * Re-reads metadata (e.g. after a start/stop changed the applied version). Local
	 * unsaved text is kept; the latest content is only adopted when nothing is pending.
	 */
	async refresh(): Promise<void> {
		if (!this.doc || this.#destroyed) return;
		try {
			const doc = await this.#api.getProperties(this.serverId, { signal: this.#loadAbort.signal });
			if (this.saving || this.#running) return; // The save result carries fresher metadata.
			if (!this.pending) this.#accept(doc);
			else if (doc.etag === this.doc?.etag) this.doc = doc;
		} catch {
			// Metadata refresh is best effort; the next save reports real problems.
		}
	}

	/** Replaces the local text. Typing waits for inactivity; `immediate` saves now. */
	edit(next: string, immediate = false): void {
		if (!this.doc || this.conflict) return;
		this.content = next;
		if (immediate) void this.flush();
		else this.#schedule();
	}

	#schedule() {
		this.#clearTimer();
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.flush();
		}, this.#delayMs);
	}

	#clearTimer() {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	/** Saves pending text now (Enter, switch, retry, unmount). Resolves when idle. */
	flush(): Promise<void> {
		this.#clearTimer();
		if (!this.#running) {
			this.#running = this.#saveLoop().finally(() => {
				this.#running = null;
			});
		}
		return this.#running;
	}

	async #saveLoop(): Promise<void> {
		let attempt = 0;
		while (this.doc && this.content !== this.saved && !this.conflict) {
			const snapshot = this.content;
			this.saving = true;
			this.error = null;
			try {
				// No abort signal: leaving the page must not silently discard a save.
				const doc = await this.#api.saveProperties(this.serverId, {
					content: snapshot,
					etag: this.doc.etag
				});
				attempt = 0;
				this.retrying = false;
				this.doc = doc;
				this.saved = doc.content;
				// Normally identical; adopt the stored text only if nothing was typed meanwhile.
				if (this.content === snapshot) this.content = doc.content;
				this.savedAt = Date.now();
			} catch (error) {
				const code = errorCode(error);
				if (code === 'properties.conflict') {
					this.retrying = false;
					this.conflict = true;
					return;
				}
				if (code === 'server.busy' && attempt < this.#retryDelays.length && !this.#destroyed) {
					this.retrying = true;
					await sleep(this.#retryDelays[attempt]);
					attempt += 1;
					continue;
				}
				this.retrying = false;
				this.error = error;
				return;
			} finally {
				this.saving = false;
			}
			// The owner is still typing: let the inactivity timer pick up the rest.
			if (this.#timer !== null) return;
		}
	}

	/** Conflict: discard local edits and load the latest saved version. */
	async reloadLatest(): Promise<void> {
		this.#clearTimer();
		this.conflict = false;
		this.error = null;
		await this.load();
	}

	/** Conflict: adopt the latest etag and save the local text on top of it. */
	async keepMine(): Promise<void> {
		const mine = this.content;
		try {
			const latest = await this.#api.getProperties(this.serverId, {
				signal: this.#loadAbort.signal
			});
			this.doc = latest;
			this.saved = latest.content;
			this.content = mine;
			this.conflict = false;
			this.error = null;
			await this.flush();
		} catch (error) {
			if (!isAbortError(error)) this.error = error;
		}
	}

	/**
	 * Copies `version` into a new latest version (never restarts). Refused while local
	 * edits are unsaved so they cannot be silently replaced.
	 */
	async restore(version: number): Promise<boolean> {
		if (!this.doc || this.pending || this.saving || this.conflict) return false;
		try {
			const doc = await this.#api.restoreProperties(this.serverId, {
				version,
				etag: this.doc.etag
			});
			this.#accept(doc);
			this.savedAt = Date.now();
			return true;
		} catch (error) {
			if (errorCode(error) === 'properties.conflict') this.conflict = true;
			else this.error = error;
			return false;
		}
	}

	/** Stops reads and flushes pending text to this same server (saves are not aborted). */
	destroy(): void {
		const hadTimer = this.#timer !== null;
		this.#clearTimer();
		this.#destroyed = true;
		this.#loadAbort.abort();
		if ((hadTimer || this.pending) && !this.conflict && !this.#running) void this.flush();
	}
}
