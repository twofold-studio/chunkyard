import { describe, expect, it } from 'vitest';
import type { PlayerLists } from '#lib/api/index.js';
import {
	buildAdd,
	buildRemove,
	entryView,
	listsFromResult,
	suggestions,
	utf8Bytes,
	validateName,
	validateReason,
	type PlayerForm
} from './players';

const form = (extra: Partial<PlayerForm> = {}): PlayerForm => ({
	list: 'whitelist',
	name: 'Steve_01',
	uuid: '',
	level: null,
	reason: '',
	...extra
});

describe('player validation', () => {
	it('accepts only 3–16 ASCII letters, digits and underscores', () => {
		expect(validateName('Abc')).toBeNull();
		expect(validateName('a_very_long_name')).toBeNull();
		expect(validateName('ab')).toMatch(/3–16/);
		expect(validateName('a_very_long_name1')).toMatch(/3–16/);
		expect(validateName('Stéve')).toMatch(/3–16/);
		expect(validateName('two words')).toMatch(/3–16/);
		expect(validateName('')).toMatch(/Enter/);
	});

	it('limits reasons to one line of 256 UTF-8 bytes', () => {
		expect(validateReason('griefing spawn')).toBeNull();
		expect(validateReason('line\nbreak')).toMatch(/single line/);
		expect(validateReason('tab\there')).toMatch(/single line/);
		expect(utf8Bytes('é')).toBe(2);
		expect(validateReason('é'.repeat(128))).toBeNull();
		expect(validateReason('é'.repeat(129))).toMatch(/256 bytes/);
		expect(validateReason('a'.repeat(257))).toMatch(/256 bytes/);
	});
});

describe('buildAdd', () => {
	it('sends only the fields that apply, exactly', () => {
		expect(buildAdd(form({ name: ' Steve_01 ' }), false)).toEqual({
			ok: true,
			change: { list: 'whitelist', action: 'add', name: 'Steve_01' }
		});
		const uuid = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
		expect(buildAdd(form({ uuid }), true)).toEqual({
			ok: true,
			change: { list: 'whitelist', action: 'add', name: 'Steve_01', uuid }
		});
		expect(buildAdd(form({ uuid: 'not-a-uuid' }), false)).toEqual({
			ok: false,
			error: expect.stringMatching(/UUID/)
		});
	});

	it('sends a chosen operator level only while stopped', () => {
		expect(buildAdd(form({ list: 'operators', level: 2 }), false)).toEqual({
			ok: true,
			change: { list: 'operators', action: 'add', name: 'Steve_01', level: 2 }
		});
		// Live op: the server's configured level applies; no `level` key at all.
		const live = buildAdd(form({ list: 'operators', level: 2 }), true);
		expect(live).toEqual({
			ok: true,
			change: { list: 'operators', action: 'add', name: 'Steve_01' }
		});
		expect(live.ok && 'level' in live.change).toBe(false);
		// Default level is left to the backend.
		expect(buildAdd(form({ list: 'operators' }), false)).toEqual({
			ok: true,
			change: { list: 'operators', action: 'add', name: 'Steve_01' }
		});
		expect(buildAdd(form({ list: 'operators', level: 5 }), false).ok).toBe(false);
		// A level never leaks into another list.
		expect(buildAdd(form({ level: 3 }), false)).toEqual({
			ok: true,
			change: { list: 'whitelist', action: 'add', name: 'Steve_01' }
		});
	});

	it('adds a trimmed ban reason only when given', () => {
		expect(buildAdd(form({ list: 'bans', reason: '  griefing  ' }), true)).toEqual({
			ok: true,
			change: { list: 'bans', action: 'add', name: 'Steve_01', reason: 'griefing' }
		});
		expect(buildAdd(form({ list: 'bans', reason: '   ' }), false)).toEqual({
			ok: true,
			change: { list: 'bans', action: 'add', name: 'Steve_01' }
		});
		expect(buildAdd(form({ list: 'bans', reason: 'a\nb' }), false).ok).toBe(false);
	});

	it('rejects invalid names before any request', () => {
		expect(buildAdd(form({ name: 'x' }), false)).toEqual({
			ok: false,
			error: expect.stringMatching(/3–16/)
		});
	});
});

describe('entries and results', () => {
	it('builds removals by name only', () => {
		expect(buildRemove('bans', 'Alex')).toEqual({
			ok: true,
			change: { list: 'bans', action: 'remove', name: 'Alex' }
		});
		expect(buildRemove('bans', '??').ok).toBe(false);
	});

	it('reads known native fields and ignores everything else', () => {
		const view = entryView(
			{ uuid: 'u', name: 'Alex', level: 4, bypassesPlayerLimit: false, extra: { x: 1 } },
			0
		);
		expect(view).toMatchObject({ name: 'Alex', uuid: 'u', level: 4, reason: null });
		expect(entryView({ level: '4' as unknown as number }, 1)).toMatchObject({
			name: null,
			level: null
		});
	});

	const lists: PlayerLists = {
		whitelist: [{ name: 'alex', uuid: 'a' }],
		operators: [],
		bans: [],
		knownPlayers: [
			{ name: 'Alex', uuid: 'a' },
			{ name: 'Steve', uuid: 's' },
			{ name: 'bad name', uuid: 'x' }
		],
		running: false,
		onlineMode: true,
		whitelistEnabled: false
	};

	it('suggests known players not already on the list', () => {
		expect(suggestions(lists, 'whitelist')).toEqual(['Steve']);
		expect(suggestions(lists, 'operators')).toEqual(['Alex', 'Steve']);
	});

	it('accepts only a complete `{players}` job result', () => {
		expect(listsFromResult({ players: lists })).toBe(lists);
		expect(listsFromResult({ players: { whitelist: [] } })).toBeNull();
		expect(listsFromResult(null)).toBeNull();
	});
});
