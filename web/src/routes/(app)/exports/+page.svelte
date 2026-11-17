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
	import { storageTarget } from '#lib/exports/exports.js';
	import { formatBytes } from '#lib/metrics.js';
	import { EXPORTS_TABS, parseTab, type ExportsTab } from '#lib/navigation/palette.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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

	let tab = $state<ExportsTab>(parseTab(EXPORTS_TABS, page.url.searchParams.get('tab')));
	/** S3 storage stays mounted after its first visit so unsaved connection edits survive tab switches. */
	let storageVisited = $state(untrack(() => tab) === 'storage');

	// Palette links and history navigation select the tab named in the query.
	$effect(() => {
		const url = page.shallow?.url ?? page.url;
		const requested = parseTab(EXPORTS_TABS, url.searchParams.get('tab'));
		untrack(() => selectTab(requested, false));
	});

	function selectTab(next: string, updateUrl = true) {
		const value = parseTab(EXPORTS_TABS, next);
		tab = value;
		if (value === 'storage') storageVisited = true;
		if (!updateUrl) return;
		const current = page.shallow?.url ?? page.url;
		const url = new URL(current.href);
		if (value === EXPORTS_TABS[0][0]) url.searchParams.delete('tab');
		else url.searchParams.set('tab', value);
		if (url.href !== current.href) {
			// Same page; a shallow entry keeps the storage form and running restores mounted.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(url, { shallow: true, replace: true, reset: false, state: page.state });
		}
	}

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
	description="Existing backups of every server, on this manager or in S3. They stay here after a server is deleted."
	meta={exports.length
		? `${exports.length} ${exports.length === 1 ? 'backup' : 'backups'}`
		: undefined}
/>

<!-- Where each kind of backup work happens, so this page is not mistaken for the place to create one. -->
<dl
	class="grid gap-px overflow-hidden rounded-lg border border-border bg-border text-xs sm:grid-cols-3 [&>div]:flex [&>div]:min-w-0 [&>div]:flex-col [&>div]:gap-0.5 [&>div]:bg-card [&>div]:px-4 [&>div]:py-2.5"
	data-testid="backup-overview"
>
	<div>
		<dt class="font-medium">Back up now</dt>
		<dd class="text-muted-foreground">
			World, full instance or selected files, from a server's Exports tab.
		</dd>
	</div>
	<div>
		<dt class="font-medium">Automatic schedule</dt>
		<dd class="text-muted-foreground">
			Per server, in its Exports tab. Always the full instance to
			{#if storageTarget(storage)}<span class="font-mono text-foreground"
					>{storageTarget(storage)}</span
				>{:else}S3 storage{/if}, only while stopped.
		</dd>
	</div>
	<div>
		<dt class="font-medium">Existing backups</dt>
		<dd class="text-muted-foreground">
			{exports.length
				? `${exports.length} ${exports.length === 1 ? 'backup' : 'backups'} · ${formatBytes(totalBytes)}`
				: 'None yet'}. Listed below.
		</dd>
	</div>
</dl>

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

<Tabs.Root bind:value={() => tab, (next) => selectTab(next)} class="gap-4">
	<Tabs.List
		variant="line"
		class="scrollbar-none w-full justify-start gap-4 overflow-x-auto overflow-y-hidden rounded-none border-b border-border"
	>
		<Tabs.Trigger
			value="servers"
			class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]"
		>
			<ServerIcon data-icon="inline-start" aria-hidden="true" />By server
			<span class="text-xs text-muted-foreground tabular-nums">{groups.length}</span>
		</Tabs.Trigger>
		<Tabs.Trigger
			value="exports"
			class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]"
		>
			<ArchiveIcon data-icon="inline-start" aria-hidden="true" />Exports
			<span class="text-xs text-muted-foreground tabular-nums">{exports.length}</span>
		</Tabs.Trigger>
		<Tabs.Trigger
			value="storage"
			class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]"
		>
			<CloudCogIcon data-icon="inline-start" aria-hidden="true" />S3 storage
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

	<Tabs.Content value="exports">
		{#if tab === 'exports'}
			<Reveal class="flex flex-col gap-2">
				<section class="flex flex-col gap-2" aria-label="All exports">
					<ExportList
						{exports}
						showServer
						{serverIds}
						{pinnedIds}
						emptyText="No backups yet. Stop a server and use Back up now in its Exports tab."
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
		{#if storageVisited && storage}
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
