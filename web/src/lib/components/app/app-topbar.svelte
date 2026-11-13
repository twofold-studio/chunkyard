<script lang="ts">
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { Snippet } from 'svelte';
	import type { Crumb } from './types';

	let { crumbs = [], actions }: { crumbs?: Crumb[]; actions?: Snippet } = $props();
	const sidebar = Sidebar.useSidebar();
	const showTrigger = $derived(sidebar.isMobile || !sidebar.open);
</script>

<header
	class="sticky top-0 z-10 flex h-[72px] shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6"
>
	{#if showTrigger}
		<Button variant="ghost" size="icon-sm" onclick={sidebar.toggle} aria-label="Open sidebar">
			<PanelLeftIcon />
		</Button>
	{/if}
	<Breadcrumb.Root class="min-w-0">
		<Breadcrumb.List class="flex-nowrap">
			{#each crumbs as crumb, i (crumb.href ?? crumb.label)}
				{#if i > 0}<Breadcrumb.Separator>/</Breadcrumb.Separator>{/if}
				<Breadcrumb.Item class="min-w-0">
					{#if crumb.href && i < crumbs.length - 1}
						<Breadcrumb.Link href={crumb.href} class="truncate">{crumb.label}</Breadcrumb.Link>
					{:else}
						<Breadcrumb.Page class="truncate">{crumb.label}</Breadcrumb.Page>
					{/if}
				</Breadcrumb.Item>
			{/each}
		</Breadcrumb.List>
	</Breadcrumb.Root>
	<div class="ml-auto flex items-center gap-2">
		{@render actions?.()}
	</div>
</header>
