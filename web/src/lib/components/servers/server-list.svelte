<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import ServerGrid from './server-grid.svelte';
	import {
		applyView,
		countLabel,
		isFiltered,
		LOCATION_LABELS,
		loadSortPreference,
		saveSortPreference,
		softwareFilterLabel,
		softwareOptions,
		SORT_LABELS,
		STATE_LABELS,
		type LocationFilter,
		type SortKey,
		type StateFilter
	} from '#lib/servers/list-view.js';
	import type { ServerView } from '#lib/api/index.js';
	import type { BackupIndex } from '#lib/exports/backups.js';
	import { isArchived } from '#lib/exports/backups.js';
	import type { BackupOperations } from '#lib/exports/backup-operations.svelte.js';

	interface Props {
		/** The records returned by the current `GET /servers` response. */
		servers: ServerView[];
		createHref: string;
		/** Injected in tests; defaults to `localStorage` when available. */
		storage?: Storage;
		/** Newest full S3 backups (`null` loading, `'error'` failed); omit to hide backup ages. */
		backups?: BackupIndex | null | 'error';
		operations?: BackupOperations;
		onRestore?: (server: ServerView) => void;
		now?: number;
	}

	let { servers, createHref, storage, backups, operations, onRestore, now }: Props = $props();

	const store = () => storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);

	let query = $state('');
	let stateFilter = $state<StateFilter>('all');
	let software = $state('all');
	let location = $state<LocationFilter>('all');
	const anyArchived = $derived(servers.some(isArchived));
	let sort = $state<SortKey>(loadSortPreference(store()));

	const view = $derived({ query, state: stateFilter, software, sort, location });
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
		location = 'all';
	}
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
			<Select.Root type="single" bind:value={stateFilter}>
				<Select.Trigger size="sm" aria-label="Filter by state">
					{stateFilter === 'all' ? 'All states' : STATE_LABELS[stateFilter]}
				</Select.Trigger>
				<Select.Content
					><Select.Group>
						<Select.Item value="all" label="All states" />
						{#each Object.entries(STATE_LABELS) as [value, label] (value)}
							<Select.Item {value} {label} />
						{/each}
					</Select.Group></Select.Content
				>
			</Select.Root>
			{#if anyArchived || location !== 'all'}
				<Select.Root type="single" bind:value={location}>
					<Select.Trigger size="sm" aria-label="Filter by location">
						{location === 'all' ? 'Local and archived' : LOCATION_LABELS[location]}
					</Select.Trigger>
					<Select.Content
						><Select.Group>
							<Select.Item value="all" label="Local and archived" />
							{#each Object.entries(LOCATION_LABELS) as [value, label] (value)}
								<Select.Item {value} {label} />
							{/each}
						</Select.Group></Select.Content
					>
				</Select.Root>
			{/if}
			<Select.Root type="single" bind:value={software}>
				<Select.Trigger size="sm" aria-label="Filter by software">
					{software === 'all' ? 'All software' : softwareFilterLabel(software)}
				</Select.Trigger>
				<Select.Content
					><Select.Group>
						<Select.Item value="all" label="All software" />
						{#each softwareChoices as value (value)}
							<Select.Item {value} label={softwareFilterLabel(value)} />
						{/each}
					</Select.Group></Select.Content
				>
			</Select.Root>
			<Select.Root type="single" value={sort} onValueChange={(next) => setSort(next as SortKey)}>
				<Select.Trigger size="sm" aria-label="Sort servers"
					>Sort: {SORT_LABELS[sort]}</Select.Trigger
				>
				<Select.Content
					><Select.Group>
						{#each Object.entries(SORT_LABELS) as [value, label] (value)}
							<Select.Item {value} {label} />
						{/each}
					</Select.Group></Select.Content
				>
			</Select.Root>
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

<ServerGrid servers={visible} {createHref} {backups} {operations} {onRestore} {now} />
