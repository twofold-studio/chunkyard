import { describe, expect, it } from 'vitest';
import {
	escapePropertyKey,
	escapePropertyValue,
	getProperty,
	parseProperties,
	setProperty,
	removeProperty,
	revertProperty,
	UnsafePropertyEdit,
	validatePropertyKey
} from './properties';

/** Representative file: CRLF, comments, blanks, escapes, continuation, duplicates. */
const GNARLY = [
	'#Minecraft server properties',
	'! bang comment',
	'',
	'   ',
	'motd=A \\u00A7aGreen\\tServer',
	'pvp = true',
	'difficulty : easy',
	'level-name   world',
	'description=first \\',
	'    second \\',
	'\tthird',
	'white-list=false',
	'empty=',
	'bare',
	'max-players=10',
	'max-players=20',
	'spaced\\ key=yes',
	'  indented=1',
	'# trailing comment'
].join('\r\n');

describe('parseProperties', () => {
	it('reads Java properties semantics', () => {
		const doc = parseProperties(GNARLY);
		expect(getProperty(doc, 'motd')).toBe('A \u00A7aGreen\tServer');
		expect(getProperty(doc, 'pvp')).toBe('true');
		expect(getProperty(doc, 'difficulty')).toBe('easy');
		expect(getProperty(doc, 'level-name')).toBe('world');
		expect(getProperty(doc, 'description')).toBe('first second third');
		expect(getProperty(doc, 'empty')).toBe('');
		expect(getProperty(doc, 'bare')).toBe('');
		expect(getProperty(doc, 'spaced key')).toBe('yes');
		expect(getProperty(doc, 'indented')).toBe('1');
		expect(getProperty(doc, 'missing')).toBeUndefined();
		expect(doc.eol).toBe('\r\n');
		expect(doc.missingFinalEol).toBe(true);
	});

	it('lets the last duplicate win and counts occurrences', () => {
		const doc = parseProperties(GNARLY);
		expect(getProperty(doc, 'max-players')).toBe('20');
		expect(doc.counts.get('max-players')).toBe(2);
		expect(doc.effective.get('max-players')?.line).toBe(16);
	});

	it('treats continued comment-looking lines as part of the value', () => {
		const doc = parseProperties('a=1\\\n# not a comment\nb=2\n');
		expect(getProperty(doc, 'a')).toBe('1# not a comment');
		expect(getProperty(doc, 'b')).toBe('2');
	});

	it('handles lone CR line endings, a BOM and a dangling continuation at EOF', () => {
		const doc = parseProperties('\uFEFFa=1\rb=2\\');
		expect(getProperty(doc, 'a')).toBe('1');
		expect(getProperty(doc, 'b')).toBe('2');
		expect(doc.eol).toBe('\r');
	});

	it('flags malformed unicode escapes', () => {
		const doc = parseProperties('motd=bad \\u12G4\nok=1\n');
		expect(doc.effective.get('motd')?.malformed).toBe(true);
		expect(doc.effective.get('ok')?.malformed).toBe(false);
	});
});

describe('setProperty', () => {
	it('returns the input unchanged when the value is the same (lossless no-op)', () => {
		for (const key of ['motd', 'description', 'max-players', 'bare', 'level-name']) {
			const value = getProperty(parseProperties(GNARLY), key)!;
			expect(setProperty(GNARLY, key, value)).toBe(GNARLY);
		}
	});

	it('changes only the edited value, keeping separators and every other byte', () => {
		const next = setProperty(GNARLY, 'pvp', 'false');
		expect(next).toBe(GNARLY.replace('pvp = true', 'pvp = false'));
		const diff = setProperty(GNARLY, 'level-name', 'survival');
		expect(diff).toBe(GNARLY.replace('level-name   world', 'level-name   survival'));
	});

	it('edits only the effective (last) duplicate', () => {
		const next = setProperty(GNARLY, 'max-players', '50');
		expect(next).toContain('max-players=10\r\nmax-players=50\r\n');
		expect(getProperty(parseProperties(next), 'max-players')).toBe('50');
	});

	it('collapses an edited continuation into one line without touching neighbours', () => {
		const next = setProperty(GNARLY, 'description', 'single');
		expect(next).toBe(
			GNARLY.replace('description=first \\\r\n    second \\\r\n\tthird', 'description=single')
		);
	});

	it('inserts a separator for a bare key', () => {
		const next = setProperty(GNARLY, 'bare', 'value');
		expect(next).toContain('\r\nbare=value\r\n');
	});

	it('appends a missing key with the file line ending, adding one if needed', () => {
		const next = setProperty(GNARLY, 'hardcore', 'true');
		expect(next).toBe(`${GNARLY}\r\nhardcore=true\r\n`);
		expect(setProperty('a=1\n', 'b', '2')).toBe('a=1\nb=2\n');
		expect(setProperty('', 'b', '2')).toBe('b=2\n');
	});

	it('round-trips special values through escaping', () => {
		const values = [
			' leading space',
			'back\\slash',
			'multi\nline',
			'tab\there',
			'§aColor ✓',
			'#!=:'
		];
		for (const value of values) {
			const next = setProperty(GNARLY, 'motd', value);
			expect(getProperty(parseProperties(next), 'motd')).toBe(value);
			// Every other entry is unchanged.
			const before = parseProperties(GNARLY);
			const after = parseProperties(next);
			for (const [key, entry] of before.effective) {
				if (key !== 'motd') expect(after.effective.get(key)?.value).toBe(entry.value);
			}
		}
	});

	it('refuses to patch a malformed entry', () => {
		expect(() => setProperty('motd=\\uZZZZ\n', 'motd', 'x')).toThrow(UnsafePropertyEdit);
	});
});

describe('escaping helpers', () => {
	it('escapes keys and values', () => {
		expect(escapePropertyKey('a b=c:d')).toBe('a\\ b\\=c\\:d');
		expect(escapePropertyKey('#x')).toBe('\\#x');
		expect(escapePropertyValue(' x\\y')).toBe('\\ x\\\\y');
		expect(escapePropertyValue('\u0001')).toBe('\\u0001');
	});

	it('validates new keys', () => {
		expect(validatePropertyKey('')).not.toBeNull();
		expect(validatePropertyKey('a b')).not.toBeNull();
		expect(validatePropertyKey('rcon.port')).toBeNull();
	});
});

describe('revertProperty', () => {
	it('restores an edited value and removes an appended key', () => {
		const edited = setProperty(setProperty(GNARLY, 'pvp', 'false'), 'hardcore', 'true');
		const once = revertProperty(edited, GNARLY, 'hardcore');
		expect(once).toBe(GNARLY.replace('pvp = true', 'pvp = false') + '\r\n');
		expect(revertProperty(once, GNARLY, 'pvp')).toBe(`${GNARLY}\r\n`);
		expect(revertProperty(setProperty(GNARLY, 'hardcore', 'true'), GNARLY, 'hardcore')).toBe(
			GNARLY
		);
		expect(removeProperty('a=1\nb=2\nc=3', 'b')).toBe('a=1\nc=3');
		expect(removeProperty('﻿a=1\nb=2\n', 'a')).toBe('﻿b=2\n');
	});
});
