<script lang="ts" generics="T extends string">
	import type { Component } from 'svelte';
	import { cn } from '#lib/utils.js';

	interface Option {
		value: T;
		label: string;
		hint?: string;
		icon?: Component;
		disabled?: boolean;
	}

	interface Props {
		label: string;
		options: Option[];
		value: T;
		disabled?: boolean;
	}

	let { label, options, value = $bindable(), disabled = false }: Props = $props();

	function onkeydown(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		const enabled = options.filter((o) => !o.disabled);
		if (enabled.length === 0) return;
		const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
		const current = Math.max(
			0,
			enabled.findIndex((o) => o.value === value)
		);
		const next = enabled[(current + step + enabled.length) % enabled.length];
		value = next.value;
		const group = event.currentTarget as HTMLElement;
		group.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
	}
</script>

<div
	role="radiogroup"
	aria-label={label}
	tabindex="-1"
	class="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-0.5"
	{onkeydown}
>
	{#each options as option (option.value)}
		{@const checked = option.value === value}
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			data-value={option.value}
			tabindex={checked ? 0 : -1}
			title={option.hint}
			disabled={disabled || option.disabled}
			class={cn(
				'motion-press inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50',
				checked
					? 'bg-background text-foreground shadow-xs ring-1 ring-border'
					: 'text-muted-foreground hover:text-foreground'
			)}
			onclick={() => (value = option.value)}
		>
			{#if option.icon}<option.icon class="size-3.5" aria-hidden="true" />{/if}
			{option.label}
		</button>
	{/each}
</div>
