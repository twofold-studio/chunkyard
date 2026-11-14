<script lang="ts">
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { tick, untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import FileCogIcon from '@lucide/svelte/icons/file-cog';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { prefersReducedMotion } from '#lib/motion/index.js';
	import ServerNetwork from './server-network.svelte';
	import ServerResources from './server-resources.svelte';
	import type { ServerView } from '#lib/api/index.js';

	interface Props {
		server: ServerView;
		busy: boolean;
		onRequestEula: () => void;
		onRevokeEula: () => void;
		onServerUpdated: (server: ServerView) => void;
		/** Opens the Properties tab (server.properties). */
		onOpenProperties: () => void;
		/** Bump to expand Network and scroll it into view (e.g. from Overview). */
		networkFocus?: number;
		/** Called once a focus request was handled, so it is not replayed on the next visit. */
		onNetworkFocused?: () => void;
	}

	let {
		server,
		busy,
		onRequestEula,
		onRevokeEula,
		onServerUpdated,
		onOpenProperties,
		networkFocus = 0,
		onNetworkFocused
	}: Props = $props();

	const stopped = $derived(server.status.state === 'stopped');
	let networkOpen = $state(false);
	let networkEl = $state<HTMLElement | null>(null);

	async function revealNetwork() {
		networkOpen = true;
		await tick();
		networkEl?.scrollIntoView({
			block: 'start',
			behavior: prefersReducedMotion() ? 'auto' : 'smooth'
		});
	}

	$effect(() => {
		if (networkFocus <= 0) return;
		untrack(() => {
			void revealNetwork();
			onNetworkFocused?.();
		});
	});
</script>

<div class="flex flex-col gap-4">
	{#if !server.acceptEula}
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm"
			role="status"
		>
			<TriangleAlertIcon class="size-4 shrink-0 text-warning" aria-hidden="true" />
			<span class="min-w-0 flex-1"
				>The server cannot start until the Minecraft EULA is accepted.</span
			>
			<Button size="xs" variant="outline" onclick={onRequestEula} disabled={!stopped || busy}>
				Review EULA
			</Button>
		</div>
	{/if}

	<button
		type="button"
		class="motion-lift flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-left hover:border-ring/60 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
		onclick={onOpenProperties}
	>
		<FileCogIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="text-sm font-medium">Minecraft settings</span>
			<span class="text-xs text-muted-foreground"
				>Difficulty, whitelist, MOTD and more in Properties; editable while running.</span
			>
		</span>
		<ArrowRightIcon class="size-4 text-muted-foreground" aria-hidden="true" />
	</button>

	<section
		bind:this={networkEl}
		aria-label="Hosting"
		class="scroll-mt-24 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
	>
		<ServerNetwork {server} {busy} {onServerUpdated} bind:open={networkOpen} />
		<ServerResources {server} {busy} {onServerUpdated} />
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
			<ScaleIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<span class="text-sm font-medium">Minecraft EULA</span>
			<a
				href="https://aka.ms/MinecraftEULA"
				target="_blank"
				rel="noreferrer noopener"
				class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
				>Read</a
			>
			<div class="ml-auto flex items-center gap-2">
				{#if !stopped}
					<span class="text-xs text-muted-foreground">Stop the server to change</span>
				{/if}
				<span class="text-xs text-muted-foreground" aria-hidden="true">
					{server.acceptEula ? 'Accepted' : 'Not accepted'}
				</span>
				<Switch
					id="eula-switch"
					aria-label="Minecraft EULA accepted"
					bind:checked={
						() => server.acceptEula, (checked) => (checked ? onRequestEula() : onRevokeEula())
					}
					disabled={!stopped || busy}
				/>
			</div>
		</div>
	</section>
</div>
