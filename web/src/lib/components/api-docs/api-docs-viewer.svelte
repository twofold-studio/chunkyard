<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import OperationCard from './operation-card.svelte';
	import SchemaView from './schema-view.svelte';
	import CodeBlock from './code-block.svelte';
	import {
		countOperations,
		exampleFor,
		filterGroups,
		formatJson,
		groupOperations,
		slug,
		type OpenApiDocument
	} from './openapi';

	let { doc }: { doc: OpenApiDocument } = $props();

	let query = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);
	/** A `#op-…` / `#schema-…` deep link present when the page opened. */
	const deepLink = isDeepLink(decodeURIComponent(location.hash.slice(1)))
		? decodeURIComponent(location.hash.slice(1))
		: undefined;
	/** Ids of expanded operations and schemas. */
	const expanded = new SvelteSet<string>(deepLink ? [deepLink] : []);

	const groups = $derived(groupOperations(doc));
	const visible = $derived(filterGroups(groups, query));
	const total = $derived(countOperations(groups));
	const shown = $derived(countOperations(visible));
	const schemas = $derived(
		Object.entries(doc.components?.schemas ?? {}).sort(([a], [b]) => a.localeCompare(b))
	);
	const schemeEntries = $derived(Object.entries(doc.components?.securitySchemes ?? {}));
	const allVisibleOpen = $derived(
		shown > 0 && visible.every((g) => g.operations.every((op) => expanded.has(op.id)))
	);

	function setOpen(id: string, open: boolean) {
		if (open) expanded.add(id);
		else expanded.delete(id);
	}

	function toggleAll() {
		const open = !allVisibleOpen;
		for (const group of visible) for (const op of group.operations) setOpen(op.id, open);
	}

	/** Opens the operation or schema a same-page link points at before the browser scrolls to it. */
	function revealLinkTarget(event: MouseEvent) {
		const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
		const id = link?.getAttribute('href')?.slice(1);
		if (id && isDeepLink(id)) expanded.add(id);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		event.preventDefault();
		searchInput?.focus();
	}

	function onSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && query) {
			event.preventDefault();
			query = '';
		}
	}

	function isDeepLink(id: string) {
		return id.startsWith('op-') || id.startsWith('schema-');
	}

	// The target only exists once the document has rendered; scroll to it after the first paint.
	$effect(() => {
		if (!deepLink) return;
		const frame = requestAnimationFrame(() =>
			document.getElementById(deepLink)?.scrollIntoView({ block: 'start' })
		);
		return () => cancelAnimationFrame(frame);
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (delegated link handling; links remain keyboard-activatable) -->
<div class="flex flex-col gap-8" onclick={revealLinkTarget}>
	<section
		class="flex flex-col gap-4 rounded-lg border border-border bg-card p-5"
		aria-label="Overview"
	>
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h2 class="text-base font-semibold">{doc.info.title}</h2>
			<span class="font-mono text-xs text-muted-foreground">v{doc.info.version}</span>
			<span class="font-mono text-xs text-muted-foreground">OpenAPI {doc.openapi}</span>
		</div>
		{#if doc.info.summary || doc.info.description}
			<p class="max-w-3xl text-sm whitespace-pre-line text-muted-foreground">
				{doc.info.description ?? doc.info.summary}
			</p>
		{/if}
		{#if schemeEntries.length}
			<div class="flex flex-col gap-2 border-t border-border pt-4">
				<h3
					class="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
				>
					<ShieldCheckIcon class="size-3.5" aria-hidden="true" />
					Authentication
				</h3>
				<ul class="flex flex-col gap-1.5 text-sm">
					{#each schemeEntries as [name, scheme] (name)}
						<li class="flex flex-wrap items-baseline gap-x-2">
							<code class="font-mono text-[13px] font-medium">{name}</code>
							<span class="text-xs text-muted-foreground">
								{scheme.type}{#if scheme.in && scheme.name}
									· {scheme.in} <code class="font-mono">{scheme.name}</code>{/if}{#if scheme.scheme}
									· {scheme.scheme}{/if}
							</span>
							{#if scheme.description}
								<span class="w-full text-muted-foreground">{scheme.description}</span>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="text-xs text-muted-foreground">
					This page reads the API with your current browser session. Requests other than GET must
					also send <code class="font-mono text-foreground/90">X-MCM-CSRF: 1</code> from the same origin.
				</p>
			</div>
		{/if}
	</section>

	<div class="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
		<nav aria-label="API sections" class="min-w-0 lg:sticky lg:top-24 lg:self-start">
			<ul
				class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 text-sm lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
			>
				{#each visible as group (group.id)}
					<li class="shrink-0">
						<a
							href="#{group.id}"
							class="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:border-transparent"
						>
							<span class="truncate">{group.tag}</span>
							<span class="font-mono text-[11px] tabular-nums">{group.operations.length}</span>
						</a>
					</li>
				{/each}
				{#if schemas.length}
					<li class="shrink-0 lg:mt-2 lg:border-t lg:border-border lg:pt-2">
						<a
							href="#schemas"
							class="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:border-transparent"
						>
							<span>Schemas</span>
							<span class="font-mono text-[11px] tabular-nums">{schemas.length}</span>
						</a>
					</li>
				{/if}
			</ul>
		</nav>

		<div class="flex min-w-0 flex-col gap-8">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<div class="relative flex-1">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						bind:ref={searchInput}
						bind:value={query}
						type="search"
						placeholder="Search endpoints by path, method or summary"
						aria-label="Search endpoints"
						aria-keyshortcuts="/"
						autocomplete="off"
						spellcheck={false}
						class="pr-14 pl-8"
						onkeydown={onSearchKeydown}
					/>
					{#if query}
						<Button
							variant="ghost"
							size="icon-xs"
							class="absolute top-1/2 right-1.5 -translate-y-1/2"
							aria-label="Clear search"
							onclick={() => {
								query = '';
								searchInput?.focus();
							}}
						>
							<XIcon />
						</Button>
					{:else}
						<kbd
							class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-border px-1.5 font-mono text-[11px] text-muted-foreground"
							aria-hidden="true">/</kbd
						>
					{/if}
				</div>
				<div class="flex items-center justify-between gap-3 sm:justify-end">
					<span class="text-xs text-muted-foreground tabular-nums" role="status" aria-live="polite">
						{query ? `${shown} of ${total}` : `${total}`} endpoints
					</span>
					<Button variant="outline" size="sm" onclick={toggleAll} disabled={shown === 0}>
						{allVisibleOpen ? 'Collapse all' : 'Expand all'}
					</Button>
				</div>
			</div>

			{#if visible.length === 0}
				<div class="rounded-lg border border-dashed border-border px-6 py-12 text-center">
					<p class="text-sm font-medium">
						{total === 0 ? 'This document has no operations.' : `No endpoints match “${query}”.`}
					</p>
					{#if query}
						<Button variant="link" size="sm" onclick={() => (query = '')}>Clear search</Button>
					{/if}
				</div>
			{/if}

			{#each visible as group (group.id)}
				<section
					id={group.id}
					class="flex scroll-mt-24 flex-col gap-3"
					aria-labelledby="{group.id}-title"
				>
					<div class="flex flex-col gap-1">
						<h2 id="{group.id}-title" class="text-sm font-semibold">{group.tag}</h2>
						{#if group.description}
							<p class="text-sm text-muted-foreground">{group.description}</p>
						{/if}
					</div>
					<div class="flex flex-col gap-2">
						{#each group.operations as op (op.id)}
							<OperationCard
								{doc}
								{op}
								open={expanded.has(op.id)}
								onToggle={(open) => setOpen(op.id, open)}
							/>
						{/each}
					</div>
				</section>
			{/each}

			{#if schemas.length}
				<section
					id="schemas"
					class="flex scroll-mt-24 flex-col gap-3"
					aria-labelledby="schemas-title"
				>
					<div class="flex flex-col gap-1">
						<h2 id="schemas-title" class="text-sm font-semibold">Schemas</h2>
						<p class="text-sm text-muted-foreground">
							Shared request and response models referenced by the operations above.
						</p>
					</div>
					<div class="flex flex-col gap-2">
						{#each schemas as [name, schema] (name)}
							{@const id = `schema-${slug(name)}`}
							<details
								{id}
								open={expanded.has(id)}
								ontoggle={(event) => setOpen(id, event.currentTarget.open)}
								class="group/schema scroll-mt-24 rounded-lg border border-border bg-card"
							>
								<summary
									class="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-2.5 outline-none select-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
								>
									<ChevronRightIcon
										class="size-4 shrink-0 text-muted-foreground transition-transform group-open/schema:rotate-90"
										aria-hidden="true"
									/>
									<code class="font-mono text-[13px] font-medium">{name}</code>
									{#if schema.description}
										<span class="truncate text-sm text-muted-foreground">{schema.description}</span>
									{/if}
								</summary>
								{#if expanded.has(id)}
									{@const example = formatJson(exampleFor(doc, schema))}
									<div class="flex flex-col gap-4 border-t border-border px-4 py-4">
										<SchemaView {doc} {schema} />
										{#if example}<CodeBlock code={example} label="{name} example" />{/if}
									</div>
								{/if}
							</details>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	</div>
</div>
