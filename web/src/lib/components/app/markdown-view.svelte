<script lang="ts">
	import type { Block, Inline } from '#lib/markdown.js';

	interface Props {
		blocks: Block[];
	}

	let { blocks }: Props = $props();

	// The surrounding dialog title is the h2; document headings nest below it.
	const TAGS = { 1: 'h3', 2: 'h3', 3: 'h4', 4: 'h5' } as const;
	const HEADING_CLASS = {
		1: 'text-base font-semibold text-foreground',
		2: 'mt-2 border-b border-border pb-2 text-base font-semibold text-foreground',
		3: 'text-xs font-medium tracking-wide text-muted-foreground uppercase',
		4: 'text-sm font-medium text-foreground'
	} as const;
</script>

{#snippet inlines(items: Inline[])}
	{#each items as item, i (i)}
		{#if item.type === 'code'}
			<code class="rounded bg-muted px-1 py-px font-mono text-[0.8125rem] text-foreground"
				>{item.text}</code
			>
		{:else if item.type === 'strong'}
			<strong class="font-semibold text-foreground">{item.text}</strong>
		{:else if item.type === 'link'}
			<!-- External http(s) links only; parseInline drops every other scheme. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={item.href}
				target="_blank"
				rel="noopener noreferrer"
				class="text-foreground underline underline-offset-4 hover:text-foreground/80">{item.text}</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{:else}
			{item.text}
		{/if}
	{/each}
{/snippet}

<div class="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
	{#each blocks as block, i (i)}
		{#if block.type === 'heading'}
			<svelte:element this={TAGS[block.level]} class={HEADING_CLASS[block.level]}>
				{@render inlines(block.inlines)}
			</svelte:element>
		{:else if block.type === 'list'}
			<ul class="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted-foreground/60">
				{#each block.items as item, j (j)}
					<li>{@render inlines(item)}</li>
				{/each}
			</ul>
		{:else if block.type === 'code'}
			<pre
				class="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">{block.text}</pre>
		{:else if block.type === 'rule'}
			<hr class="border-border" />
		{:else}
			<p>{@render inlines(block.inlines)}</p>
		{/if}
	{/each}
</div>
