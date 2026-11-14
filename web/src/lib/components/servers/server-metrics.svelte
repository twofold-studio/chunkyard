<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import {
		formatMetricsInterval,
		METRICS_INTERVALS,
		metricsInterval,
		type MetricsIntervalSeconds
	} from '#lib/metrics-interval.svelte.js';
	import {
		describeError,
		errorCode,
		getServerMetrics,
		isAbortError,
		type ServerMetrics,
		type ServerState
	} from '#lib/api/index.js';
	import { poll } from '#lib/polling.js';
	import { formatTime } from '#lib/format.js';
	import {
		formatBytes,
		formatCount,
		formatCpu,
		formatUptime,
		ratio,
		UNAVAILABLE
	} from '#lib/metrics.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		serverId: string;
		serverState: ServerState;
		/** Configured CPU limit (cores), used to scale the CPU bar. */
		cpus?: number;
	}

	let { serverId, serverState, cpus }: Props = $props();

	let metrics = $state.raw<ServerMetrics | null>(null);
	let error = $state.raw<unknown>(null);
	let loading = $state(false);
	let manual: AbortController | null = null;

	const live = $derived(serverState === 'running');
	// Browser-wide preference; 0 pauses automatic refresh (manual Refresh still works).
	const seconds = $derived(metricsInterval.seconds);
	const paused = $derived(live && seconds === 0);

	async function load(id: string, signal: AbortSignal) {
		loading = true;
		try {
			const sample = await getServerMetrics(id, { signal });
			if (signal.aborted) return;
			metrics = sample;
			error = null;
		} catch (cause) {
			if (isAbortError(cause) || signal.aborted) return;
			error = cause;
			// A busy sampler is transient; anything else means the old values are no longer trustworthy.
			if (errorCode(cause) !== 'metrics.busy') metrics = null;
		} finally {
			if (!signal.aborted) loading = false;
		}
	}

	$effect(() => {
		const id = serverId;
		const running = live;
		const every = seconds;
		const controller = new AbortController();
		untrack(() => {
			manual?.abort();
			loading = false;
			error = null;
			const current = metrics?.serverId === id;
			if (!running || !current) metrics = null;
			if (running && every > 0) {
				// Sequential: the next sample waits for the previous one; hidden tabs pause.
				poll((signal) => load(id, signal), { intervalMs: every * 1000, signal: controller.signal });
			} else if (!(running && current)) {
				// Stopped, or refresh off: one snapshot. Turning refresh off keeps the last sample.
				load(id, controller.signal);
			}
		});
		return () => controller.abort();
	});

	$effect(() => () => manual?.abort());

	function refresh() {
		manual?.abort();
		manual = new AbortController();
		load(serverId, manual.signal);
	}

	const sampledAt = $derived.by(() => {
		if (!metrics) return null;
		const date = new Date(metrics.sampledAt);
		return Number.isNaN(date.getTime()) ? null : date;
	});
	const memoryUsed = $derived(metrics?.memoryWorkingSetBytes ?? null);
	const cpuRatio = $derived(ratio(metrics?.cpuPercent, cpus && cpus > 0 ? cpus * 100 : null));
	const memoryRatio = $derived(ratio(memoryUsed, metrics?.memoryLimitBytes));
	const busy = $derived(errorCode(error) === 'metrics.busy');
	const message = $derived(error ? describeError(error) : null);
	const errorText = $derived.by(() => {
		if (!message) return '';
		if (busy) return 'Metrics sampler busy; retrying shortly.';
		if (errorCode(error) === 'docker.unavailable') return 'Docker unavailable; no measurements.';
		return `${message.title}: ${message.detail}`;
	});
</script>

{#snippet bar(value: number | null, label: string)}
	<div
		class="mt-2 h-1 overflow-hidden rounded-full bg-muted"
		role="meter"
		aria-label={label}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={value === null ? undefined : Math.round(value * 100)}
	>
		{#if value !== null}
			<div
				class={cn(
					'h-full rounded-full transition-[width] duration-500',
					value >= 0.9 ? 'bg-destructive' : value >= 0.75 ? 'bg-warning' : 'bg-primary'
				)}
				style:width="{(value * 100).toFixed(1)}%"
			></div>
		{/if}
	</div>
{/snippet}

<section
	class="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4"
	aria-labelledby="metrics-heading"
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 id="metrics-heading" class="flex items-center gap-2 text-sm font-medium">
			<ActivityIcon class="size-4 text-muted-foreground" aria-hidden="true" />
			Resources
		</h2>
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<span>
				{#if !live}
					Not running
				{:else if paused}
					Paused{#if sampledAt}&nbsp;· sampled {formatTime(sampledAt)}{/if}
				{:else if sampledAt}
					Sampled {formatTime(sampledAt)} · every {seconds}s
				{:else}
					Waiting for first sample
				{/if}
			</span>
			<Select.Root
				type="single"
				value={String(seconds)}
				onValueChange={(next) => metricsInterval.set(Number(next) as MetricsIntervalSeconds)}
			>
				<Select.Trigger
					size="sm"
					class="h-7! gap-1 px-2 text-xs"
					aria-label="Metrics refresh interval"
					title="Automatic refresh (saved in this browser)"
				>
					{formatMetricsInterval(seconds)}
				</Select.Trigger>
				<Select.Content>
					{#each METRICS_INTERVALS as option (option)}
						<Select.Item value={String(option)} label={formatMetricsInterval(option)}>
							{option === 0 ? 'Off' : `Every ${option}s`}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={refresh}
				disabled={loading}
				aria-label="Refresh metrics"
			>
				{#if loading}<Spinner />{:else}<RotateCwIcon />{/if}
			</Button>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-3">
		<div title="CPU time relative to one logical core; can exceed 100%.">
			<p class="text-xs text-muted-foreground">CPU</p>
			<p class="font-mono text-lg tabular-nums" data-testid="metric-cpu">
				{formatCpu(metrics?.cpuPercent)}
			</p>
			<p class="text-xs text-muted-foreground">
				of one core{#if cpus}&nbsp;· limit {cpus} {cpus === 1 ? 'core' : 'cores'}{/if}
			</p>
			{@render bar(cpuRatio, 'CPU of limit')}
		</div>
		<div title="Container working set (usage minus inactive file cache). This is not the JVM heap.">
			<p class="text-xs text-muted-foreground">Memory</p>
			<p class="font-mono text-lg tabular-nums" data-testid="metric-memory">
				{formatBytes(memoryUsed)}
			</p>
			<p class="text-xs text-muted-foreground">
				of {formatBytes(metrics?.memoryLimitBytes)} limit · usage {formatBytes(
					metrics?.memoryUsageBytes
				)}
			</p>
			{@render bar(memoryRatio, 'Memory of limit')}
		</div>
		<div title="Time since the container started. Minecraft may still be loading.">
			<p class="text-xs text-muted-foreground">Uptime</p>
			<p class="font-mono text-lg tabular-nums" data-testid="metric-uptime">
				{formatUptime(metrics?.uptimeSeconds)}
			</p>
			<p class="text-xs text-muted-foreground">
				{metrics?.startedAt ? `since ${formatTime(new Date(metrics.startedAt))}` : UNAVAILABLE}
			</p>
		</div>
	</div>

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
				<Button variant="link" size="sm" class="h-auto p-0 text-xs" onclick={refresh}>Retry</Button>
			{/if}
		</div>
	{/if}
</section>
