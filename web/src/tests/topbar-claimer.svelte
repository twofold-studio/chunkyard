<script lang="ts">
	import { useTopbarContent } from '#lib/components/app/topbar-context.svelte.js';

	let { name, busy = false }: { name: string; busy?: boolean } = $props();
	useTopbarContent(header);
</script>

{#snippet header()}
	<h1>{name}</h1>
	<button type="button" disabled={busy}>Start {name}</button>
{/snippet}

<p>Page body for {name}</p>
