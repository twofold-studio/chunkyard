import type { DockerCapacity } from '#lib/api/index.js';

const MiB = 1024 * 1024;

/**
 * Hard container memory limit for a max heap, mirroring docs/docker.md: max heap plus the
 * larger of 256 MiB or 25% JVM/native overhead.
 */
export function containerLimitMb(maxHeapMb: number): number {
	return maxHeapMb + Math.max(256, Math.ceil(maxHeapMb * 0.25));
}

/** Share of host memory above which the OS and other services have little headroom. */
export const MEMORY_HEADROOM_RATIO = 0.75;

export interface CapacityWarning {
	field: 'memory' | 'cpus';
	level: 'over' | 'tight';
	message: string;
}

function positive(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Normalises a backend capacity record; unknown or invalid totals become `null`. */
export function knownCapacity(capacity: DockerCapacity | null | undefined): {
	cpus: number | null;
	memoryMb: number | null;
} {
	return {
		cpus: positive(capacity?.logicalCpus) ? capacity.logicalCpus : null,
		memoryMb: positive(capacity?.memoryTotalBytes)
			? Math.floor(capacity.memoryTotalBytes / MiB)
			: null
	};
}

/**
 * Advisory checks of an allocation against engine totals. Never blocks or changes values:
 * unknown capacity or blank inputs produce no warnings.
 */
export function capacityWarnings(
	values: { memoryMaxMb: number | null | undefined; cpus: number | null | undefined },
	capacity: DockerCapacity | null | undefined
): CapacityWarning[] {
	const host = knownCapacity(capacity);
	const warnings: CapacityWarning[] = [];
	const heap = values.memoryMaxMb;
	if (host.memoryMb !== null && positive(heap)) {
		const limit = containerLimitMb(heap);
		const hostText = formatHostMemory(host.memoryMb);
		if (limit > host.memoryMb) {
			warnings.push({
				field: 'memory',
				level: 'over',
				message: `With JVM overhead the container may use about ${formatHostMemory(limit)}, more than the ${hostText} the Docker host has in total. The server is likely to be killed or swap heavily.`
			});
		} else if (limit > host.memoryMb * MEMORY_HEADROOM_RATIO) {
			warnings.push({
				field: 'memory',
				level: 'tight',
				message: `With JVM overhead the container may use about ${formatHostMemory(limit)} of the host's ${hostText}, leaving little for the OS and other services.`
			});
		}
	}
	const cpus = values.cpus;
	if (host.cpus !== null && positive(cpus) && cpus > host.cpus) {
		warnings.push({
			field: 'cpus',
			level: 'over',
			message: `The host has ${host.cpus} logical ${host.cpus === 1 ? 'CPU' : 'CPUs'}; a higher limit gives no extra capacity.`
		});
	}
	return warnings;
}

/** "15.6 GiB" / "512 MiB" for host-scale memory amounts in MiB. */
export function formatHostMemory(mb: number): string {
	if (mb < 1024) return `${Math.round(mb)} MiB`;
	const gib = mb / 1024;
	return `${gib >= 100 ? gib.toFixed(0) : gib.toFixed(1)} GiB`;
}
