<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { describeError, listServers, type ServerView } from '#lib/api/index.js';
	import {
		createServerSource,
		searchDestinations,
		type Destination
	} from '#lib/navigation/palette.js';
	import { goto } from '$app/navigation';

	interface Props {
		open?: boolean;
		/** Identifies the signed-in session; cached servers are never shown across keys. */
		sessionKey: string;
		/** Injected in tests; defaults to `GET /api/v1/servers`. */
		load?: (signal: AbortSignal) => Promise<ServerView[]>;
		/** Defaults to `goto`, so the unsaved-changes guard and Properties flush still run. */
		navigate?: (href: string) => unknown;
	}

	let {
		open = $bindable(false),
		sessionKey,
		load = async (signal) => (await listServers({ signal })).items,
		// Destinations are built with resolve() in #lib/navigation/palette.ts.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		navigate = (href) => goto(href)
	}: Props = $props();

	const source = createServerSource((signal) => load(signal));
	let servers = $state<ServerView[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let query = $state('');
	let active = $state(0);

	const results = $derived(searchDestinations(servers, query));
	const groups = $derived(
		(['Go to', 'Servers'] as const)
			.map((name) => ({ name, items: results.filter((r) => r.group === name) }))
			.filter((g) => g.items.length)
	);
	/** The highlighted option, kept in range as results shrink. */
	const current = $derived(Math.min(active, Math.max(0, results.length - 1)));
	const listId = 'command-palette-list';
	const optionId = (index: number) => `command-palette-option-${index}`;

	$effect(() => {
		// Reset the cache when the session changes.
		void sessionKey;
		return () => source.clear();
	});

	$effect(() => {
		if (!open) return;
		const key = sessionKey;
		query = '';
		active = 0;
		error = null;
		const cached = source.cached(key);
		servers = cached ?? [];
		if (!cached) {
			loading = true;
			source.fetch(key).then(
				(items) => {
					if (items) servers = items;
					loading = false;
				},
				(failure) => {
					error = describeError(failure).title;
					loading = false;
				}
			);
		}
		return () => {
			source.cancel();
			loading = false;
		};
	});

	function onWindowKeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			open = !open;
		}
	}

	function select(dest: Destination | undefined) {
		if (!dest) return;
		open = false;
		navigate(dest.href);
	}

	function onInputKeydown(event: KeyboardEvent) {
		const count = results.length;
		if (event.key === 'ArrowDown' && count) {
			event.preventDefault();
			active = (current + 1) % count;
		} else if (event.key === 'ArrowUp' && count) {
			event.preventDefault();
			active = (current - 1 + count) % count;
		} else if (event.key === 'Home' && count) {
			event.preventDefault();
			active = 0;
		} else if (event.key === 'End' && count) {
			event.preventDefault();
			active = count - 1;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			select(results[current]);
		}
	}

	$effect(() => {
		if (!open) return;
		document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<Dialog.Root bind:open>
	<Dialog.Content
		class="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
		showCloseButton={false}
	>
		<Dialog.Title class="sr-only">Quick navigation</Dialog.Title>
		<Dialog.Description class="sr-only">
			Search pages and servers. Use the arrow keys to choose and Enter to open.
		</Dialog.Description>
		<div class="flex items-center gap-2 border-b px-3">
			<SearchIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<input
				class="h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				placeholder="Go to page or server…"
				role="combobox"
				aria-label="Search pages and servers"
				aria-expanded="true"
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={results.length ? optionId(current) : undefined}
				autocomplete="off"
				spellcheck="false"
				bind:value={query}
				oninput={() => (active = 0)}
				onkeydown={onInputKeydown}
			/>
			{#if loading}<Spinner
					class="size-4 text-muted-foreground"
					aria-label="Loading servers"
				/>{/if}
		</div>
		<div id={listId} role="listbox" aria-label="Destinations" class="max-h-80 overflow-y-auto p-1">
			{#each groups as group (group.name)}
				<div role="group" aria-label={group.name}>
					<div class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground" aria-hidden="true">
						{group.name}
					</div>
					{#each group.items as dest (dest.id)}
						{@const index = results.indexOf(dest)}
						<div
							id={optionId(index)}
							role="option"
							tabindex="-1"
							aria-selected={index === current}
							class="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
							onpointermove={() => (active = index)}
							onclick={() => select(dest)}
							onkeydown={() => {}}
						>
							<span class="min-w-0 truncate">{dest.label}</span>
							{#if dest.detail}
								<span class="shrink-0 text-xs text-muted-foreground">{dest.detail}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		</div>
		{#if error}
			<p class="border-t px-3 py-2 text-xs text-destructive" role="alert">
				Servers could not be loaded: {error}. Pages are still available.
			</p>
		{/if}
		{#if !results.length && !loading}
			<p class="border-t px-3 py-2 text-xs text-muted-foreground" role="status">
				No pages or loaded servers match “{query}”.
			</p>
		{/if}
		<p class="hidden border-t px-3 py-1.5 text-[11px] text-muted-foreground sm:block">
			↑↓ choose · Enter open · Esc close · Ctrl/⌘ K toggle
		</p>
	</Dialog.Content>
</Dialog.Root>
