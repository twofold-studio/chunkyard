<script lang="ts">
	import ServerMetrics from '#lib/components/servers/server-metrics.svelte';
	import { useServerMetrics } from '#lib/servers/metrics-source.svelte.js';
	import { formatBytes, formatCpu } from '#lib/metrics.js';
	import type { ServerState } from '#lib/api/index.js';

	interface Props {
		serverId: string;
		serverState: ServerState;
		cpus?: number;
		/** Mount the charts panel (the header readout is always mounted, like the page header). */
		showPanel?: boolean;
		active?: boolean;
	}

	let { serverId, serverState, cpus, showPanel = true, active = true }: Props = $props();

	const metrics = useServerMetrics(() => ({
		serverId,
		running: serverState === 'running',
		active
	}));
</script>

<p data-testid="header-usage">
	{#if metrics.live}CPU {formatCpu(metrics.live.cpuPercent)} · RAM {formatBytes(
			metrics.live.memoryBytes
		)}{:else}no live usage{/if}
</p>
{#if showPanel}
	<ServerMetrics source={metrics} {cpus} />
{/if}
