import { describe, expect, it } from 'vitest';
import {
	canLinkServer,
	filterJobs,
	formatDuration,
	jobFailure,
	jobKindLabel,
	jobKinds,
	jobResultSummary,
	jobTiming,
	mergeJobs,
	sanitizeText
} from './jobs';
import { job } from './jobs.fixture';

describe('job labels', () => {
	it('names known kinds and humanizes unknown ones', () => {
		expect(jobKindLabel('server.export')).toBe('Export server');
		expect(jobKindLabel('java.install')).toBe('Install Java runtime');
		expect(jobKindLabel('backup.prune_old')).toBe('Backup prune old');
	});

	it('orders kinds with known ones first', () => {
		const kinds = jobKinds([
			job('a', { kind: 'zzz.custom' }),
			job('b', { kind: 'server.export' }),
			job('c', { kind: 'java.install' }),
			job('d', { kind: 'server.export' })
		]);
		expect(kinds).toEqual(['java.install', 'server.export', 'zzz.custom']);
	});
});

describe('jobTiming', () => {
	const now = Date.parse('2026-11-14T10:01:00Z');

	it('measures finished run time and queue wait', () => {
		const timing = jobTiming(job('a'), now);
		expect(timing).toEqual({ runMs: 3000, waitMs: 1000, live: false });
	});

	it('grows while running and while queued', () => {
		expect(jobTiming(job('a', { state: 'running', finishedAt: null }), now).runMs).toBe(59_000);
		const queued = jobTiming(job('a', { state: 'queued', startedAt: null, finishedAt: null }), now);
		expect(queued).toEqual({ runMs: null, waitMs: 60_000, live: true });
	});

	it('formats durations compactly and refuses invalid input', () => {
		expect(formatDuration(850)).toBe('850 ms');
		expect(formatDuration(12_400)).toBe('12 s');
		expect(formatDuration(4_200)).toBe('4.2 s');
		expect(formatDuration(185_000)).toBe('3m 05s');
		expect(formatDuration(7_800_000)).toBe('2h 10m');
		expect(formatDuration(null)).toBe('—');
		expect(formatDuration(-5)).toBe('—');
	});
});

describe('jobFailure', () => {
	it('uses known titles and strips control characters', () => {
		const failure = jobFailure(
			job('a', {
				state: 'failed',
				error: { code: 'custom.thing', detail: 'line one\nline\u0000two' }
			})
		);
		expect(failure).toEqual({
			code: 'custom.thing',
			title: 'Request failed',
			detail: 'line one line two'
		});
	});

	it('bounds very long details', () => {
		expect(sanitizeText('x'.repeat(1000)).length).toBe(400);
	});

	it('describes a cancelled job without an error', () => {
		expect(jobFailure(job('a', { state: 'cancelled' }))?.title).toBe('Cancelled');
		expect(jobFailure(job('a'))).toBeNull();
	});
});

describe('jobResultSummary', () => {
	it('summarizes an export from allowlisted fields only', () => {
		const rows = jobResultSummary(
			job('a', {
				kind: 'server.export',
				result: {
					id: 'e1',
					fileName: 'survival.tar.gz',
					scope: 'selected',
					destination: 's3',
					size: 2048,
					sha256: 'ab'.repeat(32),
					secretAccessKey: 'SHOULD-NOT-APPEAR',
					signedUrl: 'https://example.invalid/?X-Amz-Signature=abc'
				}
			})
		);
		expect(rows.map((r) => r.label)).toEqual([
			'Archive',
			'Contents',
			'Destination',
			'Size',
			'SHA-256'
		]);
		const text = JSON.stringify(rows);
		expect(text).not.toContain('SHOULD-NOT-APPEAR');
		expect(text).not.toContain('Signature');
	});

	it('summarizes Java installs and lifecycle results', () => {
		expect(
			jobResultSummary(
				job('a', {
					kind: 'java.install',
					serverId: null,
					result: {
						runtime: { major: 21, vendor: 'Temurin', fullVersion: '21.0.4', path: '/opt/x' }
					}
				})
			)
		).toEqual([
			{ label: 'Runtime', value: 'Java 21', mono: false },
			{ label: 'Vendor', value: 'Temurin', mono: false },
			{ label: 'Version', value: '21.0.4', mono: true }
		]);
		const rows = jobResultSummary(
			job('a', { result: { server: { name: 'Survival', status: { state: 'running' } } } })
		);
		expect(rows).toEqual([
			{ label: 'Server', value: 'Survival', mono: false },
			{ label: 'Status after', value: 'running', mono: false }
		]);
	});

	it('renders nothing for unknown kinds, odd shapes or unfinished jobs', () => {
		expect(jobResultSummary(job('a', { kind: 'mystery', result: { token: 'x' } }))).toEqual([]);
		expect(jobResultSummary(job('a', { kind: 'server.export', result: [1, 2] }))).toEqual([]);
		expect(
			jobResultSummary(job('a', { state: 'running', result: { server: { name: 'x' } } }))
		).toEqual([]);
	});
});

describe('filterJobs', () => {
	const jobs = [
		job('1', { state: 'running', finishedAt: null }),
		job('2', { serverId: 'srv-2', state: 'failed', kind: 'server.export' }),
		job('3', { serverId: null, kind: 'java.install', state: 'queued' }),
		job('4')
	];

	it('filters by server, state and kind together', () => {
		const ids = (f: Parameters<typeof filterJobs>[1]) => filterJobs(jobs, f).map((j) => j.id);
		expect(ids({ server: 'all', state: 'all', kind: 'all' })).toEqual(['1', '2', '3', '4']);
		expect(ids({ server: 'srv-1', state: 'all', kind: 'all' })).toEqual(['1', '4']);
		expect(ids({ server: 'none', state: 'all', kind: 'all' })).toEqual(['3']);
		expect(ids({ server: 'all', state: 'active', kind: 'all' })).toEqual(['1', '3']);
		expect(ids({ server: 'all', state: 'failed', kind: 'server.export' })).toEqual(['2']);
		expect(ids({ server: 'srv-1', state: 'failed', kind: 'all' })).toEqual([]);
	});
});

describe('mergeJobs', () => {
	it('replaces by id and keeps newest-first cursor order', () => {
		const a = job('a', { createdAt: '2026-11-14T10:00:00Z' });
		const b = job('b', { createdAt: '2026-11-14T11:00:00Z' });
		const c = job('c', { createdAt: '2026-11-14T09:00:00Z' });
		const updated = { ...a, state: 'failed' as const };
		const merged = mergeJobs([b, a], [c, updated]);
		expect(merged.map((j) => j.id)).toEqual(['b', 'a', 'c']);
		expect(merged[1].state).toBe('failed');
	});
});

describe('canLinkServer', () => {
	it('links only existing servers and never a successfully deleted one', () => {
		const known = new Set(['srv-1']);
		expect(canLinkServer(job('a'), known)).toBe(true);
		expect(canLinkServer(job('a', { serverId: 'gone' }), known)).toBe(false);
		expect(canLinkServer(job('a', { serverId: null }), known)).toBe(false);
		expect(canLinkServer(job('a', { kind: 'server.delete' }), known)).toBe(false);
		expect(canLinkServer(job('a', { kind: 'server.delete', state: 'failed' }), known)).toBe(true);
	});
});
