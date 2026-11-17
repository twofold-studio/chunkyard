<script lang="ts">
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ArrowDownUpIcon from '@lucide/svelte/icons/arrow-down-up';
	import UserIcon from '@lucide/svelte/icons/user';
	import ServerCogIcon from '@lucide/svelte/icons/server-cog';
	import LinkIcon from '@lucide/svelte/icons/link';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { PageHeader, SettingsPanel, SettingsSection } from '#lib/components/app/index.js';
	import {
		formatMetricsInterval,
		isHighFrequency,
		metricsInterval,
		type MetricsIntervalMs
	} from '#lib/metrics-interval.svelte.js';
	import {
		loadSortPreference,
		saveSortPreference,
		SORT_LABELS,
		type SortKey
	} from '#lib/servers/list-view.js';
	import { exportsHref, integrationsHref } from '#lib/navigation/palette.js';
	import { storageTarget } from '#lib/exports/exports.js';
	import { formatBytes } from '#lib/metrics.js';
	import { channelHint, loadVersion, type ShownVersion } from '#lib/version.js';
	import { resolve } from '$app/paths';
	import { formatDate, REFRESH_CHOICES, refreshChoiceLabel, refreshSummary } from './preferences';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const auth = $derived(data.auth);
	const docker = $derived(data.docker);
	const host = $derived(docker?.capacity ?? null);
	const target = $derived(storageTarget(data.storage));

	const store = () => (typeof localStorage === 'undefined' ? undefined : localStorage);
	let sort = $state<SortKey>(loadSortPreference(store()));

	function setSort(next: SortKey) {
		sort = next;
		saveSortPreference(store(), next);
	}

	const refresh = $derived(metricsInterval.ms);
	/** A sub-second rate saved from a server page is shown but not offered here. */
	const highFrequencySaved = $derived(isHighFrequency(refresh));

	let version = $state.raw<ShownVersion | null>(null);
	$effect(() => {
		const controller = new AbortController();
		loadVersion(controller.signal).then(
			(v) => (version = v),
			() => {}
		);
		return () => controller.abort();
	});

	const links = [
		{ label: 'API keys', href: integrationsHref('api-keys'), hint: 'Create or revoke keys' },
		{ label: 'MCP server', href: integrationsHref('mcp'), hint: 'Connect an AI client' },
		{ label: 'S3 storage', href: exportsHref('storage'), hint: 'Backup bucket connection' },
		{ label: 'Exports', href: exportsHref('exports'), hint: 'All backups' },
		{ label: 'Activity', href: resolve('activity'), hint: 'Jobs and history' },
		{ label: 'API reference', href: resolve('api-docs'), hint: 'REST routes' }
	];
</script>

<svelte:head><title>Settings · Chunkyard</title></svelte:head>

<PageHeader
	title="Settings"
	icon={SettingsIcon}
	description="Preferences for this browser, plus read-only details about your account and this manager."
/>

<SettingsPanel>
	<SettingsSection
		title="Live refresh"
		icon={ActivityIcon}
		description="How often CPU and memory readings are requested for running servers."
	>
		{#snippet aside()}
			<Badge variant="outline" class="mt-1 w-fit gap-1"
				><MonitorIcon aria-hidden="true" />This browser only</Badge
			>
		{/snippet}
		<div class="flex flex-wrap items-center gap-3">
			<Select.Root
				type="single"
				value={String(refresh)}
				onValueChange={(next) => metricsInterval.set(Number(next) as MetricsIntervalMs)}
			>
				<Select.Trigger class="w-44" aria-label="Live refresh interval">
					{highFrequencySaved
						? `Every ${formatMetricsInterval(refresh)}`
						: refreshChoiceLabel(refresh)}
				</Select.Trigger>
				<Select.Content>
					{#each REFRESH_CHOICES as option (option)}
						<Select.Item value={String(option)} label={refreshChoiceLabel(option)} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<p class="text-xs text-muted-foreground" aria-live="polite">{refreshSummary(refresh)}</p>
		<p class="text-xs text-muted-foreground">
			Shared by every Chunkyard tab in this browser and also changeable from a server's usage panel.
			Sub-second rates are only available there, per visit.
		</p>
	</SettingsSection>

	<SettingsSection
		title="Server list order"
		icon={ArrowDownUpIcon}
		description="Default sort for the server list. Search and filters always start cleared."
	>
		{#snippet aside()}
			<Badge variant="outline" class="mt-1 w-fit gap-1"
				><MonitorIcon aria-hidden="true" />This browser only</Badge
			>
		{/snippet}
		<Select.Root type="single" value={sort} onValueChange={(next) => setSort(next as SortKey)}>
			<Select.Trigger class="w-44" aria-label="Server list sort order"
				>Sort by {SORT_LABELS[sort].toLowerCase()}</Select.Trigger
			>
			<Select.Content>
				{#each Object.entries(SORT_LABELS) as [value, label] (value)}
					<Select.Item {value} {label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</SettingsSection>

	<SettingsSection title="Account" icon={UserIcon}>
		{#if auth?.mode === 'session'}
			{@const created = formatDate(auth.user.createdAt)}
			<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
				<dt class="text-muted-foreground">Email</dt>
				<dd class="truncate" title={auth.user.email}>{auth.user.email}</dd>
				<dt class="text-muted-foreground">Role</dt>
				<dd class="capitalize">{auth.user.role}</dd>
				{#if created}
					<dt class="text-muted-foreground">Created</dt>
					<dd>{created}</dd>
				{/if}
				<dt class="text-muted-foreground">Sign-in</dt>
				<dd>Email and password</dd>
			</dl>
			<p class="text-xs text-muted-foreground">
				This manager has a single owner. Sign out from the sidebar. Scripts and AI clients use <a
					href={resolve('integrations')}
					class="underline underline-offset-4 hover:text-foreground">API keys</a
				> instead of this session.
			</p>
		{:else}
			<p class="text-sm">Authentication is disabled.</p>
			<p class="text-xs text-muted-foreground">
				The backend runs with <code class="font-mono">CHUNKYARD_AUTH__ENABLED=false</code>, so
				anyone who can reach it has full control. Keep it on a trusted network or behind your own
				access control.
			</p>
		{/if}
	</SettingsSection>

	<SettingsSection
		title="Manager"
		icon={ServerCogIcon}
		description="Read-only. Configured through the backend's environment."
	>
		<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
			{#if version}
				<dt class="text-muted-foreground">Version</dt>
				<dd class="font-mono">
					{version.version}{#if channelHint(version.channel)}<span class="text-muted-foreground">
							· {channelHint(version.channel)}</span
						>{/if}
				</dd>
			{/if}
			<dt class="text-muted-foreground">Docker</dt>
			<dd>
				{#if !docker}
					<span class="text-muted-foreground">Status unavailable</span>
				{:else if docker.available}
					Available{#if docker.version}&nbsp;·&nbsp;<span class="font-mono">{docker.version}</span
						>{/if}
				{:else}
					<span class="text-destructive">Unavailable</span>{#if docker.reason}<span
							class="text-muted-foreground"
						>
							· {docker.reason}</span
						>{/if}
				{/if}
			</dd>
			{#if host && (host.operatingSystem || host.architecture)}
				<dt class="text-muted-foreground">Host</dt>
				<dd>{[host.operatingSystem, host.architecture].filter(Boolean).join(' · ')}</dd>
			{/if}
			{#if host && (host.logicalCpus || host.memoryTotalBytes)}
				<dt class="text-muted-foreground">Capacity</dt>
				<dd class="tabular-nums">
					{[
						host.logicalCpus
							? `${host.logicalCpus} ${host.logicalCpus === 1 ? 'CPU' : 'CPUs'}`
							: '',
						host.memoryTotalBytes ? `${formatBytes(host.memoryTotalBytes)} memory` : ''
					]
						.filter(Boolean)
						.join(' · ')}
				</dd>
			{/if}
			<dt class="text-muted-foreground">S3 storage</dt>
			<dd>
				{#if target}
					<span class="font-mono">{target}</span>
				{:else if data.storage}
					<span class="text-muted-foreground">Not configured</span>
				{:else}
					<span class="text-muted-foreground">Status unavailable</span>
				{/if}
				·
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- exportsHref resolves the route and adds ?tab= -->
				<a href={exportsHref('storage')} class="underline underline-offset-4 hover:text-foreground"
					>{target ? 'Edit' : 'Set up'}</a
				>
			</dd>
		</dl>
	</SettingsSection>

	<SettingsSection title="Shortcuts" icon={LinkIcon} description="Where other settings live.">
		<ul class="grid gap-2 sm:grid-cols-2">
			{#each links as link (link.href)}
				<li>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is built with resolve() above -->
					<a
						href={link.href}
						class="flex flex-col rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
					>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
						<span class="font-medium">{link.label}</span>
						<span class="text-xs text-muted-foreground">{link.hint}</span>
					</a>
				</li>
			{/each}
		</ul>
		<p class="text-xs text-muted-foreground">
			Per-server options (resources, network, launch, backup schedule) are in each server's Settings
			tab.
		</p>
	</SettingsSection>
</SettingsPanel>
