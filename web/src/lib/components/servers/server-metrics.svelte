<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import {
		formatMetricsInterval,
		METRICS_INTERVALS,
		metricsInterval,
		type MetricsIntervalMs
	} from '#lib/metrics-interval.svelte.js';
	import { describeError, errorCode } from '#lib/api/index.js';
	import { formatTime } from '#lib/format.js';
	import { formatBytes, formatCount, formatCpu, formatUptime } from '#lib/metrics.js';
	import { cn } from '#lib/utils.js';
	import {
		gapThresholdMs,
		latestMemoryLimit,
		MAX_HISTORY_POINTS,
		segments,
		seriesStats
	} from '#lib/metrics-history.js';
	import type { MetricsSource } from '#lib/servers/metrics-source.svelte.js';
	import HistorySparkline from '#lib/components/charts/history-sparkline.svelte';

	interface Props {
		/** The page's single metrics sampler (shared with the header readout). */
		source: MetricsSource;
		/** Configured CPU limit (cores), used as the CPU chart ceiling. */
		cpus?: number;
	}

	let { source, cpus }: Props = $props();

	const metrics = $derived(source.metrics);
	const history = $derived(source.history);
	const live = $derived(source.running);
	const ms = $derived(source.ms);
	const transport = $derived(source.transport);
	const paused = $derived(source.paused);
	const error = $derived(source.error);
	const busy = $derived(source.busy);

	const sampledAt = $derived.by(() => {
		if (!metrics) return null;
		const date = new Date(metrics.sampledAt);
		return Number.isNaN(date.getTime()) ? null : date;
	});

	const gapMs = $derived(gapThresholdMs(ms));
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
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 id="metrics-heading" class="flex items-center gap-2 text-sm font-medium">
			<ActivityIcon class="size-4 text-muted-foreground" aria-hidden="true" />
			Usage
		</h2>
		<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
			<span data-testid="metrics-state">
				{#if !live}
					Not running
				{:else if paused}
					Paused{#if sampledAt}&nbsp;· sampled {formatTime(sampledAt)}{/if}
				{:else if sampledAt}
					<span
						title={ms < 1000
							? 'Docker measures about once a second; delivery is never faster than real measurements.'
							: undefined}
						>Sampled {formatTime(sampledAt)} · {transport === 'stream' ? 'live' : 'polling'}, up to
						every {formatMetricsInterval(ms)}</span
					>
				{:else}
					Waiting for first sample
				{/if}
			</span>
			{#if live && metrics?.uptimeSeconds != null}
				<span title="Time since the container started. Minecraft may still be loading.">
					· up <span class="font-mono text-foreground tabular-nums" data-testid="metric-uptime"
						>{formatUptime(metrics.uptimeSeconds)}</span
					>
				</span>
			{/if}
			<Select.Root
				type="single"
				value={String(ms)}
				onValueChange={(next) => metricsInterval.set(Number(next) as MetricsIntervalMs)}
			>
				<Select.Trigger
					size="sm"
					class="h-7! gap-1 px-2 text-xs"
					aria-label="Metrics refresh interval"
					title="Automatic refresh (saved in this browser)"
				>
					{formatMetricsInterval(ms)}
				</Select.Trigger>
				<Select.Content>
					{#each METRICS_INTERVALS as option (option)}
						<Select.Item value={String(option)} label={formatMetricsInterval(option)}>
							{option === 0 ? 'Off' : `Every ${formatMetricsInterval(option)}`}
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
	</div>

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
		CPU is relative to one core (can exceed 100%). Memory is the container working set, not the JVM
		heap. History collected while this page is open · {history.length}/{MAX_HISTORY_POINTS} samples, not
		stored. Gaps mean no measurement.
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
				<Button variant="link" size="sm" class="h-auto p-0 text-xs" onclick={() => source.refresh()}
					>Retry</Button
				>
			{/if}
		</div>
	{/if}
</section>
