import { errorCode, isAbortError, readFile, writeFile, type FileContent } from '#lib/api/index.js';

export interface EditorApi {
	readFile: typeof readFile;
	writeFile: typeof writeFile;
}

/**
 * One text file opened in the editor. Saves send the etag from the last read, so a
 * file changed elsewhere fails with `files.conflict` instead of being overwritten.
 */
export class TextFileEditor {
	readonly serverId: string;
	readonly path: string;

	/** Text as last read or saved. */
	original = $state('');
	content = $state('');
	etag = $state<string | null>(null);
	size = $state(0);
	readOnly = $state(false);
	canWrite = $state(false);
	loading = $state(true);
	saving = $state(false);
	/** Load failure: the editor cannot show the file. */
	loadError = $state.raw<unknown>(null);
	/** Last save failure other than a conflict. */
	saveError = $state.raw<unknown>(null);
	/** The file changed on disk since it was read; saving is blocked until reload. */
	conflict = $state(false);
	/** Epoch milliseconds of the last successful save. */
	savedAt = $state<number | null>(null);

	#abort = new AbortController();
	#api: EditorApi;

	constructor(serverId: string, path: string, api: Partial<EditorApi> = {}) {
		this.serverId = serverId;
		this.path = path;
		this.#api = { readFile, writeFile, ...api };
	}

	get dirty(): boolean {
		return this.content !== this.original;
	}

	get editable(): boolean {
		return !this.loading && !this.loadError && !this.readOnly && this.canWrite;
	}

	#apply(file: FileContent) {
		this.original = file.content;
		this.content = file.content;
		this.etag = file.etag;
		this.size = file.size;
		this.readOnly = file.readOnly;
		this.canWrite = file.canWrite;
	}

	async load(): Promise<void> {
		this.loading = true;
		this.loadError = null;
		try {
			this.#apply(
				await this.#api.readFile(this.serverId, this.path, { signal: this.#abort.signal })
			);
			this.conflict = false;
			this.saveError = null;
		} catch (error) {
			if (!isAbortError(error)) this.loadError = error;
		} finally {
			if (!this.#abort.signal.aborted) this.loading = false;
		}
	}

	/** Re-reads the file from disk, discarding unsaved changes. */
	reload(): Promise<void> {
		return this.load();
	}

	async save(): Promise<boolean> {
		if (!this.editable || this.saving || this.conflict || !this.dirty) return false;
		this.saving = true;
		this.saveError = null;
		const content = this.content;
		try {
			const saved = await this.#api.writeFile(
				this.serverId,
				this.path,
				{ content, etag: this.etag },
				{ signal: this.#abort.signal }
			);
			this.etag = saved.etag;
			this.size = saved.size;
			this.original = content;
			this.savedAt = Date.now();
			return true;
		} catch (error) {
			if (isAbortError(error)) return false;
			if (errorCode(error) === 'files.conflict') this.conflict = true;
			else this.saveError = error;
			return false;
		} finally {
			this.saving = false;
		}
	}

	destroy() {
		this.#abort.abort();
	}
}
