<!--
	Explicit confirmation for restoring a full archive into an archived or removed server identity.
	It only describes what the backend does; the caller submits the request.
-->
<script lang="ts">
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { ExportRecord } from '#lib/api/index.js';
	import { backupKind, formatAge } from '#lib/exports/backups.js';
	import { formatExportTime } from '#lib/exports/exports.js';
	import { formatBytes } from '#lib/metrics.js';

	interface Props {
		/** Archive ID to restore; `null` closes the dialog. */
		exportId: string | null;
		/** Catalog record of {@link exportId}, when loaded. */
		record?: ExportRecord | null;
		/** Display name of the server identity. */
		name: string;
		/** `removed`: no record in the manager; it is recreated with EULA acceptance off. */
		state: 'archived' | 'removed';
		onConfirm: (exportId: string) => void;
		onCancel: () => void;
		now?: number;
	}

	let {
		exportId,
		record = null,
		name,
		state,
		onConfirm,
		onCancel,
		now = Date.now()
	}: Props = $props();

	function confirm() {
		if (exportId) onConfirm(exportId);
	}
</script>

<AlertDialog.Root bind:open={() => exportId !== null, (open) => !open && onCancel()}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Restore {name}?</AlertDialog.Title>
			<AlertDialog.Description>
				Extracts the verified full backup into a new local instance of this server. The game stays
				stopped; nothing is started for you.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if record && record.id === exportId}
			<dl
				class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
				aria-label="Backup to restore"
			>
				<dt class="text-muted-foreground">Backup</dt>
				<dd class="truncate font-mono" title={record.fileName}>{record.fileName}</dd>
				<dt class="text-muted-foreground">Created</dt>
				<dd>{formatExportTime(record.createdAt)} · {formatAge(record.createdAt, now)}</dd>
				<dt class="text-muted-foreground">Kind</dt>
				<dd>{backupKind(record)} · {formatBytes(record.size)}</dd>
			</dl>
		{:else}
			<p class="text-xs text-muted-foreground">
				Pinned restore point <code class="font-mono">{exportId}</code>. Its catalog details could
				not be loaded; the backend verifies it before restoring.
			</p>
		{/if}
		<ul class="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
			{#if state === 'removed'}
				<li>
					The server record is recreated with its original ID and backed-up settings. Minecraft EULA
					acceptance starts <strong class="text-foreground">off</strong>; review it before starting.
				</li>
				<li>
					If files of this server were kept on the manager host, the restore stops with a conflict
					instead of overwriting them.
				</li>
			{:else}
				<li>Software, launch settings and desired properties come from the backup.</li>
				<li>Name, network, memory/CPU and EULA acceptance stay as they are now.</li>
			{/if}
		</ul>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<Button onclick={confirm}>
				<ArchiveRestoreIcon data-icon="inline-start" />
				Restore
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
