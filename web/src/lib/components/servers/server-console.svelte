<script lang="ts">
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import SendIcon from '@lucide/svelte/icons/send-horizontal';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import WrapTextIcon from '@lucide/svelte/icons/wrap-text';
	import ArrowDownToLineIcon from '@lucide/svelte/icons/arrow-down-to-line';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import { toast } from 'svelte-sonner';
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
	import {
		commandHistoryFor,
		consoleFileName,
		consoleText,
		filterLines,
		matchSegments
	} from '#lib/console/command-history.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		serverId: string;
		/** Used for download file names; defaults to the id. */
		serverName?: string;
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
		serverName,
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
	/** Keep the newest line in view; scrolling up pauses, Jump to latest resumes. */
	let follow = $state(true);
	/** Last entry id seen while following; newer entries count as unseen when paused. */
	let seenId = $state(-1);
	let wrap = $state(true);
	let query = $state('');
	let commandInput = $state<HTMLInputElement | null>(null);

	// View-only filter: the live buffer and the server's logs are never changed.
	const visibleLines = $derived(filterLines(lines, query));
	const filtering = $derived(query.trim().length > 0);
	const unseen = $derived(follow ? 0 : lines.filter((entry) => entry.id > seenId).length);
	const history = $derived(commandHistoryFor(serverId));
	let manual: AbortController | null = null;
	let followUp: ReturnType<typeof setTimeout> | undefined;

	async function show(entries: ConsoleEntry[], replaced = false) {
		lines = entries;
		loaded = true;
		updatedAt = new Date();
		// A snapshot re-keys every line; it is not "new output" for the paused counter.
		if (replaced && !follow) seenId = entries.at(-1)?.id ?? -1;
		if (follow) await scrollToEnd();
	}

	async function scrollToEnd() {
		seenId = lines.at(-1)?.id ?? -1;
		await tick();
		viewport?.scrollTo({ top: viewport.scrollHeight });
	}

	function setFollow(next: boolean) {
		follow = next;
		if (next) void scrollToEnd();
		else seenId = lines.at(-1)?.id ?? -1;
	}

	/** Replaces the snapshot; the console endpoint has no cursor, so never append. */
	async function load(id: string, signal: AbortSignal) {
		loading = true;
		try {
			const { items } = await getConsole(id, TAIL, { signal });
			error = null;
			await show(buffer.replace(items), true);
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
							void show(buffer.replace(items), true);
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
		const atEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24;
		if (atEnd !== follow) setFollow(atEnd);
	}

	// Changing the filter or wrapping keeps the newest line in view while following.
	$effect(() => {
		void query;
		void wrap;
		if (untrack(() => follow))
			void tick().then(() => viewport?.scrollTo({ top: viewport.scrollHeight }));
	});

	async function copyLines() {
		const text = consoleText(visibleLines.map((entry) => entry.line));
		try {
			await navigator.clipboard.writeText(text);
			toast.success(
				`Copied ${visibleLines.length} ${visibleLines.length === 1 ? 'line' : 'lines'}`
			);
		} catch {
			toast.error('Could not copy to the clipboard');
		}
	}

	function downloadLines() {
		const text = consoleText(visibleLines.map((entry) => entry.line));
		const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = consoleFileName(serverName ?? serverId, new Date());
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	function onFilterKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && query) {
			event.preventDefault();
			query = '';
		}
	}

	/** Up/Down recall sent commands; Enter still only sends what is in the field. */
	function onCommandKeydown(event: KeyboardEvent) {
		if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
			return;
		let recalled: string | null = null;
		if (event.key === 'ArrowUp') recalled = history.previous(command);
		else if (event.key === 'ArrowDown') recalled = history.next();
		else return;
		event.preventDefault();
		if (recalled === null) return;
		command = recalled;
		void tick().then(() => commandInput?.setSelectionRange(recalled.length, recalled.length));
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		const line = command.trim();
		if (!line || sending) return;
		sending = true;
		commandError = null;
		const recall = history;
		try {
			await sendCommand(serverId, line);
			recall.push(line);
			command = '';
			setFollow(true);
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

	<div class="flex flex-wrap items-center gap-2">
		<div class="relative min-w-48 flex-1">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<label for="console-filter" class="sr-only">Filter console output</label>
			<Input
				id="console-filter"
				type="search"
				bind:value={query}
				onkeydown={onFilterKeydown}
				placeholder="Filter output"
				autocomplete="off"
				spellcheck={false}
				class="h-8 pr-8 pl-8 font-mono text-xs md:text-xs [&::-webkit-search-cancel-button]:hidden"
			/>
			{#if query}
				<Button
					variant="ghost"
					size="icon-xs"
					class="absolute top-1/2 right-1 -translate-y-1/2"
					onclick={() => (query = '')}
					aria-label="Clear filter"
				>
					<XIcon />
				</Button>
			{/if}
		</div>
		{#if filtering}
			<span class="text-xs text-muted-foreground tabular-nums" role="status">
				{visibleLines.length} of {lines.length}
				{lines.length === 1 ? 'line' : 'lines'}
			</span>
		{/if}
		<div class="flex items-center gap-1">
			<Button
				variant={wrap ? 'secondary' : 'ghost'}
				size="sm"
				aria-pressed={wrap}
				onclick={() => (wrap = !wrap)}
				title="Wrap long lines"
			>
				<WrapTextIcon data-icon="inline-start" />
				Wrap
			</Button>
			<Button
				variant={follow ? 'secondary' : 'ghost'}
				size="sm"
				aria-pressed={follow}
				onclick={() => setFollow(!follow)}
				title="Keep the newest output in view"
			>
				<ArrowDownToLineIcon data-icon="inline-start" />
				Follow
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onclick={copyLines}
				disabled={visibleLines.length === 0}
				title={filtering
					? 'Copy the filtered lines shown above'
					: 'Copy the lines currently held in this view'}
			>
				<CopyIcon data-icon="inline-start" />
				<span class="max-sm:sr-only">Copy</span>
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onclick={downloadLines}
				disabled={visibleLines.length === 0}
				title={filtering
					? 'Download the filtered lines shown above as plain text'
					: 'Download the lines currently held in this view as plain text'}
			>
				<DownloadIcon data-icon="inline-start" />
				<span class="max-sm:sr-only">Download</span>
			</Button>
		</div>
	</div>

	<div class="relative">
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
			{:else if visibleLines.length === 0}
				<p class="text-muted-foreground">No lines match “{query.trim()}”.</p>
			{:else}
				{#each visibleLines as { id, line } (id)}
					<div
						class={cn(
							wrap ? 'break-all whitespace-pre-wrap' : 'w-max min-w-full whitespace-pre',
							line.stream === 'stderr' && 'text-warning'
						)}
					>
						{#if filtering}{#each matchSegments(line.text, query) as segment, index (index)}{#if segment.match}<mark
										class="rounded-[2px] bg-warning/30 text-inherit">{segment.text}</mark
									>{:else}{segment.text}{/if}{/each}{:else}{line.text}{/if}
					</div>
				{/each}
			{/if}
		</div>
		{#if !follow && loaded}
			<div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
				<Button
					size="sm"
					variant="secondary"
					class="pointer-events-auto shadow-md"
					onclick={() => setFollow(true)}
				>
					<ArrowDownToLineIcon data-icon="inline-start" />
					{unseen > 0 ? `Paused · ${unseen} new — jump to latest` : 'Paused · jump to latest'}
				</Button>
			</div>
		{/if}
	</div>

	<form {onsubmit} class="flex flex-col gap-2">
		<div class="flex gap-2">
			<label for="console-command" class="sr-only">Console command</label>
			<Input
				id="console-command"
				bind:ref={commandInput}
				bind:value={command}
				onkeydown={onCommandKeydown}
				oninput={() => history.reset()}
				aria-describedby="console-command-hint"
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
		<p id="console-command-hint" class="text-xs text-muted-foreground">
			↑/↓ recall commands sent from this tab · nothing is sent until you press Enter
		</p>
		{#if commandError}<ErrorAlert error={commandError} />{/if}
	</form>
</div>
