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
	import ServerConfig from '#lib/components/servers/server-config.svelte';
	import EulaDialog from '#lib/components/servers/eula-dialog.svelte';
	import ServerInstallPanel from '#lib/components/servers/server-install-panel.svelte';
	import { describeSoftware, needsInstall } from '#lib/servers/software.js';
	import { errorCode, type ServerAction, type ServerView } from '#lib/api/index.js';
	import { ServerController } from '#lib/servers/server-controller.svelte.js';
	import { poll } from '#lib/polling.js';
	import { formatMemoryRange } from '#lib/format.js';
	import { goto } from '$app/navigation';
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

	let tab = $state('console');
	let eulaOpen = $state(false);
	let consoleKey = $state(0);

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
	<ServerActions
		serverState={server.status.state}
		busy={controller.busy}
		pending={controller.action}
		startBlocked={notInstalled}
		{onAction}
	/>
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
				<p>Accept the Minecraft EULA in Configuration before the first start.</p>
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
				The manager does not download server software. On the manager host, place
				<code class="font-mono">{server.jar}</code> at:
			</p>
			<CopyText value={jarPath} label="Copy JAR path" />
			{#if !server.acceptEula}
				<p>Accept the Minecraft EULA in Configuration before the first start.</p>
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
			hint={`Copy ${server.jar} into the server directory on the manager host, then start again.`}
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

<ServerMetrics serverId={server.id} serverState={server.status.state} cpus={server.cpus} />

<Tabs.Root bind:value={tab} class="gap-6">
	<Tabs.List variant="line" class="w-full justify-start gap-4 rounded-none border-b border-border">
		<Tabs.Trigger value="console" class="flex-none px-1">Console</Tabs.Trigger>
		<Tabs.Trigger value="configuration" class="flex-none px-1">Configuration</Tabs.Trigger>
	</Tabs.List>
	<Tabs.Content value="console">
		{#if tab === 'console'}
			<ServerConsole serverId={server.id} {running} refreshKey={consoleKey} />
		{/if}
	</Tabs.Content>
	<Tabs.Content value="configuration">
		<ServerConfig
			{server}
			busy={controller.busy}
			onRequestEula={() => (eulaOpen = true)}
			onRevokeEula={() => setEula(false)}
		/>
	</Tabs.Content>
</Tabs.Root>

<EulaDialog bind:open={eulaOpen} onAccept={() => setEula(true)} />
