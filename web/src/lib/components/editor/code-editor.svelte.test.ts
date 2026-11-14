import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import CodeEditor from './code-editor.svelte';
import { editorDoc, setEditorDoc } from './test-utils.js';

type Module = typeof import('./codemirror.js');

describe('CodeEditor', () => {
	it('shows a loading state until the editor chunk arrives', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const load = async (): Promise<Module> => {
			await gate;
			return import('./codemirror.js');
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
