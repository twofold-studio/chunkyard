<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FilterXIcon from '@lucide/svelte/icons/filter-x';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { untrack } from 'svelte';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import type { JobPage } from '#lib/api/index.js';
	import { activityIndicator } from '#lib/jobs/activity-indicator.svelte.js';
	import { JobsFeed, type JobsFeedOptions } from '#lib/jobs/jobs-feed.svelte.js';
	import {
		DEFAULT_FILTERS,
		JOB_STATE_LABELS,
		filterJobs,
		filtersActive,
		formatDuration,
		formatJobTime,
		formatRelative,
		jobHeadline,
		jobKindLabel,
		jobKinds,
		jobTiming,
		type JobFilters,
		type StateFilter
	} from '#lib/jobs/jobs.js';
	import { fadeIn } from '#lib/motion/index.js';
	import { resolve } from '$app/paths';
	import JobStateBadge from './job-state-badge.svelte';

	interface Props {
		initial: JobPage | null;
		/**
		 * Server-scoped history: pages are requested with `serverId`, the server filter is
		 * hidden and rows omit the server name. Without it the view lists every job.
		 */
		serverId?: string;
		/** Existing servers (names for display). `null` when the list could not be loaded. */
		servers: { id: string; name: string }[] | null;
		/** Injected in tests. */
		feedOptions?: JobsFeedOptions;
	}

	let { initial, servers, serverId, feedOptions = {} }: Props = $props();

	const scope = untrack(() => serverId);
	/** Reports active-job changes so the shell re-checks the global count; never the count itself. */
	const source = scope ? `server:${scope}` : 'activity';
	const feed = new JobsFeed(
		untrack(() => initial),
		untrack(() => ({
			...feedOptions,
			filter: scope ? { serverId: scope } : undefined,
			onChange: (items) => {
				activityIndicator.observe(source, items);
				feedOptions.onChange?.(items);
			}
		}))
	);
	activityIndicator.observe(source, feed.items);
	$effect(() => {
		// Untracked: a re-run would destroy the feed. Server-scoped views fetch their first page here.
		untrack(() => {
			if (!feed.loaded) void feed.refresh();
			feed.start();
		});
		return () => {
			feed.destroy();
			activityIndicator.forget(source);
		};
	});

	let filters = $state<JobFilters>({ ...DEFAULT_FILTERS });
	let now = $state(Date.now());

	// Live durations tick only while something visible is still queued or running.
	const anyActive = $derived(feed.active.length > 0);
	$effect(() => {
		if (!anyActive) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	const names = $derived(new Map((servers ?? []).map((s) => [s.id, s.name])));
	const visible = $derived(filterJobs(feed.items, filters));
	const kinds = $derived(jobKinds(feed.items));
	const filtering = $derived(filtersActive(filters));
	const serverOptions = $derived.by(() => {
		const ids = [...new Set(feed.items.map((j) => j.serverId).filter((id) => id !== null))];
		return ids
			.map((id) => ({ id, label: serverName(id) }))
			.sort((a, b) => a.label.localeCompare(b.label));
	});
	const hasUnscoped = $derived(feed.items.some((j) => j.serverId === null));

	function serverName(id: string | null): string {
		if (id === null) return 'Manager';
		const name = names.get(id);
		if (name) return name;
		return servers ? `Deleted server (${id.slice(0, 8)})` : `Server ${id.slice(0, 8)}`;
	}

	const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
		{ value: 'all', label: 'Any state' },
		{ value: 'active', label: 'Queued or running' },
		{ value: 'succeeded', label: JOB_STATE_LABELS.succeeded },
		{ value: 'failed', label: JOB_STATE_LABELS.failed },
		{ value: 'cancelled', label: JOB_STATE_LABELS.cancelled }
	];
	const stateLabel = $derived(STATE_OPTIONS.find((o) => o.value === filters.state)?.label);
	const serverLabel = $derived(
		filters.server === 'all'
			? 'Any server'
			: filters.server === 'none'
				? 'Manager (no server)'
				: serverName(filters.server)
	);
	const kindLabel = $derived(filters.kind === 'all' ? 'Any type' : jobKindLabel(filters.kind));
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Filter loaded jobs">
		{#if !scope}
			<Select.Root type="single" bind:value={filters.server}>
				<Select.Trigger size="sm" class="h-8 max-w-56 text-xs" aria-label="Filter by server">
					<span class="truncate">{serverLabel}</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="Any server">Any server</Select.Item>
					{#if hasUnscoped}
						<Select.Item value="none" label="Manager (no server)">Manager (no server)</Select.Item>
					{/if}
					{#each serverOptions as option (option.id)}
						<Select.Item value={option.id} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		<Select.Root type="single" bind:value={filters.state}>
			<Select.Trigger size="sm" class="h-8 text-xs" aria-label="Filter by state">
				{stateLabel}
			</Select.Trigger>
			<Select.Content>
				{#each STATE_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root type="single" bind:value={filters.kind}>
			<Select.Trigger size="sm" class="h-8 text-xs" aria-label="Filter by type">
				{kindLabel}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="Any type">Any type</Select.Item>
				{#each kinds as kind (kind)}
					<Select.Item value={kind} label={jobKindLabel(kind)}>{jobKindLabel(kind)}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if filtering}
			<Button
				variant="ghost"
				size="sm"
				class="h-8 text-xs"
				onclick={() => (filters = { ...DEFAULT_FILTERS })}
			>
				<FilterXIcon data-icon="inline-start" />
				Clear filters
			</Button>
		{/if}
		<div class="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
			<span data-testid="jobs-count" aria-live="polite">
				{#if filtering}
					{visible.length} of {feed.items.length} loaded
				{:else}
					{feed.items.length} loaded
				{/if}
			</span>
			<Button
				variant="outline"
				size="icon-sm"
				onclick={() => feed.refresh()}
				disabled={feed.refreshing}
				aria-label="Check for new jobs"
				title="Check for new jobs"
			>
				<RefreshCwIcon class={feed.refreshing ? 'animate-spin' : undefined} />
			</Button>
		</div>
	</div>
	{#if filtering}
		<p class="text-xs text-muted-foreground" in:fadeIn>
			Filters apply only to jobs loaded in this view{feed.nextCursor
				? '; load older jobs to search further back'
				: ''}.
		</p>
	{/if}

	{#if feed.error}
		<ErrorAlert error={feed.error} />
	{/if}

	{#if !feed.loaded && !feed.error}
		<p
			class="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-8 text-sm text-muted-foreground"
			role="status"
		>
			<Spinner class="size-4" />
			Loading jobs…
		</p>
	{:else if feed.items.length === 0}
		<Empty.Root class="rounded-lg border border-border py-12">
			<Empty.Header>
				<Empty.Media variant="icon"><HistoryIcon /></Empty.Media>
				<Empty.Title>{scope ? 'No jobs for this server yet' : 'No jobs yet'}</Empty.Title>
				<Empty.Description>
					{scope
						? 'Installs, starts, stops and exports of this server appear here as they run.'
						: 'Installs, starts, stops, exports and Java downloads appear here as they run.'}
				</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else if visible.length === 0}
		<p class="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
			No loaded jobs match these filters.
		</p>
	{:else}
		<ul
			class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
			aria-label="Jobs"
		>
			{#each visible as job (job.id)}
				{@const timing = jobTiming(job, now)}
				{@const headline = jobHeadline(job)}
				<li>
					<a
						href={resolve(`activity/${job.id}`)}
						class="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:outline-none"
						data-testid="job-row"
					>
						<div class="flex min-w-0 flex-1 flex-col gap-0.5">
							<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
								<span class="truncate text-sm font-medium">{jobKindLabel(job.kind)}</span>
								<JobStateBadge state={job.state} />
							</div>
							<p class="flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
								{#if !scope}
									<span class="truncate">{serverName(job.serverId)}</span>
									<span aria-hidden="true">·</span>
								{/if}
								<time datetime={job.createdAt} title={formatJobTime(job.createdAt)}
									>{formatRelative(job.createdAt, now)}</time
								>
							</p>
							{#if headline}
								<p
									class={[
										'truncate text-xs',
										job.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'
									]}
								>
									{headline}
								</p>
							{/if}
						</div>
						<span
							class="shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums"
							title={job.state === 'queued' ? 'Waiting in queue' : 'Run time'}
						>
							{#if job.state === 'queued'}
								waiting {formatDuration(timing.waitMs)}
							{:else}
								{formatDuration(timing.runMs)}
							{/if}
						</span>
						<ChevronRightIcon
							class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
							aria-hidden="true"
						/>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	{#if feed.nextCursor}
		<div class="flex justify-center">
			<Button
				variant="outline"
				size="sm"
				onclick={() => feed.loadMore()}
				disabled={feed.loadingMore}
			>
				{#if feed.loadingMore}<Spinner data-icon="inline-start" />{/if}
				{feed.loadingMore ? 'Loading…' : 'Load older jobs'}
			</Button>
		</div>
	{:else if feed.items.length > 0}
		<p class="text-center text-xs text-muted-foreground">Start of job history.</p>
	{/if}
</div>
