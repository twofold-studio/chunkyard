<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { Button } from '#lib/components/ui/button/index.js';

	let { code, label = 'Example' }: { code: string; label?: string } = $props();
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(timer));

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard can be unavailable (insecure context); the text stays selectable.
		}
	}
</script>

<div class="relative rounded-md border border-border bg-background">
	<Button
		variant="ghost"
		size="icon-xs"
		class="absolute top-1.5 right-1.5"
		onclick={copy}
		aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
	>
		{#if copied}<CheckIcon />{:else}<CopyIcon />{/if}
	</Button>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard-reachable) -->
	<pre
		class="max-h-80 overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed text-foreground/90"
		aria-label={label}
		tabindex="0"><code>{code}</code></pre>
</div>
