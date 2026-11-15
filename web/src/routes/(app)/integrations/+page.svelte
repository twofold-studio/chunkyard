<script lang="ts">
	import PlugIcon from '@lucide/svelte/icons/plug';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import BotIcon from '@lucide/svelte/icons/bot';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import {
		CopyText,
		PageHeader,
		SettingsPanel,
		SettingsSection
	} from '#lib/components/app/index.js';
	import ApiKeys from '#lib/components/integrations/api-keys.svelte';
	import { mcpEndpoint, claudeCodeCommand } from '#lib/integrations.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const endpoint = $derived(mcpEndpoint(page.url.origin));
	const command = $derived(claudeCodeCommand(endpoint));
</script>

<svelte:head><title>Integrations · Chunkyard</title></svelte:head>

<PageHeader
	title="Integrations"
	icon={PlugIcon}
	description="API keys let scripts and AI clients use the REST API and the MCP endpoint without a browser session."
/>

<SettingsPanel>
	<SettingsSection
		title="API keys"
		icon={KeyRoundIcon}
		description="Send a key as Authorization: Bearer on each request. Keys are managed only from a signed-in browser (or a trusted auth-disabled setup), never with another key."
	>
		<ApiKeys />
	</SettingsSection>

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
				Replace <code class="font-mono">YOUR_API_KEY</code> with a key from above in your own terminal;
				the key is never filled in here. Treat the resulting client configuration as a credential.
			</p>
		</div>
		<p class="text-xs text-muted-foreground">
			Works with clients that send headers directly (Claude Code, MCP SDKs, other HTTP clients).
			Browser connectors that require an OAuth sign-in are not supported. Tools follow the same
			rules as the web UI: file changes need a stopped server, installs never start a server or
			accept the EULA.
		</p>
	</SettingsSection>

	<SettingsSection
		title="REST API"
		icon={BookOpenIcon}
		description="Every route is described in the API reference, which is readable without signing in."
	>
		<div>
			<a
				href={resolve('api-docs')}
				class="text-sm underline underline-offset-4 hover:text-foreground">Open the API reference</a
			>
		</div>
	</SettingsSection>
</SettingsPanel>
