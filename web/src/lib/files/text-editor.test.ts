import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '#lib/api/index.js';
import { TextFileEditor } from './text-editor.svelte';

const file = (content: string, etag: string, extra = {}) => ({
	path: 'server.properties',
	content,
	etag,
	size: content.length,
	readOnly: false,
	canWrite: true,
	...extra
});

describe('TextFileEditor', () => {
	it('tracks dirty state and saves with the etag from the last read', async () => {
		const readFile = vi.fn().mockResolvedValue(file('motd=a\n', 'e1'));
		const writeFile = vi.fn().mockResolvedValue({ path: 'server.properties', etag: 'e2', size: 8 });
		const editor = new TextFileEditor('s', 'server.properties', { readFile, writeFile });
		await editor.load();
		expect(editor.dirty).toBe(false);
		editor.content = 'motd=b\n';
		expect(editor.dirty).toBe(true);
		expect(await editor.save()).toBe(true);
		expect(writeFile).toHaveBeenCalledWith(
			's',
			'server.properties',
			{ content: 'motd=b\n', etag: 'e1' },
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		expect(editor.dirty).toBe(false);
		expect(editor.etag).toBe('e2');
		// The next save uses the new etag.
		editor.content = 'motd=c\n';
		await editor.save();
		expect(writeFile.mock.calls[1][2]).toEqual({ content: 'motd=c\n', etag: 'e2' });
	});

	it('stops on a conflict without overwriting and keeps local edits until reload', async () => {
		const readFile = vi
			.fn()
			.mockResolvedValueOnce(file('a', 'e1'))
			.mockResolvedValueOnce(file('theirs', 'e3'));
		const writeFile = vi
			.fn()
			.mockRejectedValue(new ApiError(409, 'files.conflict', 'The file changed.'));
		const editor = new TextFileEditor('s', 'server.properties', { readFile, writeFile });
		await editor.load();
		editor.content = 'mine';
		expect(await editor.save()).toBe(false);
		expect(editor.conflict).toBe(true);
		expect(editor.content).toBe('mine');
		// Saving again is refused until the owner reloads.
		expect(await editor.save()).toBe(false);
		expect(writeFile).toHaveBeenCalledOnce();
		await editor.reload();
		expect(editor.conflict).toBe(false);
		expect(editor.content).toBe('theirs');
		expect(editor.etag).toBe('e3');
	});

	it('refuses to save read-only files or while the server runs', async () => {
		const writeFile = vi.fn();
		const readOnly = new TextFileEditor('s', 'eula.txt', {
			readFile: vi.fn().mockResolvedValue(file('eula=false', 'e', { readOnly: true })),
			writeFile
		});
		await readOnly.load();
		readOnly.content = 'eula=true';
		expect(await readOnly.save()).toBe(false);

		const running = new TextFileEditor('s', 'a.txt', {
			readFile: vi.fn().mockResolvedValue(file('x', 'e', { canWrite: false })),
			writeFile
		});
		await running.load();
		running.content = 'y';
		expect(await running.save()).toBe(false);
		expect(writeFile).not.toHaveBeenCalled();
	});

	it('aborts in-flight requests on destroy', async () => {
		let signal: AbortSignal | undefined;
		const readFile = vi.fn((_id: string, _path: string, o?: { signal?: AbortSignal }) => {
			signal = o?.signal;
			return new Promise<never>(() => {});
		});
		const editor = new TextFileEditor('s', 'a.txt', { readFile, writeFile: vi.fn() });
		void editor.load();
		editor.destroy();
		expect(signal?.aborted).toBe(true);
	});
});
