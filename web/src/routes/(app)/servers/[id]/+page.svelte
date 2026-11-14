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
		useTopbarContent
	} from '#lib/components/app/index.js';
	import ServerActions from '#lib/components/servers/server-actions.svelte';
	import ServerConsole from '#lib/components/servers/server-console.svelte';
	import ServerMetrics from '#lib/components/servers/server-metrics.svelte';
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
	import ServerExports from '#lib/components/exports/server-exports.svelte';
	import ServerProperties from '#lib/components/properties/server-properties.svelte';
	import EulaDialog from '#lib/components/servers/eula-dialog.svelte';
	import DeleteServerDialog from '#lib/components/servers/delete-server-dialog.svelte';
	import ServerInstallPanel from '#lib/components/servers/server-install-panel.svelte';
	import { needsInstall, softwareHeadline } from '#lib/servers/software.js';
	import {
		errorCode,
		type DeletedServer,
		type InstallOptions,
		type ServerAction,
		type ServerView
	} from '#lib/api/index.js';
	import { ServerController } from '#lib/servers/server-controller.svelte.js';
	import { poll } from '#lib/polling.js';
	import { formatMemoryRange } from '#lib/format.js';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const controller = new ServerController(untrack(() => data.server) as ServerView);
	// Navigating between servers reuses this component: swap the tracked record.
	$effect.pre(() => {
		const next = data.server;
		if (next && untrack(() => controller.server.id) !== next.id) controller.reset(next);
	});
	$effect(() => () => controller.destroy());

	const server = $derived(controller.server);
	const running = $derived(server.status.state === 'running');
	const created = $derived(page.url.searchParams.has('created'));
	const software = $derived(server.software ?? null);
	const notInstalled = $derived(needsInstall(server));
	const softwareSummary = $derived(softwareHeadline(server));

	const TABS = [
		{ value: 'overview', label: 'Overview', icon: LayoutDashboardIcon },
		{ value: 'console', label: 'Console', icon: TerminalIcon },
		{ value: 'properties', label: 'Properties', icon: FileCogIcon },
		{ value: 'files', label: 'Files', icon: FolderTreeIcon },
		{ value: 'exports', label: 'Exports', icon: ArchiveIcon },
		{ value: 'settings', label: 'Settings', icon: SlidersIcon }
	] as const;
	type TabValue = (typeof TABS)[number]['value'];
	const isTab = (value: string | null): value is TabValue => TABS.some((t) => t.value === value);

	const initialTab = page.url.searchParams.get('tab');
	let tab = $state<TabValue>(isTab(initialTab) ? initialTab : 'overview');
	/** Files stays mounted after the first visit so editor changes survive tab switches. */
	let filesVisited = $state(initialTab === 'files');
	let filesDirty = $state(false);
	/** Properties stays mounted after its first visit so its view and history survive tab switches. */
	let propertiesVisited = $state(initialTab === 'properties');
	/** Exports stays mounted after its first visit so a running export keeps its progress. */
	let exportsVisited = $state(initialTab === 'exports');
	/** An export job holds the instance lock until compression/upload finishes. */
	let exporting = $state(false);
	/** Properties autosave is queued or in flight (flushed on unmount, never prompted). */
	let propertiesPending = $state(false);
	let propertiesEditor = $state<{
		flushPending(): Promise<boolean>;
		refreshMetadata(): Promise<void>;
	} | null>(null);
	let leavingAfterAutosave = false;
	/** Bumped to expand and scroll to Settings → Network. */
	let networkFocus = $state(0);
	/** Bumped to expand and scroll to Settings → Launch. */
	let launchFocus = $state(0);
	let tabDirection = $state<1 | -1>(1);

	beforeNavigate((navigation) => {
		if (removed || navigation.willUnload) return;
		if (navigation.to?.url.pathname === page.url.pathname) return;
		// Tab switches keep the editor mounted; leaving the instance discards it.
		if (filesDirty && !window.confirm('Leave this server and discard unsaved file changes?')) {
			navigation.cancel();
			return;
		}
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

	function selectTab(next: string) {
		if (!isTab(next) || next === tab) return;
		const from = TABS.findIndex((t) => t.value === tab);
		const to = TABS.findIndex((t) => t.value === next);
		tabDirection = to >= from ? 1 : -1;
		tab = next;
		if (next === 'files') filesVisited = true;
		if (next === 'properties') propertiesVisited = true;
		if (next === 'exports') exportsVisited = true;
	}

	function editNetwork() {
		networkFocus += 1;
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
						if (tab === 'properties') await propertiesEditor?.refreshMetadata();
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
		if (deleted.id !== server.id) return;
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
			<h1 class="truncate text-base font-semibold tracking-tight" title={server.name}>
				{server.name}
			</h1>
			<StatusBadge state={server.status.state} compact />
		</div>
		<p
			class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground max-md:hidden"
			role="status"
		>
			{#if controller.busy && controller.job && controller.action}
				<Spinner class="size-3" />
				<span class="truncate">{labels[controller.action]}… job {controller.job.state}</span>
			{:else}
				<span class="truncate">
					{#if softwareSummary}{softwareSummary} ·
					{/if}Port {server.port} · {formatMemoryRange(server.memoryMinMb, server.memoryMaxMb)}
				</span>
			{/if}
		</p>
	</div>
	<div class="flex shrink-0 items-center gap-1.5">
		<ServerActions
			compact
			serverState={server.status.state}
			busy={controller.busy || deleting || removed || exporting}
			pending={controller.action}
			startBlocked={notInstalled}
			{onAction}
		/>
		<DeleteServerDialog
			compact
			{server}
			disabled={controller.busy || removed || propertiesPending || exporting}
			bind:deleting
			ondeleted={onDeleted}
		/>
	</div>
{/snippet}

{#if created && software}
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

{#if software && (notInstalled || controller.installJob)}
	<ServerInstallPanel
		{software}
		job={controller.installJob}
		error={controller.installError}
		working={controller.installWorking}
		installed={!notInstalled}
		disabled={controller.busy || server.status.state === 'running'}
		onInstall={notInstalled ? onInstall : undefined}
	/>
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
		<ErrorAlert error={controller.error} />
	{/if}
{/if}

<Tabs.Root bind:value={() => tab, selectTab} class="gap-6">
	<Tabs.List
		variant="line"
		class="scrollbar-none w-full justify-start gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-none border-b border-border"
	>
		{#each TABS as item (item.value)}
			<Tabs.Trigger
				value={item.value}
				class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]"
			>
				<item.icon data-icon="inline-start" aria-hidden="true" />
				{item.label}
				{#if (item.value === 'files' && filesDirty) || (item.value === 'properties' && propertiesPending)}
					<span class="size-1.5 rounded-full bg-warning" aria-label="Unsaved changes"></span>
				{:else if item.value === 'exports' && exporting}
					<Spinner class="size-3" aria-label="Export running" />
				{/if}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
	<Tabs.Content value="overview">
		{#if tab === 'overview'}
			<Reveal preset="step" direction={tabDirection} class="flex flex-col gap-6">
				<ServerMetrics serverId={server.id} serverState={server.status.state} cpus={server.cpus} />
				<ServerOverview {server} onEditNetwork={editNetwork} />
			</Reveal>
		{/if}
	</Tabs.Content>
	<Tabs.Content value="console">
		{#if tab === 'console'}
			<Reveal preset="step" direction={tabDirection}>
				<ServerConsole serverId={server.id} {running} refreshKey={consoleKey} />
			</Reveal>
		{/if}
	</Tabs.Content>
	<Tabs.Content value="properties">
		{#if propertiesVisited}
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
		{#if filesVisited}
			{#key server.id}
				<ServerFiles
					serverId={server.id}
					serverState={server.status.state}
					bind:dirty={filesDirty}
					onOpenProperties={() => selectTab('properties')}
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
				/>
			{/key}
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
				/>
			</Reveal>
		{/if}
	</Tabs.Content>
</Tabs.Root>

<EulaDialog bind:open={eulaOpen} onAccept={() => setEula(true)} />
