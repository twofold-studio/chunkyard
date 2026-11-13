<script lang="ts">
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import FileCogIcon from '@lucide/svelte/icons/file-cog';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { SettingsPanel, SettingsSection } from '#lib/components/app/index.js';
	import ServerNetwork from './server-network.svelte';
	import type { ServerView } from '#lib/api/index.js';

	interface Props {
		server: ServerView;
		busy: boolean;
		onRequestEula: () => void;
		onRevokeEula: () => void;
		/** Opens server.properties in the Files editor. */
		onEditProperties: () => void;
		onServerUpdated: (server: ServerView) => void;
	}

	let { server, busy, onRequestEula, onRevokeEula, onEditProperties, onServerUpdated }: Props =
		$props();
	const stopped = $derived(server.status.state === 'stopped');
</script>

<SettingsPanel>
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

	<ServerNetwork {server} {busy} {onServerUpdated} />

	<SettingsSection
		title="server.properties"
		description="Minecraft's own settings: MOTD, difficulty, game mode, whitelist, view distance and more. Edited as text; changes apply on the next start."
		icon={FileCogIcon}
	>
		<div class="flex flex-wrap items-center gap-3">
			<Button variant="outline" size="sm" onclick={onEditProperties}>
				{stopped ? 'Edit server.properties' : 'View server.properties'}
				<ArrowRightIcon data-icon="inline-end" />
			</Button>
			<span class="text-sm text-muted-foreground">
				Chunkyard creates this file with the instance; Minecraft fills in its remaining defaults on
				the first start.
			</span>
		</div>
	</SettingsSection>
</SettingsPanel>
