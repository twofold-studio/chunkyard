<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import BlocksIcon from '@lucide/svelte/icons/blocks';
	import Gamepad2Icon from '@lucide/svelte/icons/gamepad-2';
	import MemoryStickIcon from '@lucide/svelte/icons/memory-stick';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { StatusBadge } from '#lib/components/app/index.js';
	import { formatCpus, formatMemory, formatMemoryRange } from '#lib/format.js';
	import { cardSummary, needsInstall } from '#lib/servers/software.js';
	import { resolve } from '$app/paths';
	import type { ServerView } from '#lib/api/index.js';

	let { server }: { server: ServerView } = $props();

	const summary = $derived(cardSummary(server));
	const notInstalled = $derived(needsInstall(server));
</script>

{#snippet spec(Icon: typeof ServerIcon, label: string, value: string, title?: string)}
	<div class="flex min-w-0 items-center gap-1.5" {title}>
		<dt class="shrink-0 text-muted-foreground">
			<Icon class="size-3.5" aria-hidden="true" />
			<span class="sr-only">{label}</span>
		</dt>
		<dd class="truncate">{value}</dd>
	</div>
{/snippet}

<a
	href={resolve(`servers/${server.id}`)}
	class="flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring/60 hover:bg-accent/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
	data-testid="server-card"
>
	<div class="flex min-w-0 items-start gap-3">
		<span
			class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground"
		>
			<ServerIcon class="size-[18px]" aria-hidden="true" />
		</span>
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<h3 class="truncate text-sm leading-5 font-medium">{server.name}</h3>
			<div class="flex flex-wrap items-center gap-1.5">
				<StatusBadge state={server.status.state} />
				{#if notInstalled}<Badge variant="warning">Not installed</Badge>{/if}
				{#if !server.acceptEula}<Badge variant="warning">EULA</Badge>{/if}
			</div>
		</div>
	</div>
	<dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-foreground/90">
		{@render spec(BlocksIcon, 'Software', summary.software)}
		{@render spec(Gamepad2Icon, 'Minecraft version', summary.version ?? 'Unknown version')}
		{@render spec(
			MemoryStickIcon,
			'Memory',
			formatMemory(server.memoryMaxMb),
			`Heap ${formatMemoryRange(server.memoryMinMb, server.memoryMaxMb)}`
		)}
		{@render spec(CpuIcon, 'CPU limit', formatCpus(server.cpus))}
		{@render spec(NetworkIcon, 'Host game port', `Port ${server.port}`)}
	</dl>
</a>
