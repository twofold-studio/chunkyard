<script lang="ts">
	import { onMount } from 'svelte';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { isAbortError } from '#lib/api/index.js';
	import { parseMarkdown, type Block } from '#lib/markdown.js';
	import { channelHint, loadChangelog, loadVersion, type ShownVersion } from '#lib/version.js';
	import { cn } from '#lib/utils.js';
	import ErrorAlert from './error-alert.svelte';
	import Markdown from './markdown-view.svelte';

	interface Props {
		class?: string;
	}

	let { class: className }: Props = $props();

	let info = $state.raw<ShownVersion | null>(null);
	let open = $state(false);
	let blocks = $state.raw<Block[] | null>(null);
	let loadError = $state.raw<unknown>(null);
	let loading = $state(false);
	// Plain (non-reactive) handle for the in-flight changelog request.
	let changelogRequest: AbortController | null = null;

	const hint = $derived(info ? channelHint(info.channel) : null);
	const label = $derived(
		info
			? `Chunkyard version ${info.version}${info.channel ? ` (${info.channel} build)` : ''}. View changelog`
			: ''
	);

	onMount(() => {
		const controller = new AbortController();
		loadVersion(controller.signal).then(
			(shown) => (info = shown),
			() => {} // aborted on unmount; the badge is optional
		);
		return () => {
			controller.abort();
			changelogRequest?.abort();
		};
	});

	async function fetchChangelog() {
		if (loading || blocks) return;
		const controller = new AbortController();
		changelogRequest = controller;
		loading = true;
		loadError = null;
		try {
			const changelog = await loadChangelog(controller.signal);
			// The dialog title already says "Changelog"; drop the document's own H1.
			const parsed = parseMarkdown(changelog.markdown);
			blocks = parsed[0]?.type === 'heading' && parsed[0].level === 1 ? parsed.slice(1) : parsed;
		} catch (error) {
			if (!isAbortError(error)) loadError = error;
		} finally {
			if (changelogRequest === controller) {
				changelogRequest = null;
				loading = false;
			}
		}
	}

	function onOpenChange(next: boolean) {
		if (next) fetchChangelog();
		else changelogRequest?.abort();
	}
</script>

{#if info}
	<Dialog.Root bind:open {onOpenChange}>
		<Dialog.Trigger
			class={cn(
				'inline-flex h-6 items-center gap-1.5 rounded-md border border-border px-2 font-mono text-[11px] text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
				className
			)}
			aria-label={label}
			title="View changelog"
		>
			<span>v{info.version}</span>
			{#if hint}
				<span class="text-muted-foreground/60" aria-hidden="true">·</span>
				<span class="text-muted-foreground/80">{hint}</span>
			{/if}
		</Dialog.Trigger>
		<Dialog.Content class="flex max-h-[85svh] flex-col gap-4 sm:max-w-2xl">
			<Dialog.Header class="pr-8">
				<Dialog.Title>Changelog</Dialog.Title>
				<Dialog.Description>
					Project notes for Chunkyard v{info.version}{info.channel
						? ` (${info.channel} build)`
						: ''}.
				</Dialog.Description>
			</Dialog.Header>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard-reachable) -->
			<div
				class="-mx-6 min-h-0 flex-1 overflow-y-auto border-t border-border px-6 pt-4"
				tabindex="0"
				role="region"
				aria-label="Changelog entries"
				aria-busy={loading}
			>
				{#if blocks}
					<Markdown {blocks} />
				{:else if loadError}
					<ErrorAlert error={loadError}>
						<Button variant="outline" size="sm" class="mt-2" onclick={fetchChangelog}>
							<RotateCwIcon data-icon="inline-start" />
							Retry
						</Button>
					</ErrorAlert>
				{:else}
					<div class="flex items-center gap-2 py-8 text-muted-foreground">
						<Spinner aria-label="Loading changelog" />
						<span>Loading changelog…</span>
					</div>
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Root>
{/if}
