<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import { cn } from '#lib/utils.js';
	import { serverIconUrl } from '#lib/servers/icons.js';
	import type { ServerView } from '#lib/api/index.js';
	import SoftwareLogo from './software-logo.svelte';

	interface Props {
		server: Pick<ServerView, 'icon' | 'software'>;
		class?: string;
		/** Lucide icon size class for the generic fallback. */
		iconClass?: string;
	}

	let { server, class: className, iconClass = 'size-[18px]' }: Props = $props();

	// Preserve custom/pack icons; bundled software marks fill the remaining avatars.
	const url = $derived(serverIconUrl(server));
	let failedFor = $state<string | null>(null);
	const showImage = $derived(url !== null && failedFor !== url);
</script>

<span
	class={cn(
		'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-muted-foreground',
		className
	)}
	aria-hidden="true"
	data-slot="server-avatar"
	data-source={showImage
		? (server.icon?.source ?? 'modpack')
		: server.software
			? 'software'
			: 'generic'}
>
	{#if showImage}
		<img
			src={url}
			alt=""
			class="size-full object-cover"
			decoding="async"
			referrerpolicy="same-origin"
			onerror={() => (failedFor = url)}
		/>
	{:else if server.software}
		<SoftwareLogo kind={server.software.type} class="size-7" />
	{:else}
		<ServerIcon class={iconClass} />
	{/if}
</span>
