<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ServerIcon from '@lucide/svelte/icons/server';
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { getJob as defaultGetJob, isJobActive, type Job } from '#lib/api/index.js';
	import {
		canLinkServer,
		formatDuration,
		formatJobTime,
		jobFailure,
		jobKindLabel,
		jobResultSummary,
		jobTiming,
		sanitizeText
	} from '#lib/jobs/jobs.js';
	import { poll } from '#lib/polling.js';
	import { resolve } from '$app/paths';
	import JobStateBadge from './job-state-badge.svelte';
	import JobWorkProgress from './job-work-progress.svelte';
	import { readJobWork } from '#lib/jobs/work.js';

	interface Props {
		job: Job;
		servers: { id: string; name: string }[] | null;
		/** Injected in tests. */
		intervalMs?: number;
		getJob?: (id: string, o: { signal?: AbortSignal }) => Promise<Job>;
	}

	let { job: initial, servers, intervalMs = 1500, getJob = defaultGetJob }: Props = $props();

	let job = $state.raw<Job>(untrack(() => initial));
	let error = $state.raw<unknown>(null);
	let now = $state(Date.now());

	// A different job id (client navigation between jobs) replaces the tracked record.
	$effect.pre(() => {
		const next = initial;
		if (untrack(() => job.id) !== next.id) {
			job = next;
			error = null;
		}
	});

	const active = $derived(isJobActive(job));
	const id = $derived(job.id);

	// Sequential refresh only while queued/running; pauses on hidden tabs, stops on leave.
	$effect(() => {
		if (!active) return;
		const target = id;
		const controller = new AbortController();
		untrack(() =>
			poll(
				async (signal) => {
					const next = await getJob(target, { signal });
					if (!signal.aborted && next.id === target) {
						job = next;
						error = null;
					}
				},
				{
					intervalMs,
					immediate: false,
					signal: controller.signal,
					onError: (cause) => (error = cause)
				}
			)
		);
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	});

	const timing = $derived(jobTiming(job, now));
	const failure = $derived(jobFailure(job));
	const summary = $derived(jobResultSummary(job));
	const knownIds = $derived(new Set((servers ?? []).map((s) => s.id)));
	const serverName = $derived(
		job.serverId ? (servers?.find((s) => s.id === job.serverId)?.name ?? null) : null
	);
	const linkable = $derived(canLinkServer(job, knownIds));
	const message = $derived(job.message ? sanitizeText(job.message, 300) : null);
	/** Finished jobs show their observed steps only when the backend recorded any. */
	const hasWork = $derived(readJobWork(job.work) !== null);
</script>

{#snippet field(label: string, value: string, mono = false)}
	<div class="flex flex-col gap-0.5">
		<dt class="text-xs text-muted-foreground">{label}</dt>
		<dd class={mono ? 'font-mono text-sm break-all' : 'text-sm'}>{value}</dd>
	</div>
{/snippet}

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap items-center gap-3">
		<Button variant="ghost" size="sm" href={resolve('activity')} class="-ml-2">
			<ArrowLeftIcon data-icon="inline-start" />
			Activity
		</Button>
	</div>

	<section
		class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
		aria-labelledby="job-heading"
	>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
			<h1 id="job-heading" class="text-base font-semibold tracking-tight">
				{jobKindLabel(job.kind)}
			</h1>
			<span role="status" aria-live="polite"><JobStateBadge state={job.state} /></span>
			{#if linkable && job.serverId}
				<Button
					variant="outline"
					size="sm"
					class="ml-auto"
					href={resolve(`servers/${job.serverId}`)}
				>
					<ServerIcon data-icon="inline-start" />
					Open {serverName ?? 'server'}
				</Button>
			{/if}
		</div>

		{#if active}
			<div class="flex flex-col gap-2 px-4 py-2.5" data-testid="job-progress">
				<JobWorkProgress {job} class="sm:max-w-lg" />
				<p class="text-xs text-muted-foreground">
					{#if message}{message} ·
					{/if}Steps show a percentage only when their size is known. Jobs cannot be cancelled from
					here.
				</p>
			</div>
		{:else}
			{#if hasWork}
				<div class="px-4 py-2.5" data-testid="job-progress">
					<JobWorkProgress {job} class="sm:max-w-lg" />
				</div>
			{/if}
			{#if message}
				<p class="px-4 py-2.5 text-sm text-muted-foreground">{message}</p>
			{/if}
		{/if}

		<dl class="grid gap-4 px-4 py-3 sm:grid-cols-3">
			{@render field(
				'Server',
				job.serverId
					? (serverName ?? (servers ? 'Deleted server' : job.serverId.slice(0, 8)))
					: 'None (manager)'
			)}
			{@render field('Created', formatJobTime(job.createdAt))}
			{@render field('Started', formatJobTime(job.startedAt))}
			{@render field('Finished', active ? '—' : formatJobTime(job.finishedAt))}
			{@render field('Queue wait', formatDuration(timing.waitMs))}
			{@render field(timing.live ? 'Running for' : 'Run time', formatDuration(timing.runMs))}
		</dl>

		{#if failure}
			<div class="flex gap-3 px-4 py-3" data-testid="job-failure">
				<CircleAlertIcon class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
				<div class="flex min-w-0 flex-col gap-1">
					<p class="text-sm font-medium">{failure.title}</p>
					<p class="text-sm text-muted-foreground">{failure.detail}</p>
					<p class="font-mono text-xs text-muted-foreground">{failure.code}</p>
				</div>
			</div>
		{/if}

		{#if job.state === 'succeeded'}
			<div class="flex flex-col gap-2 px-4 py-3">
				<h2 class="text-xs font-medium text-muted-foreground">Result</h2>
				{#if summary.length}
					<dl class="grid gap-4 sm:grid-cols-3" data-testid="job-summary">
						{#each summary as row (row.label)}
							{@render field(row.label, row.value, row.mono)}
						{/each}
					</dl>
				{:else}
					<p class="text-sm text-muted-foreground">Completed. No summary for this job type.</p>
				{/if}
			</div>
		{/if}
	</section>

	{#if error}
		<ErrorAlert {error} hint="Showing the last known state; retrying automatically." />
	{/if}

	<p class="font-mono text-xs text-muted-foreground">Job {job.id}</p>
</div>
