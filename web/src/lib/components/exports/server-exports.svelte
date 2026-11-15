<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import FolderTreeIcon from '@lucide/svelte/icons/folder-tree';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import OctagonPauseIcon from '@lucide/svelte/icons/octagon-pause';
	import FolderTreeSelectIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import XIcon from '@lucide/svelte/icons/x';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		createExport,
		getStorage,
		isAbortError,
		isJobActive,
		listExports,
		waitForJob,
		type ExportDestination,
		type ExportRecord,
		type CreateExportRequest,
		type ExportScope,
		type Job,
		type ServerArchive,
		type ServerState,
		type StorageConnection
	} from '#lib/api/index.js';
	import {
		MAX_SELECTED_PATHS,
		buildExportRequest,
		exportFromResult,
		shortHash,
		upsertExport
	} from '#lib/exports/exports.js';
	import { exportSelection } from '#lib/exports/export-selection.svelte.js';
	import { formatBytes } from '#lib/metrics.js';
	import { collapse, fadeIn } from '#lib/motion/index.js';
	import { resolve } from '$app/paths';
	import ChoiceGroup from './choice-group.svelte';
	import ExportList from './export-list.svelte';
	import RestoreNote from './restore-note.svelte';
	import RemoveLocalPanel from './remove-local-panel.svelte';
	import RestoreDialog from './restore-dialog.svelte';
	import BackupSchedule, { type ScheduleApi } from './backup-schedule.svelte';
	import { fullS3Backups } from '#lib/exports/backups.js';
	import JobWorkProgress from '#lib/components/jobs/job-work-progress.svelte';
	import { readJobWork } from '#lib/jobs/work.js';

	interface Props {
		serverId: string;
		serverState: ServerState;
		/** Another server operation is running. */
		busy?: boolean;
		/** True while an export job for this server is queued or running. */
		exporting?: boolean;
		/** Bumped by Files → "Export selected" to switch to the selected-paths scope. */
		selectionFocus?: number;
		/** Opens the Files tab to pick paths. */
		onChooseFiles?: () => void;
		/** Export job of this server recovered after a reload; followed by the page. */
		recoveredJob?: Job | null;
		/** Failure of {@link recoveredJob}. */
		recoveredError?: unknown;
		/** Bumped when a recovered export finishes; reloads the archive list. */
		archivesVersion?: number;
		/** Injected in tests. */
		jobIntervalMs?: number;
		/** Display name used in confirmations. */
		serverName?: string;
		/** Set while local files are removed: no new exports; full archives offer Restore. */
		archive?: ServerArchive | null;
		/** Why removing local files is unavailable now (e.g. unsaved file edits), or `null`. */
		removeBlocked?: string | null;
		/** Archive/restore job tracked by the page controller (running or last finished). */
		backupJob?: Job | null;
		/** Archive/restore request or job in flight. */
		backupWorking?: boolean;
		backupError?: unknown;
		/** Which operation {@link backupJob} is. */
		backupOp?: 'archive' | 'restore' | null;
		/** Removes local files against the chosen full S3 export (after explicit confirmation). */
		onRemoveLocal?: (exportId: string) => void;
		/** Restores the archived server from a full archive (after confirmation). */
		onRestore?: (exportId: string) => void;
		/** Injected in tests (scheduled backups). */
		scheduleApi?: ScheduleApi;
	}

	let {
		serverId,
		serverState,
		busy = false,
		exporting = $bindable(false),
		selectionFocus = 0,
		onChooseFiles,
		recoveredJob = null,
		recoveredError = null,
		archivesVersion = 0,
		jobIntervalMs = 1000,
		serverName = 'this server',
		archive = null,
		removeBlocked = null,
		backupJob = null,
		backupWorking = false,
		backupError = null,
		backupOp = null,
		onRemoveLocal,
		onRestore,
		scheduleApi
	}: Props = $props();

	const pathsId = $props.id();
	const PATHS_PLACEHOLDER = ['world', 'plugins/Essentials', 'ops.json'].join('\n');

	let storage = $state.raw<StorageConnection | null>(null);
	let archives = $state.raw<ExportRecord[] | null>(null);
	let loadError = $state.raw<unknown>(null);

	/** Full archive awaiting restore confirmation. */
	let restoreTarget = $state<string | null>(null);
	const restoreRecord = $derived(archives?.find((a) => a.id === restoreTarget) ?? null);
	const removeCandidates = $derived(archives === null ? null : fullS3Backups(archives, serverId));
	const removeReason = $derived(
		serverState !== 'stopped'
			? 'Stop the server first. Nothing is stopped for you.'
			: (removeBlocked ?? (busy || exporting ? 'Wait for the current operation to finish.' : null))
	);

	// Paths picked in Files (shared per server); typed paths below are merged after them.
	const selected = $derived(exportSelection.paths(serverId));
	let scope = $state<ExportScope>(
		untrack(() => (exportSelection.count(serverId) > 0 ? 'selected' : 'world'))
	);
	$effect(() => {
		if (selectionFocus > 0) untrack(() => (scope = 'selected'));
	});
	/** Request awaiting confirmation of its exact paths and destination. */
	let confirming = $state.raw<CreateExportRequest | null>(null);
	let destination = $state<ExportDestination>('local');
	let pathsInput = $state('');
	let attempted = $state(false);

	let job = $state.raw<Job | null>(null);
	let jobError = $state.raw<unknown>(null);
	let completed = $state.raw<ExportRecord | null>(null);

	const abort = new AbortController();
	$effect(() => () => abort.abort());

	$effect(() => {
		const id = serverId;
		void archivesVersion;
		untrack(() => load(id));
	});

	const recoveredActive = $derived(recoveredJob !== null && isJobActive(recoveredJob));
	/** Local or recovered export in progress. */
	const working = $derived(exporting || recoveredActive);
	const shownJob = $derived(exporting ? job : recoveredActive ? recoveredJob : null);

	async function load(id: string) {
		loadError = null;
		try {
			const [connection, list] = await Promise.all([
				getStorage({ signal: abort.signal }),
				listExports({ signal: abort.signal })
			]);
			storage = connection;
			archives = list.items.filter((item) => item.serverId === id);
		} catch (cause) {
			if (!isAbortError(cause)) loadError = cause;
		}
	}

	const stopped = $derived(serverState === 'stopped');
	const s3Ready = $derived(storage?.configured === true);
	const built = $derived(buildExportRequest(scope, destination, pathsInput, selected));
	const pathsError = $derived(attempted && !built.ok ? built.error : null);
	const canSubmit = $derived(
		stopped && !busy && !exporting && (destination === 'local' || s3Ready)
	);

	// Fall back to local if S3 becomes unavailable while selected.
	$effect(() => {
		if (storage && !s3Ready && untrack(() => destination) === 's3') destination = 'local';
	});

	const scopeOptions = [
		{
			value: 'world' as const,
			label: 'World',
			icon: GlobeIcon,
			hint: 'Every world folder with a level.dat, including dimensions'
		},
		{
			value: 'all' as const,
			label: 'Full instance',
			icon: FolderTreeIcon,
			hint: 'All files, server.properties, manifest and managed JAR'
		},
		{
			value: 'selected' as const,
			label: 'Selected paths',
			icon: ListChecksIcon,
			hint: 'Specific files or folders'
		}
	];
	const destinationOptions = $derived([
		{ value: 'local' as const, label: 'Manager host', icon: HardDriveIcon },
		{
			value: 's3' as const,
			label: 'S3',
			icon: CloudIcon,
			disabled: !s3Ready,
			hint: s3Ready ? `Bucket ${storage?.bucket}` : 'Configure S3 storage first'
		}
	]);

	function start(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		if (!canSubmit || !built.ok) return;
		// Selected paths are confirmed explicitly; world/full scopes are self-describing.
		if (built.request.scope === 'selected') confirming = built.request;
		else void run(built.request, []);
	}

	function confirmExport() {
		const request = confirming;
		confirming = null;
		if (!request || !canSubmit) return;
		// Only paths that came from the Files selection are cleared after success.
		void run(
			request,
			selected.filter((path) => request.paths?.includes(path))
		);
	}

	async function run(request: CreateExportRequest, fromSelection: string[]) {
		const target = serverId;
		exporting = true;
		jobError = null;
		completed = null;
		job = null;
		try {
			const { job: initial } = await createExport(target, request, { signal: abort.signal });
			const final = await waitForJob(initial, {
				signal: abort.signal,
				intervalMs: jobIntervalMs,
				onUpdate: (update) => (job = update)
			});
			job = final;
			if (final.state === 'succeeded') {
				const record = exportFromResult(final.result);
				completed = record;
				attempted = false;
				if (fromSelection.length) exportSelection.remove(target, fromSelection);
				if (record && record.serverId === target) {
					archives = upsertExport(archives ?? [], record);
				} else {
					await load(target);
				}
				toast.success('Export verified', {
					description: record ? `${record.fileName} · ${formatBytes(record.size)}` : undefined
				});
			} else {
				jobError = final.error ?? {
					code: `job.${final.state}`,
					detail: `The export job ${final.state}.`
				};
			}
		} catch (cause) {
			if (!isAbortError(cause)) jobError = cause;
		} finally {
			exporting = false;
		}
	}

	function removed(id: string) {
		archives = (archives ?? []).filter((item) => item.id !== id);
		if (completed?.id === id) completed = null;
	}
</script>

<div class="flex flex-col gap-4">
	{#if archive}
		<p
			class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground"
			role="status"
		>
			<CloudIcon class="size-4 shrink-0" aria-hidden="true" />
			Local files were removed. Restore this server from a full backup below to export again.
		</p>
		{#if backupOp === 'restore' && (backupWorking || backupError)}
			{#if backupWorking && backupJob}
				<div class="rounded-lg border border-border bg-card px-4 py-2.5" role="status">
					<JobWorkProgress job={backupJob} fallback="Restoring" />
				</div>
			{:else if backupError}
				<ErrorAlert error={backupError}>
					<p class="text-muted-foreground">Nothing was overwritten. You can retry the restore.</p>
				</ErrorAlert>
			{/if}
		{/if}
	{:else}
		<form
			class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
			onsubmit={start}
			aria-label="New export"
			novalidate
		>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
				<ArchiveIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span class="text-sm font-medium">New export</span>
				<span class="text-xs text-muted-foreground">Compressed .tar.gz, SHA-256 verified</span>
				{#if !stopped}
					<span
						class="ml-auto inline-flex items-center gap-1.5 text-xs text-warning"
						role="status"
						in:fadeIn
					>
						<OctagonPauseIcon class="size-3.5" aria-hidden="true" />
						Stop the server to export
					</span>
				{/if}
			</div>

			<div class="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
				<span class="text-xs font-medium text-muted-foreground">Contents</span>
				<ChoiceGroup
					label="Export contents"
					options={scopeOptions}
					bind:value={scope}
					disabled={exporting}
				/>

				{#if scope === 'selected'}
					<span class="self-start pt-1 text-xs font-medium text-muted-foreground">From Files</span>
					<div class="flex min-w-0 flex-col gap-1.5" transition:collapse>
						{#if selected.length}
							<ul class="flex flex-wrap gap-1.5" aria-label="Paths selected in Files">
								{#each selected as path (path)}
									<li
										class="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pr-0.5 pl-2 font-mono text-xs"
									>
										<span class="truncate" title={path}>{path}</span>
										<Button
											variant="ghost"
											size="icon-xs"
											class="size-5"
											aria-label={`Remove ${path} from the selection`}
											disabled={exporting}
											onclick={() => exportSelection.remove(serverId, [path])}
										>
											<XIcon />
										</Button>
									</li>
								{/each}
							</ul>
							<div
								class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
							>
								<span data-testid="selected-count"
									>{selected.length} selected · folders include everything inside them</span
								>
								{#if onChooseFiles}
									<button
										type="button"
										class="underline underline-offset-4 hover:text-foreground"
										onclick={onChooseFiles}>Change in Files</button
									>
								{/if}
								<button
									type="button"
									class="underline underline-offset-4 hover:text-foreground disabled:opacity-50"
									disabled={exporting}
									onclick={() => exportSelection.clear(serverId)}>Clear selection</button
								>
							</div>
						{:else}
							<p
								class="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground"
							>
								<span>Nothing selected.</span>
								{#if onChooseFiles}
									<Button variant="outline" size="xs" onclick={onChooseFiles}>
										<FolderTreeSelectIcon data-icon="inline-start" />
										Choose in Files
									</Button>
								{/if}
							</p>
						{/if}
					</div>
					<label for={pathsId} class="self-start pt-1.5 text-xs font-medium text-muted-foreground"
						>Typed paths</label
					>
					<div class="flex min-w-0 flex-col gap-1.5" transition:collapse>
						<Textarea
							id={pathsId}
							bind:value={pathsInput}
							rows={selected.length ? 2 : 3}
							spellcheck={false}
							autocomplete="off"
							placeholder={PATHS_PLACEHOLDER}
							class="min-h-16 font-mono text-xs md:text-xs"
							aria-invalid={pathsError ? true : undefined}
							aria-describedby={`${pathsId}-hint`}
							disabled={exporting}
						/>
						<p
							id={`${pathsId}-hint`}
							class={['text-xs', pathsError ? 'text-destructive' : 'text-muted-foreground']}
						>
							{pathsError ??
								`${selected.length ? 'Optional extra paths, one' : 'One file or folder'} per line, relative to the server directory (up to ${MAX_SELECTED_PATHS} in total). Symbolic links fail the export.`}
						</p>
					</div>
				{/if}

				<span class="text-xs font-medium text-muted-foreground">Destination</span>
				<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
					<ChoiceGroup
						label="Export destination"
						options={destinationOptions}
						bind:value={destination}
						disabled={exporting}
					/>
					{#if storage === null && !loadError}
						<Skeleton class="h-4 w-24" />
					{:else if !s3Ready}
						<a
							href={resolve('exports')}
							class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
							>Set up S3 storage</a
						>
					{:else if destination === 's3'}
						<span class="truncate font-mono text-xs text-muted-foreground" title={storage?.endpoint}
							>{storage?.bucket}{storage?.prefix ? `/${storage.prefix}` : ''}</span
						>
					{/if}
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
				<p class="min-w-0 flex-1 text-xs text-muted-foreground">
					The server stays locked until compression{destination === 's3'
						? ', upload and read-back verification'
						: ''} finish. Nothing is stopped, restarted or deleted for you.
				</p>
				<Button type="submit" size="sm" disabled={!canSubmit}>
					{#if exporting}<Spinner data-icon="inline-start" />{:else}<ArchiveIcon
							data-icon="inline-start"
						/>{/if}
					{exporting ? 'Exporting…' : 'Export'}
				</Button>
			</div>

			{#if working}
				<div class="flex flex-col gap-1.5 px-4 py-2.5" role="status" transition:collapse>
					{#if shownJob}
						<JobWorkProgress job={shownJob} fallback="Exporting" />
					{:else}
						<p class="flex items-center gap-2 text-sm">
							<Spinner class="size-3.5" />
							<span>Requesting</span>
						</p>
					{/if}
					{#if shownJob?.message || (!exporting && shownJob)}
						<p class="flex min-w-0 items-center gap-2">
							{#if shownJob?.message}<span class="truncate text-xs text-muted-foreground"
									>{shownJob.message}</span
								>{/if}
							{#if !exporting && shownJob}
								<a
									href={resolve(`activity/${shownJob.id}`)}
									class="ml-auto shrink-0 text-xs text-muted-foreground underline underline-offset-4"
									>{shownJob.kind === 'server.backup_scheduled'
										? 'Scheduled backup'
										: 'Started earlier'} · details</a
								>
							{/if}
						</p>
					{/if}
				</div>
			{:else if completed}
				<p
					class="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-sm"
					role="status"
					transition:collapse
				>
					<CircleCheckIcon class="size-4 shrink-0 text-success" aria-hidden="true" />
					<span>Export verified</span>
					<span class="truncate font-mono text-xs text-muted-foreground" title={completed.sha256}
						>{completed.fileName} · {formatBytes(completed.size)} · sha256 {shortHash(
							completed.sha256
						)}</span
					>
				</p>
			{/if}
		</form>

		{#if jobError}
			<div transition:collapse>
				<ErrorAlert error={jobError}>
					<p class="text-muted-foreground">Server files were not changed.</p>
					{#if job && readJobWork(job.work)}
						<JobWorkProgress {job} class="mt-1" />
					{/if}
				</ErrorAlert>
			</div>
		{:else if recoveredError && recoveredJob && !exporting}
			<div transition:collapse>
				<ErrorAlert error={recoveredError}>
					<p class="text-muted-foreground">Server files were not changed.</p>
					{#if readJobWork(recoveredJob.work)}
						<JobWorkProgress job={recoveredJob} class="mt-1" />
					{/if}
					<a
						href={resolve(`activity/${recoveredJob.id}`)}
						class="text-xs underline underline-offset-4">Job details in Activity</a
					>
				</ErrorAlert>
			</div>
		{/if}
	{/if}

	{#if !archive}
		<BackupSchedule
			{serverId}
			storage={loadError ? null : storage}
			refreshKey={archivesVersion}
			api={scheduleApi}
		/>
	{/if}

	<section class="flex flex-col gap-2" aria-label="Archives of this server">
		<div class="flex items-center gap-2">
			<h2 class="text-sm font-medium">Archives</h2>
			<a
				href={resolve('exports')}
				class="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
				>All archives</a
			>
		</div>
		{#if loadError}
			<ErrorAlert error={loadError}>
				<Button variant="outline" size="sm" class="mt-2" onclick={() => load(serverId)}
					>Retry</Button
				>
			</ErrorAlert>
		{:else if archives === null}
			<Skeleton class="h-14 w-full" />
		{:else}
			<ExportList
				exports={archives}
				emptyText={archive
					? 'No archives of this server are listed. Its restore point may be missing from the catalog.'
					: 'No archives of this server yet. Archives stay available after the server is deleted.'}
				ondeleted={removed}
				pinnedIds={archive ? [archive.exportId] : []}
				onrestore={archive && onRestore ? (record) => (restoreTarget = record.id) : undefined}
				restoreDisabled={busy || backupWorking}
			/>
		{/if}
	</section>

	{#if !archive && onRemoveLocal && !loadError}
		<RemoveLocalPanel
			{serverName}
			candidates={removeCandidates}
			blockedReason={removeReason}
			working={backupWorking && backupOp === 'archive'}
			job={backupOp === 'archive' ? backupJob : null}
			error={backupOp === 'archive' ? backupError : null}
			onConfirm={onRemoveLocal}
		/>
	{/if}

	<RestoreNote />
</div>

<RestoreDialog
	exportId={restoreTarget}
	record={restoreRecord}
	name={serverName}
	state="archived"
	onConfirm={(id) => {
		restoreTarget = null;
		onRestore?.(id);
	}}
	onCancel={() => (restoreTarget = null)}
/>

<AlertDialog.Root bind:open={() => confirming !== null, (open) => !open && (confirming = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				Export {confirming?.paths?.length ?? 0}
				{confirming?.paths?.length === 1 ? 'path' : 'paths'}?
			</AlertDialog.Title>
			<AlertDialog.Description>
				To {confirming?.destination === 's3'
					? `S3 bucket ${storage?.bucket ?? ''}${storage?.prefix ? `/${storage.prefix}` : ''}`
					: 'the manager host'}. Folders are archived with everything inside them. The server stays
				locked until the archive is verified.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<ul
			class="max-h-60 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs"
			aria-label="Paths to export"
		>
			{#each confirming?.paths ?? [] as path (path)}
				<li class="truncate py-0.5" title={path}>{path}</li>
			{/each}
		</ul>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmExport}>Start export</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
