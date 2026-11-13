<script lang="ts">
	import { AddTile } from '#lib/components/app/index.js';
	import ServerCard from './server-card.svelte';
	import type { ServerView } from '#lib/api/index.js';

	interface Props {
		servers: ServerView[];
		createHref: string;
	}

	let { servers, createHref }: Props = $props();
</script>

<!-- The create tile always holds the first slot, also when servers exist. -->
<ul
	class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
	aria-label="Servers"
>
	<li class="min-w-0">
		<AddTile
			href={createHref}
			title="Create server"
			description={servers.length
				? 'Add another Vanilla, Paper or custom JAR server.'
				: 'Install Vanilla or Paper, or bring your own server JAR.'}
			class="h-full min-h-36 gap-2 p-4"
		/>
	</li>
	{#each servers as server (server.id)}
		<li class="min-w-0">
			<ServerCard {server} />
		</li>
	{/each}
</ul>
