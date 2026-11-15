import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_METRICS_INTERVAL,
	LEGACY_METRICS_INTERVAL_KEY,
	METRICS_INTERVAL_KEY,
	STANDBY_METRICS_MS,
	cardCadence,
	formatMetricsInterval,
	isHighFrequency,
	metricsInterval,
	pageCadence,
	parseMetricsInterval
} from './metrics-interval.svelte';

function storage(initial: Record<string, string> = {}): Storage {
	const data = new Map(Object.entries(initial));
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (k) => data.get(k) ?? null,
		key: (i) => [...data.keys()][i] ?? null,
		removeItem: (k) => void data.delete(k),
		setItem: (k, v) => void data.set(k, String(v))
	};
}

describe('metrics interval preference', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		metricsInterval.reload();
	});

	it('accepts only offered intervals, including sub-second and off', () => {
		expect(parseMetricsInterval('0')).toBe(0);
		expect(parseMetricsInterval('100')).toBe(100);
		expect(parseMetricsInterval('30000')).toBe(30000);
		expect(parseMetricsInterval('50')).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval('')).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval(null)).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval('abc')).toBe(DEFAULT_METRICS_INTERVAL);
	});

	it('formats choices', () => {
		expect(formatMetricsInterval(0)).toBe('Off');
		expect(formatMetricsInterval(250)).toBe('250 ms');
		expect(formatMetricsInterval(10000)).toBe('10s');
	});

	it('migrates the earlier seconds preference and survives blocked storage', () => {
		vi.stubGlobal('localStorage', storage({ [LEGACY_METRICS_INTERVAL_KEY]: '2' }));
		metricsInterval.reload();
		expect(metricsInterval.ms).toBe(2000);
		const fresh = storage({ [METRICS_INTERVAL_KEY]: '250', [LEGACY_METRICS_INTERVAL_KEY]: '2' });
		vi.stubGlobal('localStorage', fresh);
		metricsInterval.reload();
		expect(metricsInterval.ms).toBe(250);
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		});
		metricsInterval.reload();
		expect(metricsInterval.ms).toBe(DEFAULT_METRICS_INTERVAL);
		expect(() => metricsInterval.set(100)).not.toThrow();
		expect(metricsInterval.ms).toBe(100);
	});
});

describe('attention-gated cadence', () => {
	it('keeps Off off, whatever the attention or High frequency choice', () => {
		for (const hf of [false, true])
			for (const attentive of [false, true])
				expect(pageCadence(0, hf, attentive)).toEqual({ mode: 'off', ms: 0, capped: false });
	});

	it('limits a saved sub-second rate to 1s until High frequency is chosen', () => {
		expect(pageCadence(100, false, true)).toEqual({ mode: 'active', ms: 1000, capped: true });
		expect(pageCadence(100, true, true)).toEqual({ mode: 'active', ms: 100, capped: false });
		expect(pageCadence(250, true, true).ms).toBe(250);
	});

	it('drops anything faster than 5s to standby without attention', () => {
		for (const ms of [100, 250, 500, 1000, 2000] as const) {
			expect(pageCadence(ms, true, false)).toEqual({ mode: 'standby', ms: 5000, capped: false });
		}
		// 1s and 2s need attention but not High frequency.
		expect(pageCadence(2000, false, true)).toEqual({ mode: 'active', ms: 2000, capped: false });
	});

	it('never speeds up slower preferences', () => {
		for (const ms of [5000, 10000, 30000, 60000] as const) {
			for (const attentive of [false, true]) {
				expect(pageCadence(ms, true, attentive)).toEqual({ mode: 'active', ms, capped: false });
			}
		}
	});

	it('keeps server list cards at standby or slower', () => {
		expect(cardCadence(0)).toBe(0);
		expect(cardCadence(100)).toBe(STANDBY_METRICS_MS);
		expect(cardCadence(2000)).toBe(STANDBY_METRICS_MS);
		expect(cardCadence(30000)).toBe(30000);
		expect(isHighFrequency(500)).toBe(true);
		expect(isHighFrequency(1000)).toBe(false);
		expect(isHighFrequency(0)).toBe(false);
	});
});
