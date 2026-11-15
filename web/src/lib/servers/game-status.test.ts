import { describe, expect, it } from 'vitest';
import type { GameStatus } from '#lib/api/index.js';
import { formatPlayerCount, readiness, sampleNote, STATUS_STALE_MS } from './game-status';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const status = (extra: Partial<GameStatus> = {}): GameStatus => ({
	state: 'ready',
	observedAt: '2026-11-15T12:00:00Z',
	latencyMs: 12,
	onlinePlayers: 3,
	maxPlayers: 20,
	playerSample: [],
	version: '1.21.1',
	connectAddress: 'host:25565',
	detail: 'Minecraft answered a Server List Ping.',
	...extra
});

describe('player counts', () => {
	it('never turns unknown counts into zero', () => {
		expect(formatPlayerCount(status())).toBe('3/20');
		expect(formatPlayerCount(status({ maxPlayers: null }))).toBe('3');
		expect(formatPlayerCount(status({ onlinePlayers: null }))).toBe('—');
		expect(formatPlayerCount(status({ onlinePlayers: null, maxPlayers: null }))).toBe('—');
		expect(formatPlayerCount(status({ onlinePlayers: 0 }))).toBe('0/20');
	});

	it('labels the advertised sample as partial', () => {
		const alex = { name: 'Alex', uuid: 'a' };
		expect(sampleNote(status({ playerSample: [alex], onlinePlayers: 5 }))).toBe(
			'Advertised sample: 1 of 5 online. Not a complete roster.'
		);
		expect(sampleNote(status({ playerSample: [alex], onlinePlayers: 1 }))).toMatch(
			/Not guaranteed to be a complete roster/
		);
		expect(sampleNote(status({ playerSample: [], onlinePlayers: 4 }))).toBe(
			'The server advertises no player names.'
		);
	});
});

describe('readiness', () => {
	it('shows the current state and players while fresh', () => {
		expect(readiness(status(), NOW, NOW + 1000, false)).toEqual({
			state: 'ready',
			label: 'Ready',
			tone: 'success',
			stale: false,
			players: '3/20'
		});
		expect(readiness(status({ state: 'starting', onlinePlayers: null }), NOW, NOW, false)).toEqual({
			state: 'starting',
			label: 'Starting',
			tone: 'warning',
			stale: false,
			players: null
		});
		expect(readiness(status({ state: 'unreachable' }), NOW, NOW, false).tone).toBe('danger');
	});

	it('does not repeat an old or failed observation as current', () => {
		const old = readiness(status(), NOW, NOW + STATUS_STALE_MS + 1, false);
		expect(old).toMatchObject({
			stale: true,
			label: 'Last seen ready',
			tone: 'muted',
			players: null
		});
		const failed = readiness(status(), NOW, NOW, true);
		expect(failed).toMatchObject({ stale: true, players: null });
	});

	it('distinguishes checking from unavailable before the first answer', () => {
		expect(readiness(null, null, NOW, false)).toMatchObject({ state: null, label: 'Checking' });
		expect(readiness(null, null, NOW, true)).toMatchObject({
			state: null,
			label: 'Status unavailable'
		});
	});
});
