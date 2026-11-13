<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="overflow-hidden rounded-lg border border-border bg-card">
	{@render children()}
</div>
