<script lang="ts" module>
	import type { ExportRecord, Job, PropertiesDocument } from '#lib/api/index.js';

	export interface OpsSummaryApi {
		exports: (signal: AbortSignal) => Promise<ExportRecord[]>;
		jobs: (serverId: string, signal: AbortSignal) => Promise<Job[]>;
		properties: (serverId: string, signal: AbortSignal) => Promise<PropertiesDocument>;
	}
</script>

<script lang="ts">
	import CloudCheckIcon from '@lucide/svelte/icons/cloud-check';
	import CloudOffIcon from '@lucide/svelte/icons/cloud-off';
	import FileCogIcon from '@lucide/svelte/icons/file-cog';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import { untrack } from 'svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import JobStateBadge from '#lib/components/jobs/job-state-badge.svelte';
	import { getProperties, isAbortError, listExports, listJobs } from '#lib/api/index.js';
	import { fullS3Backups, formatAge } from '#lib/exports/backups.js';
	import { formatExportTime } from '#lib/exports/exports.js';
	import { formatRelative, jobKindLabel } from '#lib/jobs/jobs.js';

	interface Props {
		serverId: string;
		running: boolean;
		/** Changes when something worth re-reading happened (a job finished, start/stop). */
		refreshKey?: string;
		onOpenExports?: () => void;
		onOpenActivity?: () => void;
		onOpenProperties?: () => void;
		now?: number;
		/** Injected in tests. */
		api?: OpsSummaryApi;
	}

	const RECENT_JOBS = 3;
	const defaultApi: OpsSummaryApi = {
		exports: async (signal) => (await listExports({ signal })).items,
		jobs: async (serverId, signal) =>
			(await listJobs({ serverId, limit: RECENT_JOBS, signal })).items,
		properties: (serverId, signal) => getProperties(serverId, { signal })
	};

	let {
		serverId,
		running,
		refreshKey = '',
		onOpenExports,
		onOpenActivity,
		onOpenProperties,
		now = Date.now(),
		api: apiProp
	}: Props = $props();
	const api = untrack(() => apiProp) ?? defaultApi;

	type Part<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T };
	let backup = $state.raw<Part<ExportRecord | null>>({ status: 'loading' });
	let jobs = $state.raw<Part<Job[]>>({ status: 'loading' });
	let properties = $state.raw<Part<PropertiesDocument>>({ status: 'loading' });
	let loadedFor: string | null = null;

	// One read per server and per refresh key; no timer. A newer read aborts the older one.
	$effect(() => {
		const id = serverId;
		void refreshKey;
		const abort = new AbortController();
		const { signal } = abort;
		untrack(() => {
			if (loadedFor !== id) {
				// Another server: never show the previous server's details meanwhile.
				backup = jobs = properties = { status: 'loading' };
				loadedFor = id;
			}
		});
		const settle = <T,>(promise: Promise<T>, set: (part: Part<T>) => void) =>
			promise.then(
				(value) => {
					if (!signal.aborted) set({ status: 'ready', value });
				},
				(error: unknown) => {
					if (!isAbortError(error) && !signal.aborted) set({ status: 'error' });
				}
			);
		void settle(
			api.exports(signal).then((items) => fullS3Backups(items, id)[0] ?? null),
			(part) => (backup = part)
		);
		void settle(
			api.jobs(id, signal).then((items) => items.slice(0, RECENT_JOBS)),
			(part) => (jobs = part)
		);
		void settle(api.properties(id, signal), (part) => (properties = part));
		return () => abort.abort();
	});

	const propertiesText = $derived.by(() => {
		if (properties.status !== 'ready') return null;
		const doc = properties.value;
		if (!running) return `Next start uses v${doc.version}`;
		if (doc.appliedVersion === null) return `Saved v${doc.version}; running version unknown`;
		if (doc.restartRequired) return `Running v${doc.appliedVersion} · v${doc.version} saved`;
		return `Running v${doc.appliedVersion}`;
	});
</script>

{#snippet row(Icon: typeof HistoryIcon, title: string, action?: () => void, actionLabel?: string)}
	<div class="flex items-center gap-2">
		<Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<h3 class="text-sm font-medium">{title}</h3>
		{#if action && actionLabel}
			<Button variant="link" size="xs" class="ml-auto h-auto p-0 text-xs" onclick={action}
				>{actionLabel}</Button
			>
		{/if}
	</div>
{/snippet}

<section
	class="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3"
	aria-label="Operations"
	data-testid="ops-summary"
>
	<div class="flex min-w-0 flex-col gap-2 bg-card p-4" data-testid="ops-backup">
		{@render row(CloudCheckIcon, 'Backup', onOpenExports, 'Exports')}
		{#if backup.status === 'loading'}
			<Skeleton class="h-5 w-3/4" />
		{:else if backup.status === 'error'}
			<p class="flex items-center gap-1.5 text-sm text-muted-foreground">
				<CloudOffIcon class="size-3.5" aria-hidden="true" /> Backups unavailable
			</p>
		{:else if backup.value}
			<p class="text-sm" title={formatExportTime(backup.value.createdAt)}>
				Full S3 backup {formatAge(backup.value.createdAt, now)}
			</p>
		{:else}
			<p class="flex items-center gap-1.5 text-sm text-muted-foreground">
				<CloudOffIcon class="size-3.5" aria-hidden="true" /> No full S3 backup yet
			</p>
		{/if}
	</div>

	<div class="flex min-w-0 flex-col gap-2 bg-card p-4" data-testid="ops-properties">
		{@render row(FileCogIcon, 'Properties', onOpenProperties, 'Properties')}
		{#if properties.status === 'loading'}
			<Skeleton class="h-5 w-3/4" />
		{:else if properties.status === 'error'}
			<p class="text-sm text-muted-foreground">Properties unavailable</p>
		{:else}
			<p class="flex flex-wrap items-center gap-2 text-sm">
				{propertiesText}
				{#if running && properties.value.restartRequired && properties.value.appliedVersion !== null}
					<Badge variant="warning">Restart to apply</Badge>
				{/if}
			</p>
		{/if}
	</div>

	<div class="flex min-w-0 flex-col gap-2 bg-card p-4" data-testid="ops-activity">
		{@render row(HistoryIcon, 'Recent activity', onOpenActivity, 'Activity')}
		{#if jobs.status === 'loading'}
			<Skeleton class="h-5 w-3/4" />
		{:else if jobs.status === 'error'}
			<p class="text-sm text-muted-foreground">Activity unavailable</p>
		{:else if jobs.value.length === 0}
			<p class="text-sm text-muted-foreground">No jobs for this server yet</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each jobs.value as job (job.id)}
					<li class="flex min-w-0 items-center gap-2 text-sm">
						<span class="min-w-0 flex-1 truncate">{jobKindLabel(job.kind)}</span>
						<span class="shrink-0 text-xs text-muted-foreground"
							>{formatRelative(job.finishedAt ?? job.createdAt, now)}</span
						>
						<JobStateBadge state={job.state} />
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
