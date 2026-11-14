<script lang="ts">
	import ContainerIcon from '@lucide/svelte/icons/container';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import BlocksIcon from '@lucide/svelte/icons/blocks';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import {
		CopyText,
		SettingsPanel,
		SettingsSection,
		StatusBadge
	} from '#lib/components/app/index.js';
	import { formatCpus, formatMemory } from '#lib/format.js';
	import { describeSoftware, installedDetails, needsInstall } from '#lib/servers/software.js';
	import type { ServerView } from '#lib/api/index.js';

	interface Props {
		server: ServerView;
		/** Jump to Settings → Network. */
		onEditNetwork?: () => void;
	}

	let { server, onEditNetwork }: Props = $props();
	const launch = $derived(server.launch ?? null);
	const software = $derived(server.software ? describeSoftware(server.software, launch) : null);
	const details = $derived(installedDetails(server));
</script>

{#snippet value(label: string, text: string, mono = false)}
	<div class="flex flex-col gap-0.5">
		<span class="text-xs text-muted-foreground">{label}</span>
		<span class={mono ? 'font-mono text-sm break-all' : 'text-sm'}>{text}</span>
	</div>
{/snippet}

<SettingsPanel>
	<SettingsSection
		title="Status"
		description="Docker container state. A running container does not mean Minecraft has finished starting."
		icon={ActivityIcon}
	>
		<div class="flex flex-wrap items-center gap-3">
			<StatusBadge state={server.status.state} />
			{#if server.status.exitCode !== null}
				<span class="text-sm text-muted-foreground">Last exit code {server.status.exitCode}</span>
			{/if}
			{#if server.status.oomKilled}
				<span class="text-sm text-destructive">Killed: out of memory</span>
			{/if}
		</div>
		{#if server.status.containerId}
			{@render value('Container', server.status.containerId.slice(0, 12), true)}
		{/if}
	</SettingsSection>

	{#if software}
		<SettingsSection
			title="Software"
			description="Installed and verified by the manager. Reinstalling is not supported."
			icon={BlocksIcon}
		>
			<div class="grid gap-4 sm:grid-cols-3">
				{@render value('Type', software.kind)}
				{#if software.detail}{@render value('Selection', software.detail)}{/if}
				{@render value('Status', needsInstall(server) ? 'Not installed' : 'Installed')}
			</div>
			{#if launch}
				<div class="grid gap-4 sm:grid-cols-3">
					{#each details as row (row.label)}{@render value(row.label, row.value)}{/each}
				</div>
				{@render value('Launch file', server.launchOverride?.path ?? launch.path, true)}
				{@render value(
					server.software?.type === 'curseforge' ? 'Server pack SHA-256' : 'SHA-256',
					launch.checksum,
					true
				)}
			{/if}
		</SettingsSection>
	{/if}

	<SettingsSection
		title="Network"
		description="Host port published for the game. Change it, or the bind address, in Settings."
		icon={NetworkIcon}
	>
		<div class="flex flex-wrap items-end gap-4">
			{@render value('Game port', String(server.port))}
			{#if onEditNetwork}
				<button
					type="button"
					class="text-sm underline underline-offset-4 hover:text-foreground"
					onclick={onEditNetwork}
				>
					Network settings
				</button>
			{/if}
		</div>
	</SettingsSection>

	<SettingsSection
		title="Directory"
		description={software
			? 'Managed directory on the manager host, mounted at /data in the container. Browse it in Files.'
			: 'Managed directory on the manager host, mounted at /data in the container. Upload the server JAR in Files or copy it here.'}
		icon={FolderIcon}
	>
		<CopyText value={server.directory} label="Copy directory path" />
		{#if !software}{@render value('Server JAR', server.jar, true)}{/if}
	</SettingsSection>

	<SettingsSection
		title="Runtime"
		description="Docker runtime. Java comes from the image; host Java runtimes are not used by Docker servers."
		icon={ContainerIcon}
	>
		{@render value('Image', server.dockerImage, true)}
		{#if server.autoJava}
			<p class="text-xs text-muted-foreground">Chosen automatically to match the required Java.</p>
		{/if}
	</SettingsSection>

	<SettingsSection title="Resources" description="Java heap bounds and CPU limit." icon={CpuIcon}>
		<div class="grid gap-4 sm:grid-cols-3">
			{@render value('Min heap', formatMemory(server.memoryMinMb))}
			{@render value('Max heap', formatMemory(server.memoryMaxMb))}
			{@render value('CPU limit', formatCpus(server.cpus))}
		</div>
		<p class="text-xs text-muted-foreground">
			Change these in Settings → Resources while the server is stopped.
		</p>
	</SettingsSection>
</SettingsPanel>
