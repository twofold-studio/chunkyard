/**
 * Console command recall: a bounded, in-memory list of sent commands per server, kept for
 * the lifetime of the browser tab (never persisted or sent anywhere).
 */

export const COMMAND_HISTORY_LIMIT = 50;

export class CommandHistory {
	readonly limit: number;
	#items: string[] = [];
	/** Index into items while browsing; `null` when editing the draft. */
	#cursor: number | null = null;
	#draft = '';

	constructor(limit = COMMAND_HISTORY_LIMIT) {
		this.limit = limit;
	}

	get items(): readonly string[] {
		return this.#items;
	}

	/** Records a sent command (consecutive duplicates collapse) and resets browsing. */
	push(command: string) {
		const line = command.trim();
		this.reset();
		if (!line || this.#items.at(-1) === line) return;
		this.#items.push(line);
		if (this.#items.length > this.limit) this.#items.splice(0, this.#items.length - this.limit);
	}

	/** Older command, or `null` when there is nothing older. `current` is kept as the draft. */
	previous(current: string): string | null {
		if (this.#items.length === 0) return null;
		if (this.#cursor === null) {
			this.#draft = current;
			this.#cursor = this.#items.length - 1;
		} else if (this.#cursor > 0) {
			this.#cursor -= 1;
		} else {
			return null;
		}
		return this.#items[this.#cursor];
	}

	/** Newer command, the saved draft after the newest, or `null` when not browsing. */
	next(): string | null {
		if (this.#cursor === null) return null;
		if (this.#cursor < this.#items.length - 1) {
			this.#cursor += 1;
			return this.#items[this.#cursor];
		}
		const draft = this.#draft;
		this.reset();
		return draft;
	}

	/** Stop browsing (e.g. the user typed); the next Up starts from the newest again. */
	reset() {
		this.#cursor = null;
		this.#draft = '';
	}
}

const histories = new Map<string, CommandHistory>();

/** The shared history for one server, created on first use. */
export function commandHistoryFor(serverId: string): CommandHistory {
	let history = histories.get(serverId);
	if (!history) {
		history = new CommandHistory();
		histories.set(serverId, history);
	}
	return history;
}

/** Plain-text export of console lines: one line each, exactly as received. */
export function consoleText(lines: readonly { text: string }[]): string {
	return lines.map((line) => line.text).join('\n') + (lines.length ? '\n' : '');
}

/** Case-insensitive substring filter; an empty query keeps every line. */
export function filterLines<T extends { line: { text: string } }>(
	entries: readonly T[],
	query: string
): readonly T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return entries;
	return entries.filter((entry) => entry.line.text.toLowerCase().includes(needle));
}

/** Splits text around case-insensitive matches so they can be marked without HTML. */
export function matchSegments(text: string, query: string): { text: string; match: boolean }[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [{ text, match: false }];
	const lower = text.toLowerCase();
	// Some characters change length when lowercased; skip marking rather than mis-slice.
	if (lower.length !== text.length) return [{ text, match: false }];
	const segments: { text: string; match: boolean }[] = [];
	let from = 0;
	for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
		if (at > from) segments.push({ text: text.slice(from, at), match: false });
		segments.push({ text: text.slice(at, at + needle.length), match: true });
		from = at + needle.length;
	}
	if (from < text.length) segments.push({ text: text.slice(from), match: false });
	return segments;
}

/** File name for a console download, e.g. `survival-console-20261114-041500.txt`. */
export function consoleFileName(name: string, at: Date): string {
	const safe = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
	return `${safe}-console-${stamp}.txt`;
}
