<script lang="ts">
	import PlugIcon from '@lucide/svelte/icons/plug';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import BotIcon from '@lucide/svelte/icons/bot';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import { untrack } from 'svelte';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import {
		CopyText,
		PageHeader,
		SettingsPanel,
		SettingsSection
	} from '#lib/components/app/index.js';
	import ApiKeys from '#lib/components/integrations/api-keys.svelte';
	import { mcpEndpoint, claudeCodeCommand } from '#lib/integrations.js';
	import { INTEGRATIONS_TABS, parseTab, type IntegrationsTab } from '#lib/navigation/palette.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const endpoint = $derived(mcpEndpoint(page.url.origin));
	const command = $derived(claudeCodeCommand(endpoint));

	const ICONS = { 'api-keys': KeyRoundIcon, mcp: BotIcon } as const;

	let tab = $state<IntegrationsTab>(parseTab(INTEGRATIONS_TABS, page.url.searchParams.get('tab')));

	// Palette links and history navigation select the tab named in the query.
	$effect(() => {
		const url = page.shallow?.url ?? page.url;
		const requested = parseTab(INTEGRATIONS_TABS, url.searchParams.get('tab'));
		untrack(() => (tab = requested));
	});

	function selectTab(next: string) {
		const value = parseTab(INTEGRATIONS_TABS, next);
		tab = value;
		const current = page.shallow?.url ?? page.url;
		const url = new URL(current.href);
		if (value === INTEGRATIONS_TABS[0][0]) url.searchParams.delete('tab');
		else url.searchParams.set('tab', value);
		if (url.href !== current.href) {
			// Same page; a shallow entry keeps a newly created key's one-time secret on screen.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(url, { shallow: true, replace: true, reset: false, state: page.state });
		}
	}
</script>

<svelte:head><title>Integrations · Chunkyard</title></svelte:head>

<PageHeader
	title="Integrations"
	icon={PlugIcon}
	description="API keys let scripts and AI clients use the REST API and the MCP endpoint without a browser session."
/>

<Tabs.Root bind:value={() => tab, selectTab} class="gap-4">
	<Tabs.List
		variant="line"
		class="scrollbar-none w-full justify-start gap-4 overflow-x-auto overflow-y-hidden rounded-none border-b border-border"
	>
		{#each INTEGRATIONS_TABS as [value, label] (value)}
			{@const Icon = ICONS[value]}
			<Tabs.Trigger {value} class="flex-none px-1 group-data-horizontal/tabs:after:bottom-[-4px]">
				<Icon data-icon="inline-start" aria-hidden="true" />{label}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>

	<!-- Both panels stay mounted (inactive ones are hidden) so a just-created key survives a tab switch. -->
	<Tabs.Content value="api-keys">
		<SettingsPanel>
			<SettingsSection
				title="API keys"
				icon={KeyRoundIcon}
				description="Send a key as Authorization: Bearer on each request. Keys are managed only from a signed-in browser (or a trusted auth-disabled setup), never with another key."
			>
				<ApiKeys />
			</SettingsSection>

			<SettingsSection
				title="REST API"
				icon={BookOpenIcon}
				description="Every route is described in the API reference, which is readable without signing in."
			>
				<p class="text-xs text-muted-foreground">
					Requests use the same base path as this page (<code class="font-mono"
						>{page.url.origin}/api/v1</code
					>). Authenticate scripts with an API key from the list above.
				</p>
				<div>
					<a
						href={resolve('api-docs')}
						class="text-sm underline underline-offset-4 hover:text-foreground"
						>Open the API reference</a
					>
				</div>
			</SettingsSection>
		</SettingsPanel>
	</Tabs.Content>

	<Tabs.Content value="mcp">
		<SettingsPanel>
			<SettingsSection
				title="MCP server"
				icon={BotIcon}
				description="Streamable HTTP for MCP clients that let you set a custom Authorization header."
			>
				<div class="flex flex-col gap-1.5">
					<span class="text-xs font-medium text-muted-foreground">Endpoint</span>
					<CopyText value={endpoint} label="Copy MCP endpoint" />
				</div>
				<div class="flex flex-col gap-1.5">
					<span class="text-xs font-medium text-muted-foreground">Claude Code</span>
					<CopyText value={command} label="Copy Claude Code command" />
					<p class="text-xs text-muted-foreground">
						Replace <code class="font-mono">YOUR_API_KEY</code> with a key from the
						<button
							type="button"
							class="underline underline-offset-4 hover:text-foreground"
							onclick={() => selectTab('api-keys')}>API keys</button
						>
						tab in your own terminal; the key is never filled in here. Treat the resulting client configuration
						as a credential.
					</p>
				</div>
				<p class="text-xs text-muted-foreground">
					Works with clients that send headers directly (Claude Code, MCP SDKs, other HTTP clients).
					Browser connectors that require an OAuth sign-in are not supported. Tools follow the same
					rules as the web UI: file changes need a stopped server, installs never start a server or
					accept the EULA.
				</p>
			</SettingsSection>
		</SettingsPanel>
	</Tabs.Content>
</Tabs.Root>
