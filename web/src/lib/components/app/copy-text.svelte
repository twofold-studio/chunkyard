<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { Button } from '#lib/components/ui/button/index.js';

	let { value, label = 'Copy' }: { value: string; label?: string } = $props();
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(timer));

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard access can be denied (e.g. insecure context); the text stays selectable.
		}
	}
</script>

<div
	class="flex min-w-0 items-center gap-1 rounded-md border border-border bg-background py-1 pr-1 pl-3"
>
	<code class="min-w-0 flex-1 truncate font-mono text-xs select-all" title={value}>{value}</code>
	<Button variant="ghost" size="icon-xs" onclick={copy} aria-label={label}>
		{#if copied}<CheckIcon />{:else}<CopyIcon />{/if}
	</Button>
</div>
