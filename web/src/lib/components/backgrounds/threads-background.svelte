<!--
	Decorative full-viewport background using the React Bits "Threads" effect (see threads.ts
	for source, licence and adaptation notes). It never receives pointer events, is hidden from
	assistive technology, and falls back to a static pattern when WebGL2 is unavailable.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { cn } from '#lib/utils.js';
	import { createThreads, type ThreadsOptions } from './threads.js';

	interface Props {
		options?: Partial<ThreadsOptions>;
		class?: string;
	}

	let { options = {}, class: className }: Props = $props();

	let status = $state<'pending' | 'webgl' | 'fallback'>('pending');

	const threads: Attachment<HTMLCanvasElement> = (canvas) => {
		const handle = canvas.parentElement && createThreads(canvas.parentElement, canvas, options);
		status = handle ? 'webgl' : 'fallback';
		return () => handle?.destroy();
	};
</script>

<div
	aria-hidden="true"
	data-slot="threads-background"
	data-status={status}
	class={cn('threads-root', className)}
>
	{#if status === 'fallback'}
		<div class="threads-fallback"></div>
	{:else}
		<canvas {@attach threads}></canvas>
	{/if}
</div>

<style>
	/* Layout lives in scoped CSS so the layer stays inert even if utility classes fail to load. */
	.threads-root {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100svh;
		overflow: hidden;
		pointer-events: none;
		user-select: none;
	}
	.threads-root > * {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}

	/* Still diagonal hairlines in the same copper tone, shown only without WebGL2. */
	.threads-fallback {
		background-image: repeating-linear-gradient(
			-25deg,
			transparent 0 22px,
			color-mix(in oklab, var(--threads-accent, #c2703a) 14%, transparent) 22px 23px
		);
		mask-image: radial-gradient(ellipse at 50% 50%, transparent 20%, black 75%);
	}
</style>
