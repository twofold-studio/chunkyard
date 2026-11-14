<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { cn } from '#lib/utils.js';
	import {
		isAbortError,
		listCurseForgeFiles,
		searchCurseForgeModpacks,
		sleep,
		type CurseForgeFile,
		type CurseForgeModpack
	} from '#lib/api/index.js';
	import { formatDownloads, monogram, safeCurseForgeUrl } from '#lib/servers/software.js';

	interface Props {
		/** Selected pack, or null. */
		pack: CurseForgeModpack | null;
		/** Selected release file ID, or null. */
		fileId: number | null;
		disabled?: boolean;
		/** Debounce before a search request; injected small in tests. */
		debounceMs?: number;
	}

	let {
		pack = $bindable(),
		fileId = $bindable(),
		disabled = false,
		debounceMs = 350
	}: Props = $props();

	const MIN_QUERY = 2;

	let query = $state('');
	let results = $state.raw<CurseForgeModpack[]>([]);
	let total = $state(0);
	let nextIndex = $state(0);
	let searching = $state(false);
	let loadingMore = $state(false);
	let searchError = $state.raw<unknown>(null);
	let searched = $state('');

	let files = $state.raw<CurseForgeFile[] | null>(null);
	let filesError = $state.raw<unknown>(null);
	let filesNonce = $state(0);

	const trimmed = $derived(query.trim());
	const hasMore = $derived(results.length > 0 && nextIndex < total);

	let moreAbort: AbortController | null = null;

	// Debounced search; each new query aborts the previous request and any pagination.
	$effect(() => {
		const q = trimmed;
		moreAbort?.abort();
		// An empty query lists popular packs; a single character is too broad to search.
		if (q.length > 0 && q.length < MIN_QUERY) {
			searching = false;
			searchError = null;
			results = [];
			total = 0;
			searched = '';
			return;
		}
		const controller = new AbortController();
		searching = true;
		searchError = null;
		(async () => {
			try {
				if (q) await sleep(debounceMs, controller.signal);
				const page = await searchCurseForgeModpacks(q, 0, { signal: controller.signal });
				results = page.items;
				total = page.pagination.totalCount;
				nextIndex = page.pagination.index + page.items.length;
				searched = q;
			} catch (error) {
				if (isAbortError(error)) return;
				searchError = error;
				results = [];
			}
			searching = false;
		})();
		return () => controller.abort();
	});

	$effect(() => () => moreAbort?.abort());

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		const controller = (moreAbort = new AbortController());
		loadingMore = true;
		searchError = null;
		try {
			const page = await searchCurseForgeModpacks(searched, nextIndex, {
				signal: controller.signal
			});
			const seen = new Set(results.map((item) => item.id));
			results = [...results, ...page.items.filter((item) => !seen.has(item.id))];
			nextIndex = page.pagination.index + page.items.length;
			// Stop paging if the backend returns an empty page.
			total = page.items.length === 0 ? results.length : page.pagination.totalCount;
		} catch (error) {
			if (!isAbortError(error)) searchError = error;
		} finally {
			if (moreAbort === controller) {
				loadingMore = false;
				moreAbort = null;
			}
		}
	}

	// Server-pack releases of the selected pack.
	$effect(() => {
		const id = pack?.id;
		void filesNonce;
		files = null;
		filesError = null;
		if (id === undefined) return;
		const controller = new AbortController();
		listCurseForgeFiles(id, { signal: controller.signal }).then(
			({ items }) => {
				files = items;
				if (!items.some((file) => file.id === fileId)) fileId = items[0]?.id ?? null;
			},
			(error) => {
				if (!isAbortError(error)) filesError = error;
			}
		);
		return () => controller.abort();
	});

	function choose(item: CurseForgeModpack) {
		if (pack?.id !== item.id) fileId = null;
		pack = item;
	}

	function changePack() {
		pack = null;
		fileId = null;
	}

	const selectedFile = $derived(files?.find((file) => file.id === fileId) ?? null);
	const fileValue = $derived(fileId === null ? '' : String(fileId));

	function gameVersions(file: CurseForgeFile): string {
		return file.gameVersions.slice(0, 4).join(', ');
	}
</script>

{#snippet packAvatar(item: CurseForgeModpack)}
	<!-- Remote logos are not loaded: the UI's CSP allows only same-origin images. -->
	<span
		class={cn(
			'flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold text-muted-foreground'
		)}
		aria-hidden="true"
	>
		{monogram(item.name)}
	</span>
{/snippet}

{#snippet packMeta(item: CurseForgeModpack)}
	{@const href = safeCurseForgeUrl(item.websiteUrl)}
	<span class="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
		<span class="inline-flex items-center gap-1">
			<DownloadIcon class="size-3" aria-hidden="true" />
			{formatDownloads(item.downloads)}
			<span class="sr-only">downloads</span>
		</span>
		{#if href}
			<!-- External https CurseForge link vetted by safeCurseForgeUrl, not an app route. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				{href}
				target="_blank"
				rel="noreferrer noopener"
				class="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
			>
				CurseForge <ExternalLinkIcon class="size-3" aria-hidden="true" />
				<span class="sr-only">page for {item.name} (opens in a new tab)</span>
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</span>
{/snippet}

{#if pack}
	<div class="flex flex-col gap-4">
		<div class="flex items-start gap-3 rounded-lg border border-border p-3">
			{@render packAvatar(pack)}
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<span class="truncate text-sm font-medium">{pack.name}</span>
				<span class="line-clamp-2 text-xs text-muted-foreground">{pack.summary}</span>
				{@render packMeta(pack)}
			</div>
			<Button size="sm" variant="ghost" onclick={changePack} {disabled}>
				<ArrowLeftIcon data-icon="inline-start" />
				Change
			</Button>
		</div>

		<Field.Field>
			<Field.Label for="modpack-release">Release</Field.Label>
			{#if filesError}
				<ErrorAlert error={filesError}>
					<Button size="sm" variant="outline" class="mt-2" onclick={() => (filesNonce += 1)}>
						<RefreshCwIcon data-icon="inline-start" />
						Retry
					</Button>
				</ErrorAlert>
			{:else if files === null}
				<Skeleton class="h-9 w-full" />
			{:else if files.length === 0}
				<p class="text-sm text-muted-foreground">
					No release of this pack ships a server pack, so it cannot be installed. Choose another
					pack.
				</p>
			{:else}
				<Select.Root
					type="single"
					bind:value={() => fileValue, (value) => (fileId = value ? Number(value) : null)}
					{disabled}
				>
					<Select.Trigger id="modpack-release" class="w-full">
						<span class="truncate">{selectedFile?.name ?? 'Select a release'}</span>
					</Select.Trigger>
					<Select.Content class="max-h-72">
						{#each files as file (file.id)}
							<Select.Item value={String(file.id)} label={file.name}>
								<span class="flex min-w-0 flex-col">
									<span class="truncate">{file.name}</span>
									{#if file.gameVersions.length}
										<span class="text-xs text-muted-foreground">{gameVersions(file)}</span>
									{/if}
								</span>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Field.Description>
					Only releases with a linked server pack are listed; that server pack is what gets
					installed.
					{#if selectedFile?.gameVersions.length}Minecraft {gameVersions(selectedFile)}.{/if}
					Some packs need extra settings; a failed install can be retried with advanced options.
				</Field.Description>
			{/if}
		</Field.Field>
	</div>
{:else}
	<div class="flex flex-col gap-3">
		<Field.Field>
			<Field.Label for="modpack-search">Search modpacks</Field.Label>
			<div class="relative">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					id="modpack-search"
					type="search"
					bind:value={query}
					class="pl-8"
					placeholder="e.g. All the Mods"
					autocomplete="off"
					spellcheck={false}
					maxlength={100}
					{disabled}
				/>
			</div>
		</Field.Field>

		<div aria-live="polite" class="flex flex-col gap-2">
			{#if searchError}
				<ErrorAlert error={searchError} />
			{/if}
			{#if trimmed.length > 0 && trimmed.length < MIN_QUERY}
				<p class="text-sm text-muted-foreground">Type at least {MIN_QUERY} characters to search.</p>
			{:else if searching}
				<div class="flex flex-col gap-2" aria-busy="true">
					{#each { length: 3 }, i (i)}<Skeleton class="h-16 w-full rounded-lg" />{/each}
				</div>
			{:else if !searchError && results.length === 0}
				<p class="text-sm text-muted-foreground">
					{searched ? `No modpacks match “${searched}”.` : 'No modpacks found.'}
				</p>
			{:else if results.length > 0}
				<p class="text-xs text-muted-foreground">
					{#if searched}
						{total.toLocaleString('en')}
						{total === 1 ? 'result' : 'results'}
					{:else}
						Popular modpacks
					{/if}
				</p>
				<ul class="flex flex-col gap-1.5" aria-label="Modpack results">
					{#each results as item (item.id)}
						<li
							class="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:border-ring/60 hover:bg-accent/30"
						>
							{@render packAvatar(item)}
							<div class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="truncate text-sm font-medium">{item.name}</span>
								<span class="line-clamp-2 text-xs text-muted-foreground">{item.summary}</span>
								{@render packMeta(item)}
							</div>
							<Button
								size="sm"
								variant="outline"
								onclick={() => choose(item)}
								{disabled}
								aria-label={`Select ${item.name}`}
							>
								Select
							</Button>
						</li>
					{/each}
				</ul>
				{#if hasMore}
					<Button variant="outline" size="sm" class="self-center" onclick={loadMore} {disabled}>
						{#if loadingMore}<Spinner data-icon="inline-start" />{/if}
						Load more
					</Button>
				{/if}
			{/if}
		</div>
	</div>
{/if}
