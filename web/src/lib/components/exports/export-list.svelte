<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import PinIcon from '@lucide/svelte/icons/pin';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		deleteExport,
		exportDownloadUrl,
		isAbortError,
		type ExportRecord
	} from '#lib/api/index.js';
	import {
		DESTINATION_LABELS,
		SCOPE_LABELS,
		formatExportTime,
		shortHash
	} from '#lib/exports/exports.js';
	import { canRestoreFrom } from '#lib/exports/backups.js';
	import { formatBytes } from '#lib/metrics.js';
	import { fadeIn, rise, stagger } from '#lib/motion/index.js';
	import { resolve } from '$app/paths';

	interface Props {
		exports: ExportRecord[];
		/** Show the source server name (global page). */
		showServer?: boolean;
		/** IDs of servers that still exist; others are marked as deleted. `null` = unknown. */
		serverIds?: string[] | null;
		emptyText?: string;
		ondeleted: (id: string) => void;
		/** Restore points of archived servers: marked, and their deletion is not offered. */
		pinnedIds?: readonly string[];
		/** Offers Restore on full archives only; partial archives stay download-only. */
		onrestore?: (record: ExportRecord) => void;
		/** Restore is temporarily unavailable (another operation runs). */
		restoreDisabled?: boolean;
		/** Per-row eligibility beyond the full scope (e.g. no local instance would be overwritten). */
		restorable?: (record: ExportRecord) => boolean;
	}

	let {
		exports,
		showServer = false,
		serverIds = null,
		emptyText = 'No archives yet.',
		ondeleted,
		pinnedIds = [],
		onrestore,
		restoreDisabled = false,
		restorable = () => true
	}: Props = $props();

	let target = $state.raw<ExportRecord | null>(null);
	let deleting = $state(false);
	let error = $state.raw<unknown>(null);
	let abort: AbortController | null = null;
	$effect(() => () => abort?.abort());

	function setOpen(next: boolean) {
		if (deleting) return;
		if (!next) target = null;
	}

	function ask(record: ExportRecord) {
		error = null;
		target = record;
	}

	async function confirmDelete() {
		const record = target;
		if (!record || deleting) return;
		deleting = true;
		error = null;
		abort = new AbortController();
		try {
			await deleteExport(record.id, { signal: abort.signal });
			deleting = false;
			target = null;
			ondeleted(record.id);
			toast.success('Archive deleted', { description: record.fileName });
		} catch (cause) {
			deleting = false;
			if (!isAbortError(cause)) error = cause;
		}
	}

	const serverExists = (id: string) => serverIds === null || serverIds.includes(id);
</script>

{#if exports.length === 0}
	<p
		class="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
		in:fadeIn
	>
		<ArchiveIcon class="size-4 shrink-0" aria-hidden="true" />
		{emptyText}
	</p>
{:else}
	<ul class="overflow-hidden rounded-lg border border-border bg-card" aria-label="Archives">
		{#each exports as record, index (record.id)}
			{@const DestIcon = record.destination === 's3' ? CloudIcon : HardDriveIcon}
			<li
				class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5 last:border-b-0"
				in:rise={{ delay: stagger(index) }}
			>
				<DestIcon
					class="size-4 shrink-0 text-muted-foreground"
					aria-label={DESTINATION_LABELS[record.destination]}
				/>
				<div class="flex min-w-0 flex-1 flex-col gap-0.5">
					<div class="flex min-w-0 items-center gap-2">
						<span class="truncate font-mono text-xs" title={record.fileName}>{record.fileName}</span
						>
						<Badge variant="outline">{SCOPE_LABELS[record.scope]}</Badge>
						{#if pinnedIds.includes(record.id)}
							<Badge variant="secondary" title="Restore point of the archived server">
								<PinIcon aria-hidden="true" />Restore point
							</Badge>
						{/if}
					</div>
					<p
						class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground"
					>
						{#if showServer}
							{#if serverExists(record.serverId)}
								<a
									href={resolve(`servers/${record.serverId}`)}
									class="truncate text-foreground underline-offset-4 hover:underline"
									>{record.serverName}</a
								>
							{:else}
								<span
									class="truncate"
									title="No record in the manager. Host files may still exist from an earlier deletion."
									>{record.serverName}
									<span class="text-muted-foreground/70">(removed from manager)</span></span
								>
							{/if}
						{/if}
						<span>{formatExportTime(record.createdAt)}</span>
						<span>{formatBytes(record.size)}</span>
						<span>{DESTINATION_LABELS[record.destination]}</span>
						<span
							class="inline-flex items-center gap-1 font-mono"
							title={`SHA-256 ${record.sha256}${record.objectKey ? `\nObject ${record.objectKey}` : ''}`}
						>
							<ShieldCheckIcon class="size-3 text-success" aria-hidden="true" />
							<span class="sr-only">Verified SHA-256</span>
							{shortHash(record.sha256)}
						</span>
					</p>
				</div>
				<div class="flex shrink-0 items-center gap-1">
					{#if onrestore && canRestoreFrom(record) && restorable(record)}
						<Button
							variant="outline"
							size="xs"
							disabled={restoreDisabled}
							aria-label={`Restore from ${record.fileName}`}
							onclick={() => onrestore(record)}
						>
							<ArchiveRestoreIcon data-icon="inline-start" />Restore
						</Button>
					{/if}
					<Button
						href={exportDownloadUrl(record.id)}
						download={record.fileName}
						variant="ghost"
						size="icon-sm"
						aria-label={`Download ${record.fileName}`}
						title="Download"
					>
						<DownloadIcon />
					</Button>
					{#if pinnedIds.includes(record.id)}
						<span
							class="inline-flex size-8 items-center justify-center text-muted-foreground/60"
							title="Restore the server before deleting its only restore point"
						>
							<TrashIcon class="size-4" aria-hidden="true" />
							<span class="sr-only">Deletion unavailable: restore point of an archived server</span>
						</span>
					{:else}
						<Button
							variant="ghost"
							size="icon-sm"
							class="text-destructive hover:text-destructive"
							aria-label={`Delete ${record.fileName}`}
							title="Delete"
							onclick={() => ask(record)}
						>
							<TrashIcon />
						</Button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<AlertDialog.Root bind:open={() => target !== null, setOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this archive?</AlertDialog.Title>
			<AlertDialog.Description>
				Permanently removes
				<code class="font-mono text-xs break-all">{target?.fileName}</code>
				{target?.destination === 's3' ? 'from the S3 bucket' : 'from the manager host'} and from the archive
				list. The server and its files are not affected. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if error}<ErrorAlert {error} />{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
			<Button variant="destructive" disabled={deleting} onclick={confirmDelete}>
				{#if deleting}<Spinner data-icon="inline-start" />{/if}
				Delete archive
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
