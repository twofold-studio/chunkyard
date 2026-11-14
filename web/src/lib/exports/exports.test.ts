import { describe, expect, it } from 'vitest';
import type { StorageConnection } from '#lib/api/index.js';
import {
	buildExportRequest,
	canKeepSecret,
	exportFromResult,
	parseExportPaths,
	storageFormDirty,
	storageFormFrom,
	toStorageRequest,
	upsertExport,
	validateStorageForm
} from './exports';

const connection: StorageConnection = {
	configured: true,
	endpoint: 'http://10.0.0.5:9000',
	region: 'us-east-1',
	bucket: 'mc',
	prefix: 'archives',
	accessKeyId: 'AKIA1',
	hasSecret: true
};

const record = (id: string, createdAt: string) => ({
	id,
	serverId: 'srv-1',
	serverName: 'Survival',
	scope: 'world' as const,
	destination: 'local' as const,
	createdAt,
	size: 10,
	sha256: 'a'.repeat(64),
	fileName: `${id}.tar.gz`,
	objectKey: null
});

describe('parseExportPaths', () => {
	it('trims, skips blanks and dedupes', () => {
		expect(parseExportPaths(' world/ \n\n/plugins/Essentials\nworld\nops.json\r\n')).toEqual({
			ok: true,
			paths: ['world', 'plugins/Essentials', 'ops.json']
		});
	});

	it('rejects traversal with the line number', () => {
		const result = parseExportPaths('world\n../etc');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/^Line 2:/);
	});

	it('requires 1–100 paths', () => {
		expect(parseExportPaths('  \n').ok).toBe(false);
		const many = Array.from({ length: 101 }, (_, i) => `f${i}`).join('\n');
		expect(parseExportPaths(many).ok).toBe(false);
		expect(parseExportPaths(many.split('\n').slice(0, 100).join('\n')).ok).toBe(true);
	});
});

describe('buildExportRequest', () => {
	it('omits paths unless selected', () => {
		expect(buildExportRequest('world', 's3', 'ignored')).toEqual({
			ok: true,
			request: { scope: 'world', destination: 's3' }
		});
		expect(buildExportRequest('selected', 'local', 'world')).toEqual({
			ok: true,
			request: { scope: 'selected', destination: 'local', paths: ['world'] }
		});
		expect(buildExportRequest('selected', 'local', '').ok).toBe(false);
	});
});

describe('exportFromResult', () => {
	it('accepts a bare Export and an envelope', () => {
		const r = record('e1', '2026-01-01T00:00:00Z');
		expect(exportFromResult(r)).toEqual(r);
		expect(exportFromResult({ export: r })).toEqual(r);
		expect(exportFromResult(null)).toBeNull();
		expect(exportFromResult({ id: 'x' })).toBeNull();
	});
});

describe('upsertExport', () => {
	it('keeps newest first without duplicates', () => {
		const a = record('a', '2026-01-01T00:00:00Z');
		const b = record('b', '2026-02-01T00:00:00Z');
		expect(upsertExport([a, b], { ...a, size: 99 }).map((e) => [e.id, e.size])).toEqual([
			['b', 10],
			['a', 99]
		]);
	});
});

describe('storage form', () => {
	it('keeps the secret only with unchanged endpoint and access key', () => {
		const form = storageFormFrom(connection);
		expect(canKeepSecret(connection, form)).toBe(true);
		expect(validateStorageForm(form, connection)).toEqual({});
		expect(toStorageRequest(form)).not.toHaveProperty('secretAccessKey');

		const moved = { ...form, endpoint: 'https://s3.example.com' };
		expect(canKeepSecret(connection, moved)).toBe(false);
		expect(validateStorageForm(moved, connection).secretAccessKey).toBeDefined();
		expect(canKeepSecret({ ...connection, hasSecret: false }, form)).toBe(false);
	});

	it('validates endpoint URLs and required fields', () => {
		const empty = storageFormFrom(null);
		const errors = validateStorageForm(empty, null);
		expect(Object.keys(errors).sort()).toEqual(
			['accessKeyId', 'bucket', 'endpoint', 'region', 'secretAccessKey'].sort()
		);
		expect(
			validateStorageForm({ ...storageFormFrom(connection), endpoint: 'ftp://x' }, connection)
				.endpoint
		).toBeDefined();
		expect(
			validateStorageForm(
				{ ...storageFormFrom(connection), endpoint: 'https://u:p@s3.example.com' },
				connection
			).endpoint
		).toBeDefined();
	});

	it('detects dirty state and sends trimmed values', () => {
		const form = storageFormFrom(connection);
		expect(storageFormDirty(form, connection)).toBe(false);
		expect(storageFormDirty({ ...form, secretAccessKey: 's' }, connection)).toBe(true);
		expect(storageFormDirty({ ...form, bucket: ' mc ' }, connection)).toBe(false);
		expect(toStorageRequest({ ...form, bucket: ' other ', secretAccessKey: 'k' })).toEqual({
			endpoint: connection.endpoint,
			region: 'us-east-1',
			bucket: 'other',
			prefix: 'archives',
			accessKeyId: 'AKIA1',
			secretAccessKey: 'k'
		});
	});
});
