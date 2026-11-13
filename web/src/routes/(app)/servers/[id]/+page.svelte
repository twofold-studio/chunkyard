<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import InfoIcon from '@lucide/svelte/icons/info';
	import XIcon from '@lucide/svelte/icons/x';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { CopyText, ErrorAlert, StatusBadge } from '#lib/components/app/index.js';
	import ServerActions from '#lib/components/servers/server-actions.svelte';
	import ServerConsole from '#lib/components/servers/server-console.svelte';
	import ServerMetrics from '#lib/components/servers/server-metrics.svelte';
	import ServerOverview from '#lib/components/servers/server-overview.svelte';
	import ServerSettings from '#lib/components/servers/server-settings.svelte';
	import ServerFiles from '#lib/components/files/server-files.svelte';
	import { Reveal } from '#lib/components/motion/index.js';
	import { SERVER_PROPERTIES } from '#lib/files/paths.js';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import FolderTreeIcon from '@lucide/svelte/icons/folder-tree';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import EulaDialog from '#lib/components/servers/eula-dialog.svelte';
	import DeleteServerDialog from '#lib/components/servers/delete-server-dialog.svelte';
	import ServerInstallPanel from '#lib/components/servers/server-install-panel.svelte';
	import { describeSoftware, needsInstall } from '#lib/servers/software.js';
	import {
		errorCode,
		type DeletedServer,
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
	const softwareSummary = $derived(software ? describeSoftware(software) : null);

	const TABS = [
		{ value: 'overview', label: 'Overview', icon: LayoutDashboardIcon },
		{ value: 'console', label: 'Console', icon: TerminalIcon },
		{ value: 'files', label: 'Files', icon: FolderTreeIcon },
		{ value: 'settings', label: 'Settings', icon: SlidersIcon }
	] as const;
	type TabValue = (typeof TABS)[number]['value'];
	const isTab = (value: string | null): value is TabValue => TABS.some((t) => t.value === value);

	const initialTab = page.url.searchParams.get('tab');
	let tab = $state<TabValue>(isTab(initialTab) ? initialTab : 'overview');
	/** Files stays mounted after the first visit so editor changes survive tab switches. */
	let filesVisited = $state(initialTab === 'files');
	let filesDirty = $state(false);
	let openRequest = $state<{ path: string; nonce: number } | null>(null);
	let tabDirection = $state<1 | -1>(1);

	beforeNavigate((navigation) => {
		if (removed || !filesDirty || navigation.willUnload) return;
		if (navigation.to?.url.pathname === page.url.pathname) return;
		// Tab switches keep the editor mounted; leaving the instance discards it.
		if (!window.confirm('Leave this server and discard unsaved file changes?')) navigation.cancel();
	});

	function selectTab(next: string) {
		if (!isTab(next) || next === tab) return;
		const from = TABS.findIndex((t) => t.value === tab);
		const to = TABS.findIndex((t) => t.value === next);
		tabDirection = to >= from ? 1 : -1;
		tab = next;
		if (next === 'files') filesVisited = true;
	}

	function editProperties() {
		openRequest = { path: SERVER_PROPERTIES, nonce: (openRequest?.nonce ?? 0) + 1 };
		selectTab('files');
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
					if (!controller.busy && controller.server.id === id) await controller.refresh();
				},
				{ intervalMs: 5000, immediate: false, signal: abort.signal }
			)
		);
		return () => abort.abort();
	});

	async function onAction(action: ServerAction) {
		const job = await controller.run(action);
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

	async function onInstall() {
		const job = await controller.install();
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

	const errorKind = $derived(errorCode(controller.error));
	const jarPath = $derived(`${server.directory.replace(/[\\/]+$/, '')}/${server.jar}`);
</script>

<header class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
	<div class="flex min-w-0 flex-col gap-1.5">
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="flex min-w-0 items-center gap-2.5 text-lg font-semibold tracking-tight">
				<ServerIcon class="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
				<span class="truncate">{server.name}</span>
			</h1>
			<StatusBadge state={server.status.state} />
		</div>
		<p class="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
			{#if softwareSummary}
				<span class="text-foreground">
					{softwareSummary.kind}{#if softwareSummary.detail}&nbsp;{softwareSummary.detail}{/if}
				</span>
			{/if}
			<span>Docker</span>
			<span class="font-mono">{server.dockerImage}</span>
			<span>Port {server.port}</span>
			<span>{formatMemoryRange(server.memoryMinMb, server.memoryMaxMb)}</span>
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<ServerActions
			serverState={server.status.state}
			busy={controller.busy || deleting || removed}
			pending={controller.action}
			startBlocked={notInstalled}
			{onAction}
		/>
		<DeleteServerDialog
			{server}
			disabled={controller.busy || removed}
			bind:deleting
			ondeleted={onDeleted}
		/>
	</div>
</header>

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

{#if controller.busy && controller.job && controller.action}
	<div class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
		<Spinner />
		{labels[controller.action]}… job {controller.job.state}
	</div>
{:else if running && !controller.error}
	<p class="text-sm text-muted-foreground">
		The container is running. Minecraft may still be starting; watch the console for its “Done”
		message before connecting.
	</p>
{/if}

{#if controller.error}
	{#if errorKind === 'server.jar_missing'}
		<ErrorAlert
			error={controller.error}
			hint={`Upload ${server.jar} in Files (or copy it into the server directory on the manager host), then start again.`}
		>
			<div class="mt-2"><CopyText value={jarPath} label="Copy JAR path" /></div>
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
		class="w-full justify-start gap-4 overflow-x-auto rounded-none border-b border-border"
	>
		{#each TABS as item (item.value)}
			<Tabs.Trigger value={item.value} class="flex-none px-1">
				<item.icon data-icon="inline-start" aria-hidden="true" />
				{item.label}
				{#if item.value === 'files' && filesDirty}
					<span class="size-1.5 rounded-full bg-warning" aria-label="Unsaved changes"></span>
				{/if}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
	<Tabs.Content value="overview">
		{#if tab === 'overview'}
			<Reveal preset="step" direction={tabDirection} class="flex flex-col gap-6">
				<ServerMetrics serverId={server.id} serverState={server.status.state} cpus={server.cpus} />
				<ServerOverview {server} onEditNetwork={() => selectTab('settings')} />
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
	<Tabs.Content value="files">
		{#if filesVisited}
			{#key server.id}
				<ServerFiles
					serverId={server.id}
					serverState={server.status.state}
					{openRequest}
					bind:dirty={filesDirty}
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
					onEditProperties={editProperties}
					onServerUpdated={(updated) => controller.apply(updated)}
				/>
			</Reveal>
		{/if}
	</Tabs.Content>
</Tabs.Root>

<EulaDialog bind:open={eulaOpen} onAccept={() => setEula(true)} />
