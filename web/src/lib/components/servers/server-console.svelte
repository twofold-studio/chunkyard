<script lang="ts">
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import SendIcon from '@lucide/svelte/icons/send-horizontal';
	import { tick, untrack } from 'svelte';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { getConsole, isAbortError, sendCommand, type ConsoleLine } from '#lib/api/index.js';
	import { poll } from '#lib/polling.js';
	import { formatTime } from '#lib/format.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		serverId: string;
		/** Container is running: commands are accepted and the snapshot refreshes automatically. */
		running: boolean;
		/** Bumped by the parent after lifecycle actions to force a fresh snapshot. */
		refreshKey?: number;
	}

	const TAIL = 200;
	const REFRESH_MS = 3000;

	let { serverId, running, refreshKey = 0 }: Props = $props();

	let lines = $state.raw<ConsoleLine[]>([]);
	let loaded = $state(false);
	let loading = $state(false);
	let error = $state.raw<unknown>(null);
	let updatedAt = $state<Date | null>(null);
	let autoRefresh = $state(true);

	let command = $state('');
	let sending = $state(false);
	let commandError = $state.raw<unknown>(null);

	let viewport = $state<HTMLElement | null>(null);
	let pinned = true;
	let manual: AbortController | null = null;
	let followUp: ReturnType<typeof setTimeout> | undefined;

	/** Replaces the snapshot; the console endpoint has no cursor, so never append. */
	async function load(id: string, signal: AbortSignal) {
		loading = true;
		try {
			const { items } = await getConsole(id, TAIL, { signal });
			lines = items;
			error = null;
			loaded = true;
			updatedAt = new Date();
			if (pinned) {
				await tick();
				viewport?.scrollTo({ top: viewport.scrollHeight });
			}
		} catch (cause) {
			if (!isAbortError(cause)) error = cause;
			throw cause;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Restart when the server, its running state, the toggle or the refresh key change.
		const id = serverId;
		const live = running && autoRefresh;
		void refreshKey;
		const controller = new AbortController();
		untrack(() => {
			if (live) {
				poll((signal) => load(id, signal), {
					intervalMs: REFRESH_MS,
					signal: controller.signal,
					onError: () => {}
				});
			} else {
				// Stopped containers keep their logs: show a single snapshot.
				load(id, controller.signal).catch(() => {});
			}
		});
		return () => controller.abort();
	});

	$effect(() => () => {
		clearTimeout(followUp);
		manual?.abort();
	});

	function refreshNow() {
		manual?.abort();
		manual = new AbortController();
		load(serverId, manual.signal).catch(() => {});
	}

	function onScroll() {
		if (!viewport) return;
		pinned = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24;
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		const line = command.trim();
		if (!line || sending) return;
		sending = true;
		commandError = null;
		try {
			await sendCommand(serverId, line);
			command = '';
			pinned = true;
			// Give the server a moment to print its reply, then take a fresh snapshot.
			clearTimeout(followUp);
			followUp = setTimeout(refreshNow, 600);
		} catch (cause) {
			commandError = cause;
		} finally {
			sending = false;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
		<p>
			Snapshot of the last {TAIL} lines{#if updatedAt}, taken {formatTime(updatedAt)}{/if}.
			{#if running && autoRefresh}Refreshes every {REFRESH_MS / 1000}s while this tab is visible.{/if}
		</p>
		<div class="flex items-center gap-3">
			<Field.Field orientation="horizontal" class="w-auto">
				<Switch id="console-auto" bind:checked={autoRefresh} disabled={!running} size="sm" />
				<Field.Label for="console-auto" class="text-xs font-normal">Auto-refresh</Field.Label>
			</Field.Field>
			<Button variant="outline" size="sm" onclick={refreshNow} disabled={loading}>
				{#if loading}<Spinner data-icon="inline-start" />{:else}<RotateCwIcon
						data-icon="inline-start"
					/>{/if}
				Refresh
			</Button>
		</div>
	</div>

	{#if error}
		<ErrorAlert {error} />
	{/if}

	<div
		bind:this={viewport}
		onscroll={onScroll}
		class="h-[26rem] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed"
		role="log"
		aria-label="Server console snapshot"
	>
		{#if !loaded && loading}
			<p class="text-muted-foreground">Loading console…</p>
		{:else if lines.length === 0}
			<p class="text-muted-foreground">
				{running ? 'No output yet.' : 'No output. Start the server to see its console.'}
			</p>
		{:else}
			{#each lines as line, i (i)}
				<div
					class={cn('break-all whitespace-pre-wrap', line.stream === 'stderr' && 'text-warning')}
				>
					{line.text}
				</div>
			{/each}
		{/if}
	</div>

	<form {onsubmit} class="flex flex-col gap-2">
		<div class="flex gap-2">
			<label for="console-command" class="sr-only">Console command</label>
			<Input
				id="console-command"
				bind:value={command}
				class="font-mono"
				placeholder={running ? 'say Hello' : 'Start the server to send commands'}
				autocomplete="off"
				spellcheck={false}
				disabled={!running || sending}
			/>
			<Button type="submit" variant="outline" disabled={!running || sending || !command.trim()}>
				{#if sending}<Spinner data-icon="inline-start" />{:else}<SendIcon
						data-icon="inline-start"
					/>{/if}
				Send
			</Button>
		</div>
		{#if commandError}<ErrorAlert error={commandError} />{/if}
	</form>
</div>
