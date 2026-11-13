<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import { cn } from '#lib/utils.js';

	interface Props {
		/** Zero-based index of the current step. */
		current: number;
		steps: readonly string[];
		/** Accessible name of the list. */
		label?: string;
	}

	let { current, steps, label = 'Setup progress' }: Props = $props();
</script>

<ol aria-label={label} class="flex items-center gap-2 text-xs">
	{#each steps as label, index (label)}
		{@const done = index < current}
		{@const active = index === current}
		{#if index > 0}
			<li
				aria-hidden="true"
				class={cn(
					'h-px flex-1 transition-colors duration-(--motion-slow)',
					done || active ? 'bg-primary' : 'bg-border'
				)}
			></li>
		{/if}
		<li
			class="flex items-center gap-2"
			aria-current={active ? 'step' : undefined}
			data-state={done ? 'complete' : active ? 'current' : 'upcoming'}
		>
			<span
				class={cn(
					'flex size-5 shrink-0 items-center justify-center rounded-full border font-medium tabular-nums transition-colors duration-(--motion-base)',
					done && 'border-primary bg-primary text-primary-foreground',
					active && 'border-primary text-foreground',
					!done && !active && 'border-border text-muted-foreground'
				)}
				aria-hidden="true"
			>
				{#if done}<CheckIcon class="size-3" />{:else}{index + 1}{/if}
			</span>
			<span class={cn(active ? 'text-foreground' : 'text-muted-foreground')}>
				{label}<span class="sr-only">
					— step {index + 1} of {steps.length}{done
						? ', completed'
						: active
							? ', current'
							: ''}</span
				>
			</span>
		</li>
	{/each}
</ol>
