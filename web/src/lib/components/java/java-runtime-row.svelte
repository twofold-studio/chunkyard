<script lang="ts">
	import CoffeeIcon from '@lucide/svelte/icons/coffee';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { JavaRuntime } from '#lib/api/index.js';

	let { runtime }: { runtime: JavaRuntime } = $props();
</script>

<li class="flex items-center gap-4 border-b border-border px-5 py-4 last:border-b-0">
	<span
		class="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground"
	>
		<CoffeeIcon class="size-4" aria-hidden="true" />
	</span>
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
			<span class="text-sm font-medium">Java {runtime.major}</span>
			<span class="text-sm text-muted-foreground">{runtime.vendor}</span>
			<span class="font-mono text-xs text-muted-foreground">{runtime.fullVersion}</span>
		</div>
		<p class="flex min-w-0 gap-3 text-xs text-muted-foreground">
			<span class="shrink-0">{runtime.os}/{runtime.arch}</span>
			<span class="truncate font-mono" title={runtime.path}>{runtime.path}</span>
		</p>
	</div>
	<Badge variant={runtime.managed ? 'secondary' : 'outline'}>
		{runtime.managed ? 'Managed' : 'System'}
	</Badge>
</li>
