/**
 * A deliberately small Markdown reader for the Changie-generated CHANGELOG.md.
 *
 * It produces plain data (never HTML strings), so the renderer interpolates every
 * piece as text and raw HTML in the source is displayed literally instead of parsed.
 * Supported: ATX headings, paragraphs, `-`/`*`/`+` bullet lists (with wrapped
 * continuation lines), fenced code blocks, thematic breaks, and inline code,
 * `**strong**` and `[text](https://…)` links. Anything else stays text.
 */

export type Inline =
	| { type: 'text'; text: string }
	| { type: 'code'; text: string }
	| { type: 'strong'; text: string }
	| { type: 'link'; text: string; href: string };

export type Block =
	| { type: 'heading'; level: 1 | 2 | 3 | 4; inlines: Inline[] }
	| { type: 'paragraph'; inlines: Inline[] }
	| { type: 'list'; items: Inline[][] }
	| { type: 'code'; text: string }
	| { type: 'rule' };

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
const SAFE_HREF = /^https?:\/\//i;

export function parseInline(source: string): Inline[] {
	const out: Inline[] = [];
	const pushText = (text: string) => {
		if (!text) return;
		const last = out.at(-1);
		if (last?.type === 'text') last.text += text;
		else out.push({ type: 'text', text });
	};
	let index = 0;
	for (const match of source.matchAll(INLINE)) {
		pushText(source.slice(index, match.index));
		const [whole, code, strong, linkText, href] = match;
		if (code !== undefined) out.push({ type: 'code', text: code });
		else if (strong !== undefined) out.push({ type: 'strong', text: strong });
		// Only absolute http(s) links become anchors; relative or script URLs stay readable text.
		else if (SAFE_HREF.test(href)) out.push({ type: 'link', text: linkText, href });
		else pushText(linkText);
		index = match.index + whole.length;
	}
	pushText(source.slice(index));
	return out;
}

export function parseMarkdown(source: string): Block[] {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	let list: string[] | null = null;

	const flush = () => {
		if (paragraph.length) {
			blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
			paragraph = [];
		}
		if (list) {
			blocks.push({ type: 'list', items: list.map(parseInline) });
			list = null;
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		if (trimmed.startsWith('```')) {
			flush();
			const code: string[] = [];
			while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]);
			blocks.push({ type: 'code', text: code.join('\n') });
			continue;
		}
		if (!trimmed) {
			flush();
			continue;
		}
		const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);
		if (heading) {
			flush();
			const level = Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4;
			blocks.push({ type: 'heading', level, inlines: parseInline(heading[2]) });
			continue;
		}
		if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
			flush();
			blocks.push({ type: 'rule' });
			continue;
		}
		const item = /^[-*+]\s+(.*)$/.exec(trimmed);
		if (item) {
			if (paragraph.length) flush();
			(list ??= []).push(item[1]);
			continue;
		}
		if (list && /^\s/.test(line)) {
			// Indented continuation of the previous bullet.
			list[list.length - 1] += ' ' + trimmed;
			continue;
		}
		if (list) flush();
		paragraph.push(trimmed);
	}
	flush();
	return blocks;
}
