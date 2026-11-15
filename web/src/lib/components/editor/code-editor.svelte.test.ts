import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import CodeEditor from './code-editor.svelte';
import { editorDoc, setEditorDoc } from './test-utils.js';
import type { VimMode } from './codemirror.js';

type Module = typeof import('./codemirror.js');

describe('CodeEditor', () => {
	it('shows a loading state until the editor chunk arrives', async () => {
		// Control the load boundary, independently of cold Vite module compilation.
		const module = await import('./codemirror.js');
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const load = async (): Promise<Module> => {
			await gate;
			return module;
		};
		render(CodeEditor, { value: 'a\n', label: 'Doc', load });
		await expect.element(page.getByRole('status')).toHaveTextContent('Loading editor…');
		release();
		await vi.waitFor(() => expect(editorDoc('Doc')).toBe('a\n'));
		await expect.element(page.getByText('Loading editor…')).not.toBeInTheDocument();
	});

	it('destroys the view on unmount, including when unmounted mid-load', async () => {
		const destroyed = vi.fn();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const load = async (): Promise<Module> => {
			await gate;
			const module = await import('./codemirror.js');
			return {
				...module,
				createEditor: async (...args: Parameters<Module['createEditor']>) => {
					const handle = await module.createEditor(...args);
					return {
						...handle,
						destroy: () => {
							destroyed();
							handle.destroy();
						}
					};
				}
			};
		};
		const early = render(CodeEditor, { value: 'x', label: 'Early', load });
		early.unmount();
		release();
		await vi.waitFor(() => expect(destroyed).toHaveBeenCalledOnce());
		expect(document.querySelector('.cm-editor')).toBeNull();

		const later = render(CodeEditor, { value: 'y', label: 'Later', load });
		await vi.waitFor(() => expect(editorDoc('Later')).toBe('y'));
		later.unmount();
		expect(destroyed).toHaveBeenCalledTimes(2);
		expect(document.querySelector('.cm-editor')).toBeNull();
	});

	it('falls back to a plain textarea that keeps line endings when loading fails', async () => {
		const onChange = vi.fn();
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		render(CodeEditor, {
			value: 'a\r\nb\r\n',
			label: 'Doc',
			onChange,
			load: () => Promise.reject(new Error('offline'))
		});
		const area = page.getByRole('textbox', { name: 'Doc' });
		await expect.element(area).toHaveValue('a\nb\n');
		await area.fill('a\nb\nc\n');
		expect(onChange).toHaveBeenLastCalledWith('a\r\nb\r\nc\r\n');
		error.mockRestore();
	});

	it('replaces the document when the value changes from outside', async () => {
		const onChange = vi.fn();
		const { rerender } = render(CodeEditor, { value: 'one\n', label: 'Doc', onChange });
		await vi.waitFor(() => expect(editorDoc('Doc')).toBe('one\n'));
		await rerender({ value: 'two\r\n' });
		await vi.waitFor(() => expect(editorDoc('Doc')).toBe('two\n'));
		expect(onChange).not.toHaveBeenCalled();
		// Edits use the new value's line ending.
		setEditorDoc('Doc', 'two\nthree\n');
		expect(onChange).toHaveBeenLastCalledWith('two\r\nthree\r\n');
	});

	it('runs custom shortcuts and opens find/replace', async () => {
		const run = vi.fn();
		render(CodeEditor, {
			value: 'needle\n',
			label: 'Doc',
			shortcuts: [{ key: 'Mod-Enter', run }]
		});
		await vi.waitFor(() => expect(editorDoc('Doc')).toBe('needle\n'));
		await page.getByRole('textbox', { name: 'Doc' }).click();
		await userEvent.keyboard('{Control>}{Enter}{/Control}');
		expect(run).toHaveBeenCalledOnce();
		await userEvent.keyboard('{Control>}f{/Control}');
		await expect.element(page.getByRole('textbox', { name: 'Find' })).toBeVisible();
		await expect.element(page.getByRole('textbox', { name: 'Replace' })).toBeVisible();
	});

	it('uses the latest external value when asynchronous creation finishes', async () => {
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => (entered = resolve));
		const gate = new Promise<void>((resolve) => (release = resolve));
		const onChange = vi.fn();
		const load = async (): Promise<Module> => {
			const module = await import('./codemirror.js');
			return {
				...module,
				createEditor: async (...args: Parameters<Module['createEditor']>) => {
					entered();
					await gate;
					return module.createEditor(...args);
				}
			};
		};
		const { rerender } = render(CodeEditor, { value: 'old\n', label: 'Doc', load, onChange });
		await started;
		await rerender({ value: 'latest\r\n' });
		release();
		await vi.waitFor(() => expect(editorDoc('Doc')).toBe('latest\n'));
		expect(onChange).not.toHaveBeenCalled();
		setEditorDoc('Doc', 'latest\nedit\n');
		expect(onChange).toHaveBeenLastCalledWith('latest\r\nedit\r\n');
	});
});

describe('CodeEditor Vim mode', () => {
	async function ready(label: string) {
		await vi.waitFor(() => expect(document.querySelector('.cm-vimMode')).not.toBeNull());
		await page.getByRole('textbox', { name: label }).click();
		// Clicking lands past the text; start every case at the first character.
		await userEvent.keyboard('gg0');
	}

	it('stays off by default and keeps the normal keys', async () => {
		render(CodeEditor, { value: 'needle\n', label: 'Doc' });
		await vi.waitFor(() => expect(editorDoc('Doc')).toBe('needle\n'));
		expect(document.querySelector('.cm-vimMode')).toBeNull();
		await page.getByRole('textbox', { name: 'Doc' }).click();
		await userEvent.keyboard('x');
		expect(editorDoc('Doc')).toMatch(/x/);
	});

	it('edits through Vim, keeps line endings and reports the mode', async () => {
		const onChange = vi.fn();
		const modes: (string | null)[] = [];
		const screen = render(CodeEditor, {
			value: '﻿one\r\ntwo\r\n',
			label: 'Doc',
			vim: true,
			onChange,
			get vimMode(): VimMode | null {
				return null;
			},
			set vimMode(mode: VimMode | null) {
				modes.push(mode);
			}
		});
		await ready('Doc');
		await userEvent.keyboard('x');
		expect(editorDoc('Doc')).toBe('ne\ntwo\n');
		expect(onChange).toHaveBeenLastCalledWith('﻿ne\r\ntwo\r\n');
		await userEvent.keyboard('A!{Escape}');
		expect(editorDoc('Doc')).toBe('ne!\ntwo\n');
		expect(onChange).toHaveBeenLastCalledWith('﻿ne!\r\ntwo\r\n');
		expect(modes).toEqual(expect.arrayContaining(['normal', 'insert']));
		expect(modes.at(-1)).toBe('normal');
		// Undo goes back to the loaded text, so the page sees it as clean again.
		await userEvent.keyboard('uu');
		expect(onChange).toHaveBeenLastCalledWith('﻿one\r\ntwo\r\n');
		screen.unmount();
	});

	it('saves with :w, and :q never closes anything', async () => {
		const onSave = vi.fn();
		render(CodeEditor, { value: 'a\n', label: 'Doc', vim: true, onSave });
		await ready('Doc');
		await userEvent.keyboard(':w{Enter}');
		expect(onSave).toHaveBeenCalledOnce();
		await userEvent.keyboard(':q{Enter}');
		await expect.element(page.getByText('Not an editor command ":q"')).toBeVisible();
		expect(onSave).toHaveBeenCalledOnce();
		expect(editorDoc('Doc')).toBe('a\n');
	});

	it('keeps read-only text unchanged and refuses :w', async () => {
		const onSave = vi.fn();
		const onChange = vi.fn();
		render(CodeEditor, {
			value: 'keep\nme\n',
			label: 'Doc',
			vim: true,
			readOnly: true,
			onSave,
			onChange
		});
		await ready('Doc');
		await userEvent.keyboard('ddxiZ{Escape}p');
		expect(editorDoc('Doc')).toBe('keep\nme\n');
		expect(onChange).not.toHaveBeenCalled();
		await userEvent.keyboard(':w{Enter}');
		expect(onSave).not.toHaveBeenCalled();
		await expect.element(page.getByText('Read-only: nothing to save')).toBeVisible();
	});

	it('reports :w as unavailable without a save handler', async () => {
		render(CodeEditor, { value: 'a\n', label: 'Doc', vim: true });
		await ready('Doc');
		await userEvent.keyboard(':w{Enter}');
		await expect.element(page.getByText('Saving is not available here')).toBeVisible();
	});

	it('leaves with Escape then Tab from insert and normal mode', async () => {
		const after = document.createElement('button');
		after.textContent = 'After';
		render(CodeEditor, { value: 'a\n', label: 'Doc', vim: true });
		document.body.append(after);
		try {
			await ready('Doc');
			await userEvent.keyboard('i{Escape}{Tab}');
			expect(document.activeElement).toBe(after);
			expect(editorDoc('Doc')).toBe('a\n');
			await page.getByRole('textbox', { name: 'Doc' }).click();
			await userEvent.keyboard('{Escape}{Tab}');
			expect(document.activeElement).toBe(after);
		} finally {
			after.remove();
		}
	});

	it('lets page shortcuts such as Ctrl+K and Ctrl+S reach the window', async () => {
		const run = vi.fn();
		const seen: string[] = [];
		const listener = (event: KeyboardEvent) => {
			if (event.ctrlKey) seen.push(event.key.toLowerCase());
		};
		window.addEventListener('keydown', listener);
		try {
			render(CodeEditor, {
				value: 'a\n',
				label: 'Doc',
				vim: true,
				shortcuts: [{ key: 'Mod-Enter', run }]
			});
			await ready('Doc');
			await userEvent.keyboard('{Control>}k{/Control}');
			await userEvent.keyboard('i{Control>}k{/Control}{Escape}');
			expect(seen.filter((key) => key === 'k')).toHaveLength(2);
			await userEvent.keyboard('{Control>}{Enter}{/Control}');
			expect(run).toHaveBeenCalledOnce();
			expect(editorDoc('Doc')).toBe('a\n');
		} finally {
			window.removeEventListener('keydown', listener);
		}
	});

	it('turns on and off without losing the document or undo', async () => {
		const onChange = vi.fn();
		const { rerender } = render(CodeEditor, { value: 'abc\n', label: 'Doc', onChange });
		await vi.waitFor(() => expect(editorDoc('Doc')).toBe('abc\n'));
		await rerender({ vim: true });
		await ready('Doc');
		await userEvent.keyboard('x');
		expect(editorDoc('Doc')).toBe('bc\n');
		await rerender({ vim: false });
		await vi.waitFor(() => expect(document.querySelector('.cm-vimMode')).toBeNull());
		await page.getByRole('textbox', { name: 'Doc' }).click();
		await userEvent.keyboard('{Control>}z{/Control}');
		expect(editorDoc('Doc')).toBe('abc\n');
		await userEvent.keyboard('{Control>}f{/Control}');
		await expect.element(page.getByRole('textbox', { name: 'Find' })).toBeVisible();
	});
});
