import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '#lib/api/index.js';
import { UploadQueue } from './upload-queue.svelte';
import { MAX_UPLOAD_BYTES } from './paths';

const file = (name: string, size = 4) => {
	const f = new File(['data'], name);
	if (size !== 4) Object.defineProperty(f, 'size', { value: size });
	return f;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('UploadQueue', () => {
	it('uploads one file at a time into the current folder', async () => {
		let active = 0;
		let maxActive = 0;
		const upload = vi.fn(
			async (...args: [id: string, path: string, file: Blob, overwrite?: boolean]) => {
				const path = args[1];
				active += 1;
				maxActive = Math.max(maxActive, active);
				await settle();
				active -= 1;
				return { entry: { name: path, path } as never };
			}
		);
		const onUploaded = vi.fn();
		const queue = new UploadQueue({ serverId: 's', upload, onUploaded });
		queue.add('plugins', [file('a.jar'), file('b.jar')]);
		await vi.waitFor(() => expect(queue.items.every((i) => i.state === 'done')).toBe(true));
		expect(maxActive).toBe(1);
		expect(upload.mock.calls.map((c) => [c[1], c[3]])).toEqual([
			['plugins/a.jar', false],
			['plugins/b.jar', false]
		]);
		expect(onUploaded).toHaveBeenCalledTimes(2);
	});

	it('asks before replacing an existing file and only then sends overwrite=true', async () => {
		const upload = vi
			.fn()
			.mockRejectedValueOnce(new ApiError(409, 'files.exists', 'Exists.'))
			.mockResolvedValueOnce({ entry: {} });
		const queue = new UploadQueue({ serverId: 's', upload });
		queue.add('', [file('server.jar')]);
		await vi.waitFor(() => expect(queue.items[0].state).toBe('exists'));
		expect(upload).toHaveBeenCalledOnce();
		queue.replace(queue.items[0].id);
		await vi.waitFor(() => expect(queue.items[0].state).toBe('done'));
		expect(upload.mock.calls[1][3]).toBe(true);
	});

	it('rejects oversized files and unsafe names locally', async () => {
		const upload = vi.fn();
		const queue = new UploadQueue({ serverId: 's', upload });
		queue.add('', [file('huge.zip', MAX_UPLOAD_BYTES + 1), file('..')]);
		await settle();
		expect(queue.items.map((i) => i.state)).toEqual(['failed', 'failed']);
		expect(upload).not.toHaveBeenCalled();
	});

	it('aborts the running upload and skips the rest on destroy', async () => {
		let signal: AbortSignal | undefined;
		const upload = vi.fn(
			(_id: string, _p: string, _f: Blob, _o?: boolean, opts?: { signal?: AbortSignal }) => {
				signal = opts?.signal;
				return new Promise<never>((_, reject) =>
					opts?.signal?.addEventListener('abort', () =>
						reject(new DOMException('Aborted', 'AbortError'))
					)
				);
			}
		);
		const queue = new UploadQueue({ serverId: 's', upload });
		queue.add('', [file('a'), file('b')]);
		await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
		queue.destroy();
		await settle();
		expect(signal?.aborted).toBe(true);
		expect(queue.items.map((i) => i.state)).toEqual(['skipped', 'skipped']);
		expect(upload).toHaveBeenCalledOnce();
	});

	it('keeps the folder captured when the files were queued', async () => {
		const upload = vi.fn(async () => ({ entry: {} as never }));
		const queue = new UploadQueue({ serverId: 's', upload });
		let dir = 'plugins';
		queue.add(dir, [file('a.jar')]);
		dir = 'world';
		queue.add(dir, [file('b.jar')]);
		await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
		expect(queue.items.map((i) => [i.dir, i.path])).toEqual([
			['plugins', 'plugins/a.jar'],
			['world', 'world/b.jar']
		]);
	});

	it('does not queue the same destination twice while it is still open', async () => {
		let release!: () => void;
		const upload = vi.fn(
			() =>
				new Promise<{ entry: never }>(
					(resolve) => (release = () => resolve({ entry: {} as never }))
				)
		);
		const queue = new UploadQueue({ serverId: 's', upload });
		expect(queue.add('', [file('a.jar')])).toEqual({ added: 1, duplicates: [] });
		expect(queue.add('', [file('a.jar'), file('b.jar')])).toEqual({
			added: 1,
			duplicates: ['a.jar']
		});
		expect(queue.items.map((i) => i.path)).toEqual(['a.jar', 'b.jar']);
		await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
		release();
		await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
		release();
		await vi.waitFor(() => expect(queue.items.every((i) => i.state === 'done')).toBe(true));
		// Finished destinations may be queued again (e.g. a deliberate second upload).
		expect(queue.add('', [file('a.jar')]).added).toBe(1);
	});

	it('rejects protected names locally', async () => {
		const upload = vi.fn();
		const queue = new UploadQueue({ serverId: 's', upload });
		queue.add('', [file('server.properties'), file('eula.txt'), file('.chunkyard-x')]);
		await settle();
		expect(queue.items.every((i) => i.state === 'failed')).toBe(true);
		expect(queue.canRetry(queue.items[0].id)).toBe(false);
		expect(upload).not.toHaveBeenCalled();
	});

	it('holds waiting uploads as retryable failures without sending them', async () => {
		let release!: () => void;
		const upload = vi.fn(
			() =>
				new Promise<{ entry: never }>(
					(resolve) => (release = () => resolve({ entry: {} as never }))
				)
		);
		const queue = new UploadQueue({ serverId: 's', upload });
		queue.add('', [file('a'), file('b')]);
		await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
		queue.hold({ code: 'files.server_running', detail: 'paused' });
		release();
		await vi.waitFor(() => expect(queue.items[0].state).toBe('done'));
		await settle();
		expect(queue.items[1].state).toBe('failed');
		expect(upload).toHaveBeenCalledOnce();
		expect(queue.canRetry(queue.items[1].id)).toBe(true);
		queue.retry(queue.items[1].id);
		await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
	});

	it('rechecks write permission between files and before retry', async () => {
		let writable = true;
		let release!: () => void;
		const upload = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = () => resolve({ entry: {} });
					})
			)
			.mockResolvedValue({ entry: {} });
		const queue = new UploadQueue({ serverId: 's', upload, canUpload: () => writable });
		queue.add('original', [file('a'), file('b')]);
		writable = false;
		release();
		await vi.waitFor(() => expect(queue.items[1].state).toBe('failed'));
		queue.retry(queue.items[1].id);
		expect(upload).toHaveBeenCalledOnce();
		writable = true;
		queue.retry(queue.items[1].id);
		await vi.waitFor(() => expect(queue.items[1].state).toBe('done'));
		expect(upload.mock.calls[1][1]).toBe('original/b');
	});

	it('does not replace an existing file after write permission is revoked', async () => {
		let writable = true;
		const upload = vi
			.fn()
			.mockRejectedValueOnce(new ApiError(409, 'files.exists', 'Exists.'))
			.mockResolvedValue({ entry: {} });
		const queue = new UploadQueue({ serverId: 's', upload, canUpload: () => writable });
		queue.add('', [file('a')]);
		await vi.waitFor(() => expect(queue.items[0].state).toBe('exists'));
		writable = false;
		queue.replace(queue.items[0].id);
		expect(upload).toHaveBeenCalledOnce();
		expect(queue.items[0].state).toBe('exists');
		writable = true;
		queue.replace(queue.items[0].id);
		await vi.waitFor(() => expect(queue.items[0].state).toBe('done'));
	});
});
