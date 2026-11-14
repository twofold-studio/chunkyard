<script lang="ts">
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import OctagonAlertIcon from '@lucide/svelte/icons/octagon-alert';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';
	import {
		describeSoftware,
		installedDetails,
		needsInstall,
		safeCurseForgeUrl
	} from '#lib/servers/software.js';
	import type { CurseForgeModpack, ServerView } from '#lib/api/index.js';
	import type { MetricsSource } from '#lib/servers/metrics-source.svelte.js';
	import ServerAvatar from './server-avatar.svelte';
	import ServerMetrics from './server-metrics.svelte';

	interface Props {
		server: ServerView;
		/** The page's single metrics sampler. */
		metrics: MetricsSource;
		/** CurseForge metadata for this server's pack, when known. */
		pack?: CurseForgeModpack | null;
		onRequestEula?: () => void;
		onOpenConsole?: () => void;
		onOpenResources?: () => void;
		/** Another operation is running. */
		busy?: boolean;
	}

	let {
		server,
		metrics,
		pack = null,
		onRequestEula,
		onOpenConsole,
		onOpenResources,
		busy = false
	}: Props = $props();

	const software = $derived(server.software ?? null);
	const launch = $derived(server.launch ?? null);
	const isPack = $derived(software?.type === 'curseforge');
	const notInstalled = $derived(needsInstall(server));
	const state = $derived(server.status.state);
	const stopped = $derived(state === 'stopped');

	const title = $derived.by(() => {
		if (!software) return 'Custom JAR';
		if (isPack) return pack?.name?.trim() || 'CurseForge modpack';
		return describeSoftware(software, launch).kind;
	});
	const packHref = $derived(isPack && pack ? safeCurseForgeUrl(pack.websiteUrl) : null);

	/** Minecraft, loader, Paper build and Java; launch details live in Settings. */
	const facts = $derived.by(() => {
		const rows = installedDetails(server).filter((row) => row.label !== 'Launch');
		if (rows.length > 0 || !software || isPack) return rows;
		// Not installed yet: the requested selection is still meaningful (never pack IDs).
		const detail = describeSoftware(software, launch).detail;
		return detail ? [{ label: 'Selected', value: detail }] : [];
	});

	const exitCode = $derived(server.status.exitCode);
	const failedExit = $derived(state !== 'running' && exitCode !== null && exitCode !== 0);
</script>

{#snippet caveat(
	tone: 'danger' | 'warning' | 'info',
	text: string,
	action?: () => void,
	label?: string
)}
	<div
		class={cn(
			'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-2.5 text-sm',
			tone === 'danger' && 'border-destructive/30 bg-destructive/10',
			tone === 'warning' && 'border-warning/30 bg-warning/10',
			tone === 'info' && 'border-border bg-card/40 text-muted-foreground'
		)}
		role={tone === 'info' ? undefined : 'status'}
	>
		{#if tone === 'danger'}
			<OctagonAlertIcon class="size-4 shrink-0 text-destructive" aria-hidden="true" />
		{:else if tone === 'warning'}
			<TriangleAlertIcon class="size-4 shrink-0 text-warning" aria-hidden="true" />
		{:else}
			<InfoIcon class="size-4 shrink-0" aria-hidden="true" />
		{/if}
		<span class="min-w-0 flex-1">{text}</span>
		{#if action && label}
			<Button size="xs" variant="outline" onclick={action}>{label}</Button>
		{/if}
	</div>
{/snippet}

<div class="flex flex-col gap-4" data-testid="server-overview">
	<!-- Only conditions that need attention; routine details live in Settings. -->
	{#if server.status.oomKilled}
		{@render caveat(
			'danger',
			'The container was killed for running out of memory. Give it more Server RAM while it is stopped.',
			onOpenResources,
			'Resources'
		)}
	{/if}
	{#if failedExit}
		{@render caveat(
			'danger',
			`The last run exited with code ${exitCode}. Check the console output for the cause.`,
			onOpenConsole,
			'Open console'
		)}
	{/if}
	{#if state === 'unknown'}
		{@render caveat(
			'warning',
			'Container state unknown. Docker may be unavailable; actions can fail until it responds.'
		)}
	{/if}
	{#if !server.acceptEula}
		{@render caveat(
			'warning',
			'The server cannot start until the Minecraft EULA is accepted.',
			stopped && !busy ? onRequestEula : undefined,
			'Review EULA'
		)}
	{/if}
	{#if state === 'running'}
		{@render caveat(
			'info',
			'The container is running. Minecraft may still be loading; the console shows when it is ready.'
		)}
	{/if}

	<section
		class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-card p-4"
		aria-label="Software"
	>
		<ServerAvatar {server} class="size-12 rounded-md" iconClass="size-5" />
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
				<h2 class="min-w-0 text-base leading-snug font-semibold break-words">{title}</h2>
				{#if packHref}
					<!-- External https CurseForge link vetted by safeCurseForgeUrl, not an app route. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={packHref}
						target="_blank"
						rel="noreferrer noopener"
						class="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
					>
						CurseForge <ExternalLinkIcon class="size-3" aria-hidden="true" />
						<span class="sr-only">page for {title} (opens in a new tab)</span>
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
				{#if software}
					<Badge variant={notInstalled ? 'warning' : 'success'}>
						{notInstalled ? 'Not installed' : 'Installed'}
					</Badge>
				{/if}
			</div>
			{#if facts.length > 0 || !software}
				<dl class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
					{#each facts as row (row.label)}
						<div class="flex gap-1.5">
							<dt class="text-muted-foreground">{row.label}</dt>
							<dd>{row.value}</dd>
						</div>
					{/each}
					{#if !software}
						<div class="flex min-w-0 gap-1.5">
							<dt class="text-muted-foreground">JAR</dt>
							<dd class="truncate font-mono">{server.jar}</dd>
						</div>
					{/if}
				</dl>
			{/if}
		</div>
	</section>

	<ServerMetrics source={metrics} cpus={server.cpus} />
</div>
