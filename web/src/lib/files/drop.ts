/**
 * Reads what was dropped from the operating system. Must run synchronously inside
 * the `drop` handler: the browser empties the `DataTransfer` afterwards.
 */

export interface DroppedItems {
	files: File[];
	/** Names of dropped folders. Folder upload is not supported, so they are skipped. */
	folders: string[];
}

/** True for a drag that carries files from outside the page. */
export function carriesFiles(transfer: DataTransfer | null | undefined): boolean {
	return !!transfer && Array.from(transfer.types).includes('Files');
}

export function readDrop(transfer: DataTransfer): DroppedItems {
	const files: File[] = [];
	const folders: string[] = [];
	const items = Array.from(transfer.items ?? []).filter((item) => item.kind === 'file');
	if (items.length === 0) return { files: Array.from(transfer.files), folders };
	for (const item of items) {
		// `webkitGetAsEntry` is the only portable way to tell a folder from a file.
		const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
		if (entry?.isDirectory) {
			folders.push(entry.name);
			continue;
		}
		const file = item.getAsFile();
		if (file) files.push(file);
	}
	return { files, folders };
}
