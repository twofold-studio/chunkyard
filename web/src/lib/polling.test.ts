import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { poll } from './polling';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('poll', () => {
	it('runs sequentially at the interval and stops on abort', async () => {
		const controller = new AbortController();
		const tick = vi.fn().mockResolvedValue(undefined);
		const done = poll(tick, { intervalMs: 1000, signal: controller.signal, isVisible: () => true });
		await vi.advanceTimersByTimeAsync(0);
		expect(tick).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(2000);
		expect(tick).toHaveBeenCalledTimes(3);
		controller.abort();
		await done;
		await vi.advanceTimersByTimeAsync(5000);
		expect(tick).toHaveBeenCalledTimes(3);
	});

	it('never overlaps a slow tick', async () => {
		const controller = new AbortController();
		let running = 0;
		let maxConcurrent = 0;
		const tick = vi.fn(async () => {
			running++;
			maxConcurrent = Math.max(maxConcurrent, running);
			await new Promise((r) => setTimeout(r, 2500));
			running--;
		});
		poll(tick, { intervalMs: 100, signal: controller.signal, isVisible: () => true });
		await vi.advanceTimersByTimeAsync(10_000);
		controller.abort();
		expect(maxConcurrent).toBe(1);
	});

	it('skips ticks while hidden or disabled', async () => {
		const controller = new AbortController();
		let visible = false;
		const tick = vi.fn().mockResolvedValue(undefined);
		poll(tick, { intervalMs: 1000, signal: controller.signal, isVisible: () => visible });
		await vi.advanceTimersByTimeAsync(3000);
		expect(tick).not.toHaveBeenCalled();
		visible = true;
		await vi.advanceTimersByTimeAsync(1000);
		expect(tick).toHaveBeenCalledTimes(1);
		controller.abort();
	});

	it('reports errors and keeps polling', async () => {
		const controller = new AbortController();
		const onError = vi.fn();
		const tick = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
		poll(tick, { intervalMs: 1000, signal: controller.signal, isVisible: () => true, onError });
		await vi.advanceTimersByTimeAsync(1000);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(tick).toHaveBeenCalledTimes(2);
		controller.abort();
	});
});
