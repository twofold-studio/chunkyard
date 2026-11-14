import { parseRelativePath } from '#lib/files/paths.js';
import type {
	CreateExportRequest,
	ExportDestination,
	ExportRecord,
	ExportScope,
	StorageConnection,
	UpdateStorageRequest
} from '#lib/api/index.js';

/** Contract bounds for `scope: "selected"`. */
export const MAX_SELECTED_PATHS = 100;

export const SCOPE_LABELS: Record<ExportScope, string> = {
	world: 'World',
	selected: 'Selected paths',
	all: 'Full instance'
};

export const DESTINATION_LABELS: Record<ExportDestination, string> = {
	local: 'Manager host',
	s3: 'S3'
};

export type PathsResult = { ok: true; paths: string[] } | { ok: false; error: string };

/**
 * Parses newline-separated, instance-relative paths and merges them after `selected`
 * (paths chosen in Files). Blank lines are ignored and duplicates collapse; every typed
 * path must pass {@link parseRelativePath} (no `..`, absolute or empty segments). The
 * backend still enforces containment and rejects symlinks.
 */
export function parseExportPaths(input: string, selected: readonly string[] = []): PathsResult {
	const paths: string[] = [];
	for (const path of selected) {
		const parsed = parseRelativePath(path);
		if (!parsed.ok) return { ok: false, error: `Selected path ${path}: ${parsed.error}` };
		if (!paths.includes(parsed.path)) paths.push(parsed.path);
	}
	const lines = input.split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) continue;
		const parsed = parseRelativePath(line);
		if (!parsed.ok) return { ok: false, error: `Line ${index + 1}: ${parsed.error}` };
		if (!paths.includes(parsed.path)) paths.push(parsed.path);
	}
	if (paths.length === 0) return { ok: false, error: 'Enter at least one path.' };
	if (paths.length > MAX_SELECTED_PATHS) {
		return {
			ok: false,
			error: `Select at most ${MAX_SELECTED_PATHS} paths (currently ${paths.length}).`
		};
	}
	return { ok: true, paths };
}

export function buildExportRequest(
	scope: ExportScope,
	destination: ExportDestination,
	pathsInput: string,
	selected: readonly string[] = []
): { ok: true; request: CreateExportRequest } | { ok: false; error: string } {
	if (scope !== 'selected') return { ok: true, request: { scope, destination } };
	const parsed = parseExportPaths(pathsInput, selected);
	if (!parsed.ok) return parsed;
	return { ok: true, request: { scope, destination, paths: parsed.paths } };
}

/** The {@link ExportRecord} in a succeeded job's `result`, or `null` for unknown shapes. */
export function exportFromResult(result: unknown): ExportRecord | null {
	if (!result || typeof result !== 'object') return null;
	const r = result as Record<string, unknown>;
	// Accept both a bare Export and an `{export}` envelope.
	const record = (r.export && typeof r.export === 'object' ? r.export : r) as Record<
		string,
		unknown
	>;
	if (
		typeof record.id !== 'string' ||
		typeof record.fileName !== 'string' ||
		typeof record.sha256 !== 'string' ||
		typeof record.size !== 'number'
	) {
		return null;
	}
	return record as unknown as ExportRecord;
}

/** Inserts or replaces `record`, keeping newest first. */
export function upsertExport(list: ExportRecord[], record: ExportRecord): ExportRecord[] {
	return [record, ...list.filter((item) => item.id !== record.id)].sort((a, b) =>
		b.createdAt.localeCompare(a.createdAt)
	);
}

export function formatExportTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

export function shortHash(sha256: string): string {
	return sha256.slice(0, 12);
}

// Storage form -------------------------------------------------------------------

export interface StorageFormValues {
	endpoint: string;
	region: string;
	bucket: string;
	prefix: string;
	accessKeyId: string;
	/** Empty keeps the stored secret (when allowed). */
	secretAccessKey: string;
}

export function storageFormFrom(connection: StorageConnection | null): StorageFormValues {
	return {
		endpoint: connection?.endpoint ?? '',
		region: connection?.region ?? '',
		bucket: connection?.bucket ?? '',
		prefix: connection?.prefix ?? '',
		accessKeyId: connection?.accessKeyId ?? '',
		secretAccessKey: ''
	};
}

/** True when an empty secret may keep the stored one: same endpoint and access key. */
export function canKeepSecret(
	connection: StorageConnection | null,
	form: Pick<StorageFormValues, 'endpoint' | 'accessKeyId'>
): boolean {
	return (
		!!connection?.hasSecret &&
		connection.endpoint === form.endpoint.trim() &&
		connection.accessKeyId === form.accessKeyId.trim()
	);
}

export type StorageFormErrors = Partial<Record<keyof StorageFormValues, string>>;

export function validateStorageForm(
	form: StorageFormValues,
	connection: StorageConnection | null
): StorageFormErrors {
	const errors: StorageFormErrors = {};
	const endpoint = form.endpoint.trim();
	if (!endpoint) errors.endpoint = 'Enter the S3 endpoint URL.';
	else {
		try {
			const url = new URL(endpoint);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				errors.endpoint = 'Use an http:// or https:// URL.';
			} else if (url.username || url.password) {
				errors.endpoint = 'Do not put credentials in the endpoint URL.';
			}
		} catch {
			errors.endpoint = 'Enter a full URL, for example https://s3.example.com.';
		}
	}
	if (!form.region.trim()) errors.region = 'Enter the region (e.g. us-east-1).';
	if (!form.bucket.trim()) errors.bucket = 'Enter an existing bucket name.';
	if (!form.accessKeyId.trim()) errors.accessKeyId = 'Enter the access key ID.';
	if (!form.secretAccessKey && !canKeepSecret(connection, form)) {
		errors.secretAccessKey = connection?.hasSecret
			? 'Enter the secret again: the endpoint or access key changed.'
			: 'Enter the secret access key.';
	}
	return errors;
}

export function toStorageRequest(form: StorageFormValues): UpdateStorageRequest {
	const body: UpdateStorageRequest = {
		endpoint: form.endpoint.trim(),
		region: form.region.trim(),
		bucket: form.bucket.trim(),
		prefix: form.prefix.trim(),
		accessKeyId: form.accessKeyId.trim()
	};
	if (form.secretAccessKey) body.secretAccessKey = form.secretAccessKey;
	return body;
}

export function storageFormDirty(
	form: StorageFormValues,
	connection: StorageConnection | null
): boolean {
	const base = storageFormFrom(connection);
	return (
		form.secretAccessKey !== '' ||
		(Object.keys(base) as (keyof StorageFormValues)[]).some(
			(key) => key !== 'secretAccessKey' && form[key].trim() !== base[key]
		)
	);
}
