<script lang="ts">
	import HistorySparkline from '#lib/components/charts/history-sparkline.svelte';
	import { formatBytes, formatCpu } from '#lib/metrics.js';
	import {
		gapThresholdMs,
		latestMemoryLimit,
		segments,
		seriesStats
	} from '#lib/metrics-history.js';
	import { cardCadence, metricsInterval } from '#lib/metrics-interval.svelte.js';
	import { metricsHub, type MetricsHub } from '#lib/servers/metrics-hub.svelte.js';
	import { viewportVisibility } from '#lib/attention.svelte.js';

	interface Props {
		serverId: string;
		/** Configured CPU limit (cores), the CPU chart ceiling. */
		cpus: number;
		/** Injected in tests. */
		hub?: MetricsHub;
	}

	let { serverId, cpus, hub = metricsHub }: Props = $props();

	// Cards never sample faster than standby (5s), whatever the saved preference: sub-second
	// rates are reserved for a server page chart the admin is looking at.
	const ms = $derived(cardCadence(metricsInterval.ms));
	/** On screen. Without IntersectionObserver the card counts as visible (5s at most). */
	let visible = $state(false);
	const observe = viewportVisibility((next) => (visible = next), true);
	// The card only exists for running local servers; the hub shares the stream with the
	// server page and stops it while the browser tab is hidden. Off-screen cards release
	// their subscription entirely; the history collected so far stays on the channel.
	const channel = $derived(hub.channel(serverId));
	$effect(() => {
		if (ms === 0 || !visible) return;
		const subscription = hub.watch(serverId, ms);
		return () => subscription.release();
	});

	const history = $derived(channel.history);
	const sample = $derived(channel.sample);
	const current = $derived(
		sample && sample.serverId === serverId && sample.status?.state === 'running' ? sample : null
	);
	const gapMs = $derived(gapThresholdMs(ms));
	const start = $derived(history[0]?.t ?? 0);
	const end = $derived(history.at(-1)?.t ?? 0);
	const windowText = 'the time this list has been open';
</script>

{#if ms === 0}
	<p class="text-xs text-muted-foreground" data-testid="card-usage">Live usage off</p>
{:else}
	<div
		class="grid grid-cols-2 gap-3"
		data-testid="card-usage"
		data-live={visible ? 'true' : 'false'}
		title={`Live while visible, up to every ${ms / 1000}s`}
		{@attach observe}
	>
		<HistorySparkline
			compact
			label="CPU"
			current={formatCpu(current?.cpuPercent)}
			currentTestId="card-cpu"
			runs={segments(history, 'cpu', gapMs)}
			{start}
			{end}
			ceiling={cpus > 0 ? cpus * 100 : 100}
			ceilingLabel={`CPU limit (${cpus * 100}%)`}
			stats={seriesStats(history, 'cpu')}
			format={formatCpu}
			{windowText}
		/>
		<HistorySparkline
			compact
			label="RAM"
			current={formatBytes(current?.memoryWorkingSetBytes)}
			currentTestId="card-ram"
			runs={segments(history, 'memory', gapMs)}
			{start}
			{end}
			ceiling={latestMemoryLimit(history)}
			ceilingLabel="Memory limit"
			stats={seriesStats(history, 'memory')}
			format={formatBytes}
			{windowText}
		/>
	</div>
{/if}
