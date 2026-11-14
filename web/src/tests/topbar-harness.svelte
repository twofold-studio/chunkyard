<script lang="ts">
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import AppTopbar from '#lib/components/app/app-topbar.svelte';
	import { provideTopbarSlot } from '#lib/components/app/topbar-context.svelte.js';
	import TopbarClaimer from './topbar-claimer.svelte';
	import { resolve } from '$app/paths';

	interface Props {
		/** Server shown by the page, or null for a page without header content. */
		server: { id: string; name: string; busy?: boolean } | null;
	}

	let { server }: Props = $props();
	const slot = provideTopbarSlot();
	const crumbs = $derived([
		{ label: 'Servers', href: '/servers' },
		...(server ? [{ label: server.name, href: `/servers/${server.id}` }] : [])
	]);
</script>

<Sidebar.Provider>
	<Sidebar.Inset>
		<AppTopbar {crumbs} context={slot.content}>
			{#snippet actions()}<a href={resolve('/(app)/servers/new')}>New server</a>{/snippet}
		</AppTopbar>
		{#if server}
			<!-- Like the app layout's Swap, a different server remounts the page. -->
			{#key server?.id}
				<TopbarClaimer name={server?.name ?? ''} busy={server?.busy} />
			{/key}
		{/if}
	</Sidebar.Inset>
</Sidebar.Provider>
