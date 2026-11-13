<script lang="ts">
	import ContainerIcon from '@lucide/svelte/icons/container';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import BlocksIcon from '@lucide/svelte/icons/blocks';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import {
		CopyText,
		SettingsPanel,
		SettingsSection,
		StatusBadge
	} from '#lib/components/app/index.js';
	import { formatCpus, formatMemory } from '#lib/format.js';
	import { describeSoftware, needsInstall } from '#lib/servers/software.js';
	import type { ServerView } from '#lib/api/index.js';

	interface Props {
		server: ServerView;
		busy: boolean;
		onRequestEula: () => void;
		onRevokeEula: () => void;
	}

	let { server, busy, onRequestEula, onRevokeEula }: Props = $props();
	const stopped = $derived(server.status.state === 'stopped');
	const software = $derived(server.software ? describeSoftware(server.software) : null);
	const launch = $derived(server.launch ?? null);
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
					{@render value('Minecraft', launch.version)}
					{#if launch.build}{@render value('Build', launch.build)}{/if}
					{@render value('Java', `Java ${launch.javaMajor}`)}
				</div>
				{@render value('Launch file', launch.path, true)}
				{@render value('SHA-256', launch.checksum, true)}
			{/if}
		</SettingsSection>
	{/if}

	<SettingsSection
		title="Directory"
		description={software
			? 'Managed directory on the manager host, mounted at /data in the container.'
			: 'Managed directory on the manager host, mounted at /data in the container. Copy the server JAR here.'}
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

	<SettingsSection
		title="Network"
		description="Host port published for container port 25565/TCP on CHUNKYARD_DOCKER__PUBLISH_IP (loopback by default). Other servers may share this port, but only one of them can run at a time."
		icon={NetworkIcon}
	>
		{@render value('Game port', String(server.port))}
	</SettingsSection>

	<SettingsSection title="Resources" description="Java heap bounds and CPU limit." icon={CpuIcon}>
		<div class="grid gap-4 sm:grid-cols-3">
			{@render value('Min heap', formatMemory(server.memoryMinMb))}
			{@render value('Max heap', formatMemory(server.memoryMaxMb))}
			{@render value('CPU limit', formatCpus(server.cpus))}
		</div>
		<p class="text-xs text-muted-foreground">Resource settings cannot be edited yet.</p>
	</SettingsSection>

	<SettingsSection
		title="Minecraft EULA"
		description="Required before the server can start. Can only be changed while the server is stopped."
		icon={ScaleIcon}
	>
		<Field.Field orientation="horizontal" data-disabled={!stopped || busy ? true : undefined}>
			<Switch
				id="eula-switch"
				bind:checked={
					() => server.acceptEula, (checked) => (checked ? onRequestEula() : onRevokeEula())
				}
				disabled={!stopped || busy}
			/>
			<Field.Label for="eula-switch" class="font-normal">
				{server.acceptEula ? 'EULA accepted' : 'EULA not accepted'}
			</Field.Label>
		</Field.Field>
		{#if !stopped}
			<Field.Description>Stop the server to change EULA acceptance.</Field.Description>
		{/if}
	</SettingsSection>
</SettingsPanel>
