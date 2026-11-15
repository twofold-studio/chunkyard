<script lang="ts" module>
	import type { MetricsHistory } from '#lib/api/index.js';

	export type StoredHistoryFetcher = (
		serverId: string,
		hours: number,
		signal: AbortSignal
	) => Promise<MetricsHistory>;
</script>

<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { describeError, getMetricsHistory, isAbortError } from '#lib/api/index.js';
	import { documentAttention, type DocumentAttention } from '#lib/attention.svelte.js';
	import { formatBytes, formatCpu } from '#lib/metrics.js';
	import {
		HISTORY_RANGES,
		latestMemoryLimit,
		segments,
		seriesStats,
		storedGapMs,
		storedHistoryPoints
	} from '#lib/metrics-history.js';
	import { poll } from '#lib/polling.js';
	import HistorySparkline from '#lib/components/charts/history-sparkline.svelte';

	interface Props {
		serverId: string;
		hours: number;
		/** Configured CPU limit (cores), used as the CPU chart ceiling. */
		cpus?: number;
		/** Opens Settings, where collection is turned on or off. */
		onOpenSettings?: () => void;
		/** Injected in tests. */
		fetch?: StoredHistoryFetcher;
		attention?: DocumentAttention;
		/** Attended refresh interval; at most once a minute. */
		refreshMs?: number;
		now?: () => number;
	}

	let {
		serverId,
		hours,
		cpus,
		onOpenSettings,
		fetch: fetchProp,
		attention: attentionProp,
		refreshMs = 60_000,
		now = Date.now
	}: Props = $props();
	const fetcher: StoredHistoryFetcher =
		untrack(() => fetchProp) ?? ((id, h, signal) => getMetricsHistory(id, h, { signal }));
	const attention = untrack(() => attentionProp) ?? documentAttention;

	let history = $state.raw<MetricsHistory | null>(null);
	let error = $state.raw<unknown>(null);
	let loading = $state(false);
	/** Window end in ms; the window is always the full requested range. */
	let end = $state(untrack(() => now()));

	async function load(id: string, h: number, signal: AbortSignal) {
		loading = true;
		try {
			const next = await fetcher(id, h, signal);
			if (signal.aborted) return;
			history = next;
			error = null;
			end = now();
		} catch (cause) {
			if (!isAbortError(cause) && !signal.aborted) error = cause;
		} finally {
			if (!signal.aborted) loading = false;
		}
	}

	let abort: AbortController | null = null;
	function reload() {
		abort?.abort();
		const controller = (abort = new AbortController());
		void load(serverId, hours, controller.signal);
	}

	// Once on entry and per range or server; then at most once a minute while attended.
	$effect(() => {
		const id = serverId;
		const h = hours;
		const controller = new AbortController();
		abort?.abort();
		abort = controller;
		untrack(() => {
			history = null;
			error = null;
			void load(id, h, controller.signal).then(() =>
				poll((signal) => load(id, h, signal), {
					intervalMs: Math.max(refreshMs, 1000),
					signal: controller.signal,
					immediate: false,
					isVisible: () => attention.attentive
				})
			);
		});
		return () => controller.abort();
	});

	const points = $derived(history ? storedHistoryPoints(history.items) : []);
	const gapMs = $derived(
		history ? storedGapMs(history.resolutionSeconds, history.intervalSeconds) : 0
	);
	const start = $derived(end - hours * 3_600_000);
	const cpuStats = $derived(seriesStats(points, 'cpu'));
	const memoryStats = $derived(seriesStats(points, 'memory'));
	const rangeLabel = $derived(HISTORY_RANGES.find((r) => r.hours === hours)?.label ?? `${hours}h`);
	const windowText = $derived(
		`the last ${rangeLabel === '7d' ? '7 days' : rangeLabel === '1h' ? 'hour' : `${hours} hours`}`
	);
	const resolution = $derived.by(() => {
		const s = history?.resolutionSeconds ?? 0;
		if (s <= 0) return null;
		return s < 120
			? `${s}-second`
			: s % 3600 === 0
				? `${s / 3600}-hour`
				: `${Math.round(s / 60)}-minute`;
	});
	const message = $derived(error ? describeError(error) : null);
	const empty = $derived(history !== null && cpuStats.count === 0 && memoryStats.count === 0);
</script>

<div class="flex flex-col gap-4" data-testid="stored-history" data-hours={hours}>
	{#if history === null && !error}
		<div class="grid gap-5 sm:grid-cols-2">
			<Skeleton class="h-20 w-full" />
			<Skeleton class="h-20 w-full" />
		</div>
	{:else if history === null && message}
		<div class="flex flex-wrap items-center gap-2 text-xs text-destructive" role="status">
			<CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
			<span>{message.title}: {message.detail}</span>
			<Button variant="link" size="sm" class="h-auto p-0 text-xs" onclick={reload}>Retry</Button>
		</div>
	{:else if history}
		{#if !history.enabled}
			<p
				class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
				data-testid="stored-history-disabled"
			>
				History collection is off for this server{empty
					? '.'
					: '; earlier snapshots are shown until they expire.'}
				{#if onOpenSettings}
					<button
						type="button"
						class="underline underline-offset-4 hover:text-foreground"
						onclick={onOpenSettings}>Turn on in Settings</button
					>
				{/if}
			</p>
		{/if}
		{#if empty}
			<p
				class="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
				data-testid="stored-history-empty"
			>
				No snapshots in the last {rangeLabel}. Snapshots are only taken while the server runs.
			</p>
		{:else}
			<div class="grid gap-5 sm:grid-cols-2" data-testid="stored-history-charts">
				<HistorySparkline
					label="CPU"
					runs={segments(points, 'cpu', gapMs)}
					{start}
					{end}
					ceiling={cpus && cpus > 0 ? cpus * 100 : 100}
					ceilingLabel={cpus ? `CPU limit (${cpus * 100}%)` : 'One core (100%)'}
					stats={cpuStats}
					format={formatCpu}
					{windowText}
				/>
				<HistorySparkline
					label="Memory (working set)"
					runs={segments(points, 'memory', gapMs)}
					{start}
					{end}
					ceiling={latestMemoryLimit(points)}
					ceilingLabel="Memory limit"
					stats={memoryStats}
					format={formatBytes}
					{windowText}
				/>
			</div>
		{/if}
		{#if message}
			<p class="flex items-center gap-1.5 text-xs text-destructive" role="status">
				<CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
				Refresh failed; showing the last loaded history. {message.detail}
			</p>
		{/if}
		<p class="text-xs text-muted-foreground" data-testid="stored-history-note">
			Stored snapshots taken about every {Math.round(history.intervalSeconds / 60) || 1}
			{Math.round(history.intervalSeconds / 60) <= 1 ? 'minute' : 'minutes'} while running, kept
			{history.retentionDays} days.
			{resolution
				? `Each point averages the snapshots in a ${resolution} bucket, not continuous usage.`
				: ''}
			Gaps mean no snapshot (stopped, collection off or sampler busy).
			{#if loading}<span class="sr-only">Loading</span>{/if}
		</p>
	{/if}
</div>
