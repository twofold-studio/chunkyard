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
	import {
		ApiError,
		getConsole,
		isAbortError,
		sendCommand,
		type ConsoleLine
	} from '#lib/api/index.js';
	import { poll } from '#lib/polling.js';
	import { formatTime } from '#lib/format.js';
	import {
		browserSocketFactory,
		ConsoleBuffer,
		connectConsoleStream,
		consoleStreamUrl,
		type ConsoleEntry,
		type SocketFactory,
		type StreamStatus
	} from '#lib/console/console-stream.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		serverId: string;
		/** Container is running: commands are accepted and output streams live. */
		running: boolean;
		/** Bumped by the parent after lifecycle actions to force a fresh snapshot. */
		refreshKey?: number;
		/**
		 * WebSocket factory for the live stream; `null` forces snapshot polling.
		 * Defaults to the browser's WebSocket.
		 */
		createSocket?: SocketFactory | null;
	}

	const TAIL = 200;
	const REFRESH_MS = 3000;

	let {
		serverId,
		running,
		refreshKey = 0,
		createSocket = browserSocketFactory()
	}: Props = $props();

	const buffer = new ConsoleBuffer();
	let lines = $state.raw<ConsoleEntry[]>([]);
	let loaded = $state(false);
	let loading = $state(false);
	let error = $state.raw<unknown>(null);
	let updatedAt = $state<Date | null>(null);
	let autoRefresh = $state(true);
	/** Live stream state; `null` while not streaming. */
	let stream = $state<StreamStatus | null>(null);
	/** The stream failed or is unsupported for this server: poll snapshots instead. */
	let fallback = $state(false);
	/** Bumped by Refresh in stream mode to reconnect (and receive a fresh snapshot). */
	let reconnect = $state(0);
	let visible = $state(typeof document === 'undefined' || document.visibilityState === 'visible');

	let command = $state('');
	let sending = $state(false);
	let commandError = $state.raw<unknown>(null);

	let viewport = $state<HTMLElement | null>(null);
	let pinned = true;
	let manual: AbortController | null = null;
	let followUp: ReturnType<typeof setTimeout> | undefined;

	async function show(entries: ConsoleEntry[]) {
		lines = entries;
		loaded = true;
		updatedAt = new Date();
		if (pinned) {
			await tick();
			viewport?.scrollTo({ top: viewport.scrollHeight });
		}
	}

	/** Replaces the snapshot; the console endpoint has no cursor, so never append. */
	async function load(id: string, signal: AbortSignal) {
		loading = true;
		try {
			const { items } = await getConsole(id, TAIL, { signal });
			error = null;
			await show(buffer.replace(items));
		} catch (cause) {
			if (!isAbortError(cause)) error = cause;
			throw cause;
		} finally {
			loading = false;
		}
	}

	const live = $derived(running && autoRefresh);
	const streaming = $derived(live && !fallback && createSocket !== null);

	$effect(() => {
		// Restart on server, running state, toggle, visibility, transport or refresh changes.
		const id = serverId;
		const isLive = live;
		const useStream = streaming;
		const isVisible = visible;
		void refreshKey;
		void reconnect;
		const controller = new AbortController();
		untrack(() => {
			stream = null;
			if (isLive && useStream) {
				// Hidden tab: no socket at all; becoming visible reconnects with a fresh snapshot.
				if (!isVisible) return;
				connectConsoleStream(
					{
						onSnapshot: (items: ConsoleLine[]) => {
							error = null;
							void show(buffer.replace(items));
						},
						onLine: (line: ConsoleLine) => void show(buffer.append(line)),
						onStatus: (status) => (stream = status),
						onError: (code, detail) => (error = new ApiError(502, code, detail)),
						onFallback: () => {
							stream = null;
							fallback = true;
						}
					},
					{ signal: controller.signal, createSocket, url: consoleStreamUrl(id) }
				);
			} else if (isLive) {
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

	// A new server or a lifecycle action deserves another WebSocket attempt.
	$effect(() => {
		void serverId;
		void refreshKey;
		untrack(() => (fallback = false));
	});

	$effect(() => () => {
		clearTimeout(followUp);
		manual?.abort();
	});

	function refreshNow() {
		if (streaming) {
			reconnect += 1;
			return;
		}
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
			// The live stream delivers the reply; snapshots need a fresh read after a moment.
			if (stream !== 'live') {
				clearTimeout(followUp);
				followUp = setTimeout(refreshNow, 600);
			}
		} catch (cause) {
			commandError = cause;
		} finally {
			sending = false;
		}
	}
</script>

<svelte:document onvisibilitychange={() => (visible = document.visibilityState === 'visible')} />

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
		<p class="flex items-center gap-1.5" role="status">
			{#if stream === 'live'}
				<span class="size-1.5 rounded-full bg-success" aria-hidden="true"></span>
				Live · last {buffer.limit} lines kept
			{:else if stream === 'connecting'}
				<Spinner class="size-3" /> Connecting…
			{:else if stream === 'reconnecting'}
				<Spinner class="size-3" /> Reconnecting…
			{:else if stream === 'ended'}
				Log stream ended{#if updatedAt}&nbsp;at {formatTime(updatedAt)}{/if}.
			{:else}
				Snapshot of the last {TAIL} lines{#if updatedAt}, taken {formatTime(updatedAt)}{/if}.
				{#if live && streaming && !visible}Paused while this tab is hidden.{:else if live}{`Refreshes every ${REFRESH_MS / 1000}s while this tab is visible.`}{/if}
			{/if}
		</p>
		<div class="flex items-center gap-3">
			<Field.Field orientation="horizontal" class="w-auto">
				<Switch id="console-auto" bind:checked={autoRefresh} disabled={!running} size="sm" />
				<Field.Label for="console-auto" class="text-xs font-normal">Live</Field.Label>
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
		aria-label="Server console"
	>
		{#if !loaded && loading}
			<p class="text-muted-foreground">Loading console…</p>
		{:else if lines.length === 0}
			<p class="text-muted-foreground">
				{running ? 'No output yet.' : 'No output. Start the server to see its console.'}
			</p>
		{:else}
			{#each lines as { id, line } (id)}
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
