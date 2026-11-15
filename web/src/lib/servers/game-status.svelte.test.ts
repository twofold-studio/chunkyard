import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameStatus } from '#lib/api/index.js';
import { ApiError } from '#lib/api/index.js';
import { DocumentAttention } from '#lib/attention.svelte.js';
import { GameStatusSource } from './game-status.svelte.js';

const status = (state: GameStatus['state'], extra: Partial<GameStatus> = {}): GameStatus => ({
	state,
	observedAt: new Date().toISOString(),
	latencyMs: 5,
	onlinePlayers: 1,
	maxPlayers: 10,
	playerSample: [],
	version: '1.21.1',
	connectAddress: null,
	detail: '',
	...extra
});

function attention(attentive = true) {
	const a = new DocumentAttention();
	a.visible = attentive;
	a.focused = attentive;
	return a;
}

let source: GameStatusSource | null = null;
afterEach(() => source?.stop());

describe('GameStatusSource', () => {
	it('polls one server sequentially and shows its answer', async () => {
		const fetch = vi.fn(async (id: string) => status(id === 's1' ? 'ready' : 'unknown'));
		source = new GameStatusSource({ fetch, attention: attention(), intervalMs: 20 });
		source.configure('s1', true);
		await vi.waitFor(() => expect(source!.readiness.label).toBe('Ready'));
		await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3));
		expect(fetch.mock.calls.every(([id]) => id === 's1')).toBe(true);
		expect(source.readiness.players).toBe('1/10');
	});

	it('does not ask while the window is hidden or unfocused', async () => {
		const fetch = vi.fn(async () => status('ready'));
		const attended = attention(false);
		source = new GameStatusSource({ fetch, attention: attended, intervalMs: 20 });
		source.configure('s1', true);
		await new Promise((r) => setTimeout(r, 120));
		expect(fetch).not.toHaveBeenCalled();
		attended.visible = true;
		attended.focused = true;
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
	});

	it('cancels and clears on server switch, and stops when inactive', async () => {
		const signals: AbortSignal[] = [];
		const fetch = vi.fn((id: string, signal: AbortSignal) => {
			signals.push(signal);
			return id === 's1'
				? new Promise<GameStatus>(() => {})
				: Promise.resolve(status('starting', { onlinePlayers: null }));
		});
		source = new GameStatusSource({ fetch, attention: attention(), intervalMs: 20 });
		source.configure('s1', true);
		await vi.waitFor(() => expect(signals).toHaveLength(1));
		source.configure('s2', true);
		expect(signals[0].aborted).toBe(true);
		await vi.waitFor(() => expect(source!.status?.state).toBe('starting'));
		// An unknown count stays unknown.
		expect(source.readiness.players).toBeNull();

		source.configure('s2', false);
		expect(source.status).toBeNull();
		const calls = fetch.mock.calls.length;
		await new Promise((r) => setTimeout(r, 100));
		expect(fetch).toHaveBeenCalledTimes(calls);
	});

	it('keeps the last answer but marks it not current after a failure', async () => {
		let fail = false;
		const fetch = vi.fn(async () => {
			if (fail) throw new ApiError(503, 'docker.unavailable', 'down');
			return status('ready');
		});
		source = new GameStatusSource({ fetch, attention: attention(), intervalMs: 20 });
		source.configure('s1', true);
		await vi.waitFor(() => expect(source!.readiness.stale).toBe(false));
		fail = true;
		await vi.waitFor(() => expect(source!.readiness.stale).toBe(true));
		expect(source.readiness.label).toBe('Last seen ready');
		expect(source.readiness.players).toBeNull();
	});
});
