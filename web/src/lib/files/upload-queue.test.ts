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
});
