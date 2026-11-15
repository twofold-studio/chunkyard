import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import FileEditor from './file-editor.svelte';
import { ApiError, type FileContent } from '#lib/api/index.js';
import { editorDoc, findEditor, setEditorDoc } from '#lib/components/editor/test-utils.js';

function file(content: string, extra: Partial<FileContent> = {}): FileContent {
	return {
		path: 'config.yml',
		content,
		etag: 'e1',
		size: new TextEncoder().encode(content).length,
		readOnly: false,
		canWrite: true,
		...extra
	};
}

function setup(
	content: string,
	options: { path?: string; writable?: boolean; readOnly?: boolean } = {}
) {
	const path = options.path ?? 'config.yml';
	const readFile = vi.fn(async () => file(content, { path, readOnly: options.readOnly ?? false }));
	const writeFile = vi.fn(async () => ({ etag: 'e2', size: 1 }));
	const onClose = vi.fn();
	const onSaved = vi.fn();
	const result = render(FileEditor, {
		serverId: 's1',
		path,
		writable: options.writable ?? true,
		onClose,
		onSaved,
		api: { readFile, writeFile } as never
	});
	return { readFile, writeFile, onClose, onSaved, label: `Contents of ${path}`, ...result };
}

const saveButton = () => page.getByRole('button', { name: 'Save', exact: true });

describe('FileEditor (CodeMirror)', () => {
	it('opens without changes: exact text, clean state, nothing to save', async () => {
		const raw = '﻿name: Grüße 🧱\r\nlist:\r\n  - a\r\n';
		const { label, writeFile } = setup(raw);
		await vi.waitFor(() => expect(editorDoc(label)).toBe('name: Grüße 🧱\nlist:\n  - a\n'));
		await expect.element(saveButton()).toBeDisabled();
		await expect.element(page.getByText('Unsaved')).not.toBeInTheDocument();
		await expect.element(page.getByText('UTF-8 with BOM · CRLF')).toBeVisible();
		await expect.element(page.getByText('YAML', { exact: true })).toBeVisible();
		expect(writeFile).not.toHaveBeenCalled();
	});

	it('typing keeps CRLF, BOM and the missing trailing newline; Ctrl+S saves with the etag', async () => {
		const { label, writeFile, onSaved } = setup('﻿a: 1\r\nb: ü');
		await vi.waitFor(() => expect(editorDoc(label)).toBe('a: 1\nb: ü'));
		const view = findEditor(label)!;
		view.focus();
		view.dispatch({ selection: { anchor: view.state.doc.length } });
		await userEvent.keyboard('{Enter}c: 3');
		await expect.element(page.getByText('Unsaved')).toBeVisible();
		await userEvent.keyboard('{Control>}s{/Control}');
		await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
		expect(writeFile.mock.calls[0]).toEqual([
			's1',
			'config.yml',
			{ content: '﻿a: 1\r\nb: ü\r\nc: 3', etag: 'e1' },
			expect.anything()
		]);
		await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
		await expect.element(page.getByText(/^Saved/)).toBeVisible();
		// Saved text is the new baseline: no longer dirty.
		await expect.element(saveButton()).toBeDisabled();
	});

	it('undoing back to the original text is clean again', async () => {
		const { label } = setup('x=1\n');
		await vi.waitFor(() => expect(editorDoc(label)).toBe('x=1\n'));
		const view = findEditor(label)!;
		view.focus();
		await userEvent.keyboard('z');
		await expect.element(page.getByText('Unsaved')).toBeVisible();
		await userEvent.keyboard('{Control>}z{/Control}');
		await expect.element(page.getByText('Unsaved')).not.toBeInTheDocument();
	});

	it('stops on an etag conflict without overwriting and keeps local edits', async () => {
		const { label, writeFile } = setup('motd=A\n', { path: 'server.properties' });
		writeFile.mockRejectedValueOnce(new ApiError(409, 'files.conflict', 'changed'));
		await vi.waitFor(() => expect(editorDoc(label)).toBe('motd=A\n'));
		setEditorDoc(label, 'motd=B\n');
		await saveButton().click();
		await expect.element(page.getByText('This file changed since you opened it')).toBeVisible();
		await expect.element(saveButton()).toBeDisabled();
		expect(editorDoc(label)).toBe('motd=B\n');
		// Ctrl+S is blocked too while the conflict stands.
		findEditor(label)!.focus();
		await userEvent.keyboard('{Control>}s{/Control}');
		expect(writeFile).toHaveBeenCalledOnce();
	});

	it('protected files are read-only: typing changes nothing', async () => {
		const { label } = setup('eula=false\n', { path: 'eula.txt', readOnly: true });
		await vi.waitFor(() => expect(editorDoc(label)).toBe('eula=false\n'));
		await expect.element(page.getByText(/managed by the EULA setting/)).toBeVisible();
		findEditor(label)!.focus();
		await userEvent.keyboard('xyz');
		expect(editorDoc(label)).toBe('eula=false\n');
		await expect.element(saveButton()).toBeDisabled();
	});

	it('is read-only while the server runs', async () => {
		const { label } = setup('a=1\n', { path: 'ops.json', writable: false });
		await vi.waitFor(() => expect(editorDoc(label)).toBe('a=1\n'));
		await expect.element(page.getByText('Stop the server to edit files.')).toBeVisible();
		await expect.element(page.getByText('JSON', { exact: true })).toBeVisible();
		findEditor(label)!.focus();
		await userEvent.keyboard('q');
		expect(editorDoc(label)).toBe('a=1\n');
	});

	it('Tab indents; Escape then Tab moves focus out of the editor', async () => {
		const { label } = setup('a\n', { path: 'notes.txt' });
		await vi.waitFor(() => expect(editorDoc(label)).toBe('a\n'));
		const view = findEditor(label)!;
		view.focus();
		view.dispatch({ selection: { anchor: 0 } });
		await userEvent.keyboard('{Tab}');
		expect(editorDoc(label)).toBe('\ta\n');
		expect(view.hasFocus).toBe(true);
		await userEvent.keyboard('{Escape}{Tab}');
		expect(editorDoc(label)).toBe('\ta\n');
		expect(view.hasFocus).toBe(false);
	});

	it('shows the cursor line and column', async () => {
		const { label } = setup('first\nsecond line\n', { path: 'notes.txt' });
		await vi.waitFor(() => expect(editorDoc(label)).toBe('first\nsecond line\n'));
		const view = findEditor(label)!;
		view.dispatch({ selection: { anchor: 6 + 3 } });
		await expect.element(page.getByText('Ln 2, Col 4')).toBeVisible();
		await expect.element(page.getByText('3 lines')).toBeVisible();
	});

	it('asks before closing with unsaved edits: stay keeps them, discard closes', async () => {
		const { label, onClose } = setup('a\n', { path: 'notes.txt' });
		await vi.waitFor(() => expect(editorDoc(label)).toBe('a\n'));
		setEditorDoc(label, 'b\n');
		await page.getByRole('button', { name: 'Files' }).click();
		const dialog = page.getByRole('alertdialog');
		await expect.element(dialog).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
		expect(editorDoc(label)).toBe('b\n');
		await page.getByRole('button', { name: 'Files' }).click();
		await page.getByRole('button', { name: 'Discard changes' }).click();
		expect(onClose).toHaveBeenCalledOnce();
	});
});

describe('FileEditor Vim toggle', () => {
	it('is opt-in, remembered, and saves with :w through the normal save path', async () => {
		const { vimPreference, VIM_PREFERENCE_KEY } =
			await import('#lib/components/editor/vim-preference.svelte.js');
		localStorage.removeItem(VIM_PREFERENCE_KEY);
		vimPreference.reload();
		try {
			const { label, writeFile, onClose } = setup('a: 1\r\n');
			await vi.waitFor(() => expect(editorDoc(label)).toBe('a: 1\n'));
			const toggle = page.getByRole('button', { name: 'Vim' });
			await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
			await toggle.click();
			await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
			expect(localStorage.getItem(VIM_PREFERENCE_KEY)).toBe('on');
			await vi.waitFor(() => expect(document.querySelector('.cm-vimMode')).not.toBeNull());
			await expect.element(page.getByText('normal', { exact: true })).toBeVisible();

			findEditor(label)!.focus();
			await userEvent.keyboard('gg0A2{Escape}');
			await expect.element(page.getByText('Unsaved')).toBeVisible();
			await userEvent.keyboard(':w{Enter}');
			await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
			expect((writeFile.mock.calls[0] as unknown[])[2]).toEqual({
				content: 'a: 12\r\n',
				etag: 'e1'
			});
			await expect.element(page.getByText(/^Saved/)).toBeVisible();
			// `:q` is not a way out of the editor.
			await userEvent.keyboard(':q{Enter}');
			expect(onClose).not.toHaveBeenCalled();
		} finally {
			vimPreference.set(false);
		}
	});
});
