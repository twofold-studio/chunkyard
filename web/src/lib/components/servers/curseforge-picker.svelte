<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CheckIcon from '@lucide/svelte/icons/check';
	import * as Field from '#lib/components/ui/field/index.js';
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
	import { formatDownloads, safeCurseForgeUrl } from '#lib/servers/software.js';
	import PackLogo from './pack-logo.svelte';

	interface Props {
		/** Selected pack, or null. */
		pack: CurseForgeModpack | null;
		/** Selected release file ID, or null. */
		fileId: number | null;
		disabled?: boolean;
		/** The selected release, kept for summaries after this picker unmounts. */
		release?: CurseForgeFile | null;
		/** Debounce before a search request; injected small in tests. */
		debounceMs?: number;
		/**
		 * A release was picked with a plain pointer click (not keyboard arrows or a modified
		 * click). The wizard may continue; keyboard users confirm with Enter/Next.
		 */
		onReleasePicked?: () => void;
	}

	let {
		pack = $bindable(),
		fileId = $bindable(),
		release = $bindable(null),
		disabled = false,
		debounceMs = 350,
		onReleasePicked
	}: Props = $props();
	const uid = $props.id();

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
	// Keep the parent's summary in step once the release list is known.
	$effect(() => {
		if (files !== null) release = selectedFile;
	});

	/** True for a deliberate pointer click: keyboard-synthesised clicks report `detail === 0`. */
	function plainClick(event: MouseEvent): boolean {
		return (
			event.detail > 0 &&
			event.button === 0 &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.shiftKey &&
			!event.altKey
		);
	}

	function pickRelease(event: MouseEvent, file: CurseForgeFile) {
		if (disabled || !plainClick(event)) return;
		// The label click precedes the radio change; select explicitly, then continue.
		fileId = file.id;
		release = file;
		onReleasePicked?.();
	}

	function gameVersions(file: CurseForgeFile): string {
		return file.gameVersions.slice(0, 4).join(', ');
	}
</script>

{#snippet packLink(item: CurseForgeModpack, extra = '')}
	{@const href = safeCurseForgeUrl(item.websiteUrl)}
	{#if href}
		<!-- External https CurseForge link vetted by safeCurseForgeUrl, not an app route. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			{href}
			target="_blank"
			rel="noreferrer noopener"
			class={cn(
				'inline-flex items-center gap-1 rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
				extra
			)}
		>
			CurseForge <ExternalLinkIcon class="size-3" aria-hidden="true" />
			<span class="sr-only">page for {item.name} (opens in a new tab)</span>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
{/snippet}

{#snippet downloads(item: CurseForgeModpack)}
	<span class="inline-flex items-center gap-1 text-muted-foreground">
		<DownloadIcon class="size-3" aria-hidden="true" />
		{formatDownloads(item.downloads)}
		<span class="sr-only">downloads</span>
	</span>
{/snippet}

{#if pack}
	<div class="flex flex-col gap-5">
		<div class="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
			<PackLogo src={pack.logoUrl} name={pack.name} />
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<span class="text-sm leading-snug font-medium break-words">{pack.name}</span>
				<span class="line-clamp-2 text-xs text-muted-foreground">{pack.summary}</span>
				<span class="flex flex-wrap items-center gap-x-3 text-xs">
					{@render downloads(pack)}
					{@render packLink(pack)}
				</span>
			</div>
			<Button size="sm" variant="ghost" onclick={changePack} {disabled}>
				<ArrowLeftIcon data-icon="inline-start" />
				Change pack
			</Button>
		</div>

		<fieldset class="flex min-w-0 flex-col gap-2" {disabled}>
			<legend class="mb-1 text-sm font-medium">Release</legend>
			{#if filesError}
				<ErrorAlert error={filesError}>
					<Button size="sm" variant="outline" class="mt-2" onclick={() => (filesNonce += 1)}>
						<RefreshCwIcon data-icon="inline-start" />
						Retry
					</Button>
				</ErrorAlert>
			{:else if files === null}
				<div class="flex flex-col gap-1.5" aria-busy="true">
					{#each { length: 3 }, i (i)}<Skeleton class="h-12 w-full rounded-md" />{/each}
				</div>
			{:else if files.length === 0}
				<p class="text-sm text-muted-foreground">
					No release of this pack ships a server pack, so it cannot be installed. Choose another
					pack.
				</p>
			{:else}
				<div
					class="flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1"
					role="radiogroup"
					aria-label="Release"
				>
					{#each files as file (file.id)}
						{@const selected = file.id === fileId}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (keyboard selection stays native radio behaviour; only pointer clicks continue) -->
						<label
							class={cn(
								'flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background px-3 py-2 transition-colors',
								'hover:border-ring/60 hover:bg-accent/30',
								'has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
								selected && 'border-primary bg-primary/5 hover:border-primary hover:bg-primary/5'
							)}
							onclick={(event) => {
								if (!(event.target instanceof HTMLInputElement)) pickRelease(event, file);
							}}
						>
							<input
								type="radio"
								name={`${uid}-release`}
								class="sr-only"
								value={file.id}
								bind:group={fileId}
								aria-describedby={file.gameVersions.length ? `${uid}-gv-${file.id}` : undefined}
							/>
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="text-sm break-words">{file.name}</span>
								{#if file.gameVersions.length}
									<span id={`${uid}-gv-${file.id}`} class="text-xs text-muted-foreground">
										Minecraft {gameVersions(file)}
									</span>
								{/if}
							</span>
							{#if selected}
								<CheckIcon class="size-4 shrink-0 text-primary" aria-hidden="true" />
							{/if}
						</label>
					{/each}
				</div>
				<Field.Description>
					Newest first. Only releases with a linked server pack are listed; that server pack is what
					gets installed. Some packs need extra settings; a failed install can be retried with
					advanced options.
				</Field.Description>
			{/if}
		</fieldset>
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-1.5">
			<label for="modpack-search" class="text-sm font-medium">Search modpacks</label>
			<p id="modpack-search-help" class="text-xs text-muted-foreground">
				Leave empty to browse popular packs. Choose a pack to see its server releases.
			</p>
			<div class="relative">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					id="modpack-search"
					type="search"
					bind:value={query}
					class="h-10 pl-9"
					placeholder="e.g. All the Mods"
					autocomplete="off"
					spellcheck={false}
					maxlength={100}
					aria-describedby="modpack-search-help"
					{disabled}
				/>
			</div>
		</div>

		<div aria-live="polite" class="flex flex-col gap-3">
			{#if searchError}
				<ErrorAlert error={searchError} />
			{/if}
			{#if trimmed.length > 0 && trimmed.length < MIN_QUERY}
				<p class="text-sm text-muted-foreground">Type at least {MIN_QUERY} characters to search.</p>
			{:else if searching}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
					{#each { length: 6 }, i (i)}<Skeleton class="h-40 w-full rounded-lg" />{/each}
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
				<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Modpack results">
					{#each results as item (item.id)}
						<li
							class={cn(
								'relative flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors',
								'hover:border-ring/60 hover:bg-accent/20',
								'has-[button:focus-visible]:border-ring has-[button:focus-visible]:ring-3 has-[button:focus-visible]:ring-ring/50',
								disabled && 'opacity-60'
							)}
						>
							<div class="flex min-w-0 items-start gap-3">
								<PackLogo src={item.logoUrl} name={item.name} />
								<h3 class="min-w-0 flex-1 text-sm leading-snug font-medium">
									<!-- The title button stretches over the card: one selection target, no nesting. -->
									<button
										type="button"
										class="line-clamp-3 text-left break-words after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none disabled:cursor-not-allowed"
										onclick={() => choose(item)}
										aria-label={`Select ${item.name}`}
										aria-describedby={`${uid}-summary-${item.id}`}
										{disabled}
									>
										{item.name}
									</button>
								</h3>
							</div>
							<p
								id={`${uid}-summary-${item.id}`}
								class="line-clamp-2 text-xs leading-relaxed text-muted-foreground"
							>
								{item.summary}
							</p>
							<div
								class="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-xs"
							>
								{@render downloads(item)}
								<!-- Above the stretched button so it stays its own target. -->
								{@render packLink(item, 'relative z-10')}
							</div>
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
