<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import BlocksIcon from '@lucide/svelte/icons/blocks';
	import Gamepad2Icon from '@lucide/svelte/icons/gamepad-2';
	import MemoryStickIcon from '@lucide/svelte/icons/memory-stick';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import CloudCheckIcon from '@lucide/svelte/icons/cloud-check';
	import CloudOffIcon from '@lucide/svelte/icons/cloud-off';
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { StatusBadge } from '#lib/components/app/index.js';
	import JobWorkProgress from '#lib/components/jobs/job-work-progress.svelte';
	import { describeError, isJobActive, type Job, type ServerView } from '#lib/api/index.js';
	import { formatCpus, formatMemory, formatMemoryRange } from '#lib/format.js';
	import { formatAge, isArchived } from '#lib/exports/backups.js';
	import { formatExportTime } from '#lib/exports/exports.js';
	import { cardSummary, needsInstall } from '#lib/servers/software.js';
	import { resolve } from '$app/paths';
	import ServerAvatar from './server-avatar.svelte';
	import CardUsage from './card-usage.svelte';
	import type { CardBackup } from './card-backup.js';

	interface Props {
		server: ServerView;
		/** Newest full S3 backup; `undefined` hides the line (no catalog requested). */
		backup?: CardBackup;
		/** Archive/restore job of this server observed by the list. */
		job?: Job | null;
		/** A restore request is in flight. */
		requesting?: boolean;
		/** Last restore failure. */
		error?: unknown;
		/** Restores the archived server from its pinned full backup (asks for confirmation). */
		onRestore?: (server: ServerView) => void;
		now?: number;
	}

	let {
		server,
		backup,
		job = null,
		requesting = false,
		error = null,
		onRestore,
		now = Date.now()
	}: Props = $props();

	const summary = $derived(cardSummary(server));
	const archived = $derived(isArchived(server));
	const notInstalled = $derived(!archived && needsInstall(server));
	const working = $derived(requesting || (job !== null && isJobActive(job)));
	const failure = $derived(error ? describeError(error) : null);
	const running = $derived(!archived && server.status.state === 'running');
</script>

{#snippet spec(Icon: typeof ServerIcon, label: string, value: string, title?: string)}
	<div class="flex min-w-0 items-center gap-1.5" {title}>
		<dt class="shrink-0 text-muted-foreground">
			<Icon class="size-3.5" aria-hidden="true" />
			<span class="sr-only">{label}</span>
		</dt>
		<dd class="truncate">{value}</dd>
	</div>
{/snippet}

<!-- The name link stretches over the card; actions sit above it, so no control is nested in a link. -->
<article
	class={[
		'motion-lift relative flex h-full flex-col gap-4 rounded-xl border bg-card p-4 has-[a[data-card-link]:focus-visible]:border-ring has-[a[data-card-link]:focus-visible]:ring-3 has-[a[data-card-link]:focus-visible]:ring-ring/40 has-[a[data-card-link]:hover]:border-ring/60 has-[a[data-card-link]:hover]:bg-accent/20 sm:p-5',
		archived ? 'border-dashed border-border' : 'border-border'
	]}
	data-testid="server-card"
	data-archived={archived ? 'true' : undefined}
	aria-busy={working || undefined}
>
	<div class="flex min-w-0 items-start gap-3">
		<ServerAvatar {server} class={archived ? 'opacity-70' : undefined} />
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<h3 class="truncate text-sm leading-5 font-medium">
				<a
					href={resolve(`servers/${server.id}`)}
					class="outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
					data-card-link>{server.name}</a
				>
			</h3>
			<div class="flex flex-wrap items-center gap-1.5">
				{#if archived}
					<Badge variant="secondary" title="Local files removed; restorable from its S3 backup">
						<CloudIcon aria-hidden="true" />Archived
					</Badge>
				{:else}
					<StatusBadge state={server.status.state} />
				{/if}
				{#if notInstalled}<Badge variant="warning">Not installed</Badge>{/if}
				{#if !server.acceptEula}<Badge variant="warning">EULA</Badge>{/if}
			</div>
		</div>
	</div>
	<dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-foreground/90">
		{@render spec(BlocksIcon, 'Software', summary.software)}
		{@render spec(Gamepad2Icon, 'Minecraft version', summary.version ?? 'Unknown version')}
		{@render spec(
			MemoryStickIcon,
			'Memory',
			formatMemory(server.memoryMaxMb),
			`Heap ${formatMemoryRange(server.memoryMinMb, server.memoryMaxMb)}`
		)}
		{@render spec(CpuIcon, 'CPU limit', formatCpus(server.cpus))}
		{@render spec(NetworkIcon, 'Host game port', `Port ${server.port}`)}
	</dl>
	{#if running}
		<CardUsage serverId={server.id} cpus={server.cpus} />
	{/if}
	{#if backup || archived}
		<div
			class="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-xs"
		>
			<p
				class="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground"
				data-testid="backup-age"
			>
				{#if !backup}
					<span>Archived</span>
				{:else if backup.status === 'loading'}
					<Spinner class="size-3" aria-hidden="true" />
					<span>Checking backups…</span>
				{:else if backup.status === 'error'}
					<CloudOffIcon class="size-3.5 shrink-0" aria-hidden="true" />
					<span>Backups unavailable</span>
				{:else if backup.latest}
					<CloudCheckIcon class="size-3.5 shrink-0 text-success" aria-hidden="true" />
					<span class="truncate" title={formatExportTime(backup.latest.createdAt)}
						>Full S3 backup {formatAge(backup.latest.createdAt, now)}</span
					>
				{:else}
					<CloudOffIcon class="size-3.5 shrink-0" aria-hidden="true" />
					<span>No full S3 backup</span>
				{/if}
			</p>
			{#if archived && onRestore}
				<Button
					size="xs"
					variant="outline"
					class="relative z-10"
					disabled={working}
					onclick={() => onRestore(server)}
					aria-label={`Restore ${server.name}`}
				>
					{#if working}<Spinner data-icon="inline-start" />{:else}<ArchiveRestoreIcon
							data-icon="inline-start"
						/>{/if}
					{working ? 'Restoring' : failure ? 'Retry restore' : 'Restore'}
				</Button>
			{/if}
		</div>
	{/if}
	{#if job && isJobActive(job)}
		<JobWorkProgress
			{job}
			history={false}
			fallback={job.kind === 'server.archive' ? 'Removing local files' : 'Restoring'}
		/>
	{:else if failure}
		<p class="relative z-10 text-xs text-destructive" role="alert">
			{failure.title}: {failure.detail}
			{#if job}
				<a href={resolve(`activity/${job.id}`)} class="underline underline-offset-4">Details</a>
			{/if}
		</p>
	{/if}
</article>
