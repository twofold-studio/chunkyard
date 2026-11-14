/**
 * Lossless reader/patcher for Java `.properties` text such as `server.properties`.
 *
 * The file is never rebuilt from an object. Parsing records where each logical entry
 * lives in the original text; {@link setProperty} replaces only the value text of the
 * one entry being edited (or appends a new line), so comments, blank lines, ordering,
 * line endings (LF/CRLF/CR, even mixed), escapes, continuations and duplicate keys
 * elsewhere in the file stay byte-for-byte identical.
 *
 * Semantics follow `java.util.Properties.load`: `#`/`!` comments, `=`/`:`/whitespace
 * separators, backslash escapes (`\t \n \r \f \uXXXX`, `\x` → `x`), a line ending in an
 * odd number of backslashes continues on the next line (whose leading whitespace is
 * skipped), and for duplicate keys the last occurrence wins.
 */

/** One `key=value` logical line (possibly spanning several physical lines). */
export interface PropertyEntry {
	key: string;
	value: string;
	/** Offset of the first key character in the source text. */
	start: number;
	/** Offset where the value text begins (or where it would be inserted). */
	valueStart: number;
	/** Offset after the last value character, before the line terminator. */
	end: number;
	/** 1-based physical line number of the entry's first line. */
	line: number;
	/** The key ran straight into the end of the line: a value needs a `=` inserted. */
	needsSeparator: boolean;
	/** Spans more than one physical line. */
	continued: boolean;
	/** Contains a malformed `\u` escape; Java would reject the file, so never patch it. */
	malformed: boolean;
}

export interface PropertiesDocument {
	/** Every logical entry in file order, duplicates included. */
	entries: PropertyEntry[];
	/** Effective entry per key (the last occurrence). */
	effective: Map<string, PropertyEntry>;
	/** Number of occurrences per key. */
	counts: Map<string, number>;
	/** Line terminator used for appended lines (the file's first one, else LF). */
	eol: string;
	/** Text ends without a line terminator (and is non-empty). */
	missingFinalEol: boolean;
}

const WHITESPACE = new Set([' ', '\t', '\f']);
const HEX = /^[0-9a-fA-F]{4}$/;

function isWhitespace(char: string | undefined): boolean {
	return char !== undefined && WHITESPACE.has(char);
}

interface PhysicalLine {
	start: number;
	/** End of content, before the terminator. */
	end: number;
	/** Offset after the terminator. */
	next: number;
	terminator: string;
}

function* physicalLines(text: string, from: number): Generator<PhysicalLine> {
	let i = from;
	while (i < text.length) {
		let end = i;
		while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1;
		let terminator = '';
		if (text[end] === '\r' && text[end + 1] === '\n') terminator = '\r\n';
		else if (end < text.length) terminator = text[end];
		yield { start: i, end, next: end + terminator.length, terminator };
		i = end + terminator.length;
	}
}

function trailingBackslashes(text: string, start: number, end: number): number {
	let count = 0;
	for (let i = end - 1; i >= start && text[i] === '\\'; i -= 1) count += 1;
	return count;
}

/** Decodes escapes in `raw`; returns `null` for a malformed `\u` escape. */
function unescape(raw: string): string | null {
	let out = '';
	for (let i = 0; i < raw.length; i += 1) {
		const char = raw[i];
		if (char !== '\\') {
			out += char;
			continue;
		}
		i += 1;
		if (i >= raw.length) break; // Lone trailing backslash: Java drops it.
		const next = raw[i];
		if (next === 'u') {
			const hex = raw.slice(i + 1, i + 5);
			if (!HEX.test(hex)) return null;
			out += String.fromCharCode(parseInt(hex, 16));
			i += 4;
		} else if (next === 't') out += '\t';
		else if (next === 'n') out += '\n';
		else if (next === 'r') out += '\r';
		else if (next === 'f') out += '\f';
		else out += next;
	}
	return out;
}

/** Parses `text`. Never throws; malformed entries are flagged instead. */
export function parseProperties(text: string): PropertiesDocument {
	const entries: PropertyEntry[] = [];
	// A UTF-8 BOM is not part of the first key.
	const from = text.startsWith('﻿') ? 1 : 0;
	const lines = [...physicalLines(text, from)];
	const eol = lines.find((l) => l.terminator)?.terminator ?? '\n';

	for (let index = 0; index < lines.length; index += 1) {
		const firstIndex = index;
		const first = lines[index];
		let contentStart = first.start;
		while (contentStart < first.end && isWhitespace(text[contentStart])) contentStart += 1;
		if (contentStart === first.end) continue; // Blank line.
		if (text[contentStart] === '#' || text[contentStart] === '!') continue; // Comment.

		// Join continuation lines into one logical line, remembering source offsets.
		let logical = '';
		const offsets: number[] = [];
		let segStart = contentStart;
		let line = first;
		let continued = false;
		for (;;) {
			const continues = trailingBackslashes(text, segStart, line.end) % 2 === 1;
			const segEnd = continues ? line.end - 1 : line.end;
			for (let i = segStart; i < segEnd; i += 1) {
				logical += text[i];
				offsets.push(i);
			}
			if (!continues || index + 1 >= lines.length) break;
			index += 1;
			continued = true;
			line = lines[index];
			segStart = line.start;
			while (segStart < line.end && isWhitespace(text[segStart])) segStart += 1;
		}
		const end = line.end;

		// Key ends at the first unescaped separator or whitespace.
		let k = 0;
		let rawKey = '';
		let explicit = false;
		while (k < logical.length) {
			const char = logical[k];
			if (char === '\\') {
				rawKey += logical.slice(k, k + 2);
				k += 2;
				continue;
			}
			if (char === '=' || char === ':') {
				explicit = true;
				k += 1;
				break;
			}
			if (isWhitespace(char)) break;
			rawKey += char;
			k += 1;
		}
		const keyEnd = k;
		while (k < logical.length && isWhitespace(logical[k])) k += 1;
		if (!explicit && (logical[k] === '=' || logical[k] === ':')) {
			k += 1;
			while (k < logical.length && isWhitespace(logical[k])) k += 1;
		}
		const key = unescape(rawKey);
		const value = unescape(logical.slice(k));
		const valueStart = k < offsets.length ? offsets[k] : end;
		entries.push({
			key: key ?? rawKey,
			value: value ?? logical.slice(k),
			start: contentStart,
			valueStart,
			end,
			line: firstIndex + 1,
			needsSeparator: !explicit && keyEnd === logical.length,
			continued,
			malformed: key === null || value === null
		});
	}

	const effective = new Map<string, PropertyEntry>();
	const counts = new Map<string, number>();
	for (const entry of entries) {
		effective.set(entry.key, entry);
		counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
	}
	const last = text.at(-1);
	return {
		entries,
		effective,
		counts,
		eol,
		missingFinalEol: text.length > from && last !== '\n' && last !== '\r'
	};
}

function escapeChar(char: string): string {
	switch (char) {
		case '\\':
			return '\\\\';
		case '\t':
			return '\\t';
		case '\n':
			return '\\n';
		case '\r':
			return '\\r';
		case '\f':
			return '\\f';
	}
	const code = char.charCodeAt(0);
	if (code < 0x20 || code === 0x7f) return `\\u${code.toString(16).padStart(4, '0')}`;
	return char;
}

/** Escapes a value so {@link parseProperties} reads back exactly `value`. */
export function escapePropertyValue(value: string): string {
	let out = '';
	for (let i = 0; i < value.length; i += 1) {
		const char = value[i];
		// A leading space would otherwise be skipped as part of the separator; tabs and
		// form feeds are always escaped.
		out += i === 0 && char === ' ' ? '\\ ' : escapeChar(char);
	}
	return out;
}

/** Escapes a key: separators, whitespace and leading comment markers are escaped. */
export function escapePropertyKey(key: string): string {
	let out = '';
	for (let i = 0; i < key.length; i += 1) {
		const char = key[i];
		if (char === '=' || char === ':' || char === ' ') out += `\\${char}`;
		else if (i === 0 && (char === '#' || char === '!')) out += `\\${char}`;
		else out += escapeChar(char);
	}
	return out;
}

/** Keys accepted by the add-property form: printable, no whitespace or separators. */
export function validatePropertyKey(key: string): string | null {
	if (!key) return 'Enter a property name.';
	if (/[\s=:\\#!]/.test(key) || [...key].some((c) => c.charCodeAt(0) < 0x20)) {
		return 'Use a name without spaces, =, :, #, ! or backslashes.';
	}
	return null;
}

export class UnsafePropertyEdit extends Error {
	constructor(key: string) {
		super(`“${key}” uses syntax that can only be edited as raw text.`);
		this.name = 'UnsafePropertyEdit';
	}
}

/**
 * Returns `text` with the effective value of `key` set to `value`. Only that entry's
 * value text changes; a missing key is appended as one new line using the file's line
 * ending. Throws {@link UnsafePropertyEdit} if the entry is malformed.
 */
export function setProperty(text: string, key: string, value: string): string {
	const doc = parseProperties(text);
	const entry = doc.effective.get(key);
	if (!entry) {
		const line = `${escapePropertyKey(key)}=${escapePropertyValue(value)}`;
		const separator = doc.missingFinalEol ? doc.eol : '';
		return `${text}${separator}${line}${doc.eol}`;
	}
	if (entry.malformed) throw new UnsafePropertyEdit(key);
	// Same value: keep the original spelling (escapes, continuations) untouched.
	if (entry.value === value) return text;
	const escaped = escapePropertyValue(value);
	const replacement = entry.needsSeparator ? `=${escaped}` : escaped;
	return text.slice(0, entry.valueStart) + replacement + text.slice(entry.end);
}

/** Effective value of `key`, or `undefined` when the file does not set it. */
export function getProperty(doc: PropertiesDocument, key: string): string | undefined {
	return doc.effective.get(key)?.value;
}

/** Removes every occurrence of `key`, each with its line terminator. */
export function removeProperty(text: string, key: string): string {
	let next = text;
	for (;;) {
		const entry = parseProperties(next).effective.get(key);
		if (!entry) return next;
		let lineStart = entry.start;
		while (lineStart > 0 && next[lineStart - 1] !== '\n' && next[lineStart - 1] !== '\r') {
			lineStart -= 1;
		}
		if (lineStart === 0 && next.startsWith('﻿')) lineStart = 1;
		let end = entry.end;
		if (next[end] === '\r' && next[end + 1] === '\n') end += 2;
		else if (next[end] === '\r' || next[end] === '\n') end += 1;
		next = next.slice(0, lineStart) + next.slice(end);
	}
}

/**
 * Undoes edits to one key: restores its value from `original`, or removes it when
 * `original` did not set it. Other entries are untouched.
 */
export function revertProperty(text: string, original: string, key: string): string {
	const value = getProperty(parseProperties(original), key);
	if (value !== undefined) return setProperty(text, key, value);
	const removed = removeProperty(text, key);
	// Appending to a file without a final newline added one; drop it again when that is
	// the only difference left.
	const rest = removed.startsWith(original) ? removed.slice(original.length) : null;
	return rest === '\n' || rest === '\r\n' || rest === '\r' ? original : removed;
}

/** Line ending used by `text`: its first terminator, LF when there is none. */
export function detectEol(text: string): '\n' | '\r\n' | '\r' {
	const match = /\r\n|\r|\n/.exec(text);
	return (match?.[0] as '\n' | '\r\n' | '\r' | undefined) ?? '\n';
}
