import { errorCode, isAbortError, uploadFile, type FileEntry } from '#lib/api/index.js';
import { joinPath, MAX_UPLOAD_BYTES, uploadNameError } from './paths.js';

export type UploadState =
	| 'pending'
	| 'uploading'
	| 'done'
	/** Target exists; waiting for an explicit replace or skip. */
	| 'exists'
	| 'failed'
	| 'skipped';

export interface UploadItem {
	id: number;
	file: File;
	/** Folder captured when the file was queued; never follows later navigation. */
	dir: string;
	/** Destination path (directory + validated file name). */
	path: string;
	state: UploadState;
	overwrite: boolean;
	error: unknown;
}

export interface UploadQueueOptions {
	serverId: string;
	upload?: typeof uploadFile;
	/** Called after each successful upload, e.g. to refresh the listing. */
	onUploaded?: (entry: FileEntry) => void;
	/** Rechecked before each request or retry; the backend remains authoritative. */
	canUpload?: () => boolean;
}

let nextId = 1;

/** Waiting, uploading or awaiting a replace decision. */
const isOpen = (state: UploadState) =>
	state === 'pending' || state === 'uploading' || state === 'exists';

/**
 * Uploads files one at a time as raw `application/octet-stream` bodies. Existing
 * targets are never replaced unless the owner confirms that item. No percentage is
 * shown because `fetch` exposes no upload progress.
 */
export class UploadQueue {
	items = $state<UploadItem[]>([]);
	#running = false;
	#abort = new AbortController();
	#options: UploadQueueOptions;

	constructor(options: UploadQueueOptions) {
		this.#options = options;
	}

	get active(): boolean {
		return this.items.some((item) => item.state === 'pending' || item.state === 'uploading');
	}

	get canUpload(): boolean {
		return this.#options.canUpload?.() ?? true;
	}

	/**
	 * Queues files for `dir`. Oversized or unsafe names fail locally without a request.
	 * A file whose destination is already waiting, uploading or awaiting a replace
	 * decision is not queued twice; those names are returned as `duplicates`.
	 */
	add(dir: string, files: Iterable<File>): { added: number; duplicates: string[] } {
		const duplicates: string[] = [];
		let added = 0;
		for (const file of files) {
			const path = joinPath(dir, file.name);
			if (this.items.some((item) => item.path === path && isOpen(item.state))) {
				duplicates.push(file.name);
				continue;
			}
			const nameError = uploadNameError(dir, file.name);
			const tooLarge = file.size > MAX_UPLOAD_BYTES;
			added += 1;
			this.items.push({
				id: nextId++,
				file,
				dir,
				path,
				state: nameError || tooLarge ? 'failed' : 'pending',
				overwrite: false,
				error: nameError
					? new Error(nameError)
					: tooLarge
						? { code: 'files.too_large', detail: 'Uploads are limited to 128 MiB per file.' }
						: null
			});
		}
		void this.#drain();
		return { added, duplicates };
	}

	/**
	 * Stops waiting items (e.g. the server started) without sending them. They become
	 * retryable failures; an upload already in flight is left to the backend.
	 */
	hold(error: { code: string; detail: string }) {
		for (const item of this.items) {
			if (item.state !== 'pending') continue;
			item.state = 'failed';
			item.error = error;
		}
	}

	/** Confirms replacing an existing target for one item. */
	replace(id: number) {
		if (!this.canUpload) return;
		const item = this.items.find((i) => i.id === id);
		if (!item || item.state !== 'exists') return;
		item.overwrite = true;
		item.state = 'pending';
		item.error = null;
		void this.#drain();
	}

	skip(id: number) {
		const item = this.items.find((i) => i.id === id);
		if (item && (item.state === 'exists' || item.state === 'pending')) item.state = 'skipped';
	}

	/** Failed for a reason a retry could fix (not size or an unsafe name). */
	canRetry(id: number): boolean {
		const item = this.items.find((i) => i.id === id);
		return (
			!!item &&
			item.state === 'failed' &&
			item.file.size <= MAX_UPLOAD_BYTES &&
			uploadNameError(item.dir, item.file.name) === null
		);
	}

	retry(id: number) {
		if (!this.canUpload) return;
		const item = this.items.find((i) => i.id === id);
		if (!item || !this.canRetry(id)) return;
		item.state = 'pending';
		item.error = null;
		void this.#drain();
	}

	/** Removes finished items from the list. */
	clearFinished() {
		this.items = this.items.filter(
			(item) => item.state === 'pending' || item.state === 'uploading' || item.state === 'exists'
		);
	}

	async #drain() {
		if (this.#running) return;
		this.#running = true;
		const upload = this.#options.upload ?? uploadFile;
		try {
			for (;;) {
				if (this.#abort.signal.aborted) return;
				if (!this.canUpload) {
					this.hold({
						code: 'files.server_running',
						detail:
							'Uploads paused while files are read-only. Retry once the server is stopped and files are writable.'
					});
					return;
				}
				const item = this.items.find((i) => i.state === 'pending');
				if (!item) return;
				item.state = 'uploading';
				try {
					const { entry } = await upload(
						this.#options.serverId,
						item.path,
						item.file,
						item.overwrite,
						{ signal: this.#abort.signal }
					);
					item.state = 'done';
					this.#options.onUploaded?.(entry);
				} catch (error) {
					if (isAbortError(error)) {
						item.state = 'skipped';
						return;
					}
					item.error = error;
					item.state = errorCode(error) === 'files.exists' && !item.overwrite ? 'exists' : 'failed';
				}
			}
		} finally {
			this.#running = false;
		}
	}

	/** Aborts the current upload and stops the queue (leaving the page). */
	destroy() {
		this.#abort.abort();
		for (const item of this.items) {
			if (item.state === 'pending' || item.state === 'uploading') item.state = 'skipped';
		}
	}
}
