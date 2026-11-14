<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ServerIcon from '@lucide/svelte/icons/server';
	import CloudCogIcon from '@lucide/svelte/icons/cloud-cog';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { ErrorAlert, PageHeader } from '#lib/components/app/index.js';
	import { Reveal } from '#lib/components/motion/index.js';
	import BackupServers from '#lib/components/exports/backup-servers.svelte';
	import ExportList from '#lib/components/exports/export-list.svelte';
	import RestoreDialog from '#lib/components/exports/restore-dialog.svelte';
	import RestoreNote from '#lib/components/exports/restore-note.svelte';
	import StorageForm from '#lib/components/exports/storage-form.svelte';
	import {
		isAbortError,
		listExports,
		listServers,
		type ExportRecord,
		type ServerView
	} from '#lib/api/index.js';
	import { BackupOperations } from '#lib/exports/backup-operations.svelte.js';
	import {
		groupBackups,
		instanceState,
		restoreAllowed,
		type BackupGroup
	} from '#lib/exports/backups.js';
	import { formatBytes } from '#lib/metrics.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let storage = $derived(data.storage);
	let exports = $derived(data.exports);
	let servers = $derived<ServerView[] | null>(data.servers);
	let refreshError = $state.raw<unknown>(null);
	const s3Archives = $derived(exports.filter((e) => e.destination === 's3').length);
	const totalBytes = $derived(exports.reduce((sum, e) => sum + e.size, 0));
	const groups = $derived(groupBackups(exports, servers));
	const pinnedIds = $derived(groups.flatMap((g) => (g.pinned ? [g.pinned.id] : [])));
	const serverIds = $derived(servers ? servers.map((s) => s.id) : null);

	type TabValue = 'servers' | 'archives' | 'storage';
	let tab = $state<TabValue>('servers');

	const abort = new AbortController();
	$effect(() => () => abort.abort());

	/** Re-reads the catalog and inventory after an observed archive/restore (no timer). */
	async function refresh() {
		try {
			const [list, inventory] = await Promise.all([
				listExports({ signal: abort.signal }),
				listServers({ signal: abort.signal }).then(
					(r) => r.items,
					() => null
				)
			]);
			exports = list.items;
			servers = inventory;
			refreshError = null;
		} catch (error) {
			if (!isAbortError(error)) refreshError = error;
		}
	}

	const operations = new BackupOperations({
		onSettled: (job) => {
			if (job.state === 'succeeded' && job.kind === 'server.restore') {
				toast.success('Server restored', { description: 'It stays stopped until you start it.' });
			}
			void refresh();
		}
	});
	$effect(() => () => operations.destroy());
	$effect(() => {
		untrack(() => void operations.recover());
	});

	let restoring = $state.raw<{ group: BackupGroup; record: ExportRecord } | null>(null);

	function askRestore(group: BackupGroup, record: ExportRecord) {
		if (!restoreAllowed(group.state)) return;
		restoring = { group, record };
	}

	function askRestoreRecord(record: ExportRecord) {
		const group = groups.find((g) => g.serverId === record.serverId);
		if (group) askRestore(group, record);
	}

	function confirmRestore(exportId: string) {
		const target = restoring;
		restoring = null;
		if (target) void operations.restore(target.group.serverId, exportId);
	}

	function removed(id: string) {
		exports = exports.filter((e) => e.id !== id);
	}
</script>

<PageHeader
	title="Storage & exports"
	icon={ArchiveIcon}
	description="Compressed server archives on the manager host or S3. Archives are independent of servers and stay here after a server is deleted. Create new exports from a server's Exports tab."
	meta={exports.length
		? `${exports.length} ${exports.length === 1 ? 'archive' : 'archives'}`
		: undefined}
/>

{#if refreshError}
	<ErrorAlert error={refreshError} hint="The lists below may be out of date.">
		<Button size="sm" variant="outline" class="mt-2" onclick={refresh}>Retry</Button>
	</ErrorAlert>
{/if}
{#if operations.recoveryError}
	<ErrorAlert
		error={operations.recoveryError}
		hint="Running restores could not be checked. They may still be running; see Activity."
	/>
{/if}

<Tabs.Root bind:value={tab} class="gap-4">
	<Tabs.List
		variant="line"
		class="scrollbar-none w-full justify-start gap-4 overflow-x-auto overflow-y-hidden rounded-none border-b border-border"
	>
		<Tabs.Trigger
			value="servers"
			class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]"
		>
			<ServerIcon data-icon="inline-start" aria-hidden="true" />Servers
			<span class="text-xs text-muted-foreground tabular-nums">{groups.length}</span>
		</Tabs.Trigger>
		<Tabs.Trigger
			value="archives"
			class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]"
		>
			<ArchiveIcon data-icon="inline-start" aria-hidden="true" />Archives
			<span class="text-xs text-muted-foreground tabular-nums">{exports.length}</span>
		</Tabs.Trigger>
		<Tabs.Trigger
			value="storage"
			class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]"
		>
			<CloudCogIcon data-icon="inline-start" aria-hidden="true" />Storage
		</Tabs.Trigger>
	</Tabs.List>

	<Tabs.Content value="servers">
		{#if tab === 'servers'}
			<Reveal class="flex flex-col gap-2">
				{#if servers === null}
					<p class="text-xs text-warning" role="status">
						The server inventory could not be loaded, so local/archived state is unknown and restore
						is unavailable.
					</p>
				{/if}
				<BackupServers {groups} {operations} onRestore={askRestore} ondeleted={removed} />
				<RestoreNote />
			</Reveal>
		{/if}
	</Tabs.Content>

	<Tabs.Content value="archives">
		{#if tab === 'archives'}
			<Reveal class="flex flex-col gap-2">
				<section class="flex flex-col gap-2" aria-label="All archives">
					{#if exports.length}
						<p class="text-xs text-muted-foreground">{formatBytes(totalBytes)} total</p>
					{/if}
					<ExportList
						{exports}
						showServer
						{serverIds}
						{pinnedIds}
						emptyText="No archives yet. Stop a server and open its Exports tab to create one."
						ondeleted={removed}
						onrestore={servers === null ? undefined : askRestoreRecord}
						restorable={(record) =>
							restoreAllowed(instanceState(record.serverId, servers).state) &&
							!operations.busy(record.serverId)}
					/>
				</section>
				<RestoreNote />
			</Reveal>
		{/if}
	</Tabs.Content>

	<Tabs.Content value="storage">
		{#if tab === 'storage' && storage}
			<Reveal>
				<StorageForm connection={storage} {s3Archives} onSaved={(saved) => (storage = saved)} />
			</Reveal>
		{/if}
	</Tabs.Content>
</Tabs.Root>

<RestoreDialog
	exportId={restoring?.record.id ?? null}
	record={restoring?.record ?? null}
	name={restoring?.group.name ?? ''}
	state={restoring?.group.state === 'removed' ? 'removed' : 'archived'}
	onConfirm={confirmRestore}
	onCancel={() => (restoring = null)}
/>
