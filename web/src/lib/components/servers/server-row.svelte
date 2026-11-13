<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { StatusBadge } from '#lib/components/app/index.js';
	import { formatCpus, formatMemoryRange } from '#lib/format.js';
	import { describeSoftware, needsInstall } from '#lib/servers/software.js';
	import { resolve } from '$app/paths';
	import type { ServerView } from '#lib/api/index.js';

	let { server }: { server: ServerView } = $props();
	const software = $derived(server.software ? describeSoftware(server.software) : null);
</script>

<li class="border-b border-border last:border-b-0">
	<a
		href={resolve(`servers/${server.id}`)}
		class="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
	>
		<span
			class="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground"
		>
			<ServerIcon class="size-4" aria-hidden="true" />
		</span>
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<div class="flex min-w-0 items-center gap-2">
				<span class="truncate text-sm font-medium">{server.name}</span>
				{#if needsInstall(server)}<Badge variant="warning">Not installed</Badge>{/if}
				{#if !server.acceptEula}<Badge variant="warning">EULA not accepted</Badge>{/if}
			</div>
			<p class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
				{#if software}<span
						>{software.kind}{#if server.launch}&nbsp;{server.launch.version}{/if}</span
					>{/if}
				<span>Port {server.port}</span>
				<span class="font-mono">{server.dockerImage}</span>
				<span>{formatMemoryRange(server.memoryMinMb, server.memoryMaxMb)}</span>
				<span class="hidden sm:inline">{formatCpus(server.cpus)}</span>
			</p>
		</div>
		<StatusBadge state={server.status.state} />
		<ChevronRightIcon
			class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
			aria-hidden="true"
		/>
	</a>
</li>
