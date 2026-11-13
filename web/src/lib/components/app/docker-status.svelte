<script lang="ts">
	import ContainerIcon from '@lucide/svelte/icons/container';
	import { getIsolation, type DockerInfo } from '#lib/api/index.js';
	import { poll } from '#lib/polling.js';
	import { cn } from '#lib/utils.js';

	let docker = $state.raw<DockerInfo | null>(null);
	let failed = $state(false);

	$effect(() => {
		const controller = new AbortController();
		poll(
			async (signal) => {
				docker = (await getIsolation({ signal })).docker;
				failed = false;
			},
			{ intervalMs: 30_000, signal: controller.signal, onError: () => (failed = true) }
		);
		return () => controller.abort();
	});

	const label = $derived(
		failed
			? 'Docker status unavailable'
			: !docker
				? 'Checking Docker…'
				: docker.available
					? `Docker ${docker.version ?? ''}`.trim()
					: 'Docker unavailable'
	);
</script>

<div
	class="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
	title={docker?.reason ?? undefined}
>
	<ContainerIcon class="size-4" aria-hidden="true" />
	<span class="truncate">{label}</span>
	<span
		class={cn(
			'ml-auto size-1.5 shrink-0 rounded-full',
			docker?.available
				? 'bg-success'
				: docker && !docker.available
					? 'bg-destructive'
					: 'bg-muted-foreground/50'
		)}
		aria-hidden="true"
	></span>
</div>
