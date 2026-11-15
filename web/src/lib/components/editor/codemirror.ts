/**
 * CodeMirror setup for the code editor. Only `code-editor.svelte` imports this module, and
 * only dynamically, so the editor's code is a separate chunk loaded when a file opens.
 */
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
	EditorView,
	crosshairCursor,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	rectangularSelection,
	type KeyBinding
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
	HighlightStyle,
	StreamLanguage,
	bracketMatching,
	indentOnInput,
	indentUnit,
	syntaxHighlighting
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { EditorLanguage } from '#lib/files/editor-text.js';
import type { VimMode } from './vim.js';

export type { VimMode };

export interface EditorStatus {
	line: number;
	column: number;
	lines: number;
	/** Characters selected across all ranges. */
	selected: number;
}

export interface EditorOptions {
	doc: string;
	language: EditorLanguage;
	readOnly: boolean;
	label: string;
	reducedMotion: boolean;
	/** Extra shortcuts (e.g. Mod-s to save); they take precedence over the defaults. */
	shortcuts: readonly KeyBinding[];
	onDocChange: (doc: string) => void;
	onStatus: (status: EditorStatus) => void;
	/** Start with Vim keybindings (loaded on demand). */
	vim?: boolean;
	/** `:w` in Vim mode. Returns false when there is nothing to save to. */
	onWrite?: () => boolean;
	/** Current Vim mode, or null while Vim is off. */
	onVimMode?: (mode: VimMode | null) => void;
}

export interface EditorHandle {
	readonly view: EditorView;
	/** Replaces the document and clears undo history (used after reload). */
	reset(doc: string): void;
	setReadOnly(readOnly: boolean): void;
	/** Turns Vim keybindings on or off; resolves once applied (or superseded). */
	setVim(enabled: boolean): Promise<void>;
	focus(): void;
	destroy(): void;
}

async function languageExtension(language: EditorLanguage): Promise<Extension> {
	switch (language) {
		case 'json':
			return (await import('@codemirror/lang-json')).json();
		case 'yaml':
			return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/yaml')).yaml);
		case 'properties':
			return StreamLanguage.define(
				(await import('@codemirror/legacy-modes/mode/properties')).properties
			);
		case 'toml':
			return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml);
		case 'shell':
			return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell);
		default:
			return [];
	}
}

// Colors come from the app's design tokens so light and dark themes both apply.
const highlight = HighlightStyle.define([
	{ tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'cm-tok-comment' },
	{ tag: [tags.string, tags.special(tags.string)], class: 'cm-tok-string' },
	{ tag: [tags.number, tags.integer, tags.float], class: 'cm-tok-number' },
	{
		tag: [tags.bool, tags.null, tags.atom, tags.keyword, tags.controlKeyword],
		class: 'cm-tok-keyword'
	},
	{
		tag: [
			tags.propertyName,
			tags.definition(tags.propertyName),
			tags.attributeName,
			tags.variableName
		],
		class: 'cm-tok-key'
	},
	{ tag: [tags.heading, tags.meta, tags.processingInstruction], class: 'cm-tok-meta' },
	{ tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], class: 'cm-tok-punct' },
	{ tag: tags.invalid, class: 'cm-tok-invalid' }
]);

const theme = EditorView.theme({
	'&': {
		color: 'var(--foreground)',
		backgroundColor: 'transparent',
		fontSize: '13px',
		height: '100%'
	},
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': {
		fontFamily: 'var(--font-mono)',
		lineHeight: '1.625'
	},
	'.cm-content': { padding: '12px 0', caretColor: 'var(--foreground)' },
	'.cm-line': { padding: '0 16px 0 12px' },
	'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
	'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
		{ backgroundColor: 'color-mix(in oklch, var(--ring) 40%, transparent)' },
	'.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--muted) 70%, transparent)' },
	'.cm-gutters': {
		backgroundColor: 'transparent',
		color: 'var(--muted-foreground)',
		borderRight: '1px solid var(--border)'
	},
	'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
	'.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '3ch' },
	'.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
		backgroundColor: 'color-mix(in oklch, var(--ring) 30%, transparent)',
		outline: '1px solid var(--ring)'
	},
	'.cm-selectionMatch': { backgroundColor: 'color-mix(in oklch, var(--warning) 18%, transparent)' },
	'.cm-searchMatch': {
		backgroundColor: 'color-mix(in oklch, var(--warning) 30%, transparent)',
		outline: '1px solid color-mix(in oklch, var(--warning) 60%, transparent)'
	},
	'.cm-searchMatch.cm-searchMatch-selected': {
		backgroundColor: 'color-mix(in oklch, var(--warning) 55%, transparent)'
	},
	'.cm-specialChar': { color: 'var(--destructive)' },
	'.cm-panels': {
		backgroundColor: 'var(--card)',
		color: 'var(--foreground)',
		fontFamily: 'var(--font-sans)',
		fontSize: '12px'
	},
	'.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
	'.cm-panel.cm-search': { padding: '8px 36px 8px 12px' },
	'.cm-panel.cm-search label': { fontSize: '12px', color: 'var(--muted-foreground)' },
	'.cm-textfield': {
		backgroundColor: 'transparent',
		color: 'var(--foreground)',
		border: '1px solid var(--input)',
		borderRadius: 'calc(var(--radius) - 2px)',
		padding: '3px 8px',
		fontFamily: 'var(--font-mono)',
		fontSize: '12px'
	},
	'.cm-textfield:focus-visible': {
		outline: '2px solid color-mix(in oklch, var(--ring) 60%, transparent)'
	},
	'.cm-button': {
		backgroundImage: 'none',
		backgroundColor: 'transparent',
		color: 'var(--foreground)',
		border: '1px solid var(--border)',
		borderRadius: 'calc(var(--radius) - 2px)',
		padding: '3px 10px',
		fontSize: '12px'
	},
	'.cm-button:hover': { backgroundColor: 'var(--accent)' },
	'.cm-button:focus-visible': {
		outline: '2px solid color-mix(in oklch, var(--ring) 60%, transparent)'
	},
	'.cm-panel.cm-search [name=close]': {
		color: 'var(--muted-foreground)',
		fontSize: '18px',
		right: '10px'
	},
	'.cm-tok-comment': { color: 'var(--muted-foreground)', fontStyle: 'italic' },
	'.cm-tok-string': { color: 'var(--success)' },
	'.cm-tok-number': { color: 'oklch(0.66 0.13 250)' },
	'.cm-tok-keyword': { color: 'var(--warning)' },
	'.cm-tok-key': { color: 'oklch(0.7 0.11 220)' },
	'.cm-tok-meta': { color: 'oklch(0.68 0.12 300)' },
	'.cm-tok-punct': { color: 'var(--muted-foreground)' },
	'.cm-tok-invalid': { color: 'var(--destructive)' }
});

function status(state: EditorState): EditorStatus {
	const head = state.selection.main.head;
	const line = state.doc.lineAt(head);
	return {
		line: line.number,
		column: head - line.from + 1,
		lines: state.doc.lines,
		selected: state.selection.ranges.reduce((total, range) => total + range.to - range.from, 0)
	};
}

export async function createEditor(
	parent: HTMLElement,
	options: EditorOptions
): Promise<EditorHandle> {
	const vimCompartment = new Compartment();
	let vimExt: Extension = [];
	let vimWanted = options.vim ?? false;
	let destroyed = false;
	const loadVim = async (): Promise<Extension> =>
		(await import('./vim.js')).vimExtension({
			onWrite: () => options.onWrite?.() ?? false,
			onMode: (mode) => options.onVimMode?.(mode)
		});
	const [languageExt, initialVim] = await Promise.all([
		languageExtension(options.language),
		vimWanted
			? loadVim().catch((error: unknown): Extension => {
					// Keep a working editor with the normal keys; Vim can be retried by toggling.
					console.error('Vim keybindings failed to load', error);
					vimWanted = false;
					return [];
				})
			: Promise.resolve<Extension>([])
	]);
	// A toggle while loading is applied by the caller through setVim.
	vimExt = initialVim;
	let vimApplied = vimWanted;
	const readOnly = new Compartment();

	const extensions = (): Extension[] => [
		// Vim first, so its keys win over the keymaps below (as the binding requires).
		vimCompartment.of(vimExt),
		lineNumbers(),
		highlightActiveLineGutter(),
		highlightSpecialChars(),
		history(),
		drawSelection({ cursorBlinkRate: options.reducedMotion ? 0 : 1200 }),
		EditorState.allowMultipleSelections.of(true),
		indentOnInput(),
		indentUnit.of(options.language === 'yaml' ? '  ' : '\t'),
		EditorState.tabSize.of(4),
		bracketMatching(),
		rectangularSelection(),
		crosshairCursor(),
		highlightActiveLine(),
		highlightSelectionMatches(),
		search({ top: true }),
		syntaxHighlighting(highlight),
		languageExt,
		readOnly.of(EditorState.readOnly.of(options.readOnly)),
		// Tab indents; press Escape first (CodeMirror's tab-focus escape) to move focus on.
		keymap.of([
			...options.shortcuts,
			...searchKeymap,
			...historyKeymap,
			...defaultKeymap,
			indentWithTab
		]),
		EditorView.contentAttributes.of({
			'aria-label': options.label,
			spellcheck: 'false',
			autocorrect: 'off',
			autocapitalize: 'off',
			translate: 'no'
		}),
		EditorView.updateListener.of((update) => {
			if (update.docChanged) options.onDocChange(update.state.doc.toString());
			if (update.docChanged || update.selectionSet) options.onStatus(status(update.state));
		}),
		theme
	];

	const makeState = (doc: string) => EditorState.create({ doc, extensions: extensions() });
	const view = new EditorView({ state: makeState(options.doc), parent });
	options.onStatus(status(view.state));
	let currentReadOnly = options.readOnly;

	return {
		view,
		reset(doc) {
			options.readOnly = currentReadOnly;
			view.setState(makeState(doc));
			options.onStatus(status(view.state));
		},
		async setVim(enabled) {
			vimWanted = enabled;
			if (enabled === vimApplied) return;
			const next = enabled ? await loadVim() : [];
			// A later call (or destroy) superseded this one while the chunk loaded.
			if (destroyed || vimWanted !== enabled || vimApplied === enabled) return;
			vimExt = next;
			vimApplied = enabled;
			view.dispatch({ effects: vimCompartment.reconfigure(next) });
		},
		setReadOnly(next) {
			currentReadOnly = next;
			view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(next)) });
		},
		focus() {
			view.focus();
		},
		destroy() {
			destroyed = true;
			view.destroy();
		}
	};
}
