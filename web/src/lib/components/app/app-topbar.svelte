<script lang="ts">
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { Snippet } from 'svelte';
	import type { Crumb } from './types';

	interface Props {
		crumbs?: Crumb[];
		actions?: Snippet;
		/**
		 * Page-provided header content (e.g. the selected server's name, status and
		 * controls). Replaces the last crumb and the default actions while present.
		 */
		context?: Snippet | null;
	}

	let { crumbs = [], actions, context = null }: Props = $props();
	const sidebar = Sidebar.useSidebar();
	const showTrigger = $derived(sidebar.isMobile || !sidebar.open);
	// The page's own title takes the place of the last crumb.
	const trail = $derived(context ? crumbs.slice(0, -1) : crumbs);
</script>

<header
	class="sticky top-0 z-10 flex h-[72px] shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:gap-3 sm:px-6"
>
	{#if showTrigger}
		<Button variant="ghost" size="icon-sm" onclick={sidebar.toggle} aria-label="Open sidebar">
			<PanelLeftIcon />
		</Button>
	{/if}
	{#if trail.length > 0}
		<Breadcrumb.Root class={['min-w-0', context && 'max-sm:hidden']}>
			<Breadcrumb.List class="flex-nowrap">
				{#each trail as crumb, i (crumb.href ?? crumb.label)}
					{#if i > 0}<Breadcrumb.Separator>/</Breadcrumb.Separator>{/if}
					<Breadcrumb.Item class="min-w-0">
						{#if crumb.href && (context || i < trail.length - 1)}
							<Breadcrumb.Link href={crumb.href} class="truncate">{crumb.label}</Breadcrumb.Link>
						{:else}
							<Breadcrumb.Page class="truncate">{crumb.label}</Breadcrumb.Page>
						{/if}
					</Breadcrumb.Item>
				{/each}
				{#if context}<Breadcrumb.Separator>/</Breadcrumb.Separator>{/if}
			</Breadcrumb.List>
		</Breadcrumb.Root>
	{/if}
	{#if context}
		<div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" data-slot="topbar-context">
			{@render context()}
		</div>
	{:else}
		<div class="ml-auto flex items-center gap-2">
			{@render actions?.()}
		</div>
	{/if}
</header>
