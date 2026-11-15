import { describe, expect, it } from 'vitest';
import {
	MAX_SEGMENTS,
	highlightSegments,
	lineText,
	parseAnsi,
	segmentCss,
	stripAnsi
} from './ansi';
import { consoleText, filterLines } from './command-history';

const ESC = '\u001b';

describe('parseAnsi', () => {
	it('leaves normal lines as a single unstyled segment', () => {
		const line = '[12:00:00 INFO]: Done (3.2s)! For help, type "help"';
		expect(parseAnsi(line)).toEqual([{ text: line, style: null }]);
		expect(parseAnsi('')).toEqual([]);
	});

	it('styles SGR colors and attributes, and resets', () => {
		expect(parseAnsi(`${ESC}[31mred${ESC}[0m plain ${ESC}[1;92mbold${ESC}[m`)).toEqual([
			{ text: 'red', style: { fg: 1 } },
			{ text: ' plain ', style: null },
			{ text: 'bold', style: { bold: true, fg: 10 } }
		]);
		expect(parseAnsi(`${ESC}[4;9mx${ESC}[24my${ESC}[39;49;29mz`)).toEqual([
			{ text: 'x', style: { underline: true, strike: true } },
			{ text: 'y', style: { strike: true } },
			{ text: 'z', style: null }
		]);
	});

	it('supports 256-color and truecolor, clamping values', () => {
		expect(parseAnsi(`${ESC}[38;5;196ma${ESC}[38;5;3mb${ESC}[48;2;300;0;999mc`)).toEqual([
			{ text: 'a', style: { fg: 'rgb(255, 0, 0)' } },
			{ text: 'b', style: { fg: 3 } },
			{ text: 'c', style: { fg: 3, bg: 'rgb(255, 0, 255)' } }
		]);
	});

	it('handles Minecraft section codes, including hex colors and reset', () => {
		expect(parseAnsi('§aGreen §lbold§r plain §x§f§f§0§0§8§8pink §kmagic §zkept')).toEqual([
			{ text: 'Green ', style: { fg: 10 } },
			{ text: 'bold', style: { fg: 10, bold: true } },
			{ text: ' plain ', style: null },
			// §k (obfuscated) is dropped; an unknown code stays as written.
			{ text: 'pink magic §zkept', style: { fg: 'rgb(255, 0, 136)' } }
		]);
		expect(stripAnsi('trailing §')).toBe('trailing ');
	});

	it('strips cursor, erase, OSC title/hyperlink, DCS and control sequences', () => {
		const hostile = [
			`${ESC}[2J${ESC}[H${ESC}[?25l`, // clear screen, home, hide cursor
			`${ESC}]0;evil title\u0007`, // window title
			`${ESC}]8;;https://evil.example/x${ESC}\\click${ESC}]8;;${ESC}\\`, // hyperlink
			`${ESC}P+q544e${ESC}\\`, // DCS query
			`${ESC}(0${ESC}7${ESC}8`, // charset, save/restore cursor
			'\u009b31m\u009d0;t\u009c', // 8-bit CSI and OSC
			'a\rb\bc\u0000d\u007f\u0085e\tf'
		].join('');
		expect(stripAnsi(hostile)).toBe('clickabcde\tf');
	});

	it('never turns markup or URLs in output into anything but text', () => {
		const line = `${ESC}[31m<img src=x onerror=alert(1)>${ESC}]8;;javascript:alert(1)${ESC}\\<a href="//x">x</a>`;
		const segments = parseAnsi(line);
		expect(segments.map((s) => s.text).join('')).toBe(
			'<img src=x onerror=alert(1)><a href="//x">x</a>'
		);
		for (const segment of segments) {
			const css = segmentCss(segment.style) ?? '';
			expect(css).not.toMatch(/url|javascript|expression|[<>"]/i);
		}
	});

	it('ignores non-SGR CSI that ends in m and private-marker sequences', () => {
		expect(parseAnsi(`${ESC}[>4;2m${ESC}[?1mtext`)).toEqual([{ text: 'text', style: null }]);
		// Unterminated sequences at the end of a line are removed.
		expect(stripAnsi(`ok${ESC}]0;never ends`)).toBe('ok');
		expect(stripAnsi(`ok${ESC}`)).toBe('ok');
	});

	it('caps segments per line and stays fast on large hostile input', () => {
		const many = Array.from({ length: 2000 }, (_, i) => `${ESC}[3${i % 8}m${i % 10}`).join('');
		const segments = parseAnsi(many);
		expect(segments.length).toBeLessThanOrEqual(MAX_SEGMENTS + 1);
		expect(segments.map((s) => s.text).join('').length).toBe(2000);

		const lines = Array.from({ length: 1000 }, (_, i) => ({
			text: `${ESC}[38;2;1;2;3m[${i}] ${'§a§l'.repeat(20)}${ESC}]0;${'x'.repeat(200)}\u0007${'y'.repeat(500)}`
		}));
		const started = performance.now();
		for (const line of lines) lineText(line);
		expect(performance.now() - started).toBeLessThan(500);
	});
});

describe('segmentCss', () => {
	it('uses palette variables, brightens bold base colors and mutes backgrounds', () => {
		expect(segmentCss(null)).toBeUndefined();
		expect(segmentCss({ fg: 1, bold: true })).toBe('color: var(--ansi-9); font-weight: 600');
		expect(segmentCss({ bg: 4 })).toBe(
			'background-color: color-mix(in oklch, var(--ansi-4) 32%, transparent)'
		);
		expect(segmentCss({ inverse: true })).toBe(
			'color: var(--background); background-color: currentColor'
		);
	});
});

describe('filtering and copying use visible text', () => {
	const entries = [
		{ id: 1, line: { text: `${ESC}[32mPlayer joined${ESC}[0m`, stream: 'stdout' as const } },
		{ id: 2, line: { text: '§cError§r: 31m', stream: 'stdout' as const } }
	];

	it('matches the text people see, not escape bytes', () => {
		expect(filterLines(entries, '[32m')).toEqual([]);
		expect(filterLines(entries, 'player j').map((e) => e.id)).toEqual([1]);
		expect(filterLines(entries, '§c')).toEqual([]);
		expect(filterLines(entries, 'error:').map((e) => e.id)).toEqual([2]);
	});

	it('copies plain text', () => {
		expect(consoleText(entries.map((e) => e.line))).toBe('Player joined\nError: 31m\n');
	});

	it('highlights matches across style boundaries', () => {
		const segments = parseAnsi(`${ESC}[31mab${ESC}[32mcd`);
		expect(highlightSegments(segments, 'BC')).toEqual([
			{ text: 'a', style: { fg: 1 }, match: false },
			{ text: 'b', style: { fg: 1 }, match: true },
			{ text: 'c', style: { fg: 2 }, match: true },
			{ text: 'd', style: { fg: 2 }, match: false }
		]);
	});
});
