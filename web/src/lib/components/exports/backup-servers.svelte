<!--
	Archives grouped by server: name, local/archived/removed state, latest backup age, scope and
	destination, plus Restore for full archives when no local instance would be overwritten.
	Renders loaded data only; the page owns fetching and job tracking.
-->
<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { SvelteSet } from 'svelte/reactivity';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import JobWorkProgress from '#lib/components/jobs/job-work-progress.svelte';
	import ServerAvatar from '#lib/components/servers/server-avatar.svelte';
	import { describeError, isJobActive, type ExportRecord } from '#lib/api/index.js';
	import {
		INSTANCE_STATE_LABELS,
		backupKind,
		canRestoreFrom,
		formatAge,
		restoreAllowed,
		type BackupGroup
	} from '#lib/exports/backups.js';
	import { formatExportTime } from '#lib/exports/exports.js';
	import type { BackupOperations } from '#lib/exports/backup-operations.svelte.js';
	import { rise, stagger } from '#lib/motion/index.js';
	import { resolve } from '$app/paths';
	import ExportList from './export-list.svelte';

	interface Props {
		groups: BackupGroup[];
		operations: BackupOperations;
		onRestore: (group: BackupGroup, record: ExportRecord) => void;
		ondeleted: (id: string) => void;
		now?: number;
	}

	let { groups, operations, onRestore, ondeleted, now = Date.now() }: Props = $props();

	const expanded = new SvelteSet<string>();
	const pinnedIds = $derived(groups.flatMap((g) => (g.pinned ? [g.pinned.id] : [])));

	function toggle(id: string) {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}

	const stateVariant = {
		local: 'outline',
		archived: 'secondary',
		removed: 'warning',
		unknown: 'outline'
	} as const;
</script>

{#if groups.length === 0}
	<p
		class="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
	>
		<ArchiveIcon class="size-4 shrink-0" aria-hidden="true" />
		No backed-up servers yet. Stop a server and export it from its Exports tab.
	</p>
{:else}
	<ul
		class="overflow-hidden rounded-lg border border-border bg-card"
		aria-label="Backed-up servers"
	>
		{#each groups as group, index (group.serverId)}
			{@const job = operations.jobs.get(group.serverId) ?? null}
			{@const working = operations.busy(group.serverId)}
			{@const error = operations.errors.get(group.serverId)}
			{@const canRestore = restoreAllowed(group.state) && group.restoreFrom !== null}
			{@const fullCount = group.items.filter(canRestoreFrom).length}
			{@const listId = `backups-${group.serverId}`}
			<li
				class="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0"
				in:rise={{ delay: stagger(index) }}
				data-testid="backup-group"
				data-state={group.state}
			>
				<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
					<ServerAvatar
						server={group.server ?? { icon: null, software: null }}
						class="size-8 rounded-md"
						iconClass="size-4"
					/>
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<div class="flex min-w-0 flex-wrap items-center gap-2">
							{#if group.server}
								<a
									href={resolve(`servers/${group.serverId}`)}
									class="truncate text-sm font-medium underline-offset-4 hover:underline"
									>{group.name}</a
								>
							{:else}
								<span class="truncate text-sm font-medium">{group.name}</span>
							{/if}
							<Badge
								variant={stateVariant[group.state]}
								title={group.state === 'removed'
									? 'No record in the manager. Host files may still exist from an earlier deletion.'
									: undefined}>{INSTANCE_STATE_LABELS[group.state]}</Badge
							>
						</div>
						<p
							class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground"
						>
							<span title={formatExportTime(group.latest.createdAt)}
								>Latest {formatAge(group.latest.createdAt, now)}</span
							>
							<span>{backupKind(group.latest)}</span>
							{#if group.pinned}
								<span>Restore point {formatAge(group.pinned.createdAt, now)}</span>
							{:else if group.latest.scope !== 'all' && group.restoreFrom}
								<span>Full {formatAge(group.restoreFrom.createdAt, now)}</span>
							{:else if fullCount === 0}
								<span>No full backup · download only</span>
							{/if}
						</p>
					</div>
					<div class="flex shrink-0 items-center gap-1.5">
						{#if canRestore && group.restoreFrom}
							{@const from = group.restoreFrom}
							<Button
								size="xs"
								variant="outline"
								disabled={working}
								aria-label={`Restore ${group.name}`}
								onclick={() => onRestore(group, from)}
							>
								{#if working}<Spinner data-icon="inline-start" />{:else}<ArchiveRestoreIcon
										data-icon="inline-start"
									/>{/if}
								{working ? 'Restoring' : error ? 'Retry' : 'Restore'}
							</Button>
						{/if}
						<Button
							size="xs"
							variant="ghost"
							aria-expanded={expanded.has(group.serverId)}
							aria-controls={listId}
							onclick={() => toggle(group.serverId)}
						>
							{group.items.length}
							{group.items.length === 1 ? 'backup' : 'backups'}
							<ChevronDownIcon
								data-icon="inline-end"
								class={['transition-transform', expanded.has(group.serverId) && 'rotate-180']}
							/>
						</Button>
					</div>
				</div>
				{#if job && isJobActive(job)}
					<JobWorkProgress
						{job}
						history={false}
						fallback={job.kind === 'server.archive' ? 'Removing local files' : 'Restoring'}
					/>
				{:else if error}
					{@const failure = describeError(error)}
					<p class="text-xs text-destructive" role="alert">
						{failure.title}: {failure.detail}
						{#if failure.hint}<span class="text-muted-foreground"> {failure.hint}</span>{/if}
						{#if job}
							<a href={resolve(`activity/${job.id}`)} class="underline underline-offset-4"
								>Details</a
							>
						{/if}
					</p>
				{/if}
				{#if expanded.has(group.serverId)}
					<div id={listId}>
						<ExportList
							exports={group.items}
							{pinnedIds}
							{ondeleted}
							onrestore={restoreAllowed(group.state)
								? (record) => onRestore(group, record)
								: undefined}
							restoreDisabled={working}
						/>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
