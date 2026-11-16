<script lang="ts" module>
	import PackageIcon from '@lucide/svelte/icons/package';
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import type { SoftwareKind } from '#lib/api/index.js';
	import minecraft from '#lib/assets/software/minecraft.png';
	import paper from '#lib/assets/software/paper.svg';
	import purpur from '#lib/assets/software/purpur.svg';
	import fabric from '#lib/assets/software/fabric.png';
	import forge from '#lib/assets/software/forge.png';
	import neoforge from '#lib/assets/software/neoforge.png';
	import curseforge from '#lib/assets/software/curseforge.png';

	/** Bundled official marks (see `$lib/assets/software/SOURCES.md`). Same-origin only. */
	const LOGOS: Partial<Record<SoftwareKind, string>> = {
		vanilla: minecraft,
		paper,
		purpur,
		fabric,
		forge,
		neoforge,
		curseforge
	};
</script>

<script lang="ts">
	import { cn } from '#lib/utils.js';

	interface Props {
		kind: SoftwareKind;
		class?: string;
	}

	let { kind, class: className }: Props = $props();

	let failed = $state<string | null>(null);
	const src = $derived(LOGOS[kind]);
	const Fallback = $derived(kind === 'custom' ? FileArchiveIcon : PackageIcon);
</script>

<!-- Decorative: the software name is always rendered next to the logo. -->
{#if src && failed !== src}
	<img
		{src}
		alt=""
		aria-hidden="true"
		draggable="false"
		data-software-logo={kind}
		class={cn('size-6 shrink-0 object-contain', className)}
		onerror={() => (failed = src)}
	/>
{:else}
	<Fallback class={cn('size-4 shrink-0 text-muted-foreground', className)} aria-hidden="true" />
{/if}
