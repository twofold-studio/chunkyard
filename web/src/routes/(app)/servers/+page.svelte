<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { AddTile, ErrorAlert, PageHeader } from '#lib/components/app/index.js';
	import ServerRow from '#lib/components/servers/server-row.svelte';
	import { listServers } from '#lib/api/index.js';
	import { poll } from '#lib/polling.js';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Seeded by the load function, then refreshed in place while the tab is visible.
	let servers = $derived(data.servers);
	let refreshError = $state<unknown>(null);

	$effect(() => {
		const controller = new AbortController();
		poll(
			async (signal) => {
				servers = (await listServers({ signal })).items;
				refreshError = null;
			},
			{
				intervalMs: 10_000,
				immediate: false,
				signal: controller.signal,
				onError: (error) => (refreshError = error)
			}
		);
		return () => controller.abort();
	});

	const count = $derived(`${servers.length} ${servers.length === 1 ? 'server' : 'servers'}`);
</script>

<PageHeader
	title="Servers"
	icon={ServerIcon}
	description="Minecraft servers running in Docker containers managed by this instance."
	meta={servers.length ? count : undefined}
/>

{#if data.docker && !data.docker.available}
	<Alert.Root variant="warning">
		<TriangleAlertIcon />
		<Alert.Title>Docker is unavailable</Alert.Title>
		<Alert.Description>
			<p>Servers cannot start, stop or show logs until a Linux Docker engine is reachable.</p>
			{#if data.docker.reason}<p class="font-mono text-xs">{data.docker.reason}</p>{/if}
		</Alert.Description>
	</Alert.Root>
{/if}

{#if refreshError}
	<ErrorAlert error={refreshError} />
{/if}

{#if servers.length === 0}
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		<AddTile
			href={resolve('servers/new')}
			title="Create server"
			description="Register a Docker-backed server, then copy your server JAR into its directory."
		/>
	</div>
{:else}
	<ul class="overflow-hidden rounded-lg border border-border bg-card" aria-label="Servers">
		{#each servers as server (server.id)}
			<ServerRow {server} />
		{/each}
	</ul>
{/if}
