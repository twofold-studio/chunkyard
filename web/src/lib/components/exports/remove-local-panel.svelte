<!--
	Explicit "remove local files" (archive) action for a stopped local server. It never runs after an
	export by itself: the owner picks a full S3 backup and confirms that later local changes are lost.
-->
<script lang="ts">
	import CloudUploadIcon from '@lucide/svelte/icons/cloud-upload';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import JobWorkProgress from '#lib/components/jobs/job-work-progress.svelte';
	import { isJobActive, type ExportRecord, type Job } from '#lib/api/index.js';
	import { formatAge } from '#lib/exports/backups.js';
	import { formatExportTime } from '#lib/exports/exports.js';
	import { formatBytes } from '#lib/metrics.js';
	import { collapse } from '#lib/motion/index.js';
	import { resolve } from '$app/paths';

	interface Props {
		serverName: string;
		/** Full S3 archives of this server, newest first; `null` while loading. */
		candidates: ExportRecord[] | null;
		/** Why removal is unavailable right now (running, unsaved edits, other work), or `null`. */
		blockedReason: string | null;
		/** Archive request or job in flight. */
		working: boolean;
		/** Archive job of this server (running or last finished). */
		job?: Job | null;
		error?: unknown;
		onConfirm: (exportId: string) => void;
		now?: number;
	}

	let {
		serverName,
		candidates,
		blockedReason,
		working,
		job = null,
		error = null,
		onConfirm,
		now = Date.now()
	}: Props = $props();

	const selectId = $props.id();
	let chosen = $state<string | null>(null);
	const choice = $derived(candidates?.find((c) => c.id === chosen) ?? candidates?.[0] ?? null);
	let confirming = $state(false);
	let acknowledged = $state(false);

	function open() {
		acknowledged = false;
		confirming = true;
	}

	function confirm() {
		if (!choice || !acknowledged || blockedReason || working) return;
		confirming = false;
		onConfirm(choice.id);
	}

	const selectClass =
		'h-8 min-w-0 max-w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30';
</script>

<section
	class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
	aria-label="Remove local files"
>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
		<HardDriveIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-sm font-medium">Keep only the S3 backup</span>
		<span class="text-xs text-muted-foreground"
			>Frees this host; the server stays listed and can be restored.</span
		>
	</div>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
		{#if candidates === null}
			<span class="flex items-center gap-2 text-xs text-muted-foreground"
				><Spinner class="size-3" />Checking backups…</span
			>
		{:else if candidates.length === 0}
			<p class="min-w-0 flex-1 text-xs text-muted-foreground">
				Needs a <span class="text-foreground">Full instance</span> export to
				<span class="text-foreground">S3</span>. Create one above; local files are never removed
				automatically.
			</p>
		{:else}
			<label for={selectId} class="text-xs font-medium text-muted-foreground">Backup</label>
			<select
				id={selectId}
				class={selectClass}
				value={choice?.id}
				onchange={(event) => (chosen = event.currentTarget.value)}
				disabled={working}
			>
				{#each candidates as candidate (candidate.id)}
					<option value={candidate.id}
						>{formatExportTime(candidate.createdAt)} · {formatAge(candidate.createdAt, now)} · {formatBytes(
							candidate.size
						)}</option
					>
				{/each}
			</select>
			<Button
				size="sm"
				variant="outline"
				class="ml-auto"
				disabled={!choice || !!blockedReason || working}
				onclick={open}
			>
				{#if working}<Spinner data-icon="inline-start" />{:else}<CloudUploadIcon
						data-icon="inline-start"
					/>{/if}
				{working ? 'Removing…' : 'Remove local files…'}
			</Button>
			{#if blockedReason && !working}
				<p class="w-full text-xs text-warning" role="status">{blockedReason}</p>
			{/if}
		{/if}
	</div>
	{#if job && (isJobActive(job) || working)}
		<div class="px-4 py-2.5" role="status" transition:collapse>
			<JobWorkProgress {job} fallback="Removing local files" />
		</div>
	{/if}
</section>

{#if error && !working}
	<div transition:collapse>
		<ErrorAlert {error}>
			<p class="text-muted-foreground">
				The manager re-read this server; its current files and state are shown.
			</p>
			{#if job}
				<a href={resolve(`activity/${job.id}`)} class="text-xs underline underline-offset-4"
					>Job details in Activity</a
				>
			{/if}
		</ErrorAlert>
	</div>
{/if}

<AlertDialog.Root bind:open={confirming}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove local files of {serverName}?</AlertDialog.Title>
			<AlertDialog.Description>
				The S3 backup is downloaded and verified again first. Then every local instance file is
				removed. The server stays listed with its settings, icon and history and can be restored
				from this backup.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if choice}
			<p class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
				Backup from <span class="font-medium">{formatExportTime(choice.createdAt)}</span>
				({formatAge(choice.createdAt, now)}) ·
				<span class="font-mono">{choice.fileName}</span>
			</p>
		{/if}
		<div class="flex items-start gap-2.5">
			<Checkbox id={`${selectId}-ack`} bind:checked={acknowledged} class="mt-0.5" />
			<Label for={`${selectId}-ack`} class="text-sm leading-snug font-normal">
				I understand that changes made after this backup, including world progress, are lost.
			</Label>
		</div>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<Button
				variant="destructive"
				disabled={!acknowledged || !!blockedReason || working}
				onclick={confirm}
			>
				Remove local files
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
