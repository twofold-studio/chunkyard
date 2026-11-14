<script lang="ts">
	import HistoryIcon from '@lucide/svelte/icons/history';
	import { untrack } from 'svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { isAbortError, type PropertiesVersionSummary } from '#lib/api/index.js';
	import type { PropertiesStore } from '#lib/properties/properties-store.svelte.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		store: PropertiesStore;
		/** Version shown read-only, or null for the current editable text. */
		selected: number | null;
		onSelect: (version: number | null) => void;
	}

	let { store, selected, onSelect }: Props = $props();

	const PAGE = 50;
	let items = $state.raw<PropertiesVersionSummary[]>([]);
	let nextBefore = $state<number | null>(null);
	let loading = $state(false);
	let error = $state.raw<unknown>(null);

	const latest = $derived(store.doc?.version ?? null);
	const applied = $derived(store.doc?.appliedVersion ?? null);

	// Reload the first page whenever a new version is saved.
	$effect(() => {
		void latest;
		const abort = new AbortController();
		untrack(() => load(null, abort.signal));
		return () => abort.abort();
	});

	async function load(before: number | null, signal?: AbortSignal) {
		loading = true;
		error = null;
		try {
			const page = await store.api.listPropertiesVersions(
				store.serverId,
				{ limit: PAGE, before },
				{ signal }
			);
			items = before === null ? page.items : [...items, ...page.items];
			nextBefore = page.nextBefore;
		} catch (cause) {
			if (!isAbortError(cause)) error = cause;
		} finally {
			if (!signal?.aborted) loading = false;
		}
	}

	const SOURCE: Record<PropertiesVersionSummary['source'], string> = {
		import: 'Imported',
		edit: 'Edited',
		restore: 'Restored'
	};

	function when(iso: string): string {
		const date = new Date(iso);
		return Number.isNaN(date.getTime())
			? iso
			: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<section
	class="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
	aria-label="Version history"
>
	<h3 class="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
		<HistoryIcon class="size-4 text-muted-foreground" aria-hidden="true" />
		Versions
	</h3>
	{#if error}
		<div class="p-3">
			<ErrorAlert {error}>
				<Button size="sm" variant="outline" class="mt-2" onclick={() => load(null)}>Retry</Button>
			</ErrorAlert>
		</div>
	{:else if items.length === 0 && loading}
		<div class="flex flex-col gap-2 p-3"><Skeleton class="h-8" /><Skeleton class="h-8" /></div>
	{:else}
		<ol class="max-h-96 overflow-y-auto">
			{#each items as item (item.version)}
				{@const isLatest = item.version === latest}
				<li>
					<button
						type="button"
						class={cn(
							'motion-press flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border px-4 py-2 text-left text-sm last:border-b-0 hover:bg-accent/40',
							(selected === item.version || (selected === null && isLatest)) && 'bg-accent'
						)}
						aria-current={selected === item.version || (selected === null && isLatest)
							? 'true'
							: undefined}
						onclick={() => onSelect(isLatest ? null : item.version)}
					>
						<span class="font-mono font-medium">v{item.version}</span>
						{#if isLatest}<Badge variant="outline">Latest</Badge>{/if}
						{#if item.version === applied}<Badge variant="success">Running</Badge>{/if}
						<span class="w-full text-xs text-muted-foreground">
							{SOURCE[item.source] ?? item.source} · {when(item.createdAt)}
						</span>
					</button>
				</li>
			{/each}
		</ol>
		{#if nextBefore !== null}
			<Button
				variant="ghost"
				size="sm"
				class="m-1"
				disabled={loading}
				onclick={() => load(nextBefore)}
			>
				{#if loading}<Spinner data-icon="inline-start" />{/if}
				Older versions
			</Button>
		{/if}
	{/if}
</section>
