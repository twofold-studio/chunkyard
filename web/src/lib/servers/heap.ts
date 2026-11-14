/**
 * Resource picker helpers. Server RAM (maximum Java heap) uses whole binary gigabytes
 * (n × 1024 MiB) on its slider and quick presets; any other amount is kept exactly as a
 * custom MiB value and never rounded or converted until the owner changes it.
 */
export const RAM_SLIDER_MIN_GB = 1;
export const RAM_SLIDER_MAX_GB = 16;
export const RAM_QUICK_GB = [2, 4, 6, 8, 12, 16] as const;
export const CPU_PRESETS = [1, 2, 4, 8] as const;

/** Backend bounds (validateResources also enforces min ≤ max and 0.1–256 CPUs). */
export const HEAP_MIN_MB = 128;
export const HEAP_MAX_MB = 262144;

export function gbToMb(gb: number): number {
	return gb * 1024;
}

/** Whole GB on the slider (1–16) a MiB value equals exactly, or `null` for a custom amount. */
export function sliderGb(mb: number | null | undefined): number | null {
	if (mb == null || !Number.isInteger(mb) || mb % 1024 !== 0) return null;
	const gb = mb / 1024;
	return gb >= RAM_SLIDER_MIN_GB && gb <= RAM_SLIDER_MAX_GB ? gb : null;
}

/** Slider thumb position for any value: exact when standard, otherwise the nearest GB. */
export function sliderPosition(mb: number | null | undefined): number {
	if (mb == null || !Number.isFinite(mb)) return RAM_SLIDER_MIN_GB;
	const gb = Math.round(mb / 1024);
	return Math.min(RAM_SLIDER_MAX_GB, Math.max(RAM_SLIDER_MIN_GB, gb));
}

export function isCpuPreset(cpus: number | null | undefined): boolean {
	return cpus != null && (CPU_PRESETS as readonly number[]).includes(cpus);
}

const grouped = new Intl.NumberFormat('en');

/** "4,096 MiB", or an empty string while the value is blank/invalid. */
export function formatMib(mb: number | null | undefined): string {
	return mb != null && Number.isFinite(mb) ? `${grouped.format(mb)} MiB` : '';
}
