<script lang="ts">
	import RadioTowerIcon from '@lucide/svelte/icons/radio-tower';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { CopyText } from '#lib/components/app/index.js';
	import { describeError } from '#lib/api/index.js';
	import { formatTime } from '#lib/format.js';
	import { UNAVAILABLE } from '#lib/metrics.js';
	import { formatPlayerCount, sampleNote } from '#lib/servers/game-status.js';
	import type { GameStatusSource } from '#lib/servers/game-status.svelte.js';
	import ReadinessBadge from './readiness-badge.svelte';

	interface Props {
		/** The page's single readiness poll (shared with the header). */
		source: GameStatusSource;
	}

	let { source }: Props = $props();

	const status = $derived(source.status);
	const ready = $derived(source.readiness);
	const observed = $derived.by(() => {
		if (!status) return null;
		const date = new Date(status.observedAt);
		return Number.isNaN(date.getTime()) ? null : date;
	});
	const errorText = $derived.by(() => {
		if (!source.error) return null;
		const message = describeError(source.error);
		return `${message.title}: ${message.detail}`;
	});
</script>

<section
	class="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
	aria-labelledby="readiness-heading"
	data-testid="server-readiness"
>
	<div class="flex flex-wrap items-center gap-2">
		<RadioTowerIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<h2 id="readiness-heading" class="text-sm font-medium">Game</h2>
		<ReadinessBadge readiness={ready} />
		<span class="ml-auto text-xs text-muted-foreground" data-testid="readiness-observed">
			{#if observed}
				{ready.stale ? 'Last observed' : 'Observed'} {formatTime(observed)}
			{:else if !source.error}
				Checking…
			{/if}
		</span>
	</div>

	{#if status && !ready.stale}
		<p class="text-sm text-muted-foreground" data-testid="readiness-detail">{status.detail}</p>
	{:else if status}
		<p class="text-sm text-muted-foreground" data-testid="readiness-detail">
			Status is not current. It refreshes every few seconds while this page is visible and focused.
		</p>
	{/if}

	{#if status}
		<dl class="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
			<dt class="text-muted-foreground">Players</dt>
			<dd class="flex min-w-0 flex-col gap-1">
				<span class="font-mono text-sm tabular-nums" data-testid="readiness-players"
					>{ready.stale ? UNAVAILABLE : formatPlayerCount(status)}</span
				>
				{#if !ready.stale}
					{#if status.playerSample.length > 0}
						<ul class="flex flex-wrap gap-1.5" aria-label="Advertised player sample">
							{#each status.playerSample as player (player.uuid + player.name)}
								<li class="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono">
									{player.name}
								</li>
							{/each}
						</ul>
					{/if}
					<span class="text-muted-foreground" data-testid="readiness-sample-note"
						>{sampleNote(status)}</span
					>
				{/if}
			</dd>
			<dt class="text-muted-foreground">Version</dt>
			<dd>{status.version ?? UNAVAILABLE}</dd>
			<dt class="text-muted-foreground">Latency</dt>
			<dd class="font-mono tabular-nums">
				{status.latencyMs !== null && !ready.stale ? `${status.latencyMs} ms` : UNAVAILABLE}
			</dd>
			<dt class="self-start pt-1.5 text-muted-foreground">Address</dt>
			<dd class="flex min-w-0 flex-col gap-1">
				{#if status.connectAddress}
					<CopyText value={status.connectAddress} label="Copy connect address" />
					<span class="text-muted-foreground"
						>Suggested address. Firewalls, VPNs and routing outside the manager are not checked.</span
					>
				{:else}
					<span class="pt-1.5">{UNAVAILABLE}</span>
				{/if}
			</dd>
		</dl>
	{/if}

	{#if errorText}
		<p class="flex items-center gap-1.5 text-xs text-destructive" role="status">
			<CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
			{errorText}
		</p>
	{/if}
</section>
