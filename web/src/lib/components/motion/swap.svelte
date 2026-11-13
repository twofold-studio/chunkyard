<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { StepDirection } from '#lib/motion/index.js';
	import Reveal, { type RevealPreset } from './reveal.svelte';

	interface Props {
		/** Changing the key replays the enter transition (route, tab or step identity). */
		key: unknown;
		children: Snippet;
		preset?: RevealPreset;
		direction?: StepDirection;
		class?: string;
	}

	let { key, children, preset = 'fade', direction = 1, class: className }: Props = $props();
</script>

{#key key}
	<Reveal {preset} {direction} class={className}>
		{@render children()}
	</Reveal>
{/key}
