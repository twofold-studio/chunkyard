/**
 * Optional Vim keybindings (@replit/codemirror-vim). `codemirror.ts` imports this module only
 * when the user has turned Vim on, so the binding is its own chunk and costs nothing otherwise.
 */
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { Vim, getCM, vim } from '@replit/codemirror-vim';

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual line' | 'visual block' | 'replace';

export interface VimHooks {
	/** `:w` asks the page to save. Returns false when this editor has nothing to save to. */
	onWrite: () => boolean;
	onMode: (mode: VimMode | null) => void;
}

type VimCM = NonNullable<ReturnType<typeof getCM>>;

/** `:w` is registered once for the whole page; each view looks up its own handler. */
const writers = new WeakMap<EditorView, () => void>();
let exRegistered = false;

function notify(cm: VimCM, message: string) {
	// A text node, never markup.
	const text = document.createElement('span');
	text.textContent = message;
	cm.openNotification(text, { bottom: true, duration: 4000 });
}

function registerEx() {
	if (exRegistered) return;
	exRegistered = true;
	// Replaces the library's `:write`, which would call a global CodeMirror save command.
	// `:q`, `:wq` and `:x` stay unknown commands: closing a file never happens from Vim.
	Vim.defineEx('write', 'w', (cm) => {
		const view = (cm as unknown as { cm6?: EditorView }).cm6;
		const write = view && writers.get(view);
		if (write) write();
	});
}

function modeName(event: { mode?: string; subMode?: string }): VimMode {
	if (event.mode === 'visual') {
		if (event.subMode === 'linewise') return 'visual line';
		if (event.subMode === 'blockwise') return 'visual block';
		return 'visual';
	}
	if (event.mode === 'insert' || event.mode === 'replace') return event.mode;
	return 'normal';
}

export function vimExtension(hooks: VimHooks): Extension {
	registerEx();

	// Created after the Vim plugin (extension order), so `getCM` already has its adapter.
	// Recreated whenever the editor state is replaced (reload), which re-subscribes.
	const bridge = ViewPlugin.define((view) => {
		const cm = getCM(view);
		const onModeChange = (event: { mode?: string; subMode?: string }) =>
			hooks.onMode(modeName(event));
		cm?.on('vim-mode-change', onModeChange);
		writers.set(view, () => {
			if (!cm) return;
			if (view.state.readOnly) notify(cm, 'Read-only: nothing to save');
			else if (!hooks.onWrite()) notify(cm, 'Saving is not available here');
		});
		hooks.onMode('normal');
		return {
			destroy() {
				cm?.off('vim-mode-change', onModeChange);
				writers.delete(view);
				hooks.onMode(null);
			}
		};
	});

	return [
		vim(),
		bridge,
		// Vim consumes Escape when it leaves insert or visual mode, which would skip
		// CodeMirror's "Escape, then Tab moves focus on" escape hatch. Observers always run,
		// so any Escape keeps that hatch open for the next Tab press.
		EditorView.domEventObservers({
			keydown(event, view) {
				if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey) return;
				view.setTabFocusMode(2000);
			}
		}),
		EditorView.theme({
			'.cm-vim-panel': {
				padding: '4px 12px',
				fontFamily: 'var(--font-mono)',
				fontSize: '12px',
				minHeight: '1.6em'
			},
			'.cm-vim-panel input': {
				border: 'none',
				outline: 'none',
				backgroundColor: 'transparent',
				color: 'var(--foreground)',
				fontFamily: 'inherit',
				fontSize: 'inherit'
			},
			'.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
			'.cm-fat-cursor': {
				background: 'color-mix(in oklch, var(--foreground) 55%, transparent)'
			},
			'&:not(.cm-focused) .cm-fat-cursor': {
				background: 'none',
				outline: '1px solid var(--muted-foreground)'
			}
		})
	];
}
