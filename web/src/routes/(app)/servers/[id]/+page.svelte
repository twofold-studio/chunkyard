<script lang="ts">
	import InfoIcon from '@lucide/svelte/icons/info';
	import XIcon from '@lucide/svelte/icons/x';
	import { tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import {
		CopyText,
		ErrorAlert,
		StatusBadge,
		UnsavedChangesDialog,
		useTopbarContent
	} from '#lib/components/app/index.js';
	import ServerActions from '#lib/components/servers/server-actions.svelte';
	import ServerConsole from '#lib/components/servers/server-console.svelte';
	import ServerAvatar from '#lib/components/servers/server-avatar.svelte';
	import ServerOverview from '#lib/components/servers/server-overview.svelte';
	import ServerSettings from '#lib/components/servers/server-settings.svelte';
	import ServerFiles from '#lib/components/files/server-files.svelte';
	import { Reveal } from '#lib/components/motion/index.js';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import FolderTreeIcon from '@lucide/svelte/icons/folder-tree';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import FileCogIcon from '@lucide/svelte/icons/file-cog';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import ActivityView from '#lib/components/jobs/activity-view.svelte';
	import ServerExports from '#lib/components/exports/server-exports.svelte';
	import ServerProperties from '#lib/components/properties/server-properties.svelte';
	import EulaDialog from '#lib/components/servers/eula-dialog.svelte';
	import DeleteServerDialog from '#lib/components/servers/delete-server-dialog.svelte';
	import ServerInstallPanel from '#lib/components/servers/server-install-panel.svelte';
	import ServerArchivedPanel from '#lib/components/servers/server-archived-panel.svelte';
	import RestoreDialog from '#lib/components/exports/restore-dialog.svelte';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { isArchived } from '#lib/exports/backups.js';
	import { needsInstall, softwareHeadline } from '#lib/servers/software.js';
	import {
		errorCode,
		isAbortError,
		listExports,
		type DeletedServer,
		type ExportRecord,
		type InstallOptions,
		type ServerAction,
		type ServerView
	} from '#lib/api/index.js';
	import { ServerController } from '#lib/servers/server-controller.svelte.js';
	import { poll } from '#lib/polling.js';
	import { formatBytes, formatCpu } from '#lib/metrics.js';
	import { useServerMetrics } from '#lib/servers/metrics-source.svelte.js';
	import { useGameStatus } from '#lib/servers/game-status.svelte.js';
	import ReadinessBadge from '#lib/components/servers/readiness-badge.svelte';
	import ServerPlayers from '#lib/components/players/server-players.svelte';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { usePackMetadata } from '#lib/servers/pack-metadata.svelte.js';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { LeaveGuard } from '#lib/navigation/leave-guard.svelte.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const controller = new ServerController(untrack(() => data.server) as ServerView);
	// Navigating between servers reuses this component: swap the tracked record.
	$effect.pre(() => {
		const next = data.server;
		if (next && untrack(() => controller.server.id) !== next.id) {
			controller.reset(next);
			selectionFocus = 0;
			// The Files editor is re-keyed per server, so its unsaved state is gone.
			filesDirty = false;
		}
	});
	$effect(() => () => controller.destroy());

	// Re-attach to queued/running work after a reload, server switch or returning to the tab.
	// Only existing jobs are followed; nothing is ever resubmitted.
	const serverId = $derived(controller.server.id);
	$effect(() => {
		void serverId;
		untrack(() => {
			if (document.visibilityState !== 'hidden' && !removed && !deleting) void controller.recover();
		});
	});
	$effect(() => {
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') controller.suspend();
			else if (!removed && !deleting) void controller.recover();
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => document.removeEventListener('visibilitychange', onVisibility);
	});
	// A recovered export finishing changes the archive list; the Exports tab reloads it.
	// A recovered delete that succeeded removed this record.
	$effect(() => {
		const deleted = controller.deleted;
		if (deleted) untrack(() => void onDeleted(deleted));
	});

	const server = $derived(controller.server);
	/** Local files removed: only metadata, Activity, Exports and restore remain available. */
	const archived = $derived(isArchived(server));
	const running = $derived(!archived && server.status.state === 'running');
	const created = $derived(page.url.searchParams.has('created'));
	const software = $derived(server.software ?? null);
	const notInstalled = $derived(needsInstall(server));
	// CurseForge pack name/link by project ID (works for records created before metadata existed).
	const packInfo = usePackMetadata(() =>
		software?.type === 'curseforge' ? software.projectId : null
	);
	const softwareSummary = $derived(softwareHeadline(server, packInfo.pack?.name ?? null));
	// The page's only metrics sampler: the header readout and the Overview charts share it.
	const metrics = useServerMetrics(() => ({
		serverId: server.id,
		running,
		active: !removed && !deleting && !archived
	}));
	const liveUsage = $derived(metrics.live);
	// The page's only readiness poll: the header badge and the Overview panel share it. Nothing
	// is probed while the container is stopped, archived or being deleted.
	const game = useGameStatus(() => ({
		serverId: server.id,
		active: !removed && !deleting && !archived && server.status.state !== 'stopped'
	}));
	const readiness = $derived(game.readiness);

	const TABS = [
		{ value: 'overview', label: 'Overview', icon: LayoutDashboardIcon },
		{ value: 'console', label: 'Console', icon: TerminalIcon },
		{ value: 'players', label: 'Players', icon: UsersIcon },
		{ value: 'properties', label: 'Properties', icon: FileCogIcon },
		{ value: 'files', label: 'Files', icon: FolderTreeIcon },
		{ value: 'exports', label: 'Exports', icon: ArchiveIcon },
		{ value: 'activity', label: 'Activity', icon: HistoryIcon },
		{ value: 'settings', label: 'Settings', icon: SlidersIcon }
	] as const;
	type TabValue = (typeof TABS)[number]['value'];
	const isTab = (value: string | null): value is TabValue => TABS.some((t) => t.value === value);
	/** Tabs that read or change local instance files; hidden while archived. */
	const LOCAL_TABS: readonly TabValue[] = ['console', 'players', 'properties', 'files'];
	const visibleTabs = $derived(archived ? TABS.filter((t) => !LOCAL_TABS.includes(t.value)) : TABS);

	const initialTab = page.url.searchParams.get('tab');
	let tab = $state<TabValue>(isTab(initialTab) ? initialTab : 'overview');
	/** Files stays mounted after the first visit so editor changes survive tab switches. */
	let filesVisited = $state(initialTab === 'files');
	let filesDirty = $state(false);
	/** Properties stays mounted after its first visit so its view and history survive tab switches. */
	let propertiesVisited = $state(initialTab === 'properties');
	/** Exports stays mounted after its first visit so a running export keeps its progress. */
	let exportsVisited = $state(initialTab === 'exports');
	/** An export started from the Exports tab holds the instance lock until it finishes. */
	let exporting = $state(false);
	$effect(() => controller.setExternalTracking('export', exporting));
	/** Export started here or recovered after a reload. */
	const exportBusy = $derived(exporting || controller.exportActive);
	/** Properties autosave is queued or in flight (flushed on unmount, never prompted). */
	let propertiesPending = $state(false);
	let propertiesEditor = $state<{
		flushPending(): Promise<boolean>;
		refreshMetadata(): Promise<void>;
	} | null>(null);
	let leavingAfterAutosave = false;
	/** Bumped when Files → "Export selected" opens the Exports tab. */
	let selectionFocus = $state(0);
	/** Bumped to expand and scroll to Settings → Network. */
	let networkFocus = $state(0);
	/** Bumped to expand and scroll to Settings → Launch. */
	let launchFocus = $state(0);
	/** Bumped to expand and scroll to Settings → Resources. */
	let resourcesFocus = $state(0);
	let tabDirection = $state<1 | -1>(1);

	// Full navigation (palette/history) and shallow tab changes share one source.
	$effect(() => {
		const url = page.shallow?.url ?? page.url;
		const requested = url.searchParams.get('tab');
		untrack(() => selectTab(isTab(requested) ? requested : 'overview', false));
	});

	/** Unsaved generic file edits: confirm before leaving this server page in-app. */
	const leaveGuard = new LeaveGuard({
		isDirty: () => filesDirty && !removed,
		proceed: (target) => {
			if (target.type === 'popstate' && target.delta) history.go(target.delta);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- SvelteKit supplied this resolved destination.
			else void goto(target.href);
		}
	});
	afterNavigate(() => leaveGuard.settled());

	beforeNavigate((navigation) => {
		if (removed || navigation.willUnload) return;
		if (navigation.to?.url.pathname === page.url.pathname) return;
		// Tab switches keep the editor mounted; leaving the instance discards it.
		if (leaveGuard.intercept(navigation)) return;
		if (propertiesPending && propertiesEditor && navigation.to) {
			navigation.cancel();
			if (leavingAfterAutosave) return;
			leavingAfterAutosave = true;
			const destination = navigation.to.url.href;
			void propertiesEditor
				.flushPending()
				.then(async (saved) => {
					if (!saved) {
						selectTab('properties');
						toast.error('Properties could not be saved. Resolve the error before leaving.');
						return;
					}
					await tick();
					// eslint-disable-next-line svelte/no-navigation-without-resolve -- SvelteKit supplied this resolved destination.
					await goto(destination);
				})
				.finally(() => {
					leavingAfterAutosave = false;
				});
		}
	});

	function selectTab(requested: string, updateUrl = true) {
		if (!isTab(requested)) return;
		const next: TabValue =
			isArchived(controller.server) && LOCAL_TABS.includes(requested) ? 'overview' : requested;
		if (next !== tab) {
			const from = TABS.findIndex((t) => t.value === tab);
			const to = TABS.findIndex((t) => t.value === next);
			tabDirection = to >= from ? 1 : -1;
			tab = next;
		}
		if (next === 'files') filesVisited = true;
		if (next === 'properties') propertiesVisited = true;
		if (next === 'exports') exportsVisited = true;
		if (updateUrl) {
			const current = page.shallow?.url ?? page.url;
			const url = new URL(current.href);
			if (next === 'overview') url.searchParams.delete('tab');
			else url.searchParams.set('tab', next);
			if (url.href !== current.href) {
				// SvelteKit supplied this same-server URL; shallow changes keep editors mounted.
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				void goto(url, { shallow: true, replace: true, reset: false, state: page.state });
			}
		}
	}

	// Becoming archived (here or elsewhere) leaves local tabs; their components unmount.
	$effect(() => {
		if (archived && LOCAL_TABS.includes(tab)) untrack(() => selectTab('overview'));
	});

	/** Archive catalog for the archived overview (pinned restore point details). */
	let catalog = $state.raw<ExportRecord[] | null>(null);
	let catalogError = $state.raw<unknown>(null);
	let catalogAbort: AbortController | null = null;
	async function loadCatalog() {
		catalogAbort?.abort();
		const abort = (catalogAbort = new AbortController());
		catalogError = null;
		try {
			const id = controller.server.id;
			const { items } = await listExports({ signal: abort.signal });
			if (!abort.signal.aborted) catalog = items.filter((e) => e.serverId === id);
		} catch (error) {
			if (!isAbortError(error) && !abort.signal.aborted) catalogError = error;
		}
	}
	$effect(() => () => catalogAbort?.abort());
	// Loaded on entry while archived and after each observed export/archive/restore.
	$effect(() => {
		void serverId;
		void controller.exportsVersion;
		if (!archived) return;
		untrack(() => {
			catalog = null;
			void loadCatalog();
		});
	});
	const pinned = $derived(
		catalogError || catalog === null
			? undefined
			: (catalog.find((e) => e.id === server.archive?.exportId) ?? null)
	);

	let restoreOpen = $state(false);
	async function onRestore(exportId: string) {
		restoreOpen = false;
		const job = await controller.restore(exportId);
		if (job?.state === 'succeeded') {
			toast.success(`Restored ${controller.server.name}`, {
				description: controller.server.acceptEula
					? 'It stays stopped until you start it.'
					: 'It stays stopped. Accept the Minecraft EULA before starting.'
			});
		}
	}

	async function onRemoveLocal(exportId: string) {
		// Unsaved browser edits would be lost with the local files.
		if (filesDirty || propertiesPending) return;
		const job = await controller.archive(exportId);
		if (job?.state === 'succeeded') {
			toast.success(`Removed local files of ${controller.server.name}`, {
				description: 'It stays listed and can be restored from its S3 backup.'
			});
		}
	}

	const removeBlocked = $derived(
		filesDirty
			? 'Save or discard the unsaved file edits in Files first.'
			: propertiesPending
				? 'Wait for the pending properties to save.'
				: null
	);

	function exportSelected() {
		selectionFocus += 1;
		selectTab('exports');
	}

	function editNetwork() {
		networkFocus += 1;
		selectTab('settings');
	}

	function editResources() {
		resourcesFocus += 1;
		selectTab('settings');
	}

	function editLaunch() {
		launchFocus += 1;
		selectTab('settings');
	}

	let eulaOpen = $state(false);
	let consoleKey = $state(0);
	/** Delete job in flight; the record must not be refreshed meanwhile. */
	let deleting = $state(false);
	/** Set once the delete job succeeded: the record no longer exists, so stop all requests. */
	let removed = $state(false);

	const labels: Record<ServerAction, string> = {
		start: 'Starting',
		stop: 'Stopping',
		restart: 'Restarting',
		kill: 'Killing'
	};

	// Container status can change underneath us (exit, crash, external stop).
	$effect(() => {
		const id = server.id;
		const abort = new AbortController();
		untrack(() =>
			poll(
				async () => {
					if (removed || deleting) return;
					if (!controller.busy && controller.server.id === id) {
						await controller.refresh();
						if (tab === 'properties' && !isArchived(controller.server))
							await propertiesEditor?.refreshMetadata();
					}
				},
				{ intervalMs: 5000, immediate: false, signal: abort.signal }
			)
		);
		return () => abort.abort();
	});

	async function onAction(action: ServerAction) {
		const target = server.id;
		if ((action === 'start' || action === 'restart') && propertiesPending && propertiesEditor) {
			if (!(await propertiesEditor.flushPending())) {
				selectTab('properties');
				toast.error('Save the pending properties before starting or restarting.');
				return;
			}
		}
		if (server.id !== target) return;
		const job = await controller.run(action);
		if (job?.state === 'succeeded' && server.id === target)
			await propertiesEditor?.refreshMetadata();
		consoleKey += 1;
		if (job?.state === 'succeeded') toast.success(`${actionDone[action]} ${server.name}`);
	}

	const actionDone: Record<ServerAction, string> = {
		start: 'Started',
		stop: 'Stopped',
		restart: 'Restarted',
		kill: 'Killed'
	};

	async function setEula(accepted: boolean) {
		if (await controller.acceptEula(accepted)) {
			toast.success(accepted ? 'EULA accepted' : 'EULA acceptance revoked');
		}
	}

	async function onInstall(options: InstallOptions | null) {
		const job = await controller.install(options);
		if (job?.state === 'succeeded') toast.success(`Installed ${server.name}`);
	}

	async function onDeleted(deleted: DeletedServer) {
		if (removed || deleted.id !== server.id) return;
		removed = true;
		controller.destroy();
		const name = server.name;
		toast.success(`Deleted ${name}`, {
			description: deleted.filesDeleted
				? 'Its world and server files were deleted.'
				: deleted.retainedDirectory
					? `Files kept on the manager host at ${deleted.retainedDirectory}`
					: 'Its files were kept on the manager host.'
		});
		await goto(resolve('servers'), { replaceState: true, invalidateAll: true });
	}

	function dismissCreated() {
		goto(resolve(`servers/${server.id}`), { replaceState: true });
	}

	// The selected server owns the app top bar while this page is mounted.
	useTopbarContent(header);

	const errorKind = $derived(errorCode(controller.error));
	const jarPath = $derived(`${server.directory.replace(/[\\/]+$/, '')}/${server.jar}`);
</script>

{#snippet header()}
	<div class="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
		<div class="flex min-w-0 items-center gap-2">
			<ServerAvatar {server} class="size-6 rounded-md max-sm:hidden" iconClass="size-3.5" />
			<h1 class="truncate text-base font-semibold tracking-tight" title={server.name}>
				{server.name}
			</h1>
			{#if archived}
				<Badge variant="secondary" title="Local files removed; restorable from its S3 backup">
					<CloudIcon aria-hidden="true" />Archived
				</Badge>
			{:else if game.active && server.status.state === 'running' && readiness.state !== null}
				<!-- Game readiness replaces the bare container state once a status ping answered. -->
				<ReadinessBadge {readiness} compact />
			{:else}
				<StatusBadge state={server.status.state} compact />
			{/if}
		</div>
		<p
			class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground max-md:hidden"
			role="status"
		>
			{#if controller.busy && controller.job && controller.action}
				<Spinner class="size-3" />
				<span class="truncate"
					>{controller.automaticLifecycle === 'recover'
						? 'Restarting after a crash'
						: controller.automaticLifecycle === 'auto_start'
							? 'Starting automatically'
							: labels[controller.action]}… job {controller.job.state}</span
				>
			{:else if controller.deleteActive}
				<Spinner class="size-3" />
				<span class="truncate">Deleting… job {controller.deleteJob?.state}</span>
			{:else if controller.installing}
				<Spinner class="size-3" />
				<span class="truncate">Installing… job {controller.installJob?.state}</span>
			{:else if controller.exportActive}
				<Spinner class="size-3" />
				<span class="truncate"
					>{controller.exportScheduled ? 'Scheduled backup' : 'Exporting'}… job {controller
						.exportJob?.state}</span
				>
			{:else if controller.backupActive}
				<Spinner class="size-3" />
				<span class="truncate"
					>{controller.backupOp === 'restore' ? 'Restoring' : 'Removing local files'}… job {controller
						.backupJob?.state ?? 'requested'}</span
				>
			{:else}
				{#if softwareSummary}<span class="truncate">{softwareSummary}</span>{/if}
				{#if liveUsage}
					<!-- Live readings only: hidden when stopped, paused, hidden-tab stale or failed. -->
					<span
						class="shrink-0 font-mono tabular-nums"
						data-testid="header-usage"
						title="Current CPU (of one core) and container memory working set"
					>
						{softwareSummary ? '· ' : ''}CPU {formatCpu(liveUsage.cpuPercent)} · RAM {formatBytes(
							liveUsage.memoryBytes
						)}
					</span>
				{/if}
			{/if}
		</p>
	</div>
	<div class="flex shrink-0 items-center gap-1.5">
		{#if archived}
			<Button
				size="sm"
				disabled={controller.busy || removed}
				onclick={() => (restoreOpen = true)}
				aria-label={`Restore ${server.name}`}
			>
				{#if controller.backupActive}<Spinner data-icon="inline-start" />{:else}<ArchiveRestoreIcon
						data-icon="inline-start"
					/>{/if}
				<span class="max-sm:hidden">Restore</span>
			</Button>
		{:else}
			<ServerActions
				compact
				serverState={server.status.state}
				busy={controller.busy || deleting || removed || exportBusy}
				pending={controller.action}
				startBlocked={notInstalled}
				{onAction}
			/>
		{/if}
	</div>
{/snippet}

{#if archived}
	<!-- No creation/install notices for an archived record: nothing local exists. -->
{:else if created && software}
	<Alert.Root>
		<InfoIcon />
		<Alert.Title>{notInstalled ? 'Server created' : 'Server installed'}</Alert.Title>
		<Alert.Description class="flex flex-col gap-2">
			<p>
				{notInstalled
					? 'Install its software below before the first start.'
					: 'The software is installed. The server was not started.'}
			</p>
			{#if !server.acceptEula}
				<p>Accept the Minecraft EULA in Settings before the first start.</p>
			{/if}
		</Alert.Description>
		<Button
			variant="ghost"
			size="icon-xs"
			class="absolute top-2.5 right-2.5"
			onclick={dismissCreated}
			aria-label="Dismiss"
		>
			<XIcon />
		</Button>
	</Alert.Root>
{:else if created}
	<Alert.Root>
		<InfoIcon />
		<Alert.Title>Copy your server JAR before starting</Alert.Title>
		<Alert.Description class="flex flex-col gap-2">
			<p>
				The manager does not download custom server software. Upload
				<code class="font-mono">{server.jar}</code> in
				<button
					type="button"
					class="underline underline-offset-4"
					onclick={() => selectTab('files')}>Files</button
				>, or place it on the manager host at:
			</p>
			<CopyText value={jarPath} label="Copy JAR path" />
			{#if !server.acceptEula}
				<p>Accept the Minecraft EULA in Settings before the first start.</p>
			{/if}
		</Alert.Description>
		<Button
			variant="ghost"
			size="icon-xs"
			class="absolute top-2.5 right-2.5"
			onclick={dismissCreated}
			aria-label="Dismiss"
		>
			<XIcon />
		</Button>
	</Alert.Root>
{/if}

{#if !archived && software && (notInstalled || controller.installJob)}
	<ServerInstallPanel
		{software}
		job={controller.installJob}
		error={controller.installError}
		working={controller.installWorking}
		installed={!notInstalled}
		disabled={controller.busy || server.status.state === 'running'}
		onInstall={notInstalled ? onInstall : undefined}
		packName={packInfo.pack?.name ?? null}
	/>
{/if}

{#snippet activityLink(id: string | null)}
	{#if id}
		<a
			href={resolve(`activity/${id}`)}
			class="mt-1 inline-block text-xs underline underline-offset-4"
			data-testid="error-activity-link">Job details in Activity</a
		>
	{/if}
{/snippet}

{#if controller.recoveryError}
	<ErrorAlert
		error={controller.recoveryError}
		hint="Running installs, starts, stops, exports, archives or restores of this server could not be checked. They may still be running."
	>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<Button
				size="sm"
				variant="outline"
				disabled={controller.recovering}
				onclick={() => controller.recover()}>Check again</Button
			>
			<button
				type="button"
				class="text-xs underline underline-offset-4"
				onclick={() => selectTab('activity')}>Open Activity</button
			>
		</div>
	</ErrorAlert>
{/if}

{#if controller.error}
	{#if errorKind === 'server.jar_missing'}
		<ErrorAlert
			error={controller.error}
			hint={`Upload ${server.jar} in Files (or copy it into the server directory on the manager host), then start again.`}
		>
			<div class="mt-2"><CopyText value={jarPath} label="Copy JAR path" /></div>
		</ErrorAlert>
	{:else if errorKind === 'server.launch_missing'}
		<ErrorAlert error={controller.error}>
			<div class="mt-2 flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onclick={() => selectTab('files')}>Open Files</Button>
				<Button size="sm" variant="outline" onclick={editLaunch}>Launch settings</Button>
			</div>
		</ErrorAlert>
	{:else if errorKind === 'server.eula_required'}
		<ErrorAlert error={controller.error} hint="Accept the Minecraft EULA, then start again.">
			<Button size="sm" variant="outline" class="mt-2" onclick={() => (eulaOpen = true)}>
				Review EULA
			</Button>
		</ErrorAlert>
	{:else}
		<ErrorAlert error={controller.error}>{@render activityLink(controller.errorJobId)}</ErrorAlert>
	{/if}
{/if}

<Tabs.Root bind:value={() => tab, selectTab} class="gap-6">
	<Tabs.List
		variant="line"
		class="scrollbar-none w-full justify-start gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-none border-b border-border"
	>
		{#each visibleTabs as item (item.value)}
			<Tabs.Trigger
				value={item.value}
				class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]"
			>
				<item.icon data-icon="inline-start" aria-hidden="true" />
				{item.label}
				{#if (item.value === 'files' && filesDirty) || (item.value === 'properties' && propertiesPending)}
					<span class="size-1.5 rounded-full bg-warning" aria-label="Unsaved changes"></span>
				{:else if item.value === 'exports' && (exportBusy || controller.backupActive)}
					<Spinner class="size-3" aria-label="Export running" />
				{/if}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
	<Tabs.Content value="overview">
		{#if tab === 'overview'}
			<Reveal preset="step" direction={tabDirection} class="flex flex-col gap-6">
				{#if archived}
					<ServerArchivedPanel
						{server}
						{pinned}
						{catalogError}
						onRetryCatalog={loadCatalog}
						working={controller.backupActive && controller.backupOp === 'restore'}
						disabled={controller.busy}
						job={controller.backupOp === 'restore' ? controller.backupJob : null}
						error={controller.backupOp === 'restore' ? controller.backupError : null}
						onRestore={() => (restoreOpen = true)}
						onOpenExports={() => selectTab('exports')}
					/>
				{:else}
					<ServerOverview
						{server}
						{metrics}
						pack={packInfo.pack}
						busy={controller.busy || deleting || removed}
						onRequestEula={() => (eulaOpen = true)}
						onOpenConsole={() => selectTab('console')}
						onOpenResources={editResources}
						opsRefreshKey={`${server.status.state}:${controller.busy}:${exportBusy}`}
						onOpenExports={() => selectTab('exports')}
						onOpenActivity={() => selectTab('activity')}
						onOpenProperties={() => selectTab('properties')}
						{game}
						onOpenSettings={() => selectTab('settings')}
					/>
				{/if}
			</Reveal>
		{/if}
	</Tabs.Content>
	<Tabs.Content value="console">
		{#if tab === 'console' && !archived}
			<Reveal preset="step" direction={tabDirection}>
				<ServerConsole
					serverId={server.id}
					serverName={server.name}
					{running}
					refreshKey={consoleKey}
				/>
			</Reveal>
		{/if}
	</Tabs.Content>
	<Tabs.Content value="players">
		{#if tab === 'players' && !archived}
			<Reveal preset="step" direction={tabDirection}>
				{#key server.id}
					<ServerPlayers
						serverId={server.id}
						serverState={server.status.state}
						busy={controller.busy || deleting || removed || exportBusy}
						onOpenFiles={() => selectTab('files')}
						onOpenProperties={() => selectTab('properties')}
					/>
				{/key}
			</Reveal>
		{/if}
	</Tabs.Content>
	<Tabs.Content value="properties">
		{#if propertiesVisited && !archived}
			{#key server.id}
				<ServerProperties
					bind:this={propertiesEditor}
					serverId={server.id}
					serverState={server.status.state}
					bind:pending={propertiesPending}
					onEditNetwork={editNetwork}
				/>
			{/key}
		{/if}
	</Tabs.Content>
	<Tabs.Content value="files">
		{#if filesVisited && !archived}
			{#key server.id}
				<ServerFiles
					serverId={server.id}
					serverState={server.status.state}
					bind:dirty={filesDirty}
					onOpenProperties={() => selectTab('properties')}
					onExportSelected={exportSelected}
				/>
			{/key}
		{/if}
	</Tabs.Content>
	<Tabs.Content value="exports">
		{#if exportsVisited}
			{#key server.id}
				<ServerExports
					serverId={server.id}
					serverState={server.status.state}
					busy={controller.busy || deleting || removed}
					bind:exporting
					recoveredJob={controller.exportJob}
					recoveredError={controller.exportError}
					archivesVersion={controller.exportsVersion}
					{selectionFocus}
					onChooseFiles={archived ? undefined : () => selectTab('files')}
					serverName={server.name}
					archive={server.archive ?? null}
					{removeBlocked}
					backupJob={controller.backupJob}
					backupWorking={controller.backupActive}
					backupError={controller.backupError}
					backupOp={controller.backupOp}
					{onRemoveLocal}
					onRestore={(id) => void onRestore(id)}
				/>
			{/key}
		{/if}
	</Tabs.Content>
	<Tabs.Content value="activity">
		{#if tab === 'activity'}
			<Reveal preset="step" direction={tabDirection}>
				{#key server.id}
					<ActivityView initial={null} servers={null} serverId={server.id} />
				{/key}
			</Reveal>
		{/if}
	</Tabs.Content>
	<Tabs.Content value="settings">
		{#if tab === 'settings'}
			<Reveal preset="step" direction={tabDirection}>
				<ServerSettings
					{server}
					busy={controller.busy || deleting || removed}
					onRequestEula={() => (eulaOpen = true)}
					onRevokeEula={() => setEula(false)}
					onServerUpdated={(updated) => controller.apply(updated)}
					onOpenProperties={() => selectTab('properties')}
					{networkFocus}
					onNetworkFocused={() => (networkFocus = 0)}
					{launchFocus}
					onLaunchFocused={() => (launchFocus = 0)}
					{resourcesFocus}
					onResourcesFocused={() => (resourcesFocus = 0)}
					{archived}
				>
					{#snippet danger()}
						<div class="flex flex-col items-end gap-1">
							<DeleteServerDialog
								{server}
								disabled={controller.busy ||
									removed ||
									propertiesPending ||
									filesDirty ||
									exportBusy}
								bind:deleting
								ondeleted={onDeleted}
							/>
							{#if removeBlocked}
								<span class="text-xs text-muted-foreground">{removeBlocked}</span>
							{:else if exportBusy || controller.busy}
								<span class="text-xs text-muted-foreground"
									>Wait for the running task to finish.</span
								>
							{/if}
						</div>
					{/snippet}
				</ServerSettings>
			</Reveal>
		{/if}
	</Tabs.Content>
</Tabs.Root>

<EulaDialog bind:open={eulaOpen} onAccept={() => setEula(true)} />

<RestoreDialog
	exportId={restoreOpen ? (server.archive?.exportId ?? null) : null}
	record={pinned ?? null}
	name={server.name}
	state="archived"
	onConfirm={(id) => void onRestore(id)}
	onCancel={() => (restoreOpen = false)}
/>

<UnsavedChangesDialog
	open={leaveGuard.pending !== null}
	title="Leave with unsaved file changes?"
	description="Your edits in the Files editor have not been saved. Leaving this server discards them."
	stayLabel="Stay"
	discardLabel="Discard and leave"
	onStay={() => leaveGuard.stay()}
	onDiscard={() => leaveGuard.discard()}
/>
