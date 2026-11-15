<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import {
		formatMetricsInterval,
		isHighFrequency,
		METRICS_INTERVALS,
		metricsInterval,
		type MetricsIntervalMs
	} from '#lib/metrics-interval.svelte.js';
	import { describeError, errorCode } from '#lib/api/index.js';
	import { formatTime } from '#lib/format.js';
	import { formatBytes, formatCount, formatCpu, formatUptime } from '#lib/metrics.js';
	import { cn } from '#lib/utils.js';
	import {
		latestMemoryLimit,
		MAX_HISTORY_POINTS,
		segments,
		seriesStats
	} from '#lib/metrics-history.js';
	import type { MetricsSource } from '#lib/servers/metrics-source.svelte.js';
	import HistorySparkline from '#lib/components/charts/history-sparkline.svelte';
	import StoredMetrics, { type StoredHistoryFetcher } from './stored-metrics.svelte';
	import { HISTORY_RANGES, type HistoryRangeHours } from '#lib/metrics-history.js';
	import { untrack } from 'svelte';

	interface Props {
		/** The page's single metrics sampler (shared with the header readout). */
		source: MetricsSource;
		/** Configured CPU limit (cores), used as the CPU chart ceiling. */
		cpus?: number;
		/** Opens Settings (stored history collection toggle). */
		onOpenSettings?: () => void;
		/** Injected in tests. */
		historyFetch?: StoredHistoryFetcher;
	}

	let { source, cpus, onOpenSettings, historyFetch }: Props = $props();

	/**
	 * Live (session samples) or a stored-history range in hours. A stored view detaches the live
	 * chart observer, so the page sampler falls back to standby while it is shown. Every visit
	 * starts on Live.
	 */
	type View = 'live' | HistoryRangeHours;
	let view = $state<View>('live');
	const VIEWS: { value: View; label: string; title: string }[] = [
		{ value: 'live', label: 'Live', title: 'Samples collected while this page is open' },
		...HISTORY_RANGES.map((range) => ({
			value: range.hours,
			label: range.label,
			title: `Stored snapshots from the last ${range.label}`
		}))
	];
	// A different server starts on Live again.
	let viewFor = untrack(() => source.serverId);
	$effect.pre(() => {
		const id = source.serverId;
		if (id !== viewFor) {
			viewFor = id;
			view = 'live';
		}
	});

	const metrics = $derived(source.metrics);
	const history = $derived(source.history);
	const live = $derived(source.running);
	/** What the admin selected (saved in this browser). */
	const preferred = $derived(source.preferredMs);
	/** What is collected right now. */
	const ms = $derived(source.ms);
	const cadence = $derived(source.cadence);
	const highFrequencyChoice = $derived(isHighFrequency(preferred));
	const transport = $derived(source.transport);
	const paused = $derived(source.paused);
	const error = $derived(source.error);
	const busy = $derived(source.busy);

	const sampledAt = $derived.by(() => {
		if (!metrics) return null;
		const date = new Date(metrics.sampledAt);
		return Number.isNaN(date.getTime()) ? null : date;
	});

	const gapMs = $derived(source.gapMs);
	/** Why collection is slowed to standby, for the status line. */
	const standbyReason = $derived.by(() => {
		if (source.chartUnobservable) return 'chart visibility unavailable in this browser';
		if (!source.chartVisible) return 'chart out of view';
		return 'window not focused';
	});

	function choose(next: MetricsIntervalMs) {
		metricsInterval.set(next);
		// Picking a sub-second rate is an explicit request for high frequency on this visit.
		// A rate saved earlier never turns it on by itself.
		source.highFrequency = isHighFrequency(next);
	}
	const windowStart = $derived(history[0]?.t ?? 0);
	const windowEnd = $derived(history.at(-1)?.t ?? 0);
	const cpuStats = $derived(seriesStats(history, 'cpu'));
	const memoryStats = $derived(seriesStats(history, 'memory'));
	const windowText = $derived.by(() => {
		const minutes = Math.round((windowEnd - windowStart) / 60_000);
		if (history.length < 2) return 'the time this page has been open';
		return minutes < 1
			? 'the last minute'
			: `the last ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
	});
	const message = $derived(error ? describeError(error) : null);
	const errorText = $derived.by(() => {
		if (!message) return '';
		if (busy) return 'Metrics sampler busy; retrying shortly.';
		if (errorCode(error) === 'docker.unavailable') return 'Docker unavailable; no measurements.';
		return `${message.title}: ${message.detail}`;
	});
</script>

<section
	class="flex flex-col gap-4 rounded-lg border border-border bg-card/40 p-4"
	aria-labelledby="metrics-heading"
	{@attach view === 'live' ? source.observeChart : null}
	data-view={view}
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex flex-wrap items-center gap-3">
			<h2 id="metrics-heading" class="flex items-center gap-2 text-sm font-medium">
				<ActivityIcon class="size-4 text-muted-foreground" aria-hidden="true" />
				Usage
			</h2>
			<div
				class="inline-flex items-center rounded-md border border-border p-0.5 text-xs"
				role="group"
				aria-label="Usage view"
			>
				{#each VIEWS as option (option.value)}
					<button
						type="button"
						class={[
							'rounded-sm px-2 py-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
							view === option.value
								? 'bg-muted font-medium text-foreground'
								: 'text-muted-foreground hover:text-foreground'
						]}
						aria-pressed={view === option.value}
						title={option.title}
						onclick={() => (view = option.value)}>{option.label}</button
					>
				{/each}
			</div>
		</div>
		{#if view !== 'live'}
			<span class="text-xs text-muted-foreground" data-testid="metrics-state" data-mode="history"
				>Stored history · live chart in standby</span
			>
		{:else}
			<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span data-testid="metrics-state" data-mode={live ? cadence.mode : 'stopped'}>
					{#if !live}
						Not running
					{:else if paused}
						Paused{#if sampledAt}&nbsp;· sampled {formatTime(sampledAt)}{/if}
					{:else}
						{#if sampledAt}Sampled {formatTime(sampledAt)} ·
						{:else}Waiting for first sample ·
						{/if}
						{#if cadence.mode === 'standby'}
							<span
								title="Faster refresh resumes while this chart is visible in a focused window."
								data-testid="metrics-cadence"
								>Standby, every {formatMetricsInterval(ms as MetricsIntervalMs)} ({standbyReason})</span
							>
						{:else}
							<span
								title={ms < 1000
									? 'Requests fresh Docker measurements at this interval. Slow responses may reduce the actual rate.'
									: undefined}
								data-testid="metrics-cadence"
								>{transport === 'poll' ? 'polling' : 'live'}, up to every {formatMetricsInterval(
									ms as MetricsIntervalMs
								)}{#if cadence.capped}&nbsp;(High frequency off){/if}</span
							>
						{/if}
					{/if}
				</span>
				{#if live && metrics?.uptimeSeconds != null}
					<span title="Time since the container started. Minecraft may still be loading.">
						· up <span class="font-mono text-foreground tabular-nums" data-testid="metric-uptime"
							>{formatUptime(metrics.uptimeSeconds)}</span
						>
					</span>
				{/if}
				{#if highFrequencyChoice}
					<label
						class="flex items-center gap-1.5"
						title="Allows the selected sub-second interval while this chart is visible in a focused window. Not saved: off on every visit."
					>
						<Switch
							size="sm"
							checked={source.highFrequency}
							onCheckedChange={(on) => (source.highFrequency = on)}
							aria-describedby="metrics-hf-help"
						/>
						High frequency
					</label>
					<span id="metrics-hf-help" class="sr-only">
						Allows sampling every {formatMetricsInterval(preferred)} while this chart is visible in a
						focused window; otherwise at most every second. Off on every visit.
					</span>
				{/if}
				<Select.Root
					type="single"
					value={String(preferred)}
					onValueChange={(next) => choose(Number(next) as MetricsIntervalMs)}
				>
					<Select.Trigger
						size="sm"
						class="h-7! gap-1 px-2 text-xs"
						aria-label="Metrics refresh interval"
						title="Requested automatic refresh (saved in this browser). Faster than 5s only while this chart is visible in a focused window."
					>
						{formatMetricsInterval(preferred)}
					</Select.Trigger>
					<Select.Content>
						{#each METRICS_INTERVALS as option (option)}
							<Select.Item value={String(option)} label={formatMetricsInterval(option)}>
								{option === 0 ? 'Off' : `Every ${formatMetricsInterval(option)}`}
								{#if isHighFrequency(option)}<span class="text-muted-foreground">
										· high frequency</span
									>{/if}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					variant="ghost"
					size="icon-xs"
					onclick={() => source.refresh()}
					disabled={source.loading}
					aria-label="Refresh metrics"
				>
					{#if source.loading}<Spinner />{:else}<RotateCwIcon />{/if}
				</Button>
			</div>
		{/if}
	</div>

	{#if view !== 'live'}
		{#if source.serverId}
			<StoredMetrics
				serverId={source.serverId}
				hours={view}
				{cpus}
				{onOpenSettings}
				fetch={historyFetch}
			/>
		{/if}
	{:else}
		<div class="grid gap-5 sm:grid-cols-2" data-testid="metrics-history">
			<HistorySparkline
				label="CPU"
				current={formatCpu(metrics?.cpuPercent)}
				currentTestId="metric-cpu"
				runs={segments(history, 'cpu', gapMs)}
				start={windowStart}
				end={windowEnd}
				ceiling={cpus && cpus > 0 ? cpus * 100 : 100}
				ceilingLabel={cpus ? `CPU limit (${cpus * 100}%)` : 'One core (100%)'}
				stats={cpuStats}
				format={formatCpu}
				{windowText}
			/>
			<HistorySparkline
				label="Memory (working set)"
				current={formatBytes(metrics?.memoryWorkingSetBytes)}
				currentTestId="metric-memory"
				runs={segments(history, 'memory', gapMs)}
				start={windowStart}
				end={windowEnd}
				ceiling={latestMemoryLimit(history)}
				ceilingLabel="Memory limit"
				stats={memoryStats}
				format={formatBytes}
				{windowText}
			/>
		</div>
		<p class="text-xs text-muted-foreground">
			CPU is relative to one core (can exceed 100%). Memory is the container working set, not the
			JVM heap. History collected while this page is open · {history.length}/{MAX_HISTORY_POINTS} samples,
			not stored. Gaps mean no measurement.
		</p>

		<dl
			class="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground"
			title="Network and block I/O are cumulative since container start, not rates or disk usage."
		>
			<div class="flex gap-1.5">
				<dt>PIDs</dt>
				<dd class="font-mono text-foreground tabular-nums">{formatCount(metrics?.pids)}</dd>
			</div>
			<div class="flex gap-1.5">
				<dt>Net rx/tx</dt>
				<dd class="font-mono text-foreground tabular-nums">
					{formatBytes(metrics?.networkRxBytes)} / {formatBytes(metrics?.networkTxBytes)}
				</dd>
			</div>
			<div class="flex gap-1.5">
				<dt>Disk read/write</dt>
				<dd class="font-mono text-foreground tabular-nums">
					{formatBytes(metrics?.blockReadBytes)} / {formatBytes(metrics?.blockWriteBytes)}
				</dd>
			</div>
		</dl>

		{#if message}
			<div
				class={cn(
					'flex flex-wrap items-center gap-2 text-xs',
					busy ? 'text-muted-foreground' : 'text-destructive'
				)}
				role="status"
			>
				<CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
				<span>{errorText}</span>
				{#if !busy}
					<Button
						variant="link"
						size="sm"
						class="h-auto p-0 text-xs"
						onclick={() => source.refresh()}>Retry</Button
					>
				{/if}
			</div>
		{/if}
	{/if}
</section>
