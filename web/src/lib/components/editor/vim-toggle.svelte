<script lang="ts">
	import type { VimMode } from './codemirror.js';
	import { vimPreference } from './vim-preference.svelte.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		/** Mode reported by the editor while Vim is on. */
		mode?: VimMode | null;
		class?: string;
	}

	let { mode = null, class: className }: Props = $props();

	const enabled = $derived(vimPreference.enabled);
</script>

<span class={cn('inline-flex items-center gap-2', className)}>
	<button
		type="button"
		aria-pressed={enabled}
		title={enabled ? 'Turn off Vim keybindings' : 'Use Vim keybindings in the editor'}
		onclick={() => vimPreference.toggle()}
		class={cn(
			'rounded-sm border px-1.5 py-px font-mono text-[11px] leading-4 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
			enabled
				? 'border-ring/60 bg-accent text-foreground'
				: 'border-border text-muted-foreground hover:text-foreground'
		)}
	>
		Vim
	</button>
	{#if enabled && mode}
		<span class="font-mono text-[11px] tracking-wide text-foreground uppercase" aria-live="polite">
			{mode}
		</span>
	{/if}
</span>
