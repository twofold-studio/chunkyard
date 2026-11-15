<script lang="ts" module>
	import type { Job, PlayerChange, PlayerLists } from '#lib/api/index.js';

	export interface PlayersApi {
		load: (serverId: string, signal: AbortSignal) => Promise<PlayerLists>;
		submit: (serverId: string, change: PlayerChange, signal: AbortSignal) => Promise<{ job: Job }>;
		wait: (job: Job, signal: AbortSignal, onUpdate: (job: Job) => void) => Promise<Job>;
	}
</script>

<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import BanIcon from '@lucide/svelte/icons/ban';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		changePlayer,
		errorCode,
		getPlayers,
		isAbortError,
		isJobActive,
		waitForJob,
		type PlayerListName,
		type ServerState
	} from '#lib/api/index.js';
	import {
		buildAdd,
		buildRemove,
		entryView,
		LIST_FILES,
		LIST_LABELS,
		listsFromResult,
		OPERATOR_LEVELS,
		suggestions,
		type EntryView
	} from '#lib/players/players.js';
	import { resolve } from '$app/paths';

	interface Props {
		serverId: string;
		serverState: ServerState;
		/** Another server operation is running (start/stop, export, install…). */
		busy?: boolean;
		onOpenFiles?: () => void;
		onOpenProperties?: () => void;
		/** Injected in tests. */
		api?: PlayersApi;
		jobIntervalMs?: number;
	}

	let {
		serverId,
		serverState,
		busy = false,
		onOpenFiles,
		onOpenProperties,
		api: apiProp,
		jobIntervalMs = 1000
	}: Props = $props();

	const api: PlayersApi = untrack(() => apiProp) ?? {
		load: (id, signal) => getPlayers(id, { signal }),
		submit: (id, change, signal) => changePlayer(id, change, { signal }),
		wait: (job, signal, onUpdate) =>
			waitForJob(job, { signal, intervalMs: jobIntervalMs, onUpdate })
	};

	const formId = $props.id();
	let lists = $state.raw<PlayerLists | null>(null);
	let loadError = $state.raw<unknown>(null);
	let loading = $state(false);
	let list = $state<PlayerListName>('whitelist');

	let name = $state('');
	let uuid = $state('');
	let level = $state<number | null>(null);
	let reason = $state('');
	let formError = $state<string | null>(null);

	/** Change awaiting explicit confirmation (removals, operators and bans). */
	let confirming = $state.raw<PlayerChange | null>(null);
	let job = $state.raw<Job | null>(null);
	let submitting = $state(false);
	let jobError = $state.raw<unknown>(null);
	let failedJobId = $state<string | null>(null);

	const abort = new AbortController();
	$effect(() => () => abort.abort());
	let loadAbort: AbortController | null = null;

	async function load() {
		loadAbort?.abort();
		const controller = (loadAbort = new AbortController());
		const stop = () => controller.abort();
		abort.signal.addEventListener('abort', stop, { once: true });
		loading = true;
		loadError = null;
		try {
			const next = await api.load(serverId, controller.signal);
			if (!controller.signal.aborted) lists = next;
		} catch (error) {
			if (!isAbortError(error) && !controller.signal.aborted) loadError = error;
		} finally {
			abort.signal.removeEventListener('abort', stop);
			if (loadAbort === controller) loading = false;
		}
	}

	// Load on entry and when the server starts or stops (live vs file edits, saved flags).
	$effect(() => {
		void serverState;
		untrack(() => void load());
	});

	const running = $derived(serverState === 'running' || (lists?.running ?? false));
	const working = $derived(submitting || (job !== null && isJobActive(job)));
	const disabled = $derived(busy || working || lists === null);
	const entries = $derived<EntryView[]>(lists ? lists[list].map(entryView) : []);
	const known = $derived(lists ? suggestions(lists, list) : []);

	function resetForm() {
		name = '';
		uuid = '';
		reason = '';
		level = null;
		formError = null;
	}

	function selectList(next: string) {
		if (next === 'whitelist' || next === 'operators' || next === 'bans') {
			list = next;
			formError = null;
		}
	}

	function onAdd(event: SubmitEvent) {
		event.preventDefault();
		if (disabled) return;
		const built = buildAdd({ list, name, uuid, level, reason }, running);
		if (!built.ok) {
			formError = built.error;
			return;
		}
		formError = null;
		// Whitelist additions are low-risk; operators and bans are confirmed.
		if (list === 'whitelist') void submit(built.change);
		else confirming = built.change;
	}

	function onRemove(entry: EntryView) {
		if (disabled || !entry.name) return;
		const built = buildRemove(list, entry.name);
		if (built.ok) confirming = built.change;
		else toast.error(built.error);
	}

	function confirm() {
		const change = confirming;
		confirming = null;
		if (change && !disabled) void submit(change);
	}

	async function submit(change: PlayerChange) {
		submitting = true;
		jobError = null;
		failedJobId = null;
		job = null;
		try {
			const { job: initial } = await api.submit(serverId, change, abort.signal);
			job = initial;
			submitting = false;
			const final = await api.wait(initial, abort.signal, (update) => (job = update));
			job = final;
			if (final.state === 'succeeded') {
				const updated = listsFromResult(final.result);
				if (updated) lists = updated;
				else await load();
				if (change.action === 'add') resetForm();
				toast.success(successText(change));
			} else {
				jobError = final.error ?? {
					code: `job.${final.state}`,
					detail: `The player change ${final.state}.`
				};
				failedJobId = final.id;
				await load();
			}
		} catch (error) {
			if (!isAbortError(error)) jobError = error;
		} finally {
			submitting = false;
		}
	}

	function successText(change: PlayerChange): string {
		const who = change.name;
		if (change.list === 'whitelist')
			return change.action === 'add' ? `${who} whitelisted` : `${who} removed from the whitelist`;
		if (change.list === 'operators')
			return change.action === 'add' ? `${who} is an operator` : `${who} is no longer an operator`;
		return change.action === 'add' ? `${who} banned` : `${who} pardoned`;
	}

	const confirmTitle = $derived.by(() => {
		const change = confirming;
		if (!change) return '';
		if (change.action === 'remove') {
			if (change.list === 'whitelist') return `Remove ${change.name} from the whitelist?`;
			if (change.list === 'operators') return `Remove operator rights from ${change.name}?`;
			return `Pardon ${change.name}?`;
		}
		return change.list === 'operators' ? `Make ${change.name} an operator?` : `Ban ${change.name}?`;
	});

	const confirmText = $derived.by(() => {
		const change = confirming;
		if (!change) return '';
		const how = running
			? 'Sent as a Minecraft console command; the change is confirmed from the server files.'
			: 'Written to the server files; it applies when the server next starts.';
		if (change.list === 'operators' && change.action === 'add')
			return `${how} ${
				change.level != null
					? `Operator level ${change.level}.`
					: running
						? "The server's configured operator level applies."
						: 'Level 4 (full) unless you choose another.'
			}`;
		if (change.list === 'bans' && change.action === 'add')
			return `${how} ${change.reason ? `Reason: “${change.reason}”.` : 'No reason given.'}`;
		return how;
	});

	const listIcons = { whitelist: ListChecksIcon, operators: ShieldIcon, bans: BanIcon };
	const addLabel: Record<PlayerListName, string> = {
		whitelist: 'Add to whitelist',
		operators: 'Make operator',
		bans: 'Ban player'
	};
	const invalidFile = $derived(
		errorCode(loadError) === 'players.invalid_file' ||
			errorCode(jobError) === 'players.invalid_file'
	);
</script>

<div class="flex flex-col gap-4" data-testid="server-players">
	<section
		class="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3"
		aria-label="Player settings"
	>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
			<UsersIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<span class="text-sm font-medium">Players</span>
			<span class="text-xs text-muted-foreground" data-testid="players-mode">
				{running
					? 'Running: changes are sent as console commands and confirmed from the files.'
					: 'Stopped: changes edit the list files and apply on the next start.'}
			</span>
			<Button
				variant="ghost"
				size="icon-xs"
				class="ml-auto"
				onclick={() => load()}
				disabled={loading}
				aria-label="Refresh player lists"
			>
				{#if loading}<Spinner />{:else}<RotateCwIcon />{/if}
			</Button>
		</div>
		{#if lists}
			<dl class="flex flex-wrap gap-x-6 gap-y-1 text-xs" data-testid="players-flags">
				<div class="flex items-center gap-1.5">
					<dt class="text-muted-foreground">Whitelist enforcement</dt>
					<dd>
						<Badge variant={lists.whitelistEnabled ? 'success' : 'outline'}
							>{lists.whitelistEnabled ? 'On' : 'Off'}</Badge
						>
					</dd>
				</div>
				<div class="flex items-center gap-1.5">
					<dt class="text-muted-foreground">Online mode</dt>
					<dd>
						<Badge variant={lists.onlineMode ? 'outline' : 'warning'}
							>{lists.onlineMode ? 'On' : 'Off'}</Badge
						>
					</dd>
				</div>
				<dd class="text-muted-foreground">
					Saved in Properties{running ? '; a saved change applies after a restart' : ''}.
					{#if onOpenProperties}
						<button
							type="button"
							class="underline underline-offset-4 hover:text-foreground"
							onclick={onOpenProperties}>Change in Properties</button
						>
					{/if}
				</dd>
			</dl>
			{#if !lists.whitelistEnabled && list === 'whitelist'}
				<p class="text-xs text-muted-foreground">
					The whitelist is not enforced, so anyone can join. Entries are kept for when it is turned
					on.
				</p>
			{/if}
			{#if !lists.onlineMode}
				<p class="text-xs text-warning">
					Online mode is off: identities are not verified by Mojang, and new entries use offline
					UUIDs unless you supply one.
				</p>
			{/if}
		{/if}
	</section>

	{#if loadError}
		<ErrorAlert error={loadError}>
			<div class="mt-2 flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onclick={() => load()}>Retry</Button>
				{#if invalidFile && onOpenFiles}
					<Button size="sm" variant="outline" onclick={onOpenFiles}>Open Files</Button>
				{/if}
			</div>
		</ErrorAlert>
	{:else if lists === null}
		<Skeleton class="h-40 w-full" />
	{:else}
		<Tabs.Root value={list} onValueChange={selectList} class="gap-3">
			<Tabs.List aria-label="Player list">
				{#each ['whitelist', 'operators', 'bans'] as const as key (key)}
					{@const Icon = listIcons[key]}
					<Tabs.Trigger value={key}>
						<Icon data-icon="inline-start" aria-hidden="true" />
						{LIST_LABELS[key]}
						<span class="font-mono text-xs text-muted-foreground tabular-nums"
							>{lists[key].length}</span
						>
					</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>

		<form
			class="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3"
			onsubmit={onAdd}
			aria-label={addLabel[list]}
			novalidate
		>
			<div class="flex flex-wrap items-end gap-3">
				<label
					class="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground"
				>
					Player name
					<Input
						bind:value={name}
						list={`${formId}-known`}
						autocomplete="off"
						spellcheck={false}
						maxlength={16}
						placeholder="ExamplePlayer"
						class="h-8 font-mono"
						aria-invalid={formError ? true : undefined}
						aria-describedby={`${formId}-error`}
						{disabled}
					/>
				</label>
				<datalist id={`${formId}-known`}>
					{#each known as option (option)}<option value={option}></option>{/each}
				</datalist>
				<label
					class="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground"
				>
					UUID (optional)
					<Input
						bind:value={uuid}
						autocomplete="off"
						spellcheck={false}
						placeholder="Resolved automatically"
						class="h-8 font-mono"
						{disabled}
					/>
				</label>
				{#if list === 'operators'}
					<div class="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
						<span id={`${formId}-level`}>Level</span>
						{#if running}
							<span class="flex h-8 items-center text-xs font-normal">Server default (live op)</span
							>
						{:else}
							<Select.Root
								type="single"
								value={level === null ? '' : String(level)}
								onValueChange={(next) => (level = next ? Number(next) : null)}
								{disabled}
							>
								<Select.Trigger size="sm" class="h-8! w-52" aria-labelledby={`${formId}-level`}>
									{level === null
										? 'Default (4 · Full)'
										: (OPERATOR_LEVELS.find((l) => l.value === level)?.label ?? level)}
								</Select.Trigger>
								<Select.Content>
									{#each OPERATOR_LEVELS as option (option.value)}
										<Select.Item value={String(option.value)} label={option.label}
											>{option.label}</Select.Item
										>
									{/each}
								</Select.Content>
							</Select.Root>
						{/if}
					</div>
				{/if}
				{#if list === 'bans'}
					<label
						class="flex min-w-48 flex-[2] flex-col gap-1 text-xs font-medium text-muted-foreground"
					>
						Reason (optional)
						<Input
							bind:value={reason}
							autocomplete="off"
							placeholder="One line, up to 256 bytes"
							class="h-8"
							{disabled}
						/>
					</label>
				{/if}
				<Button type="submit" size="sm" {disabled}>
					{#if working}<Spinner data-icon="inline-start" />{:else}<PlusIcon
							data-icon="inline-start"
						/>{/if}
					{addLabel[list]}
				</Button>
			</div>
			<p
				id={`${formId}-error`}
				class={['text-xs', formError ? 'text-destructive' : 'text-muted-foreground']}
				data-testid="players-form-hint"
			>
				{formError ??
					(running && list === 'operators'
						? 'While running, Minecraft applies its configured operator level. Stop the server to choose one.'
						: 'Names are 3–16 letters, digits or underscores. Known players are suggested; others are looked up by name.')}
			</p>
		</form>

		{#if working}
			<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
				<Spinner class="size-3.5" />
				Applying… {job ? `job ${job.state}` : 'requesting'}
			</p>
		{:else if jobError}
			<ErrorAlert error={jobError}>
				<div class="mt-1 flex flex-wrap items-center gap-3">
					{#if invalidFile && onOpenFiles}
						<Button size="sm" variant="outline" onclick={onOpenFiles}
							>Open {LIST_FILES[list]} in Files</Button
						>
					{/if}
					{#if failedJobId}
						<a
							href={resolve(`activity/${failedJobId}`)}
							class="text-xs underline underline-offset-4"
							data-testid="players-job-link">Job details in Activity</a
						>
					{/if}
				</div>
			</ErrorAlert>
		{/if}

		<section aria-label={`${LIST_LABELS[list]} entries`}>
			{#if entries.length === 0}
				<p
					class="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
				>
					{list === 'whitelist'
						? 'Nobody is whitelisted.'
						: list === 'operators'
							? 'No operators.'
							: 'No banned players.'}
				</p>
			{:else}
				<ul class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
					{#each entries as entry (entry.key)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate font-mono text-sm">{entry.name ?? 'Unnamed entry'}</span>
								<span class="truncate font-mono text-xs text-muted-foreground"
									>{entry.uuid ?? 'No UUID'}</span
								>
							</span>
							{#if list === 'operators' && entry.level !== null}
								<Badge variant="outline">Level {entry.level}</Badge>
							{/if}
							{#if list === 'bans'}
								<span class="flex min-w-0 flex-col text-xs text-muted-foreground sm:max-w-80">
									{#if entry.reason}<span class="truncate" title={entry.reason}>{entry.reason}</span
										>{/if}
									<span class="truncate"
										>{entry.expires && entry.expires !== 'forever'
											? `Until ${entry.expires}`
											: 'Permanent'}{entry.source ? ` · by ${entry.source}` : ''}</span
									>
								</span>
							{/if}
							<Button
								variant="ghost"
								size="sm"
								class="text-destructive hover:text-destructive"
								disabled={disabled || !entry.name}
								onclick={() => onRemove(entry)}
								aria-label={`${list === 'bans' ? 'Pardon' : 'Remove'} ${entry.name ?? 'entry'}`}
							>
								<TrashIcon data-icon="inline-start" />
								{list === 'bans' ? 'Pardon' : 'Remove'}
							</Button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

<AlertDialog.Root bind:open={() => confirming !== null, (open) => !open && (confirming = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{confirmTitle}</AlertDialog.Title>
			<AlertDialog.Description>{confirmText}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={confirm}
				variant={confirming?.action === 'remove' || confirming?.list === 'bans'
					? 'destructive'
					: 'default'}
				data-testid="players-confirm"
			>
				{confirming?.action === 'remove'
					? confirming.list === 'bans'
						? 'Pardon'
						: 'Remove'
					: confirming?.list === 'bans'
						? 'Ban'
						: 'Make operator'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
