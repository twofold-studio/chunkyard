<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import ServerGrid from './server-grid.svelte';
	import {
		applyView,
		countLabel,
		isFiltered,
		loadSortPreference,
		saveSortPreference,
		softwareFilterLabel,
		softwareOptions,
		SORT_LABELS,
		STATE_LABELS,
		type SortKey,
		type StateFilter
	} from '#lib/servers/list-view.js';
	import type { ServerView } from '#lib/api/index.js';

	interface Props {
		/** The records returned by the current `GET /servers` response. */
		servers: ServerView[];
		createHref: string;
		/** Injected in tests; defaults to `localStorage` when available. */
		storage?: Storage;
	}

	let { servers, createHref, storage }: Props = $props();

	const store = () => storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);

	let query = $state('');
	let stateFilter = $state<StateFilter>('all');
	let software = $state('all');
	let sort = $state<SortKey>(loadSortPreference(store()));

	const view = $derived({ query, state: stateFilter, software, sort });
	const filtered = $derived(isFiltered(view));
	const visible = $derived(applyView(servers, view));
	const softwareChoices = $derived(softwareOptions(servers));
	const summary = $derived(countLabel(visible.length, servers.length, filtered));

	function setSort(next: SortKey) {
		sort = next;
		saveSortPreference(store(), next);
	}

	function clearFilters() {
		query = '';
		stateFilter = 'all';
		software = 'all';
	}

	const selectClass =
		'h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';
</script>

{#if servers.length}
	<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" role="search">
		<div class="relative min-w-0 sm:w-64">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				type="search"
				class="h-8 pl-8"
				placeholder="Search name, software, version, port"
				aria-label="Search loaded servers"
				bind:value={query}
				onkeydown={(event) => {
					if (event.key === 'Escape' && query) {
						event.preventDefault();
						query = '';
					}
				}}
			/>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<select class={selectClass} aria-label="Filter by state" bind:value={stateFilter}>
				<option value="all">All states</option>
				{#each Object.entries(STATE_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
			<select class={selectClass} aria-label="Filter by software" bind:value={software}>
				<option value="all">All software</option>
				{#each softwareChoices as value (value)}
					<option {value}>{softwareFilterLabel(value)}</option>
				{/each}
			</select>
			<select
				class={selectClass}
				aria-label="Sort servers"
				value={sort}
				onchange={(event) => setSort(event.currentTarget.value as SortKey)}
			>
				{#each Object.entries(SORT_LABELS) as [value, label] (value)}
					<option {value}>Sort: {label}</option>
				{/each}
			</select>
			{#if filtered}
				<Button variant="ghost" size="sm" onclick={clearFilters}>
					<XIcon aria-hidden="true" />Clear
				</Button>
			{/if}
		</div>
		<p class="text-xs text-muted-foreground sm:ml-auto" aria-live="polite" data-testid="list-count">
			{summary}
		</p>
	</div>
{/if}

{#if servers.length && !visible.length}
	<div
		class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
		role="status"
	>
		<span>No loaded servers match these filters.</span>
		<Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
	</div>
{/if}

<ServerGrid servers={visible} {createHref} />
