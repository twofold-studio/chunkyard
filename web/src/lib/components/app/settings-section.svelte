<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		icon?: Component;
		children: Snippet;
		/** Extra description content (links, code) rendered under the description. */
		aside?: Snippet;
	}

	let { title, description, icon: Icon, children, aside }: Props = $props();
</script>

<section
	class="grid gap-4 border-b border-border px-5 py-6 last:border-b-0 sm:px-6 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:gap-10"
>
	<div class="flex gap-3">
		{#if Icon}<Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{/if}
		<div class="flex min-w-0 flex-col gap-1">
			<h2 class="text-sm font-medium">{title}</h2>
			{#if description}<p class="text-sm text-muted-foreground">{description}</p>{/if}
			{@render aside?.()}
		</div>
	</div>
	<div class="flex min-w-0 flex-col gap-3">
		{@render children()}
	</div>
</section>
