<script lang="ts">
	import { cn } from '#lib/utils.js';
	import type { HttpMethod } from './openapi';

	let { method, class: className }: { method: HttpMethod; class?: string } = $props();

	// Restrained tints on the near-black surface; reads by text first, colour second.
	const tone: Record<string, string> = {
		get: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
		post: 'border-success/30 bg-success/10 text-success',
		put: 'border-warning/30 bg-warning/10 text-warning',
		patch: 'border-warning/30 bg-warning/10 text-warning',
		delete: 'border-destructive/30 bg-destructive/10 text-destructive'
	};
</script>

<span
	class={cn(
		'inline-flex h-5 w-14 shrink-0 items-center justify-center rounded border font-mono text-[11px] font-semibold tracking-wide uppercase',
		tone[method] ?? 'border-border bg-muted text-muted-foreground',
		className
	)}
>
	{method}
</span>
