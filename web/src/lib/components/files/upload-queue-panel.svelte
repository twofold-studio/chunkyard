<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import CircleMinusIcon from '@lucide/svelte/icons/circle-minus';
	import CopyCheckIcon from '@lucide/svelte/icons/copy-check';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { describeError } from '#lib/api/index.js';
	import { formatBytes } from '#lib/files/paths.js';
	import type { UploadQueue, UploadState } from '#lib/files/upload-queue.svelte.js';
	import { collapse } from '#lib/motion/index.js';

	let { queue }: { queue: UploadQueue } = $props();

	const labels: Record<UploadState, string> = {
		pending: 'Waiting',
		uploading: 'Uploading…',
		done: 'Uploaded',
		exists: 'Already exists',
		failed: 'Failed',
		skipped: 'Skipped'
	};

	const finished = $derived(
		queue.items.some((i) => i.state === 'done' || i.state === 'failed' || i.state === 'skipped')
	);
</script>

{#if queue.items.length > 0}
	<section
		transition:collapse
		class="flex flex-col rounded-lg border border-border bg-card"
		aria-label="Uploads"
	>
		<header class="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
			<h3 class="text-sm font-medium">Uploads</h3>
			{#if finished}
				<Button variant="ghost" size="xs" onclick={() => queue.clearFinished()}
					>Clear finished</Button
				>
			{/if}
		</header>
		<ul class="flex max-h-64 flex-col overflow-y-auto">
			{#each queue.items as item (item.id)}
				<li
					transition:collapse
					class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2 text-sm last:border-b-0"
					data-state={item.state}
				>
					<span class="shrink-0" aria-hidden="true">
						{#if item.state === 'uploading'}
							<Spinner class="size-4" />
						{:else if item.state === 'done'}
							<CircleCheckIcon class="size-4 text-success" />
						{:else if item.state === 'failed'}
							<CircleAlertIcon class="size-4 text-destructive" />
						{:else if item.state === 'exists'}
							<CopyCheckIcon class="size-4 text-warning" />
						{:else if item.state === 'skipped'}
							<CircleMinusIcon class="size-4 text-muted-foreground" />
						{:else}
							<CircleDashedIcon class="size-4 text-muted-foreground" />
						{/if}
					</span>
					<span class="min-w-0 flex-1 truncate font-mono text-xs" title={item.path}
						>{item.path}</span
					>
					<span class="text-xs text-muted-foreground tabular-nums"
						>{formatBytes(item.file.size)}</span
					>
					<span class="w-24 text-xs text-muted-foreground" role="status">{labels[item.state]}</span>
					{#if item.state === 'exists'}
						<span class="flex gap-1">
							<Button
								size="xs"
								variant="outline"
								disabled={!queue.canUpload}
								onclick={() => queue.replace(item.id)}>Replace</Button
							>
							<Button size="xs" variant="ghost" onclick={() => queue.skip(item.id)}>Skip</Button>
						</span>
					{:else if item.state === 'failed' && queue.canRetry(item.id)}
						<Button
							size="xs"
							variant="outline"
							disabled={!queue.canUpload}
							onclick={() => queue.retry(item.id)}>Retry</Button
						>
					{/if}
					{#if item.state === 'failed'}
						<span class="basis-full pl-7 text-xs text-destructive">
							{describeError(item.error).detail}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
