<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import { PageHeader } from '#lib/components/app/index.js';
	import { Reveal } from '#lib/components/motion/index.js';
	import ExportList from '#lib/components/exports/export-list.svelte';
	import RestoreNote from '#lib/components/exports/restore-note.svelte';
	import StorageForm from '#lib/components/exports/storage-form.svelte';
	import { formatBytes } from '#lib/metrics.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let storage = $derived(data.storage);
	let exports = $derived(data.exports);
	const s3Archives = $derived(exports.filter((e) => e.destination === 's3').length);
	const totalBytes = $derived(exports.reduce((sum, e) => sum + e.size, 0));
</script>

<PageHeader
	title="Storage & exports"
	icon={ArchiveIcon}
	description="Compressed server archives on the manager host or S3. Archives are independent of servers and stay here after a server is deleted. Create new exports from a server's Exports tab."
	meta={exports.length
		? `${exports.length} ${exports.length === 1 ? 'archive' : 'archives'}`
		: undefined}
/>

{#if storage}
	<Reveal>
		<StorageForm connection={storage} {s3Archives} onSaved={(saved) => (storage = saved)} />
	</Reveal>
{/if}

<Reveal index={1} class="flex flex-col gap-2">
	<section class="flex flex-col gap-2" aria-label="All archives">
		<div class="flex items-baseline gap-2">
			<h2 class="text-sm font-medium">Archives</h2>
			{#if exports.length}
				<span class="text-xs text-muted-foreground">{formatBytes(totalBytes)} total</span>
			{/if}
		</div>
		<ExportList
			{exports}
			showServer
			serverIds={data.serverIds}
			emptyText="No archives yet. Stop a server and open its Exports tab to create one."
			ondeleted={(id) => (exports = exports.filter((e) => e.id !== id))}
		/>
	</section>
	<RestoreNote />
</Reveal>
