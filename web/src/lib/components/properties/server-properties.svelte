<script lang="ts">
	import ListIcon from '@lucide/svelte/icons/list';
	import CodeIcon from '@lucide/svelte/icons/code';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { isAbortError, type ServerState } from '#lib/api/index.js';
	import { detectEol } from '#lib/files/properties.js';
	import {
		PropertiesStore,
		type PropertiesStoreOptions
	} from '#lib/properties/properties-store.svelte.js';
	import { collapse, fadeIn } from '#lib/motion/index.js';
	import PropertiesForm from './properties-form.svelte';
	import PropertiesHistory from './properties-history.svelte';

	type Mode = 'form' | 'raw';

	interface Props {
		serverId: string;
		serverState: ServerState;
		/** Unsaved or in-flight changes, for a tab indicator. */
		pending?: boolean;
		/** Opens Settings → Network from the managed game-port row. */
		onEditNetwork?: () => void;
		/** Injected in tests. */
		options?: PropertiesStoreOptions;
	}

	let {
		serverId,
		serverState,
		pending = $bindable(false),
		onEditNetwork,
		options
	}: Props = $props();

	// The parent keys this component by server, so one store per server.
	const store = new PropertiesStore(
		untrack(() => serverId),
		untrack(() => options)
	);

	/** Finish the queued revision before a start/restart or in-app navigation. */
	export async function flushPending(): Promise<boolean> {
		await store.flush();
		return !store.pending && !store.saving && !store.conflict;
	}

	export async function refreshMetadata(): Promise<void> {
		await store.refresh();
	}
	$effect(() => {
		void store.load();
		return () => store.destroy();
	});
	$effect(() => {
		pending = store.pending || store.saving;
	});

	// Start/stop changes the applied version: refresh metadata (local edits are kept).
	let lastState = untrack(() => serverState);
	$effect(() => {
		const next = serverState;
		if (next === lastState) return;
		lastState = next;
		void untrack(() => store.refresh());
	});

	let mode = $state<Mode>('form');
	let historyOpen = $state(false);
	/** Version shown read-only from history. */
	let viewing = $state.raw<{ version: number; content: string } | null>(null);
	let viewError = $state.raw<unknown>(null);
	let viewAbort: AbortController | null = null;
	let restoring = $state(false);
	$effect(() => () => viewAbort?.abort());

	async function selectVersion(version: number | null) {
		viewAbort?.abort();
		viewError = null;
		if (version === null) {
			viewing = null;
			return;
		}
		viewAbort = new AbortController();
		try {
			const result = await store.api.getPropertiesVersion(serverId, version, {
				signal: viewAbort.signal
			});
			viewing = { version: result.version, content: result.content };
		} catch (error) {
			if (!isAbortError(error)) viewError = error;
		}
	}

	async function restore() {
		if (!viewing || restoring) return;
		const from = viewing.version;
		restoring = true;
		try {
			if (await store.restore(from)) {
				viewing = null;
				toast.success(`Restored v${from} as v${store.doc?.version}`, {
					description: running
						? 'The server keeps running; restart it to apply.'
						: 'It applies on the next start.'
				});
			}
		} finally {
			restoring = false;
		}
	}

	const running = $derived(serverState === 'running');
	const doc = $derived(store.doc);
	const fileEol = $derived(detectEol(store.saved));
	const withFileEol = (text: string) => (fileEol === '\n' ? text : text.replace(/\n/g, fileEol));
	const restoreBlocked = $derived(store.pending || store.saving || store.conflict);

	const appliedText = $derived.by(() => {
		if (!doc) return '';
		if (!running) return `Next start uses v${doc.version}`;
		if (doc.appliedVersion === null)
			return 'Running version unknown until a restart from Chunkyard';
		if (doc.restartRequired)
			return `Running v${doc.appliedVersion} · restart to apply v${doc.version}`;
		return `Running v${doc.appliedVersion}`;
	});

	function onRawKeydown(event: KeyboardEvent) {
		const mod = event.ctrlKey || event.metaKey;
		if (mod && (event.key === 'Enter' || event.key.toLowerCase() === 's')) {
			event.preventDefault();
			void store.flush();
		}
	}

	function onbeforeunload(event: BeforeUnloadEvent) {
		// Only a real page unload can lose a queued save; in-app navigation flushes it.
		if (store.pending || store.saving) event.preventDefault();
	}

	const MODES = [
		{ value: 'form', label: 'Form', icon: ListIcon },
		{ value: 'raw', label: 'Raw text', icon: CodeIcon }
	] as const;
</script>

<svelte:window {onbeforeunload} />

{#snippet saveStatus()}
	{@const state = store.state}
	<span class="flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
		{#if state === 'loading'}
			<Spinner class="size-3" /> <span class="text-muted-foreground">Loading…</span>
		{:else if state === 'saving'}
			<Spinner class="size-3" /> <span class="text-muted-foreground">Saving…</span>
		{:else if state === 'retrying'}
			<Spinner class="size-3" /> <span class="text-muted-foreground">Server busy, retrying…</span>
		{:else if state === 'pending'}
			<span class="size-1.5 rounded-full bg-warning" aria-hidden="true"></span>
			<span class="text-muted-foreground">Unsaved · saves automatically</span>
		{:else if state === 'error'}
			<CircleAlertIcon class="size-3.5 text-destructive" aria-hidden="true" />
			<span class="text-destructive">Not saved</span>
			<Button variant="link" size="xs" class="h-auto p-0" onclick={() => store.flush()}
				>Retry</Button
			>
		{:else if state === 'conflict'}
			<CircleAlertIcon class="size-3.5 text-destructive" aria-hidden="true" />
			<span class="text-destructive">Changed elsewhere</span>
		{:else if doc}
			<span in:fadeIn class="flex items-center gap-1 text-muted-foreground">
				<CheckIcon class="size-3.5 text-success" aria-hidden="true" />
				Saved · v{doc.version}
			</span>
		{/if}
	</span>
{/snippet}

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
		{@render saveStatus()}
		{#if doc}
			<span class="text-xs text-muted-foreground" data-testid="applied-version">{appliedText}</span>
			{#if running && doc.restartRequired && doc.appliedVersion !== null}
				<span in:fadeIn><Badge variant="warning">Restart to apply</Badge></span>
			{/if}
		{/if}
		<div class="ml-auto flex items-center gap-2">
			<div
				class="flex items-center rounded-md border border-border p-0.5"
				role="group"
				aria-label="Editor view"
			>
				{#each MODES as option (option.value)}
					<Button
						variant={mode === option.value ? 'secondary' : 'ghost'}
						size="xs"
						aria-pressed={mode === option.value}
						onclick={() => (mode = option.value)}
					>
						<option.icon data-icon="inline-start" />
						{option.label}
					</Button>
				{/each}
			</div>
			<Button
				variant={historyOpen ? 'secondary' : 'outline'}
				size="sm"
				aria-pressed={historyOpen}
				onclick={() => {
					historyOpen = !historyOpen;
					if (!historyOpen) void selectVersion(null);
				}}
			>
				<HistoryIcon data-icon="inline-start" />
				History
			</Button>
		</div>
	</div>

	{#if store.conflict}
		<div transition:collapse>
			<Alert.Root variant="destructive" role="alert">
				<TriangleAlertIcon />
				<Alert.Title>Properties changed elsewhere</Alert.Title>
				<Alert.Description class="flex flex-col gap-2">
					<p>
						Your latest edits were not saved and nothing was overwritten. Load the latest version
						(discarding your edits), or keep yours and save them as a new version on top.
					</p>
					<div class="flex flex-wrap gap-2">
						<Button size="sm" variant="outline" onclick={() => store.reloadLatest()}>
							Load latest
						</Button>
						<Button size="sm" variant="outline" onclick={() => store.keepMine()}>Keep mine</Button>
					</div>
				</Alert.Description>
			</Alert.Root>
		</div>
	{:else if store.error && store.state === 'error'}
		<div transition:collapse>
			<ErrorAlert error={store.error}>
				<Button size="sm" variant="outline" class="mt-2" onclick={() => store.flush()}>
					Retry save
				</Button>
			</ErrorAlert>
		</div>
	{/if}

	<div class={['grid gap-3', historyOpen && 'lg:grid-cols-[minmax(0,1fr)_16rem]']}>
		<div class="flex min-w-0 flex-col gap-3">
			{#if store.loading && !doc}
				<Skeleton class="h-96 w-full" />
			{:else if store.loadError && !doc}
				<ErrorAlert error={store.loadError}>
					<Button size="sm" variant="outline" class="mt-2" onclick={() => store.load()}>
						Retry
					</Button>
				</ErrorAlert>
			{:else if viewing}
				<div
					class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm"
					role="status"
				>
					<EyeIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span class="min-w-0 flex-1">
						Viewing <span class="font-mono">v{viewing.version}</span> (read-only).
						<span class="text-xs text-muted-foreground"
							>Dots mark settings that differ from the latest.</span
						>
					</span>
					<Button size="sm" variant="ghost" onclick={() => selectVersion(null)}
						>Back to latest</Button
					>
					<Button
						size="sm"
						onclick={restore}
						disabled={restoreBlocked || restoring}
						title={restoreBlocked ? 'Wait until your edits are saved' : undefined}
					>
						{#if restoring}<Spinner data-icon="inline-start" />{/if}
						Restore as new version
					</Button>
				</div>
				{#if mode === 'form'}
					<PropertiesForm
						content={viewing.content}
						original={store.saved}
						disabled
						changedLabel="Differs from latest"
						onChange={() => {}}
					/>
				{:else}
					<textarea
						value={viewing.content.replace(/\r\n?/g, '\n')}
						readonly
						spellcheck={false}
						wrap="off"
						aria-label={`Contents of version ${viewing.version}`}
						class="block min-h-96 w-full resize-y rounded-lg border border-border bg-background p-4 font-mono text-[13px] leading-relaxed text-muted-foreground outline-none"
					></textarea>
				{/if}
			{:else if viewError}
				<ErrorAlert error={viewError} />
			{:else if mode === 'form'}
				<PropertiesForm
					content={store.content}
					original={store.saved}
					disabled={!store.editable}
					onChange={(next, immediate) => store.edit(next, immediate)}
					onCommit={() => store.flush()}
					onRawRequest={() => (mode = 'raw')}
					{onEditNetwork}
				/>
			{:else}
				<div class="overflow-hidden rounded-lg border border-border bg-background">
					<textarea
						value={store.content.replace(/\r\n?/g, '\n')}
						oninput={(event) => store.edit(withFileEol(event.currentTarget.value))}
						onkeydown={onRawKeydown}
						readonly={!store.editable}
						spellcheck={false}
						autocomplete="off"
						autocapitalize="off"
						wrap="off"
						aria-label="Contents of server.properties"
						class="block min-h-96 w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none read-only:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
						style:height="min(70vh, {Math.max(24, store.content.split('\n').length + 2) * 1.625}em)"
					></textarea>
					<p class="border-t border-border px-4 py-2 text-xs text-muted-foreground">
						Saves after a pause · Ctrl/⌘ + Enter saves now
					</p>
				</div>
			{/if}
			{#if doc && !viewing}
				<p class="text-xs text-muted-foreground">
					Saved versions apply on the next start or restart; saving never restarts the server.
				</p>
			{/if}
		</div>
		{#if historyOpen && doc}
			<div transition:collapse class="min-w-0">
				<PropertiesHistory {store} selected={viewing?.version ?? null} onSelect={selectVersion} />
			</div>
		{/if}
	</div>
</div>
