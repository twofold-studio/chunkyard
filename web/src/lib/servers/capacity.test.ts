import { describe, expect, it } from 'vitest';
import { capacityWarnings, containerLimitMb, formatHostMemory, knownCapacity } from './capacity';

const GiB = 1024 ** 3;
const host = (memGiB: number | null, cpus: number | null) => ({
	logicalCpus: cpus,
	memoryTotalBytes: memGiB === null ? null : memGiB * GiB,
	architecture: 'x86_64',
	operatingSystem: 'Debian'
});

describe('capacity', () => {
	it('mirrors the container limit: heap plus max(256 MiB, 25%)', () => {
		expect(containerLimitMb(512)).toBe(768);
		expect(containerLimitMb(8192)).toBe(10240);
	});

	it('warns when heap plus overhead exceeds host memory', () => {
		const [warning] = capacityWarnings({ memoryMaxMb: 14336, cpus: 2 }, host(16, 8));
		expect(warning).toMatchObject({ field: 'memory', level: 'over' });
		expect(warning.message).toContain('more than the 16.0 GiB');
	});

	it('warns about tight headroom before the hard limit', () => {
		expect(capacityWarnings({ memoryMaxMb: 10240, cpus: 2 }, host(16, 8))).toEqual([
			expect.objectContaining({ field: 'memory', level: 'tight' })
		]);
		expect(capacityWarnings({ memoryMaxMb: 4096, cpus: 2 }, host(16, 8))).toEqual([]);
	});

	it('warns about CPU limits above the logical CPUs', () => {
		expect(capacityWarnings({ memoryMaxMb: 2048, cpus: 8 }, host(64, 4))).toEqual([
			expect.objectContaining({ field: 'cpus', level: 'over' })
		]);
		expect(capacityWarnings({ memoryMaxMb: 2048, cpus: 4 }, host(64, 4))).toEqual([]);
	});

	it('stays silent for unknown capacity or blank values', () => {
		expect(capacityWarnings({ memoryMaxMb: 999999, cpus: 999 }, null)).toEqual([]);
		expect(capacityWarnings({ memoryMaxMb: 999999, cpus: 999 }, undefined)).toEqual([]);
		expect(capacityWarnings({ memoryMaxMb: 999999, cpus: 999 }, host(null, null))).toEqual([]);
		expect(capacityWarnings({ memoryMaxMb: null, cpus: null }, host(1, 1))).toEqual([]);
		expect(
			knownCapacity({ ...host(16, 8), logicalCpus: -1, memoryTotalBytes: Number.NaN })
		).toEqual({
			cpus: null,
			memoryMb: null
		});
	});

	it('formats host memory', () => {
		expect(formatHostMemory(16384)).toBe('16.0 GiB');
		expect(formatHostMemory(512)).toBe('512 MiB');
	});
});
