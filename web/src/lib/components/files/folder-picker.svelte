<script lang="ts">
	import FolderIcon from '@lucide/svelte/icons/folder';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import HouseIcon from '@lucide/svelte/icons/house';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LockIcon from '@lucide/svelte/icons/lock';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		isAbortError,
		listFiles,
		type DirectoryListing,
		type FileEntry
	} from '#lib/api/index.js';
	import {
		breadcrumbs,
		destinationFolderError,
		parentPath,
		ROOT,
		sortEntries,
		type Relocation
	} from '#lib/files/paths.js';

	interface Props {
		serverId: string;
		/** Folder being browsed, which is also the chosen destination. */
		path: string;
		/** Entry being moved/copied; its own subtree is never offered as a destination. */
		source?: Relocation | null;
		/** Latest listing of `path` (or `null` while loading or after an error). */
		listing?: DirectoryListing | null;
		disabled?: boolean;
	}

	let {
		serverId,
		path = $bindable(ROOT),
		source = null,
		listing = $bindable(null),
		disabled = false
	}: Props = $props();

	let loading = $state(true);
	let error = $state.raw<unknown>(null);
	let nonce = $state(0);

	// One request per folder; navigating again aborts the previous request and any
	// late answer is ignored, so a slow folder never replaces the one now shown.
	$effect(() => {
		const id = serverId;
		const dir = path;
		void nonce;
		const abort = new AbortController();
		untrack(() => {
			loading = true;
			error = null;
			listing = null;
		});
		listFiles(id, dir, { signal: abort.signal }).then(
			(result) => {
				if (abort.signal.aborted) return;
				listing = result;
				loading = false;
			},
			(cause) => {
				if (abort.signal.aborted || isAbortError(cause)) return;
				error = cause;
				loading = false;
			}
		);
		return () => abort.abort();
	});

	const crumbs = $derived(breadcrumbs(path));
	const folders = $derived(
		listing
			? sortEntries(
					listing.entries.filter((e) => e.kind === 'directory'),
					'name',
					'asc'
				)
			: []
	);
	const hiddenCount = $derived(listing ? listing.entries.length - folders.length : 0);

	function blockedReason(entry: FileEntry): string | null {
		if (entry.readOnly) return 'Protected';
		if (source && destinationFolderError(source, entry.path)) {
			return entry.path === source.from ? 'Item being moved' : 'Inside the item being moved';
		}
		return null;
	}

	function go(next: string) {
		if (disabled) return;
		if (next === path) nonce += 1;
		else path = next;
	}
</script>

<div class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background/40">
	<div class="flex items-center gap-1 border-b border-border px-1.5 py-1">
		<Button
			variant="ghost"
			size="icon-xs"
			onclick={() => go(ROOT)}
			disabled={disabled || path === ROOT}
			aria-label="Server root"
		>
			<HouseIcon />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			onclick={() => go(parentPath(path))}
			disabled={disabled || path === ROOT}
			aria-label="Up one folder"
		>
			<ArrowUpIcon />
		</Button>
		<nav aria-label="Destination folder path" class="min-w-0 flex-1 overflow-x-auto">
			<ol class="flex items-center gap-0.5 text-xs whitespace-nowrap text-muted-foreground">
				{#each crumbs as crumb, index (crumb.path)}
					{#if index > 0}<li aria-hidden="true">/</li>{/if}
					<li class="shrink-0">
						{#if index === crumbs.length - 1}
							<span aria-current="location" class="px-1 font-medium text-foreground"
								>{crumb.name}</span
							>
						{:else}
							<button
								type="button"
								class="max-w-28 truncate rounded-sm px-1 transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none"
								onclick={() => go(crumb.path)}
								{disabled}
							>
								{crumb.name}
							</button>
						{/if}
					</li>
				{/each}
			</ol>
		</nav>
		<Button
			variant="ghost"
			size="icon-xs"
			onclick={() => (nonce += 1)}
			disabled={disabled || loading}
			aria-label="Refresh folders"
		>
			<RefreshCwIcon class={loading ? 'animate-spin' : undefined} />
		</Button>
	</div>

	<div class="h-52 overflow-y-auto" aria-busy={loading}>
		{#if loading}
			<div class="flex flex-col gap-1.5 p-2" data-testid="folder-picker-loading">
				{#each [0, 1, 2, 3] as row (row)}
					<Skeleton class="h-7 w-full" />
				{/each}
			</div>
		{:else if error}
			<div class="flex flex-col gap-2 p-2">
				<ErrorAlert {error} />
				<div class="flex gap-2">
					<Button size="xs" variant="outline" onclick={() => (nonce += 1)}>Retry</Button>
					{#if path !== ROOT}
						<Button size="xs" variant="ghost" onclick={() => go(ROOT)}>Go to server root</Button>
					{/if}
				</div>
			</div>
		{:else if listing}
			{#if folders.length === 0}
				<p class="px-3 py-6 text-center text-xs text-muted-foreground">
					No subfolders here. You can still {source ? 'choose' : 'use'} this folder.
				</p>
			{:else}
				<ul class="flex flex-col p-1" aria-label="Subfolders">
					{#each folders as folder (folder.path)}
						{@const blocked = blockedReason(folder)}
						<li>
							<button
								type="button"
								class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
								aria-disabled={blocked || disabled ? true : undefined}
								aria-label={blocked
									? `${folder.name} (${blocked.toLowerCase()})`
									: `Open ${folder.name}`}
								title={blocked ?? folder.path}
								onclick={() => {
									if (!blocked) go(folder.path);
								}}
							>
								<FolderIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<span class="min-w-0 flex-1 truncate">{folder.name}</span>
								{#if blocked}
									{#if folder.readOnly}<LockIcon class="size-3 shrink-0" aria-hidden="true" />{/if}
									<span class="shrink-0 text-[11px] text-muted-foreground">{blocked}</span>
								{:else}
									<ChevronRightIcon
										class="size-3.5 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>

	{#if listing && (listing.truncated || hiddenCount > 0)}
		<p class="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
			{#if listing.truncated}
				Listing stopped after the first {listing.entries.length} entries; some folders may be missing.
				Type a path to reach them.
			{:else}
				{hiddenCount} {hiddenCount === 1 ? 'file is' : 'files are'} not shown.
			{/if}
		</p>
	{/if}
</div>
