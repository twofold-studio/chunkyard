/**
 * Console colors: turns ANSI SGR escapes (`ESC[…m`) and Minecraft section-sign codes (`§a`,
 * `§l`, `§x§R§R§G§G§B§B`) into styled text segments. Rendering only ever uses these segments as
 * text with a palette slot or a validated `rgb()` color, never HTML. Every other escape (cursor
 * movement, OSC titles/hyperlinks, DCS, character sets) and control character is removed, so
 * untrusted output cannot inject markup, load URLs or affect the document.
 */

/** 0–15: the 16 terminal colors (Minecraft codes map onto them), drawn from the app palette. */
export type ConsoleColor = number | `rgb(${number}, ${number}, ${number})`;

export interface ConsoleStyle {
	fg?: ConsoleColor;
	bg?: ConsoleColor;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	inverse?: boolean;
}

export interface StyledSegment {
	text: string;
	style: ConsoleStyle | null;
}

/** Above this many style changes in one line, the rest of the line is shown unstyled. */
export const MAX_SEGMENTS = 256;

// One alternation, in order: CSI (ESC[ or 8-bit 0x9B), OSC (ESC] or 0x9D, ended by BEL, ST or
// 0x9C; unterminated runs to the end), DCS/SOS/PM/APC strings, other two/three-byte ESC
// sequences, a lone ESC, then C0/DEL/C1 controls except tab.
const ESCAPES =
	// eslint-disable-next-line no-control-regex
	/(?:\u001b\[|\u009b)([0-?]*)([ -/]*)([@-~])|(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c|$)|(?:\u001b[PX^_]|[\u0090\u0098\u009e\u009f])[^\u001b\u009c]*(?:\u001b\\|\u009c|$)|\u001b[ -/]*[0-~]|\u001b|[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;

const SECTION = '§';
/** Minecraft color codes in palette order (0 black … f white, matching terminal 0–15). */
const MC_COLORS: Record<string, number> = {
	'0': 0,
	'1': 4,
	'2': 2,
	'3': 6,
	'4': 1,
	'5': 5,
	'6': 3,
	'7': 7,
	'8': 8,
	'9': 12,
	a: 10,
	b: 14,
	c: 9,
	d: 13,
	e: 11,
	f: 15
};

const quick = (text: string) =>
	text.indexOf('\u001b') < 0 && !/[\u0000-\u0008\u000a-\u001f\u007f-\u009f§]/.test(text); // eslint-disable-line no-control-regex

/** Text without any escapes, section codes or control characters (filter, copy, download). */
export function stripAnsi(text: string): string {
	if (quick(text)) return text;
	return parseAnsi(text)
		.map((segment) => segment.text)
		.join('');
}

function rgb(r: number, g: number, b: number): ConsoleColor {
	const c = (n: number) => Math.max(0, Math.min(255, Math.trunc(n)));
	return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

/** xterm 256-color index to a color (0–15 stay palette slots). */
function color256(n: number): ConsoleColor | undefined {
	if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
	if (n < 16) return n;
	if (n < 232) {
		const i = n - 16;
		const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
		return rgb(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6));
	}
	const gray = 8 + (n - 232) * 10;
	return rgb(gray, gray, gray);
}

function isEmpty(style: ConsoleStyle): boolean {
	for (const key in style) if (style[key as keyof ConsoleStyle] !== undefined) return false;
	return true;
}

/** Applies one SGR parameter list to a copy of the style. */
function applySgr(style: ConsoleStyle, params: string): ConsoleStyle {
	const next: ConsoleStyle = { ...style };
	// `ESC[m` is a reset; colon sub-parameters are treated like semicolons.
	const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
	for (let i = 0; i < codes.length; i++) {
		const code = codes[i];
		if (!Number.isFinite(code)) continue;
		if (code === 0) {
			for (const key of Object.keys(next)) delete next[key as keyof ConsoleStyle];
		} else if (code === 1) next.bold = true;
		else if (code === 2) next.dim = true;
		else if (code === 3) next.italic = true;
		else if (code === 4) next.underline = true;
		else if (code === 7) next.inverse = true;
		else if (code === 9) next.strike = true;
		else if (code === 21 || code === 22) next.bold = next.dim = undefined;
		else if (code === 23) next.italic = undefined;
		else if (code === 24) next.underline = undefined;
		else if (code === 27) next.inverse = undefined;
		else if (code === 29) next.strike = undefined;
		else if (code >= 30 && code <= 37) next.fg = code - 30;
		else if (code === 39) next.fg = undefined;
		else if (code >= 40 && code <= 47) next.bg = code - 40;
		else if (code === 49) next.bg = undefined;
		else if (code >= 90 && code <= 97) next.fg = code - 90 + 8;
		else if (code >= 100 && code <= 107) next.bg = code - 100 + 8;
		else if (code === 38 || code === 48) {
			let value: ConsoleColor | undefined;
			if (codes[i + 1] === 5) {
				value = color256(codes[i + 2]);
				i += 2;
			} else if (codes[i + 1] === 2) {
				const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
				if ([r, g, b].every((v) => Number.isFinite(v))) value = rgb(r, g, b);
				i += 4;
			}
			if (value !== undefined) {
				if (code === 38) next.fg = value;
				else next.bg = value;
			}
		}
		// Blink, conceal, fonts and other codes are ignored.
	}
	return next;
}

/** Applies Minecraft section-sign codes in `text`, appending styled pieces to `out`. */
function pushMinecraft(
	text: string,
	style: ConsoleStyle,
	push: (text: string, style: ConsoleStyle) => void
): ConsoleStyle {
	let at = text.indexOf(SECTION);
	if (at < 0) {
		push(text, style);
		return style;
	}
	let from = 0;
	let current = style;
	while (at >= 0) {
		if (at > from) push(text.slice(from, at), current);
		const code = text[at + 1]?.toLowerCase();
		let length = 2;
		if (code === undefined) {
			length = 1; // A trailing § is dropped.
		} else if (code in MC_COLORS) {
			// A color code also resets formatting, as in Minecraft.
			current = { fg: MC_COLORS[code] };
		} else if (code === 'x') {
			// §x§R§R§G§G§B§B hex color.
			const digits = text.slice(at + 2, at + 14);
			if (/^(?:§[0-9a-f]){6}$/i.test(digits)) {
				const hex = digits.replaceAll(SECTION, '');
				current = {
					fg: rgb(
						parseInt(hex.slice(0, 2), 16),
						parseInt(hex.slice(2, 4), 16),
						parseInt(hex.slice(4, 6), 16)
					)
				};
				length = 14;
			}
		} else if (code === 'l') current = { ...current, bold: true };
		else if (code === 'o') current = { ...current, italic: true };
		else if (code === 'n') current = { ...current, underline: true };
		else if (code === 'm') current = { ...current, strike: true };
		else if (code === 'r') current = {};
		else if (code !== 'k') {
			// Not a formatting code: keep the text as written.
			push(text.slice(at, at + 2), current);
		}
		from = at + length;
		at = text.indexOf(SECTION, from);
	}
	if (from < text.length) push(text.slice(from), current);
	return current;
}

/** Splits a console line into styled segments. Adjacent text with the same style is merged. */
export function parseAnsi(text: string): StyledSegment[] {
	if (quick(text)) return text ? [{ text, style: null }] : [];
	const segments: StyledSegment[] = [];
	let lastKey = '';
	let overflow = false;
	const push = (piece: string, style: ConsoleStyle) => {
		if (!piece) return;
		const plain = overflow || isEmpty(style);
		const key = plain ? '' : JSON.stringify(style);
		const last = segments.at(-1);
		if (last && key === lastKey) {
			last.text += piece;
			return;
		}
		if (segments.length >= MAX_SEGMENTS) {
			overflow = true;
			if (last && lastKey === '') last.text += piece;
			else {
				segments.push({ text: piece, style: null });
				lastKey = '';
			}
			return;
		}
		segments.push({ text: piece, style: plain ? null : style });
		lastKey = key;
	};

	let style: ConsoleStyle = {};
	let from = 0;
	ESCAPES.lastIndex = 0;
	for (let match = ESCAPES.exec(text); match; match = ESCAPES.exec(text)) {
		if (match.index > from) style = pushMinecraft(text.slice(from, match.index), style, push);
		// Only SGR (final byte `m`, no intermediates or private markers) changes the style.
		if (match[3] === 'm' && !match[2] && /^[\d;:]*$/.test(match[1] ?? '')) {
			style = applySgr(style, match[1] ?? '');
		}
		from = match.index + match[0].length;
		if (match[0].length === 0) ESCAPES.lastIndex += 1;
	}
	if (from < text.length) pushMinecraft(text.slice(from), style, push);
	return segments;
}

/** Marks case-insensitive matches of `query` (in the visible text) across styled segments. */
export function highlightSegments(
	segments: readonly StyledSegment[],
	query: string
): (StyledSegment & { match: boolean })[] {
	const needle = query.trim().toLowerCase();
	const plain = segments.map((s) => s.text).join('');
	const lower = plain.toLowerCase();
	if (!needle || lower.length !== plain.length) {
		return segments.map((segment) => ({ ...segment, match: false }));
	}
	const ranges: [number, number][] = [];
	for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
		ranges.push([at, at + needle.length]);
	}
	const out: (StyledSegment & { match: boolean })[] = [];
	let offset = 0;
	let r = 0;
	for (const segment of segments) {
		const end = offset + segment.text.length;
		let cursor = offset;
		while (cursor < end) {
			while (r < ranges.length && ranges[r][1] <= cursor) r++;
			const range = ranges[r];
			if (!range || range[0] >= end) {
				out.push({ text: plain.slice(cursor, end), style: segment.style, match: false });
				cursor = end;
			} else if (range[0] > cursor) {
				out.push({ text: plain.slice(cursor, range[0]), style: segment.style, match: false });
				cursor = range[0];
			} else {
				const stop = Math.min(range[1], end);
				out.push({ text: plain.slice(cursor, stop), style: segment.style, match: true });
				cursor = stop;
			}
		}
		offset = end;
	}
	return out;
}

const parsed = new WeakMap<object, StyledSegment[]>();

/** Segments of a console line object, parsed once per line (lines are immutable). */
export function lineSegments(line: { text: string }): StyledSegment[] {
	let segments = parsed.get(line);
	if (!segments) {
		segments = parseAnsi(line.text);
		parsed.set(line, segments);
	}
	return segments;
}

/** Visible text of a console line object (cached with its segments). */
export function lineText(line: { text: string }): string {
	if (quick(line.text)) return line.text;
	return lineSegments(line)
		.map((segment) => segment.text)
		.join('');
}

const paletteColor = (color: ConsoleColor) =>
	typeof color === 'number' ? `var(--ansi-${color})` : color;

/**
 * Inline CSS for a segment. Values are palette variables or `rgb()` built from clamped
 * integers, so nothing from the console text itself reaches the style attribute.
 */
export function segmentCss(style: ConsoleStyle | null): string | undefined {
	if (!style) return undefined;
	let fg = style.fg === undefined ? undefined : paletteColor(style.fg);
	let bg = style.bg === undefined ? undefined : paletteColor(style.bg);
	if (style.inverse) {
		[fg, bg] = [bg ?? 'var(--background)', fg ?? 'currentColor'];
	}
	const css: string[] = [];
	// Bold uses the bright variant of the 8 base colors, as terminals do.
	if (style.bold && typeof style.fg === 'number' && style.fg < 8 && !style.inverse)
		fg = paletteColor(style.fg + 8);
	if (fg) css.push(`color: ${fg}`);
	if (bg)
		css.push(
			style.inverse
				? `background-color: ${bg}`
				: `background-color: color-mix(in oklch, ${bg} 32%, transparent)`
		);
	if (style.bold) css.push('font-weight: 600');
	if (style.dim) css.push('opacity: 0.7');
	if (style.italic) css.push('font-style: italic');
	const lines = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean);
	if (lines.length) css.push(`text-decoration-line: ${lines.join(' ')}`);
	return css.length ? css.join('; ') : undefined;
}
