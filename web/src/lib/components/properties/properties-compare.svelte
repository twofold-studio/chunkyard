<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { errorCode, isAbortError } from '#lib/api/index.js';
	import type { PropertiesStore } from '#lib/properties/properties-store.svelte.js';
	import { diffProperties, type PropertyChange } from '#lib/properties/diff.js';
	import { cn } from '#lib/utils.js';

	type Base = 'previous' | 'latest';

	interface Props {
		store: PropertiesStore;
		/** Version being viewed from history. */
		selected: { version: number; content: string };
	}

	let { store, selected }: Props = $props();

	/** Latest confirmed version (local unsaved edits are not a version). */
	const latest = $derived(store.doc ? { version: store.doc.version, content: store.saved } : null);
	const hasPrevious = $derived(selected.version > 1);
	let base = $state<Base>('previous');
	const effectiveBase = $derived<Base>(base === 'previous' && !hasPrevious ? 'latest' : base);

	let previous = $state.raw<{ version: number; content: string } | null>(null);
	let previousError = $state.raw<unknown>(null);
	/** Versions fetched for comparison; content of a saved version never changes. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- cache, not rendered state
	const cache = new Map<number, string>();

	// Load the version before the selected one (aborting a stale request on change).
	$effect(() => {
		const want = selected.version - 1;
		if (effectiveBase !== 'previous' || want < 1) return;
		previousError = null;
		const known = cache.get(want);
		if (known !== undefined) {
			previous = { version: want, content: known };
			return;
		}
		previous = null;
		const abort = new AbortController();
		store.api
			.getPropertiesVersion(store.serverId, want, { signal: abort.signal })
			.then((result) => {
				cache.set(want, result.content);
				previous = { version: want, content: result.content };
			})
			.catch((error: unknown) => {
				if (!isAbortError(error)) previousError = error;
			});
		return () => abort.abort();
	});

	/** Older side on the left, newer on the right. */
	const pair = $derived.by(() => {
		if (effectiveBase === 'latest') {
			if (!latest) return null;
			return { from: selected, to: latest };
		}
		if (!previous || previous.version !== selected.version - 1) return null;
		return { from: previous, to: selected };
	});
	const diff = $derived(pair ? diffProperties(pair.from.content, pair.to.content) : null);
	const sameVersion = $derived(pair !== null && pair.from.version === pair.to.version);

	const KIND: Record<
		PropertyChange['kind'],
		{ label: string; variant: 'warning' | 'success' | 'destructive' }
	> = {
		changed: { label: 'Changed', variant: 'warning' },
		added: { label: 'Added', variant: 'success' },
		removed: { label: 'Removed', variant: 'destructive' }
	};

	const show = (value: string) => (value === '' ? '(empty)' : value);
</script>

<section
	class="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
	aria-labelledby="properties-compare-title"
	data-testid="properties-compare"
>
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 text-sm"
	>
		<h4 id="properties-compare-title" class="font-medium">
			{#if pair}
				Changes <span class="font-mono">v{pair.from.version}</span>
				<ArrowRightIcon
					class="inline size-3.5 align-[-2px] text-muted-foreground"
					aria-label="to"
				/>
				<span class="font-mono">v{pair.to.version}</span>
			{:else}
				Changes
			{/if}
		</h4>
		<div
			class="ml-auto flex items-center rounded-md border border-border p-0.5 text-xs"
			role="radiogroup"
			aria-label="Compare with"
		>
			{#each [{ value: 'previous', label: hasPrevious ? `Previous (v${selected.version - 1})` : 'Previous', disabled: !hasPrevious }, { value: 'latest', label: latest ? `Latest (v${latest.version})` : 'Latest', disabled: !latest }] as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={effectiveBase === option.value}
					disabled={option.disabled}
					onclick={() => (base = option.value as Base)}
					class={cn(
						'rounded-sm px-2 py-0.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50',
						effectiveBase === option.value
							? 'bg-secondary text-secondary-foreground'
							: 'text-muted-foreground hover:text-foreground'
					)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="px-4 py-3 text-sm" aria-live="polite">
		{#if !hasPrevious && effectiveBase === 'latest' && base === 'previous'}
			<p class="mb-2 text-xs text-muted-foreground">
				v1 is the first version; comparing with the latest instead.
			</p>
		{/if}
		{#if effectiveBase === 'previous' && previousError}
			<ErrorAlert
				error={previousError}
				hint={errorCode(previousError) === 'properties.not_found'
					? `v${selected.version - 1} is not available; compare with the latest instead.`
					: undefined}
			/>
		{:else if !diff || !pair}
			<div class="flex flex-col gap-2" aria-busy="true">
				<Skeleton class="h-5 w-2/3" />
				<Skeleton class="h-5 w-1/2" />
			</div>
		{:else if sameVersion}
			<p class="text-muted-foreground">This is the latest version.</p>
		{:else if diff.changes.length === 0}
			<p class="text-muted-foreground">
				{diff.textOnly
					? 'No setting changes; only comments, order or formatting differ.'
					: 'No differences.'}
			</p>
		{:else}
			<p class="mb-2 text-xs text-muted-foreground" data-testid="compare-summary">
				{diff.changed} changed · {diff.added} added · {diff.removed} removed
				{#if diff.textOnly}· comments or formatting also differ{/if}
			</p>
			<ul class="flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
				{#each diff.changes as change (change.key)}
					<li
						class="grid gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[5.5rem_minmax(0,14rem)_minmax(0,1fr)]"
					>
						<span><Badge variant={KIND[change.kind].variant}>{KIND[change.kind].label}</Badge></span
						>
						<span class="truncate font-mono text-xs leading-6" title={change.key}>{change.key}</span
						>
						<span class="flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-xs leading-6">
							{#if change.kind === 'changed'}
								<del class="break-all text-muted-foreground">{show(change.from)}</del>
								<ArrowRightIcon class="size-3 shrink-0 text-muted-foreground" aria-label="to" />
								<ins class="break-all no-underline">{show(change.to)}</ins>
							{:else if change.kind === 'added'}
								<ins class="break-all no-underline">{show(change.to)}</ins>
							{:else}
								<del class="break-all text-muted-foreground">{show(change.from)}</del>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
