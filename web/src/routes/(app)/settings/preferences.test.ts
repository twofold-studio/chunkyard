import { describe, expect, it } from 'vitest';
import { formatDate, REFRESH_CHOICES, refreshChoiceLabel, refreshSummary } from './preferences';

describe('settings preferences', () => {
	it('offers only normal refresh rates, never high frequency', () => {
		expect(REFRESH_CHOICES).toEqual([0, 1000, 2000, 5000, 10000, 30000, 60000]);
		expect(refreshChoiceLabel(0)).toBe('Off');
		expect(refreshChoiceLabel(30000)).toBe('Every 30s');
	});

	it('describes what each saved rate does', () => {
		expect(refreshSummary(0)).toMatch(/only when you refresh/);
		expect(refreshSummary(1000)).toMatch(/every 1s while the usage chart is visible/);
		expect(refreshSummary(10000)).toBe('Server pages and server list cards refresh every 10s.');
		expect(refreshSummary(250)).toMatch(/runs at 1s unless High frequency/);
	});

	it('formats valid dates and rejects malformed ones', () => {
		expect(formatDate('2026-01-02T00:00:00Z')).toBeTruthy();
		expect(formatDate('nope')).toBeNull();
	});
});
