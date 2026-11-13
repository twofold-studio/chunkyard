export function formatMemory(mb: number): string {
	if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GiB`;
	return `${mb} MiB`;
}

export function formatMemoryRange(min: number, max: number): string {
	return min === max ? formatMemory(max) : `${formatMemory(min)} – ${formatMemory(max)}`;
}

export function formatCpus(cpus: number): string {
	return `${cpus} ${cpus === 1 ? 'CPU' : 'CPUs'}`;
}

export function formatTime(date: Date): string {
	return date.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}
