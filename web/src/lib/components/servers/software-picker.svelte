<script lang="ts">
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SoftwareLogo from './software-logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { cn } from '#lib/utils.js';
	import type { SoftwareCatalogItem, SoftwareKind } from '#lib/api/index.js';
	import { SOFTWARE_BLURBS, SOFTWARE_LABELS, SOFTWARE_ORDER } from '#lib/servers/software.js';

	interface Props {
		/** `null` while loading. */
		catalog: SoftwareCatalogItem[] | null;
		loadError?: unknown;
		value: SoftwareKind | null;
		disabled?: boolean;
		onRetry?: () => void;
		/**
		 * A choice was picked with a plain pointer click. Arrow keys, Space and modified clicks
		 * only select, so keyboard users move freely and confirm with Enter/Next.
		 */
		onPicked?: (kind: SoftwareKind) => void;
	}

	let {
		catalog,
		loadError = null,
		value = $bindable(),
		disabled = false,
		onRetry,
		onPicked
	}: Props = $props();

	function picked(event: MouseEvent, choice: Choice) {
		// The radio's own (forwarded) click also bubbles here; react to the label click only.
		if (event.target instanceof HTMLInputElement) return;
		if (disabled || !choice.available) return;
		const plain =
			event.detail > 0 &&
			event.button === 0 &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.shiftKey &&
			!event.altKey;
		if (!plain) return;
		value = choice.id;
		onPicked?.(choice.id);
	}

	interface Choice {
		id: SoftwareKind;
		available: boolean;
		reason: string | null;
	}

	const byId = $derived(new Map((catalog ?? []).map((item) => [item.id, item])));

	// Managed kinds come only from the catalog (real availability), in a fixed order.
	const managed: Choice[] = $derived(
		SOFTWARE_ORDER.filter((id) => id !== 'custom' && byId.has(id)).map((id) => {
			const item = byId.get(id)!;
			return { id, available: item.available, reason: item.reason };
		})
	);

	// A manual JAR needs no catalog support, so it stays usable even if the catalog fails.
	const custom: Choice = $derived.by(() => {
		const item = byId.get('custom');
		return { id: 'custom', available: item?.available ?? true, reason: item?.reason ?? null };
	});
</script>

{#snippet radio(choice: Choice)}
	<input
		type="radio"
		name="software"
		class="peer sr-only"
		value={choice.id}
		bind:group={value}
		disabled={disabled || !choice.available}
		aria-describedby={`software-${choice.id}-desc`}
	/>
{/snippet}

<fieldset class="flex min-w-0 flex-col gap-3" {disabled}>
	<legend class="sr-only">Server software</legend>

	{#if loadError}
		<ErrorAlert error={loadError}>
			{#if onRetry}
				<Button size="sm" variant="outline" class="mt-2" onclick={onRetry}>
					<RefreshCwIcon data-icon="inline-start" />
					Retry
				</Button>
			{/if}
		</ErrorAlert>
	{:else if catalog === null}
		<div class="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-busy="true">
			{#each { length: 3 }, i (i)}
				<Skeleton class="h-[5.5rem] rounded-lg" />
			{/each}
		</div>
	{:else if managed.length > 0}
		<div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
			{#each managed as choice (choice.id)}
				{@const selected = value === choice.id}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (keyboard selection stays native radio behaviour; only pointer clicks continue) -->
				<label
					onclick={(event) => picked(event, choice)}
					class={cn(
						'motion-press relative flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-background p-3 transition-colors',
						'hover:border-ring/60 hover:bg-accent/30',
						'has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
						selected && 'border-primary bg-primary/5 hover:border-primary hover:bg-primary/5',
						!choice.available &&
							'cursor-not-allowed opacity-60 hover:border-border hover:bg-background'
					)}
				>
					{@render radio(choice)}
					<span
						class={cn(
							'flex size-9 items-center justify-center rounded-md border border-border bg-muted/40',
							selected && 'border-primary/40'
						)}
					>
						<SoftwareLogo kind={choice.id} />
					</span>
					<span class="flex flex-col gap-0.5">
						<span class="text-sm leading-tight font-medium">{SOFTWARE_LABELS[choice.id]}</span>
						<span id={`software-${choice.id}-desc`} class="text-xs text-muted-foreground">
							{choice.available ? SOFTWARE_BLURBS[choice.id] : (choice.reason ?? 'Unavailable.')}
						</span>
					</span>
				</label>
			{/each}
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			This manager does not offer managed installs. Use a custom JAR instead.
		</p>
	{/if}

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (keyboard selection stays native radio behaviour; only pointer clicks continue) -->
	<label
		onclick={(event) => picked(event, custom)}
		class={cn(
			'flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 transition-colors',
			'hover:border-ring/60 hover:bg-accent/30',
			'has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
			value === 'custom' && 'border-solid border-primary bg-primary/5',
			!custom.available && 'cursor-not-allowed opacity-60'
		)}
	>
		{@render radio(custom)}
		<FileArchiveIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="flex min-w-0 flex-col">
			<span class="text-sm font-medium">
				Custom JAR <span class="font-normal text-muted-foreground">· Advanced</span>
			</span>
			<span id="software-custom-desc" class="text-xs text-muted-foreground">
				{custom.available
					? 'Nothing is downloaded. Copy your own server JAR into the server directory.'
					: (custom.reason ?? 'Unavailable.')}
			</span>
		</span>
	</label>
</fieldset>
