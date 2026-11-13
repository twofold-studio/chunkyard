<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		icon?: Component;
		/** Small right-aligned text such as a count. */
		meta?: string;
		actions?: Snippet;
	}

	let { title, description, icon: Icon, meta, actions }: Props = $props();
</script>

<header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
	<div class="flex min-w-0 flex-col gap-1.5">
		<h1 class="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
			{#if Icon}<Icon class="size-[18px] text-muted-foreground" aria-hidden="true" />{/if}
			{title}
		</h1>
		{#if description}
			<p class="max-w-2xl text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	<div class="flex shrink-0 items-center gap-3">
		{#if meta}<span class="text-xs text-muted-foreground">{meta}</span>{/if}
		{@render actions?.()}
	</div>
</header>
