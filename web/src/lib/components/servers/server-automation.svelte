<script lang="ts" module>
	import type { AutomationState, RecoveryPolicy } from '#lib/api/index.js';

	export interface AutomationApi {
		load: (serverId: string, signal: AbortSignal) => Promise<AutomationState>;
		saveRecovery: (
			serverId: string,
			policy: RecoveryPolicy,
			signal: AbortSignal
		) => Promise<AutomationState>;
		saveHistory: (
			serverId: string,
			enabled: boolean,
			signal: AbortSignal
		) => Promise<AutomationState>;
	}
</script>

<script lang="ts">
	import LifeBuoyIcon from '@lucide/svelte/icons/life-buoy';
	import ChartLineIcon from '@lucide/svelte/icons/chart-line';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		getAutomation,
		isAbortError,
		setHistorySettings,
		setRecoveryPolicy
	} from '#lib/api/index.js';
	import {
		formatUnix,
		RECOVERY_LIMITS,
		recoveryStatus,
		sameRecovery,
		validateRecovery
	} from '#lib/servers/automation.js';

	interface Props {
		serverId: string;
		/** Injected in tests. */
		api?: AutomationApi;
		now?: number;
	}

	let { serverId, api: apiProp, now = Date.now() }: Props = $props();
	const api: AutomationApi = untrack(() => apiProp) ?? {
		load: (id, signal) => getAutomation(id, { signal }),
		saveRecovery: (id, policy, signal) => setRecoveryPolicy(id, policy, { signal }),
		saveHistory: (id, enabled, signal) => setHistorySettings(id, enabled, { signal })
	};
	const id = $props.id();

	let automation = $state.raw<AutomationState | null>(null);
	let loadError = $state.raw<unknown>(null);
	let draft = $state<RecoveryPolicy | null>(null);
	let saving = $state(false);
	let saveError = $state.raw<unknown>(null);
	let historySaving = $state(false);
	let historyError = $state.raw<unknown>(null);

	const abort = new AbortController();
	$effect(() => () => abort.abort());

	function apply(next: AutomationState) {
		automation = next;
		draft = { ...next.recovery };
	}

	async function load() {
		loadError = null;
		try {
			apply(await api.load(serverId, abort.signal));
		} catch (error) {
			if (!isAbortError(error)) loadError = error;
		}
	}

	// Read once per server; nothing is saved on load.
	$effect(() => {
		void serverId;
		untrack(() => {
			automation = null;
			draft = null;
			void load();
		});
	});

	const dirty = $derived(
		automation !== null && draft !== null && !sameRecovery(automation.recovery, draft)
	);
	const invalid = $derived(draft ? validateRecovery(draft) : null);
	const status = $derived(automation ? recoveryStatus(automation, now) : null);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!draft || !dirty || invalid || saving) return;
		saving = true;
		saveError = null;
		try {
			apply(await api.saveRecovery(serverId, { ...draft }, abort.signal));
			toast.success('Recovery policy saved');
		} catch (error) {
			if (!isAbortError(error)) saveError = error;
		} finally {
			saving = false;
		}
	}

	async function setHistory(enabled: boolean) {
		if (!automation || historySaving) return;
		historySaving = true;
		historyError = null;
		try {
			const next = await api.saveHistory(serverId, enabled, abort.signal);
			automation = next;
			toast.success(enabled ? 'Resource history on' : 'Resource history off');
		} catch (error) {
			if (!isAbortError(error)) historyError = error;
		} finally {
			historySaving = false;
		}
	}
</script>

{#if loadError}
	<ErrorAlert error={loadError}>
		<Button size="sm" variant="outline" class="mt-2" onclick={() => load()}>Retry</Button>
	</ErrorAlert>
{:else if !automation || !draft}
	<Skeleton class="h-24 w-full" />
{:else}
	<form
		class="flex flex-col gap-3 px-4 py-3"
		onsubmit={save}
		aria-labelledby={`${id}-recovery`}
		data-testid="recovery-policy"
		novalidate
	>
		<div class="flex items-center gap-2">
			<LifeBuoyIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<h2 id={`${id}-recovery`} class="text-sm font-medium">Startup and crash recovery</h2>
		</div>
		<label class="flex items-start gap-3">
			<Switch
				class="mt-0.5"
				bind:checked={draft.autoStart}
				disabled={saving}
				aria-describedby={`${id}-auto-help`}
			/>
			<span class="flex min-w-0 flex-col">
				<span class="text-sm">Start when the manager starts</span>
				<span id={`${id}-auto-help`} class="text-xs text-muted-foreground"
					>Requires an accepted EULA; never takes a port another instance uses.</span
				>
			</span>
		</label>
		<label class="flex items-start gap-3">
			<Switch
				class="mt-0.5"
				bind:checked={draft.restartOnCrash}
				disabled={saving}
				aria-describedby={`${id}-crash-help`}
			/>
			<span class="flex min-w-0 flex-col">
				<span class="text-sm">Restart after a crash</span>
				<span id={`${id}-crash-help`} class="text-xs text-muted-foreground"
					>Only after an unexpected exit. Manual stops and kills, and clean game exits, are left
					alone.</span
				>
			</span>
		</label>
		{#if draft.restartOnCrash}
			<div class="flex flex-wrap gap-4 pl-12">
				<label class="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
					Attempts
					<Input
						type="number"
						min={RECOVERY_LIMITS.attempts.min}
						max={RECOVERY_LIMITS.attempts.max}
						step={1}
						bind:value={draft.maxAttempts}
						class="h-8 w-24 font-mono"
						disabled={saving}
					/>
				</label>
				<label class="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
					Seconds between attempts
					<Input
						type="number"
						min={RECOVERY_LIMITS.delay.min}
						max={RECOVERY_LIMITS.delay.max}
						step={1}
						bind:value={draft.retryDelaySeconds}
						class="h-8 w-28 font-mono"
						disabled={saving}
					/>
				</label>
				<p class="basis-full text-xs text-muted-foreground">
					The attempt budget resets after five minutes of stable uptime, or when you start the
					server yourself.
				</p>
			</div>
		{/if}
		{#if status}
			<p class="text-xs text-muted-foreground" data-testid="recovery-status">{status}</p>
		{/if}
		{#if saveError}<ErrorAlert error={saveError} />{/if}
		<div class="flex flex-wrap items-center justify-end gap-2">
			<span
				class={['mr-auto text-xs', invalid ? 'text-destructive' : 'text-muted-foreground']}
				data-testid="recovery-hint"
			>
				{invalid ?? (dirty ? 'Unsaved changes.' : 'Saved policies only apply after you save them.')}
			</span>
			{#if dirty}
				<Button
					variant="ghost"
					size="sm"
					disabled={saving}
					onclick={() => automation && (draft = { ...automation.recovery })}>Discard</Button
				>
			{/if}
			<Button type="submit" size="sm" disabled={!dirty || !!invalid || saving}>
				{#if saving}<Spinner data-icon="inline-start" />{/if}
				Save recovery
			</Button>
		</div>
	</form>

	<div class="flex flex-col gap-1.5 px-4 py-3" data-testid="history-setting">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
			<ChartLineIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<span id={`${id}-history`} class="text-sm font-medium">Resource history</span>
			<span class="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
				{#if historySaving}<Spinner class="size-3" />{/if}
				{automation.historyEnabled ? 'Collecting' : 'Off'}
				<Switch
					aria-labelledby={`${id}-history`}
					checked={automation.historyEnabled}
					onCheckedChange={(on) => void setHistory(on)}
					disabled={historySaving}
				/>
			</span>
		</div>
		<p class="text-xs text-muted-foreground">
			A CPU and memory snapshot about once a minute while running, even with no browser open. Kept 7
			days. Separate from the live chart refresh.
			{#if automation.lastHistoryAt}Last collection attempt {formatUnix(
					automation.lastHistoryAt
				)}.{/if}
		</p>
		{#if historyError}<ErrorAlert error={historyError} />{/if}
	</div>
{/if}
