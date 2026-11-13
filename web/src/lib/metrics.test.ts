import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatCpu, formatUptime, ratio, UNAVAILABLE } from './metrics';

describe('metrics formatting', () => {
	it('shows unavailable for null instead of zero', () => {
		expect(formatBytes(null)).toBe(UNAVAILABLE);
		expect(formatCpu(null)).toBe(UNAVAILABLE);
		expect(formatUptime(null)).toBe(UNAVAILABLE);
		expect(formatCount(undefined)).toBe(UNAVAILABLE);
		expect(ratio(null, 100)).toBeNull();
		expect(ratio(5, null)).toBeNull();
	});

	it('keeps real zeros', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatCpu(0)).toBe('0.0%');
		expect(formatCount(0)).toBe('0');
	});

	it('formats CPU above one core without clamping', () => {
		expect(formatCpu(250.4)).toBe('250%');
		expect(formatCpu(12.34)).toBe('12.3%');
		expect(ratio(250, 200)).toBe(1);
	});

	it('formats bytes and uptime', () => {
		expect(formatBytes(1536)).toBe('1.5 KiB');
		expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GiB');
		expect(formatBytes(512 * 1024 ** 2)).toBe('512 MiB');
		expect(formatUptime(42)).toBe('42s');
		expect(formatUptime(125)).toBe('2m 05s');
		expect(formatUptime(3 * 3600 + 120)).toBe('3h 2m');
		expect(formatUptime(2 * 86_400 + 3600)).toBe('2d 1h');
	});
});
