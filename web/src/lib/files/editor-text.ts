/**
 * Conversions between file text and the code editor's document.
 *
 * The editor document always uses `\n` and never shows a byte-order mark. These helpers
 * remember the file's own line ending and BOM so an edited file is written back with
 * the same conventions, and an untouched file is never re-serialized at all.
 */

export type Eol = '\n' | '\r\n' | '\r';

export interface TextFormat {
	eol: Eol;
	bom: boolean;
}

const BOM = '﻿';

/** First line break in the text decides the file's line ending (LF when there is none). */
export function detectFormat(raw: string): TextFormat {
	const match = /\r\n|\r|\n/.exec(raw);
	return { eol: (match?.[0] as Eol | undefined) ?? '\n', bom: raw.startsWith(BOM) };
}

/** File text → editor document (LF line breaks, no BOM). */
export function toEditorText(raw: string): string {
	const body = raw.startsWith(BOM) ? raw.slice(1) : raw;
	return body.replace(/\r\n?/g, '\n');
}

/** Editor document → file text using the file's original line ending and BOM. */
export function fromEditorText(text: string, format: TextFormat): string {
	const body = format.eol === '\n' ? text : text.replace(/\n/g, format.eol);
	return format.bom ? BOM + body : body;
}

export function eolLabel(eol: Eol): string {
	return eol === '\r\n' ? 'CRLF' : eol === '\r' ? 'CR' : 'LF';
}

export type EditorLanguage = 'json' | 'yaml' | 'properties' | 'toml' | 'shell' | 'plain';

export const LANGUAGE_LABELS: Record<EditorLanguage, string> = {
	json: 'JSON',
	yaml: 'YAML',
	properties: 'Properties',
	toml: 'TOML',
	shell: 'Shell',
	plain: 'Plain text'
};

const BY_EXTENSION: Record<string, EditorLanguage> = {
	json: 'json',
	json5: 'json',
	mcmeta: 'json',
	yml: 'yaml',
	yaml: 'yaml',
	properties: 'properties',
	cfg: 'properties',
	conf: 'properties',
	ini: 'properties',
	env: 'properties',
	lang: 'properties',
	toml: 'toml',
	sh: 'shell',
	bash: 'shell',
	zsh: 'shell',
	command: 'shell'
};

/** Syntax mode for a file path; unknown types are plain text. */
export function languageFor(path: string): EditorLanguage {
	const name = path.split('/').pop()?.toLowerCase() ?? '';
	if (name === '.env' || name.startsWith('.env.')) return 'properties';
	const dot = name.lastIndexOf('.');
	if (dot < 0) return 'plain';
	return BY_EXTENSION[name.slice(dot + 1)] ?? 'plain';
}
