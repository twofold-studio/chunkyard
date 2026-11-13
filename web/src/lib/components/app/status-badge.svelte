<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { ServerState } from '#lib/api/index.js';

	let { state }: { state: ServerState } = $props();

	const labels: Record<ServerState, string> = {
		running: 'Container running',
		stopped: 'Stopped',
		paused: 'Paused',
		unknown: 'Unknown'
	};
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
	title={state === 'running'
		? 'The container process is running; Minecraft may still be starting.'
		: undefined}
>
	<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
	{labels[state]}
</Badge>
