/**
 * Owner player-list edits (`/api/v1/servers/{id}/players`). Requests are only built from an
 * explicit owner submission; nothing here sends commands or starts a server by itself.
 */
import type { PlayerChange, PlayerEntry, PlayerListName, PlayerLists } from '#lib/api/index.js';

export const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;
export const UUID =
	/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;
export const MAX_REASON_BYTES = 256;

export const LIST_LABELS: Record<PlayerListName, string> = {
	whitelist: 'Whitelist',
	operators: 'Operators',
	bans: 'Bans'
};

/** Native files, for links to Files when one is malformed. */
export const LIST_FILES: Record<PlayerListName, string> = {
	whitelist: 'whitelist.json',
	operators: 'ops.json',
	bans: 'banned-players.json'
};

export const OPERATOR_LEVELS = [
	{ value: 1, label: '1 · Bypass spawn protection' },
	{ value: 2, label: '2 · Cheat commands' },
	{ value: 3, label: '3 · Moderation' },
	{ value: 4, label: '4 · Full (server default)' }
] as const;

export interface PlayerForm {
	list: PlayerListName;
	name: string;
	uuid: string;
	/** Operator level for stopped adds; ignored while running. */
	level: number | null;
	reason: string;
}

export type BuiltChange = { ok: true; change: PlayerChange } | { ok: false; error: string };

export function utf8Bytes(text: string): number {
	return new TextEncoder().encode(text).length;
}

export function validateName(name: string): string | null {
	if (!name) return 'Enter a player name.';
	if (!PLAYER_NAME.test(name)) return 'Use 3–16 letters, digits or underscores.';
	return null;
}

export function validateReason(reason: string): string | null {
	// eslint-disable-next-line no-control-regex -- control characters (incl. newlines) are rejected
	if (/[\u0000-\u001f\u007f-\u009f]/.test(reason))
		return 'Use a single line without control characters.';
	if (utf8Bytes(reason) > MAX_REASON_BYTES) return `Keep the reason to ${MAX_REASON_BYTES} bytes.`;
	return null;
}

/**
 * Builds the exact request for an add. Optional fields are omitted unless they apply:
 * `uuid` only when given, `level` only for a stopped operator add (a running server uses its
 * configured default), `reason` only for a ban with text.
 */
export function buildAdd(form: PlayerForm, running: boolean): BuiltChange {
	const name = form.name.trim();
	const nameError = validateName(name);
	if (nameError) return { ok: false, error: nameError };
	const change: PlayerChange = { list: form.list, action: 'add', name };
	const uuid = form.uuid.trim();
	if (uuid) {
		if (!UUID.test(uuid)) return { ok: false, error: 'Enter a valid UUID or leave it empty.' };
		change.uuid = uuid;
	}
	if (form.list === 'operators' && !running && form.level !== null) {
		if (!Number.isInteger(form.level) || form.level < 1 || form.level > 4)
			return { ok: false, error: 'Choose an operator level from 1 to 4.' };
		change.level = form.level;
	}
	if (form.list === 'bans') {
		const reason = form.reason.trim();
		const reasonError = validateReason(reason);
		if (reasonError) return { ok: false, error: reasonError };
		if (reason) change.reason = reason;
	}
	return { ok: true, change };
}

export function buildRemove(list: PlayerListName, name: string): BuiltChange {
	const error = validateName(name);
	if (error) return { ok: false, error: 'This entry has no valid player name to remove.' };
	return { ok: true, change: { list, action: 'remove', name } };
}

function text(value: unknown, max = 120): string | null {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

export interface EntryView {
	key: string;
	name: string | null;
	uuid: string | null;
	level: number | null;
	reason: string | null;
	expires: string | null;
	source: string | null;
	created: string | null;
}

/** Reads only the known native fields; unknown fields are kept by the backend, never shown. */
function entryFields(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
}

export function entryView(value: PlayerEntry, index: number): EntryView {
	const entry = entryFields(value);
	const name = text(entry.name, 32);
	const uuid = text(entry.uuid, 40);
	const level =
		typeof entry.level === 'number' && Number.isInteger(entry.level) ? entry.level : null;
	return {
		key: `${uuid ?? ''}:${name ?? ''}:${index}`,
		name,
		uuid,
		level,
		reason: text(entry.reason, 300),
		expires: text(entry.expires, 60),
		source: text(entry.source, 80),
		created: text(entry.created, 60)
	};
}

/** `{players}` from a successful `server.players` job, or `null` for any other shape. */
export function listsFromResult(result: unknown): PlayerLists | null {
	if (!result || typeof result !== 'object') return null;
	const players = (result as { players?: unknown }).players;
	if (!players || typeof players !== 'object') return null;
	const lists = players as PlayerLists;
	return Array.isArray(lists.whitelist) &&
		Array.isArray(lists.operators) &&
		Array.isArray(lists.bans) &&
		Array.isArray(lists.knownPlayers)
		? lists
		: null;
}

/** Known identities not yet on `list` (case-insensitive), for suggestions. */
export function suggestions(lists: PlayerLists, list: PlayerListName): string[] {
	const present = new Set(
		lists[list]
			.map((entry) => entryFields(entry).name)
			.map((name) => (typeof name === 'string' ? name.toLowerCase() : null))
			.filter((name): name is string => name !== null)
	);
	return lists.knownPlayers
		.map((player) => player.name)
		.filter((name) => PLAYER_NAME.test(name) && !present.has(name.toLowerCase()))
		.sort((a, b) => a.localeCompare(b));
}
