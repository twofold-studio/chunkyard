import { describe, expect, it } from 'vitest';
import { formatMib, gbToMb, isCpuPreset, sliderGb, sliderPosition } from './heap';

describe('heap helpers', () => {
	it('uses binary gigabytes', () => {
		expect(gbToMb(4)).toBe(4096);
		expect(sliderGb(16384)).toBe(16);
	});

	it('treats anything else as an exact custom value', () => {
		for (const value of [512, 8048, 1000, 20480, null, undefined, 1536.5]) {
			expect(sliderGb(value)).toBeNull();
		}
		expect(formatMib(8048)).toBe('8,048 MiB');
		expect(formatMib(null)).toBe('');
	});

	it('places the slider near custom values without changing them', () => {
		expect(sliderPosition(8048)).toBe(8);
		expect(sliderPosition(512)).toBe(1);
		expect(sliderPosition(65536)).toBe(16);
		expect(sliderPosition(null)).toBe(1);
	});

	it('knows the CPU quick choices', () => {
		expect(isCpuPreset(2)).toBe(true);
		expect(isCpuPreset(1.5)).toBe(false);
		expect(isCpuPreset(null)).toBe(false);
	});
});
