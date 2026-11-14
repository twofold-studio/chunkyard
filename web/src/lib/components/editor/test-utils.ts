import { EditorView } from '@codemirror/view';

/** Test helper: the CodeMirror view whose editing surface has this accessible name. */
export function findEditor(label: string): EditorView | null {
	for (const element of document.querySelectorAll<HTMLElement>('.cm-content')) {
		if (element.getAttribute('aria-label') !== label) continue;
		return EditorView.findFromDOM(element);
	}
	return null;
}

/** Editor document text (always LF, without BOM). Throws until the editor is ready. */
export function editorDoc(label: string): string {
	const view = findEditor(label);
	if (!view) throw new Error(`No editor labelled ${label}`);
	return view.state.doc.toString();
}

/** Replaces the whole document as a user edit would (undoable, reported as a change). */
export function setEditorDoc(label: string, text: string) {
	const view = findEditor(label);
	if (!view) throw new Error(`No editor labelled ${label}`);
	view.dispatch({
		changes: { from: 0, to: view.state.doc.length, insert: text },
		userEvent: 'input'
	});
}
