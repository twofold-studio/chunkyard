import { describe, expect, it } from 'vitest';
import type { Job } from '#lib/api/index.js';
import { job } from './jobs.fixture.js';
import {
	describeJobWork,
	readJobWork,
	stagePercent,
	workBytesText,
	workHistory,
	WORK_HISTORY_LIMIT
} from './work.js';

const MiB = 1024 * 1024;
const running = (work: unknown, extra: Partial<Job> = {}) =>
	job('j', {
		kind: 'server.install',
		state: 'running',
		progress: null,
		finishedAt: null,
		work: work as Job['work'],
		...extra
	});

describe('readJobWork', () => {
	it('falls back to null for old, null and malformed observations', () => {
		expect(readJobWork(undefined)).toBeNull();
		expect(readJobWork(null)).toBeNull();
		expect(readJobWork('download')).toBeNull();
		expect(readJobWork([])).toBeNull();
		expect(readJobWork({ completedBytes: 1 })).toBeNull();
		expect(readJobWork({ stage: 'Download!' })).toBeNull();
		expect(readJobWork({ stage: 'stage<x>' })).toBeNull();
	});

	it('drops invalid byte counts, non-positive totals and bad history entries', () => {
		expect(
			readJobWork({
				stage: 'download',
				completedBytes: -5,
				totalBytes: 0,
				completedStages: ['resolve', 42, 'BAD', null, 'verify']
			})
		).toEqual({
			stage: 'download',
			completedBytes: null,
			totalBytes: null,
			completedStages: ['resolve', 'verify']
		});
		expect(readJobWork({ stage: 'scan', completedBytes: 1.5, totalBytes: Infinity })).toEqual({
			stage: 'scan',
			completedBytes: null,
			totalBytes: null,
			completedStages: []
		});
	});

	it('keeps a well-formed stage a newer backend added, with a readable label', () => {
		const view = describeJobWork(running({ stage: 'warm_cache', completedStages: [] }));
		expect(view.headline).toBe('Warm cache');
	});

	it('bounds history to the last 32 transitions', () => {
		const stages = Array.from({ length: 40 }, (_, i) => (i % 2 ? 'download' : 'verify'));
		const work = readJobWork({ stage: 'finalize', completedStages: stages });
		expect(work?.completedStages).toHaveLength(WORK_HISTORY_LIMIT);
		expect(describeJobWork(running({ stage: 'finalize', completedStages: stages })).truncated).toBe(
			true
		);
	});
});

describe('stage percent and bytes', () => {
	it('computes a percent of the current stage only with a positive known total', () => {
		const work = readJobWork({
			stage: 'download',
			completedBytes: 10 * MiB,
			totalBytes: 100 * MiB,
			completedStages: ['resolve']
		})!;
		expect(stagePercent(work)).toBe(10);
		expect(workBytesText(work)).toBe('10.0 MiB of 100 MiB downloaded');
	});

	it('never shows a percent for an unknown denominator (compression output)', () => {
		const work = readJobWork({
			stage: 'compress',
			completedBytes: 12 * MiB,
			totalBytes: null,
			completedStages: ['scan']
		})!;
		expect(stagePercent(work)).toBeNull();
		expect(workBytesText(work)).toBe('12.0 MiB written');
	});

	it('treats a count beyond its total as inconsistent: bytes only', () => {
		const work = readJobWork({ stage: 'download', completedBytes: 200, totalBytes: 100 })!;
		expect(stagePercent(work)).toBeNull();
		expect(workBytesText(work)).toBe('200 B downloaded');
	});

	it('distinguishes upload from read-back verification', () => {
		const upload = describeJobWork(
			running(
				{ stage: 'upload', completedBytes: 40 * MiB, totalBytes: 95 * MiB, completedStages: [] },
				{ kind: 'server.export' }
			)
		);
		const verify = describeJobWork(
			running(
				{
					stage: 'verify_upload',
					completedBytes: 5 * MiB,
					totalBytes: 95 * MiB,
					completedStages: ['scan', 'compress', 'upload']
				},
				{ kind: 'server.export' }
			)
		);
		expect(upload.headline).toBe('Uploading to storage');
		expect(upload.bytes).toBe('40.0 MiB of 95.0 MiB sent');
		expect(verify.headline).toBe('Verifying upload (checksum read-back)');
		expect(verify.bytes).toBe('5.0 MiB of 95.0 MiB read back');
		expect(verify.percent).toBe(5);
	});
});

describe('workHistory', () => {
	it('merges consecutive repeats and never invents skipped steps', () => {
		const work = readJobWork({
			stage: 'finalize',
			completedStages: ['resolve', 'download', 'verify', 'download', 'verify', 'verify']
		})!;
		expect(workHistory(work).map((s) => [s.label, s.count])).toEqual([
			['Resolve', 1],
			['Download', 1],
			['Verify', 1],
			['Download', 1],
			['Verify', 2]
		]);
		// No extract/prepare_loader were observed, so none are listed.
		expect(workHistory(work).some((s) => s.stage === 'extract')).toBe(false);
	});
});

describe('describeJobWork', () => {
	const work = { stage: 'download', completedBytes: 50, totalBytes: 100, completedStages: [] };

	it('lets queued state win and shows no bytes or percent', () => {
		const view = describeJobWork(running(work, { state: 'queued', startedAt: null }));
		expect(view.phase).toBe('queued');
		expect(view.headline).toMatch(/^Queued/);
		expect(view.percent).toBeNull();
		expect(view.bytes).toBeNull();
	});

	it('uses the fallback when a running job has no observation', () => {
		expect(describeJobWork(running(null), 'Installing').headline).toBe('Installing');
		expect(describeJobWork(running(undefined)).headline).toBe('Working');
	});

	it('reports the failing step without a percent', () => {
		const failed = describeJobWork(
			running(work, { state: 'failed', error: { code: 'software.download_failed', detail: '' } })
		);
		expect(failed.phase).toBe('failed');
		expect(failed.headline).toBe('Failed during downloading');
		expect(failed.percent).toBeNull();
		expect(failed.bytes).toBe('50 B of 100 B downloaded');
	});

	it('marks a restart-interrupted job separately', () => {
		const view = describeJobWork(
			running(work, { state: 'failed', error: { code: 'job.interrupted', detail: '' } })
		);
		expect(view.phase).toBe('interrupted');
		expect(view.headline).toBe('Interrupted during downloading');
	});

	it('shows success as complete, never a stale stage percent', () => {
		const view = describeJobWork(running(work, { state: 'succeeded', progress: 1 }));
		expect(view.headline).toBe('Completed');
		expect(view.percent).toBeNull();
		expect(view.bytes).toBeNull();
	});

	it('ignores the legacy progress field', () => {
		const view = describeJobWork(running(null, { progress: 0.42 }));
		expect(view.percent).toBeNull();
	});
});
