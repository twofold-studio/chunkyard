<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { ServerState } from '#lib/api/index.js';

	interface Props {
		state: ServerState;
		/** Short labels, and only the dot on narrow screens (label stays for screen readers). */
		compact?: boolean;
	}

	let { state, compact = false }: Props = $props();

	const labels: Record<ServerState, string> = {
		running: 'Container running',
		stopped: 'Stopped',
		paused: 'Paused',
		unknown: 'Unknown'
	};
	const label = $derived(compact && state === 'running' ? 'Running' : labels[state]);
	const variant = $derived(
		state === 'running'
			? 'success'
			: state === 'unknown' || state === 'paused'
				? 'warning'
				: 'outline'
	);
</script>

<Badge
	{variant}
	class={compact ? 'shrink-0 max-sm:px-1.5' : undefined}
	title={state === 'running'
		? 'The container process is running; Minecraft may still be starting.'
		: undefined}
>
	<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
	<span class={compact ? 'max-sm:sr-only' : undefined}>{label}</span>
</Badge>
