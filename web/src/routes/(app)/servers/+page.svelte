<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { ErrorAlert, PageHeader } from '#lib/components/app/index.js';
	import ServerList from '#lib/components/servers/server-list.svelte';
	import RestoreDialog from '#lib/components/exports/restore-dialog.svelte';
	import {
		isAbortError,
		listExports,
		listServers,
		type ExportRecord,
		type ServerView
	} from '#lib/api/index.js';
	import { BackupOperations } from '#lib/exports/backup-operations.svelte.js';
	import { latestFullS3ByServer, type BackupIndex } from '#lib/exports/backups.js';
	import { poll } from '#lib/polling.js';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Seeded by the load function, then refreshed in place while the tab is visible.
	let servers = $derived(data.servers);
	let refreshError = $state<unknown>(null);

	/** Archive catalog, fetched on entry and after observed operations only (never on a timer). */
	let catalog = $state.raw<ExportRecord[] | null | 'error'>(null);
	const backups = $derived<BackupIndex | null | 'error'>(
		catalog === null || catalog === 'error' ? catalog : latestFullS3ByServer(catalog)
	);
	let now = $state(Date.now());

	const abort = new AbortController();
	$effect(() => () => abort.abort());

	async function loadCatalog() {
		try {
			catalog = (await listExports({ signal: abort.signal })).items;
		} catch (error) {
			if (!isAbortError(error)) catalog = 'error';
		}
	}

	async function refreshServers() {
		try {
			servers = (await listServers({ signal: abort.signal })).items;
			refreshError = null;
		} catch (error) {
			if (!isAbortError(error)) refreshError = error;
		}
	}

	const operations = new BackupOperations({
		onSettled: (job) => {
			if (job.state === 'succeeded' && job.kind === 'server.restore')
				toast.success('Server restored', { description: 'It stays stopped until you start it.' });
			void refreshServers();
			void loadCatalog();
		}
	});
	$effect(() => () => operations.destroy());

	$effect(() => {
		untrack(() => {
			void loadCatalog();
			void operations.recover();
		});
	});

	// An archive or restore finished elsewhere: re-read the catalog once.
	const archiveSignature = $derived(
		servers
			.map((s) => `${s.id}:${s.archive?.exportId ?? ''}`)
			.sort()
			.join(',')
	);
	let lastSignature: string | null = null;
	$effect(() => {
		const signature = archiveSignature;
		untrack(() => {
			if (lastSignature !== null && lastSignature !== signature && catalog !== null) {
				void loadCatalog();
			}
			lastSignature = signature;
		});
	});

	$effect(() => {
		const controller = new AbortController();
		poll(
			async (signal) => {
				servers = (await listServers({ signal })).items;
				refreshError = null;
				now = Date.now();
			},
			{
				intervalMs: 10_000,
				immediate: false,
				signal: controller.signal,
				onError: (error) => (refreshError = error)
			}
		);
		return () => controller.abort();
	});

	/** Archived server whose pinned backup awaits restore confirmation. */
	let restoring = $state.raw<ServerView | null>(null);
	const pinned = $derived<ExportRecord | null>(
		restoring?.archive && Array.isArray(catalog)
			? (catalog.find((e) => e.id === restoring?.archive?.exportId) ?? null)
			: null
	);
	function confirmRestore(exportId: string) {
		const target = restoring;
		restoring = null;
		if (target) void operations.restore(target.id, exportId);
	}
</script>

<PageHeader
	title="Servers"
	icon={ServerIcon}
	description="Minecraft servers running in Docker containers managed by this instance."
/>

{#if data.docker && !data.docker.available}
	<Alert.Root variant="warning">
		<TriangleAlertIcon />
		<Alert.Title>Docker is unavailable</Alert.Title>
		<Alert.Description>
			<p>Servers cannot start, stop or show logs until a Linux Docker engine is reachable.</p>
			{#if data.docker.reason}<p class="font-mono text-xs">{data.docker.reason}</p>{/if}
		</Alert.Description>
	</Alert.Root>
{/if}

{#if refreshError}
	<ErrorAlert error={refreshError} />
{/if}

{#if operations.recoveryError}
	<ErrorAlert
		error={operations.recoveryError}
		hint="Running restores could not be checked. They may still be running; see Activity."
	/>
{/if}

<ServerList
	{servers}
	createHref={resolve('servers/new')}
	backups={servers.length ? backups : undefined}
	{operations}
	onRestore={(server) => (restoring = server)}
	{now}
/>

<RestoreDialog
	exportId={restoring?.archive?.exportId ?? null}
	record={pinned}
	name={restoring?.name ?? ''}
	state="archived"
	{now}
	onConfirm={confirmRestore}
	onCancel={() => (restoring = null)}
/>
