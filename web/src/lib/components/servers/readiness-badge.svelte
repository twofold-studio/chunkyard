<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { Readiness } from '#lib/servers/game-status.js';

	interface Props {
		readiness: Readiness;
		/** Hide the label on narrow screens (kept for screen readers). */
		compact?: boolean;
	}

	let { readiness, compact = false }: Props = $props();

	const variant = $derived(
		readiness.tone === 'success'
			? 'success'
			: readiness.tone === 'warning'
				? 'warning'
				: readiness.tone === 'danger'
					? 'destructive'
					: 'outline'
	);
	const title = $derived(
		readiness.stale
			? 'Not current: the page was unattended or status requests failed.'
			: readiness.state === 'ready'
				? 'Minecraft answered a Server List Ping.'
				: readiness.state === 'starting'
					? 'The container runs, but Minecraft has not answered a status ping yet.'
					: undefined
	);
</script>

<Badge
	{variant}
	class={['shrink-0', compact && 'max-sm:px-1.5', readiness.stale && 'opacity-70']}
	{title}
	data-testid="readiness-badge"
	data-state={readiness.state ?? 'none'}
	data-stale={readiness.stale ? 'true' : undefined}
>
	<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
	<span class={compact ? 'max-sm:sr-only' : undefined}>
		<span class="sr-only">Game </span>{readiness.label}{#if readiness.players !== null}
			· {readiness.players}<span class="sr-only"> players</span>{/if}
	</span>
</Badge>
