<script lang="ts">
	import { cn } from '#lib/utils.js';
	import { monogram } from '#lib/servers/software.js';
	import { safeImageUrl } from '#lib/servers/icons.js';

	interface Props {
		/** Candidate logo URL; only same-origin logo/icon routes are ever loaded. */
		src: string | null | undefined;
		/** Pack name for the monogram fallback (the image itself is decorative). */
		name: string;
		class?: string;
	}

	let { src, name, class: className }: Props = $props();

	const url = $derived(safeImageUrl(src));
	let failedFor = $state<string | null>(null);
	const showImage = $derived(url !== null && failedFor !== url);
</script>

<span
	class={cn(
		'flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-xs font-semibold text-muted-foreground',
		className
	)}
	aria-hidden="true"
	data-slot="pack-logo"
>
	{#if showImage}
		<img
			src={url}
			alt=""
			class="size-full object-cover"
			loading="lazy"
			decoding="async"
			referrerpolicy="same-origin"
			onerror={() => (failedFor = url)}
		/>
	{:else}
		{monogram(name)}
	{/if}
</span>
