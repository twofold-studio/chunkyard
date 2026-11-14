import { describe, expect, it } from 'vitest';
import {
	detectFormat,
	eolLabel,
	fromEditorText,
	languageFor,
	toEditorText
} from './editor-text.js';

const roundTrip = (raw: string) => fromEditorText(toEditorText(raw), detectFormat(raw));

describe('editor text conversion', () => {
	it('round-trips files without changes', () => {
		for (const raw of [
			'',
			'a=1',
			'a=1\n',
			'a=1\nb=2\n\n',
			'a=1\r\nb=2\r\n',
			'a=1\r\nb=2',
			'old\rmac\r',
			'﻿bom=1\r\n',
			'emoji=🧱 ünïcødé — ✓\n'
		]) {
			expect(roundTrip(raw)).toBe(raw);
		}
	});

	it('normalizes the editor document to LF without a BOM', () => {
		expect(toEditorText('﻿a\r\nb\rc\n')).toBe('a\nb\nc\n');
	});

	it('writes edits back with the original line ending and BOM', () => {
		const format = detectFormat('﻿a=1\r\nb=2\r\n');
		expect(format).toEqual({ eol: '\r\n', bom: true });
		expect(fromEditorText('a=1\nb=3\nc=4\n', format)).toBe('﻿a=1\r\nb=3\r\nc=4\r\n');
	});

	it('keeps a missing trailing newline missing', () => {
		const raw = 'x\r\ny';
		expect(fromEditorText(`${toEditorText(raw)}z`, detectFormat(raw))).toBe('x\r\nyz');
	});

	it('labels line endings', () => {
		expect(eolLabel('\r\n')).toBe('CRLF');
		expect(eolLabel('\n')).toBe('LF');
		expect(eolLabel('\r')).toBe('CR');
	});
});

describe('languageFor', () => {
	it.each([
		['world/datapacks/pack.mcmeta', 'json'],
		['ops.json', 'json'],
		['plugins/Essentials/config.yml', 'yaml'],
		['bukkit.YAML', 'yaml'],
		['server.properties', 'properties'],
		['config/forge-common.toml', 'toml'],
		['start.sh', 'shell'],
		['.env', 'properties'],
		['eula.txt', 'plain'],
		['README', 'plain'],
		['logs/latest.log', 'plain']
	])('%s → %s', (path, language) => {
		expect(languageFor(path)).toBe(language);
	});
});
