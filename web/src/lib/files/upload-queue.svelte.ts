import { errorCode, isAbortError, uploadFile, type FileEntry } from '#lib/api/index.js';
import { joinPath, MAX_UPLOAD_BYTES, validateName } from './paths.js';

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
}

let nextId = 1;

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

	/** Queues files for `dir`. Oversized or unsafe names fail locally without a request. */
	add(dir: string, files: Iterable<File>) {
		for (const file of files) {
			const nameError = validateName(file.name);
			const tooLarge = file.size > MAX_UPLOAD_BYTES;
			this.items.push({
				id: nextId++,
				file,
				path: joinPath(dir, file.name),
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
	}

	/** Confirms replacing an existing target for one item. */
	replace(id: number) {
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
			validateName(item.file.name) === null
		);
	}

	retry(id: number) {
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
