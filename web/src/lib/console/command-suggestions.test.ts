import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTIONS, suggestCommands } from './command-suggestions';

const values = (input: string, history: string[] = [], cursor = input.length) =>
	suggestCommands(input, cursor, history).map((s) => s.value);

describe('suggestCommands', () => {
	it('completes command names and adds a space when arguments follow', () => {
		expect(values('wea')).toEqual(['weather ']);
		expect(values('sto')).toEqual(['stop']);
		expect(values('save')).toEqual(['save-all ', 'save-off', 'save-on']);
		expect(values('GameM')).toEqual(['gamemode ']);
	});

	it('completes fixed subcommands, nested levels and keeps a leading slash', () => {
		expect(values('weather ')).toEqual(['weather clear ', 'weather rain ', 'weather thunder ']);
		expect(values('time set n')).toEqual(['time set noon', 'time set night']);
		expect(values('/difficulty h')).toEqual(['/difficulty hard']);
		expect(values('  say')).toEqual([]); // nothing fixed after `say`, and `say` is complete
	});

	it('suggests nothing for free-form arguments, exact words, empty input or a mid-text caret', () => {
		expect(values('give ')).toEqual([]);
		expect(values('stop')).toEqual([]);
		expect(values('')).toEqual([]);
		expect(values('   ')).toEqual([]);
		expect(values('weather  ')).toEqual([]);
		expect(values('wea', [], 1)).toEqual([]);
	});

	it('puts earlier commands first, newest first, labelled as history', () => {
		const result = suggestCommands('w', 1, [
			'whitelist add Alex',
			'weather rain',
			'whitelist add Alex'
		]);
		expect(result.slice(0, 2)).toEqual([
			{ value: 'whitelist add Alex', label: 'whitelist add Alex', source: 'history' },
			{ value: 'weather rain', label: 'weather rain', source: 'history' }
		]);
		expect(result.slice(2).every((s) => s.source === 'built-in')).toBe(true);
		expect(result.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
	});
});
