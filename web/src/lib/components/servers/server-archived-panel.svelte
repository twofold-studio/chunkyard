<!--
	Overview of an archived server: its local files were removed and the pinned full S3 backup is the
	restore point. Only describes state and offers Restore; it never fetches by itself.
-->
<script lang="ts">
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import JobWorkProgress from '#lib/components/jobs/job-work-progress.svelte';
	import type { ExportRecord, Job, ServerView } from '#lib/api/index.js';
	import { backupKind, formatAge } from '#lib/exports/backups.js';
	import { formatExportTime, shortHash } from '#lib/exports/exports.js';
	import { formatBytes } from '#lib/metrics.js';
	import { formatCpus, formatMemory } from '#lib/format.js';
	import { resolve } from '$app/paths';

	interface Props {
		server: ServerView;
		/** Pinned restore point: `undefined` while the catalog loads, `null` if not listed. */
		pinned: ExportRecord | null | undefined;
		/** Catalog request failed (distinct from "not listed"). */
		catalogError?: unknown;
		onRetryCatalog?: () => void;
		/** Restore request or job in flight. */
		working: boolean;
		/** Disabled while another operation runs. */
		disabled?: boolean;
		/** Restore job (running or last finished). */
		job?: Job | null;
		error?: unknown;
		onRestore: () => void;
		onOpenExports: () => void;
		now?: number;
	}

	let {
		server,
		pinned,
		catalogError = null,
		onRetryCatalog,
		working,
		disabled = false,
		job = null,
		error = null,
		onRestore,
		onOpenExports,
		now = Date.now()
	}: Props = $props();

	const archivedAt = $derived(server.archive?.archivedAt ?? null);
</script>

<section
	class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-dashed border-border bg-card"
	aria-label="Archived server"
	data-testid="archived-panel"
>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
		<CloudIcon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<h2 class="text-sm font-medium">Archived to S3</h2>
			<p class="text-xs text-muted-foreground">
				Local files were removed{archivedAt
					? ` ${formatAge(archivedAt, now)} (${formatExportTime(archivedAt)})`
					: ''}. Console, files, properties and lifecycle controls return after a restore.
			</p>
		</div>
		<Button size="sm" disabled={working || disabled} onclick={onRestore}>
			{#if working}<Spinner data-icon="inline-start" />{:else}<ArchiveRestoreIcon
					data-icon="inline-start"
				/>{/if}
			{working ? 'Restoring…' : error ? 'Retry restore' : 'Restore'}
		</Button>
	</div>

	<dl
		class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-4 py-3 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]"
		aria-label="Restore point"
	>
		{#if pinned === undefined && !catalogError}
			<dt class="text-muted-foreground">Restore point</dt>
			<dd class="flex items-center gap-1.5 text-muted-foreground">
				<Spinner class="size-3" />Loading backup details…
			</dd>
		{:else if pinned}
			<dt class="text-muted-foreground">Restore point</dt>
			<dd>{formatExportTime(pinned.createdAt)} · {formatAge(pinned.createdAt, now)}</dd>
			<dt class="text-muted-foreground">Kind</dt>
			<dd>{backupKind(pinned)} · {formatBytes(pinned.size)}</dd>
			<dt class="text-muted-foreground">Archive</dt>
			<dd class="truncate font-mono" title={pinned.fileName}>{pinned.fileName}</dd>
			<dt class="text-muted-foreground">SHA-256</dt>
			<dd class="font-mono" title={pinned.sha256}>{shortHash(pinned.sha256)}</dd>
		{:else}
			<dt class="text-muted-foreground">Restore point</dt>
			<dd class="font-mono break-all">{server.archive?.exportId}</dd>
		{/if}
		<dt class="text-muted-foreground">Kept</dt>
		<dd>
			Name, port {server.port}, {formatMemory(server.memoryMaxMb)}, {formatCpus(server.cpus)}, EULA
			{server.acceptEula ? 'accepted' : 'not accepted'}
		</dd>
	</dl>

	{#if catalogError}
		<div class="px-4 py-2.5">
			<ErrorAlert
				error={catalogError}
				hint="Backup details could not be loaded. Restore still uses the pinned restore point."
			>
				{#if onRetryCatalog}
					<Button size="sm" variant="outline" class="mt-2" onclick={onRetryCatalog}>Retry</Button>
				{/if}
			</ErrorAlert>
		</div>
	{/if}

	{#if working && job}
		<div class="px-4 py-2.5" role="status">
			<JobWorkProgress {job} fallback="Restoring" />
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs">
		<button
			type="button"
			class="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
			onclick={onOpenExports}
		>
			<ArchiveIcon class="size-3.5" aria-hidden="true" />All backups of this server
		</button>
		<a href={resolve('exports')} class="text-muted-foreground underline-offset-4 hover:underline"
			>Storage & exports</a
		>
	</div>
</section>

{#if error && !working}
	<ErrorAlert {error}>
		<p class="text-muted-foreground">
			The server is still archived and nothing was overwritten. You can retry.
		</p>
		{#if job}
			<a href={resolve(`activity/${job.id}`)} class="text-xs underline underline-offset-4"
				>Job details in Activity</a
			>
		{/if}
	</ErrorAlert>
{/if}
