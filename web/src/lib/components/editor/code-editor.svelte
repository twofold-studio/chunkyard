<script lang="ts" module>
	export interface EditorShortcut {
		/** CodeMirror key name, e.g. `Mod-s`. */
		key: string;
		run: () => void;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import {
		detectFormat,
		fromEditorText,
		toEditorText,
		type EditorLanguage,
		type TextFormat
	} from '#lib/files/editor-text.js';
	import type { EditorHandle, EditorStatus, VimMode } from './codemirror.js';
	import { vimPreference } from './vim-preference.svelte.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		/** File text exactly as stored (any line ending, optional BOM). */
		value: string;
		/** Called with the full file text, in the file's own line ending, after each edit. */
		onChange?: (value: string) => void;
		language?: EditorLanguage;
		readOnly?: boolean;
		/** Accessible name of the editing surface. */
		label: string;
		shortcuts?: readonly EditorShortcut[];
		/** Cursor position and size, updated as the user moves around. */
		status?: EditorStatus | null;
		/** Vim keybindings; defaults to the browser-wide preference. */
		vim?: boolean;
		/** Current Vim mode while Vim is on. */
		vimMode?: VimMode | null;
		/** Vim `:w`. Without it, `:w` reports that saving is not available. */
		onSave?: () => void;
		/** Load failed: a plain textarea is shown instead. */
		fallback?: boolean;
		class?: string;
		/** Injects the CodeMirror module (tests). */
		load?: () => Promise<typeof import('./codemirror.js')>;
	}

	let {
		value,
		onChange,
		language = 'plain',
		readOnly = false,
		label,
		shortcuts = [],
		status = $bindable(null),
		vim = vimPreference.enabled,
		vimMode = $bindable(null),
		onSave,
		fallback = $bindable(false),
		class: className,
		load = () => import('./codemirror.js')
	}: Props = $props();

	let host = $state<HTMLElement | null>(null);
	let handle = $state.raw<EditorHandle | null>(null);
	/** File text the editor currently represents (last loaded or emitted). */
	let current = untrack(() => value);
	let format: TextFormat = detectFormat(untrack(() => value));

	function emit(doc: string) {
		const next = fromEditorText(doc, format);
		current = next;
		onChange?.(next);
	}

	$effect(() => {
		const target = host;
		if (!target) return;
		let cancelled = false;
		let created: EditorHandle | null = null;
		untrack(() => {
			load()
				.then((module) =>
					module.createEditor(target, {
						doc: toEditorText(current),
						language,
						readOnly,
						label,
						reducedMotion: prefersReducedMotion.current,
						shortcuts: shortcuts.map((shortcut) => ({
							key: shortcut.key,
							preventDefault: true,
							run: () => {
								shortcut.run();
								return true;
							}
						})),
						onDocChange: emit,
						onStatus: (next) => (status = next),
						vim,
						onWrite: () => {
							if (!onSave) return false;
							onSave();
							return true;
						},
						onVimMode: (mode) => (vimMode = mode)
					})
				)
				.then((editor) => {
					if (cancelled) editor.destroy();
					else {
						handle = created = editor;
						// A reload may finish while the editor/language chunk is loading.
						// Its document must win over the value captured before that await.
						editor.reset(toEditorText(current));
					}
				})
				.catch((error: unknown) => {
					if (cancelled) return;
					console.error('Code editor failed to load', error);
					fallback = true;
				});
		});
		return () => {
			cancelled = true;
			created?.destroy();
			handle = null;
		};
	});

	// Outside changes (reload, conflict refresh) replace the document and its undo history.
	$effect(() => {
		const next = value;
		if (next === current) return;
		current = next;
		format = detectFormat(next);
		untrack(() => handle)?.reset(toEditorText(next));
	});

	$effect(() => {
		handle?.setReadOnly(readOnly);
	});

	$effect(() => {
		const enabled = vim;
		const editor = handle;
		if (!editor) return;
		editor.setVim(enabled).catch((error: unknown) => {
			console.error('Vim keybindings failed to load', error);
		});
	});

	// Fallback textarea: same line-ending rules as the editor.
	function onFallbackInput(event: Event & { currentTarget: HTMLTextAreaElement }) {
		emit(event.currentTarget.value);
	}
	function onFallbackKeydown(event: KeyboardEvent) {
		const mod = event.ctrlKey || event.metaKey;
		for (const shortcut of shortcuts) {
			const key = shortcut.key.replace(/^Mod-/, '').toLowerCase();
			if (shortcut.key.startsWith('Mod-') && mod && event.key.toLowerCase() === key) {
				event.preventDefault();
				shortcut.run();
				return;
			}
		}
	}
</script>

<div class={cn('relative min-h-0', className)} data-code-editor>
	{#if fallback}
		<textarea
			value={toEditorText(value)}
			oninput={onFallbackInput}
			onkeydown={onFallbackKeydown}
			readonly={readOnly}
			spellcheck={false}
			autocomplete="off"
			autocapitalize="off"
			wrap="off"
			aria-label={label}
			class="block size-full min-h-96 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed [tab-size:4] outline-none read-only:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
		></textarea>
	{:else}
		<div
			bind:this={host}
			class={cn(
				'size-full min-h-96 [&_.cm-editor]:h-full [&_.cm-editor]:min-h-96',
				readOnly && '[&_.cm-content]:text-muted-foreground'
			)}
			aria-busy={handle ? undefined : 'true'}
		></div>
		{#if !handle}
			<div
				class="pointer-events-none absolute inset-0 flex items-start gap-3 p-4 font-mono text-[13px] text-muted-foreground"
				role="status"
			>
				<span class="motion-safe:animate-pulse">Loading editor…</span>
			</div>
		{/if}
	{/if}
</div>
