<script lang="ts">
	import type { SeriesStats, XY } from '#lib/metrics-history.js';
	import { UNAVAILABLE } from '#lib/metrics.js';

	interface Props {
		label: string;
		/** Drawable runs; breaks between runs are real gaps (never bridged). */
		runs: XY[][];
		/** Time window in ms. */
		start: number;
		end: number;
		/** Known ceiling (e.g. a limit). The scale grows past it if values exceed it. */
		ceiling?: number | null;
		/** Short name of the ceiling for the dashed guide, e.g. "limit". */
		ceilingLabel?: string;
		stats: SeriesStats;
		format: (value: number) => string;
		/** Spoken description of the time window, e.g. "the last 4 minutes". */
		windowText: string;
	}

	let {
		label,
		runs,
		start,
		end,
		ceiling = null,
		ceilingLabel = 'limit',
		stats,
		format,
		windowText
	}: Props = $props();

	const W = 240;
	const H = 56;
	const PAD = 3;

	const yMax = $derived(Math.max(ceiling ?? 0, stats.max ?? 0, Number.EPSILON));
	const span = $derived(Math.max(end - start, 1));
	const x = (t: number) => ((t - start) / span) * W;
	const y = (v: number) => PAD + (1 - v / yMax) * (H - PAD * 2);

	const shapes = $derived(
		runs.map((run) => {
			const coords = run.map((p) => `${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`);
			const line = `M${coords.join('L')}`;
			const first = x(run[0].t).toFixed(2);
			const last = x(run[run.length - 1].t).toFixed(2);
			return {
				line,
				area: run.length > 1 ? `${line}L${last},${H}L${first},${H}Z` : null,
				single: run.length === 1 ? { cx: x(run[0].t), cy: y(run[0].v) } : null
			};
		})
	);
	const ceilingY = $derived(ceiling !== null && ceiling > 0 ? y(ceiling) : null);
	const show = (v: number | null) => (v === null ? UNAVAILABLE : format(v));
	const summary = $derived(
		stats.count === 0
			? `${label}: no samples collected yet.`
			: `${label} over ${windowText}: ${stats.count} ${stats.count === 1 ? 'sample' : 'samples'}, latest ${show(stats.latest)}, lowest ${show(stats.min)}, highest ${show(stats.max)}${runs.length > 1 ? `, with ${runs.length - 1} ${runs.length === 2 ? 'gap' : 'gaps'}` : ''}.`
	);
</script>

<figure class="flex min-w-0 flex-col gap-1.5">
	<figcaption class="flex items-baseline justify-between gap-2 text-xs">
		<span class="text-muted-foreground">{label}</span>
		<span class="font-mono text-muted-foreground tabular-nums">
			{#if stats.count > 0}
				<span class="sr-only">Range </span>{show(stats.min)} – {show(stats.max)}
			{/if}
		</span>
	</figcaption>
	<svg
		viewBox="0 0 {W} {H}"
		preserveAspectRatio="none"
		class="h-14 w-full overflow-visible text-foreground"
		role="img"
		aria-label={summary}
		data-runs={runs.length}
	>
		<line
			x1="0"
			x2={W}
			y1={H - 0.5}
			y2={H - 0.5}
			class="stroke-border"
			vector-effect="non-scaling-stroke"
		/>
		{#if ceilingY !== null}
			<line
				x1="0"
				x2={W}
				y1={ceilingY}
				y2={ceilingY}
				class="stroke-muted-foreground/40"
				stroke-dasharray="3 3"
				vector-effect="non-scaling-stroke"
			>
				<title>{ceilingLabel}</title>
			</line>
		{/if}
		{#each shapes as shape, index (index)}
			{#if shape.area}
				<path d={shape.area} class="fill-current opacity-[0.07]" />
			{/if}
			{#if shape.single}
				<line
					x1={shape.single.cx}
					x2={shape.single.cx}
					y1={shape.single.cy}
					y2={shape.single.cy}
					class="stroke-current"
					stroke-width="3"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			{:else}
				<path
					d={shape.line}
					fill="none"
					class="stroke-current"
					stroke-width="1.5"
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			{/if}
		{/each}
	</svg>
</figure>
