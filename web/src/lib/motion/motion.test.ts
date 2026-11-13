import { afterEach, describe, expect, it, vi } from 'vitest';
import { DURATION, REDUCED_MOTION_QUERY, respectMotion, rise, stagger, step } from './index';

function mockReducedMotion(reduce: boolean) {
	const matchMedia = vi.fn((query: string) => ({
		matches: reduce && query === REDUCED_MOTION_QUERY
	}));
	vi.stubGlobal('window', { matchMedia });
	return matchMedia;
}

afterEach(() => vi.unstubAllGlobals());

// Svelte's fly() reads computed styles; a minimal element is enough for config checks.
const node = {} as Element;
vi.stubGlobal('getComputedStyle', () => ({ opacity: '1', transform: 'none' }));

describe('motion presets', () => {
	it('keep their durations when motion is allowed', () => {
		mockReducedMotion(false);
		expect(respectMotion({ duration: 200, delay: 40 })).toEqual({ duration: 200, delay: 40 });
	});

	it('collapse every transition to zero when reduced motion is preferred', () => {
		mockReducedMotion(true);
		expect(respectMotion({ duration: 200, delay: 40 })).toEqual({ duration: 0, delay: 0 });
		vi.stubGlobal('getComputedStyle', () => ({ opacity: '1', transform: 'none' }));
		expect(rise(node, { delay: 100 })).toMatchObject({ duration: 0, delay: 0 });
		expect(step(node, { direction: -1 })).toMatchObject({ duration: 0, delay: 0 });
	});

	it('uses short base durations and caps stagger offsets', () => {
		mockReducedMotion(false);
		vi.stubGlobal('getComputedStyle', () => ({ opacity: '1', transform: 'none' }));
		expect(rise(node)).toMatchObject({ duration: DURATION.base });
		expect(stagger(0)).toBe(0);
		expect(stagger(2, 30)).toBe(60);
		expect(stagger(100, 30)).toBe(stagger(8, 30));
	});
});
