<script lang="ts" module>
	import type { AutomationState, BackupScheduleRequest } from '#lib/api/index.js';

	export interface ScheduleApi {
		load: (serverId: string, signal: AbortSignal) => Promise<AutomationState>;
		save: (
			serverId: string,
			body: BackupScheduleRequest,
			signal: AbortSignal
		) => Promise<AutomationState>;
	}
</script>

<script lang="ts">
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		getAutomation,
		isAbortError,
		setBackupSchedule,
		type BackupPolicy,
		type StorageConnection
	} from '#lib/api/index.js';
	import {
		backupResultText,
		backupResultTone,
		buildSchedule,
		formatInterval,
		formatUnix,
		INTERVAL_PRESETS,
		relativeUnix,
		retentionNeedsConfirmation,
		sameBackup,
		SCHEDULE_LIMITS
	} from '#lib/servers/automation.js';
	import { storageTarget } from '#lib/exports/exports.js';
	import { resolve } from '$app/paths';

	interface Props {
		serverId: string;
		/** Saved S3 connection, or `null` while loading or unavailable. */
		storage: StorageConnection | null;
		/** Bumped when a (scheduled) export finished; re-reads the last result. */
		refreshKey?: number;
		/** Injected in tests. */
		api?: ScheduleApi;
		now?: number;
	}

	let { serverId, storage, refreshKey = 0, api: apiProp, now = Date.now() }: Props = $props();
	const api: ScheduleApi = untrack(() => apiProp) ?? {
		load: (id, signal) => getAutomation(id, { signal }),
		save: (id, body, signal) => setBackupSchedule(id, body, { signal })
	};
	const id = $props.id();

	let automation = $state.raw<AutomationState | null>(null);
	let loadError = $state.raw<unknown>(null);
	let draft = $state<BackupPolicy | null>(null);
	let customInterval = $state(false);
	let acknowledged = $state(false);
	let attempted = $state(false);
	let saving = $state(false);
	let saveError = $state.raw<unknown>(null);

	const abort = new AbortController();
	$effect(() => () => abort.abort());

	function apply(next: AutomationState, resetDraft: boolean) {
		automation = next;
		if (resetDraft || !draft) {
			draft = { ...next.backup };
			customInterval = !INTERVAL_PRESETS.some((p) => p.minutes === next.backup.intervalMinutes);
			acknowledged = false;
			attempted = false;
		}
	}

	async function load(resetDraft: boolean) {
		loadError = null;
		try {
			apply(await api.load(serverId, abort.signal), resetDraft);
		} catch (error) {
			if (!isAbortError(error)) loadError = error;
		}
	}

	// Read on entry and after an export finished; never saved from here without the owner.
	$effect(() => {
		void serverId;
		void refreshKey;
		untrack(() => void load(!dirty));
	});

	const s3Ready = $derived(storage?.configured === true);
	const target = $derived(storageTarget(storage));
	const dirty = $derived(
		automation !== null && draft !== null && !sameBackup(automation.backup, draft)
	);
	const needsAck = $derived(
		automation !== null && draft !== null && retentionNeedsConfirmation(automation.backup, draft)
	);
	const built = $derived(
		automation && draft ? buildSchedule(automation.backup, draft, acknowledged, s3Ready) : null
	);
	const hint = $derived(built && !built.ok && (attempted || !needsAck) ? built.error : null);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		if (!built?.ok || !dirty || saving) return;
		saving = true;
		saveError = null;
		try {
			apply(await api.save(serverId, built.request, abort.signal), true);
			toast.success('Backup schedule saved');
		} catch (error) {
			if (!isAbortError(error)) saveError = error;
		} finally {
			saving = false;
		}
	}

	function discard() {
		if (automation) apply(automation, true);
	}

	const presetValue = $derived(customInterval || !draft ? 'custom' : String(draft.intervalMinutes));
	function choosePreset(value: string) {
		if (!draft) return;
		if (value === 'custom') customInterval = true;
		else {
			customInterval = false;
			draft.intervalMinutes = Number(value);
		}
	}
	function setKeepAll(all: boolean) {
		if (!draft) return;
		draft.keepLast = all ? null : (automation?.backup.keepLast ?? 7);
		acknowledged = false;
	}
	const lastTone = $derived(backupResultTone(automation?.lastBackupResult ?? null));
	const lastVariant = $derived(
		lastTone === 'success'
			? 'success'
			: lastTone === 'warning'
				? 'warning'
				: lastTone === 'danger'
					? 'destructive'
					: 'outline'
	);
</script>

<section
	class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
	aria-labelledby={`${id}-title`}
	data-testid="backup-schedule"
>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
		<CalendarClockIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<h2 id={`${id}-title`} class="text-sm font-medium">Automatic schedule</h2>
		{#if automation}
			<Badge variant={automation.backup.enabled ? 'success' : 'outline'} class="ml-auto"
				>{automation.backup.enabled
					? formatInterval(automation.backup.intervalMinutes)
					: 'Off'}</Badge
			>
		{/if}
	</div>

	<!-- Fixed by the backend: scheduled backups are always full instances to the saved S3 target. -->
	<dl
		class="grid gap-px bg-border sm:grid-cols-3 [&>div]:flex [&>div]:min-w-0 [&>div]:flex-col [&>div]:gap-0.5 [&>div]:bg-card [&>div]:px-4 [&>div]:py-2.5"
		data-testid="schedule-fixed"
	>
		<div>
			<dt class="text-xs text-muted-foreground">What</dt>
			<dd class="text-sm font-medium">Full instance</dd>
			<dd class="text-xs text-muted-foreground">World, software, mods and config</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">Where</dt>
			<dd class="text-sm font-medium">S3 compatible storage</dd>
			<dd
				class="truncate font-mono text-xs text-muted-foreground"
				title={storage?.endpoint || undefined}
			>
				{#if target}{target}{:else if storage}Not set up{:else}—{/if}
			</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">When</dt>
			<dd class="text-sm font-medium">Only while stopped</dd>
			<dd class="text-xs text-muted-foreground">Skipped if running, never stopped for you</dd>
		</div>
	</dl>

	{#if loadError}
		<div class="px-4 py-3">
			<ErrorAlert error={loadError}>
				<Button size="sm" variant="outline" class="mt-2" onclick={() => load(true)}>Retry</Button>
			</ErrorAlert>
		</div>
	{:else if !automation || !draft}
		<div class="px-4 py-3"><Skeleton class="h-16 w-full" /></div>
	{:else}
		{#if storage && !s3Ready}
			<p class="px-4 py-2.5 text-xs text-muted-foreground" data-testid="schedule-no-storage">
				Scheduled backups need S3 storage.
				<a href={resolve('exports')} class="underline underline-offset-4 hover:text-foreground"
					>Set up and test storage</a
				>
				first; the schedule can only be enabled afterwards.
			</p>
		{/if}

		{@render status(automation)}

		<form
			class="flex flex-col gap-3 px-4 py-3"
			onsubmit={save}
			aria-label="Change schedule"
			novalidate
		>
			<label class="flex items-start gap-3">
				<Switch
					class="mt-0.5"
					bind:checked={draft.enabled}
					disabled={saving || (!s3Ready && !draft.enabled)}
					aria-describedby={`${id}-enabled-help`}
				/>
				<span class="flex min-w-0 flex-col">
					<span class="text-sm">Back up on a schedule</span>
					<span id={`${id}-enabled-help`} class="text-xs text-muted-foreground"
						>A running server is skipped, never stopped for you. Missed runs are not caught up.</span
					>
				</span>
			</label>

			<div class="flex flex-wrap items-end gap-4">
				<div class="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
					<span id={`${id}-interval`}>Interval</span>
					<Select.Root
						type="single"
						value={presetValue}
						onValueChange={choosePreset}
						disabled={saving}
					>
						<Select.Trigger size="sm" class="h-8! w-40" aria-labelledby={`${id}-interval`}>
							{customInterval ? 'Custom' : formatInterval(draft.intervalMinutes)}
						</Select.Trigger>
						<Select.Content>
							{#each INTERVAL_PRESETS as preset (preset.minutes)}
								<Select.Item value={String(preset.minutes)} label={preset.label}
									>{preset.label}</Select.Item
								>
							{/each}
							<Select.Item value="custom" label="Custom">Custom (minutes)</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				{#if customInterval}
					<label class="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
						Minutes
						<Input
							type="number"
							min={SCHEDULE_LIMITS.interval.min}
							max={SCHEDULE_LIMITS.interval.max}
							step={1}
							bind:value={draft.intervalMinutes}
							class="h-8 w-28 font-mono"
							disabled={saving}
						/>
					</label>
				{/if}

				<fieldset class="flex flex-col gap-1">
					<legend class="text-xs font-medium text-muted-foreground">Retention</legend>
					<div class="flex flex-wrap items-center gap-3 pt-1 text-sm">
						<label class="flex items-center gap-1.5">
							<input
								type="radio"
								name={`${id}-retention`}
								checked={draft.keepLast === null}
								onchange={() => setKeepAll(true)}
								disabled={saving}
							/>
							Keep all
						</label>
						<label class="flex items-center gap-1.5">
							<input
								type="radio"
								name={`${id}-retention`}
								checked={draft.keepLast !== null}
								onchange={() => setKeepAll(false)}
								disabled={saving}
							/>
							Keep last
						</label>
						{#if draft.keepLast !== null}
							<Input
								type="number"
								min={SCHEDULE_LIMITS.keep.min}
								max={SCHEDULE_LIMITS.keep.max}
								step={1}
								bind:value={draft.keepLast}
								oninput={() => (acknowledged = false)}
								class="h-8 w-20 font-mono"
								aria-label="Scheduled backups to keep"
								disabled={saving}
							/>
						{/if}
					</div>
				</fieldset>
			</div>

			{#if needsAck}
				<label
					class="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs"
					data-testid="retention-ack"
				>
					<Checkbox bind:checked={acknowledged} disabled={saving} class="mt-0.5" />
					<span>
						After each newly verified scheduled backup, delete older <strong>scheduled</strong>
						backups of this server beyond the newest {draft.keepLast}. Manual exports and pinned
						restore points are never deleted. Deleted archives cannot be recovered.
					</span>
				</label>
			{/if}

			{#if saveError}<ErrorAlert error={saveError} />{/if}
			<div class="flex flex-wrap items-center justify-end gap-2">
				<span
					class={['mr-auto text-xs', hint ? 'text-destructive' : 'text-muted-foreground']}
					data-testid="schedule-hint"
				>
					{hint ??
						(dirty
							? 'Unsaved changes. Saving sets the next run from now.'
							: 'Keep all is the default; nothing is deleted unless you choose a count.')}
				</span>
				{#if dirty}
					<Button variant="ghost" size="sm" disabled={saving} onclick={discard}>Discard</Button>
				{/if}
				<Button type="submit" size="sm" disabled={!dirty || saving || (needsAck && !acknowledged)}>
					{#if saving}<Spinner data-icon="inline-start" />{/if}
					Save schedule
				</Button>
			</div>
		</form>
	{/if}
</section>

{#snippet status(automation: AutomationState)}
	<dl
		class="grid gap-x-4 gap-y-1.5 px-4 py-3 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]"
		data-testid="schedule-status"
	>
		<dt class="text-muted-foreground">Frequency</dt>
		<dd>
			{automation.backup.enabled
				? formatInterval(automation.backup.intervalMinutes)
				: 'Off: no automatic backups'}
		</dd>
		<dt class="text-muted-foreground">Retention</dt>
		<dd>
			{automation.backup.keepLast === null
				? 'Keep every scheduled backup'
				: `Keep the newest ${automation.backup.keepLast} scheduled ${automation.backup.keepLast === 1 ? 'backup' : 'backups'}`}
		</dd>
		<dt class="text-muted-foreground">Next run</dt>
		<dd>
			{#if automation.backup.enabled && automation.nextBackupAt}
				{formatUnix(automation.nextBackupAt)}
				<span class="text-muted-foreground">({relativeUnix(automation.nextBackupAt, now)})</span>
			{:else}
				—
			{/if}
		</dd>
		<dt class="text-muted-foreground">Last result</dt>
		<dd class="flex min-w-0 flex-wrap items-center gap-2">
			{#if automation.lastBackupResult}
				<Badge variant={lastVariant}>{backupResultText(automation.lastBackupResult)}</Badge>
			{:else}
				<span>No scheduled backup yet</span>
			{/if}
			{#if automation.lastBackupJob}
				<a
					href={resolve(`activity/${automation.lastBackupJob}`)}
					class="underline underline-offset-4"
					data-testid="schedule-job-link">Job in Activity</a
				>
			{/if}
		</dd>
		{#if automation.lastBackupAt}
			<dt class="text-muted-foreground">Last verified</dt>
			<dd>
				{formatUnix(automation.lastBackupAt)}
				{#if automation.lastBackupExportId}<span class="font-mono text-muted-foreground"
						>· {automation.lastBackupExportId.slice(0, 12)}</span
					>{/if}
			</dd>
		{/if}
		{#if automation.lastBackupError}
			<dt class="text-muted-foreground">Note</dt>
			<dd class={lastTone === 'danger' ? 'text-destructive' : 'text-muted-foreground'}>
				{automation.lastBackupError}
			</dd>
		{/if}
	</dl>
{/snippet}
