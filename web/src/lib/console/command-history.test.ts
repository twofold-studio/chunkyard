import { describe, expect, it } from 'vitest';
import {
	CommandHistory,
	commandHistoryFor,
	consoleFileName,
	consoleText,
	filterLines,
	matchSegments
} from './command-history.js';

describe('CommandHistory', () => {
	it('walks back and forward and restores the draft', () => {
		const history = new CommandHistory();
		history.push('list');
		history.push('say hi');
		expect(history.previous('draft')).toBe('say hi');
		expect(history.previous('say hi')).toBe('list');
		expect(history.previous('list')).toBeNull();
		expect(history.next()).toBe('say hi');
		expect(history.next()).toBe('draft');
		expect(history.next()).toBeNull();
	});

	it('is bounded, trims and collapses consecutive duplicates', () => {
		const history = new CommandHistory(3);
		for (const line of ['a', 'b', ' b ', '', 'c', 'd']) history.push(line);
		expect(history.items).toEqual(['b', 'c', 'd']);
	});

	it('returns null when empty', () => {
		expect(new CommandHistory().previous('x')).toBeNull();
	});

	it('keeps one history per server', () => {
		commandHistoryFor('a').push('one');
		expect(commandHistoryFor('a').items).toEqual(['one']);
		expect(commandHistoryFor('b').items).toEqual([]);
	});
});

describe('console text helpers', () => {
	it('exports raw text without markup', () => {
		expect(consoleText([{ text: '<b>&amp;</b>' }, { text: 'two' }])).toBe('<b>&amp;</b>\ntwo\n');
		expect(consoleText([])).toBe('');
	});

	it('filters case-insensitively without changing the input', () => {
		const entries = [
			{ id: 1, line: { text: 'Player joined' } },
			{ id: 2, line: { text: 'Saving world' } }
		];
		expect(filterLines(entries, ' PLAYER ').map((e) => e.id)).toEqual([1]);
		expect(filterLines(entries, '')).toBe(entries);
		expect(entries).toHaveLength(2);
	});

	it('splits matches for marking', () => {
		expect(matchSegments('aXbxc', 'x')).toEqual([
			{ text: 'a', match: false },
			{ text: 'X', match: true },
			{ text: 'b', match: false },
			{ text: 'x', match: true },
			{ text: 'c', match: false }
		]);
		expect(matchSegments('İx', 'x')).toEqual([{ text: 'İx', match: false }]);
	});

	it('builds a safe download name', () => {
		expect(consoleFileName('My Server/../x', new Date(2026, 10, 14, 4, 5, 6))).toBe(
			'My-Server-..-x-console-20261114-040506.txt'
		);
	});
});
