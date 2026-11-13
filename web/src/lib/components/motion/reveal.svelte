<script lang="ts" module>
	export type RevealPreset = 'rise' | 'fade' | 'pop' | 'step';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { fadeIn, pop, rise, stagger, step, type StepDirection } from '#lib/motion/index.js';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		children: Snippet;
		preset?: RevealPreset;
		/** Position in a list; adds a capped stagger delay. */
		index?: number;
		delay?: number;
		direction?: StepDirection;
	}

	let { children, preset = 'rise', index = 0, delay = 0, direction = 1, ...rest }: Props = $props();

	const params = $derived({ delay: stagger(index, 35, delay), direction });

	function enter(node: Element, p: typeof params) {
		switch (preset) {
			case 'fade':
				return fadeIn(node, p);
			case 'pop':
				return pop(node, p);
			case 'step':
				return step(node, p);
			default:
				return rise(node, p);
		}
	}
</script>

<!-- Enter-only so content never overlaps outgoing content or shifts layout. -->
<div in:enter|global={params} {...rest}>
	{@render children()}
</div>
