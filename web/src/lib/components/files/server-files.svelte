<script lang="ts">
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import FileIcon from '@lucide/svelte/icons/file';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FilePlusIcon from '@lucide/svelte/icons/file-plus';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import MoveIcon from '@lucide/svelte/icons/folder-input';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import SearchIcon from '@lucide/svelte/icons/search';
	import LockIcon from '@lucide/svelte/icons/lock';
	import InfoIcon from '@lucide/svelte/icons/info';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import XIcon from '@lucide/svelte/icons/x';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { exportSelection } from '#lib/exports/export-selection.svelte.js';
	import { MAX_SELECTED_PATHS } from '#lib/exports/exports.js';
	import { coveringFolder, headerState, isSelectable } from '#lib/exports/selection.js';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { ErrorAlert, UnsavedChangesDialog } from '#lib/components/app/index.js';
	import { Reveal } from '#lib/components/motion/index.js';
	import { collapse, fadeIn } from '#lib/motion/index.js';
	import FileEditor from './file-editor.svelte';
	import UploadQueuePanel from './upload-queue-panel.svelte';
	import FileNameDialog, { type NameDialogRequest } from './file-name-dialog.svelte';
	import FileDeleteDialog from './file-delete-dialog.svelte';
	import RelocateDialog, { type RelocateRequest } from './relocate-dialog.svelte';
	import {
		fileDownloadUrl,
		isAbortError,
		listFiles,
		makeDirectory,
		moveFile,
		writeFile,
		type DirectoryListing,
		type FileEntry,
		type ServerState
	} from '#lib/api/index.js';
	import {
		baseName,
		breadcrumbs,
		filterEntries,
		formatBytes,
		joinPath,
		MAX_EDIT_BYTES,
		parentPath,
		ROOT,
		SERVER_PROPERTIES,
		sortEntries,
		validateName,
		type SortDirection,
		type SortKey
	} from '#lib/files/paths.js';
	import { UploadQueue } from '#lib/files/upload-queue.svelte.js';
	import { carriesFiles, readDrop } from '#lib/files/drop.js';
	import { cn } from '#lib/utils.js';

	interface OpenRequest {
		path: string;
		/** Bump to re-open the same path. */
		nonce: number;
	}

	interface Props {
		serverId: string;
		serverState: ServerState;
		/** Ask the browser to open a file in the editor (e.g. server.properties from Settings). */
		openRequest?: OpenRequest | null;
		/** True while the editor holds unsaved changes. */
		dirty?: boolean;
		/** Opens the versioned Properties tab instead of editing server.properties as a file. */
		onOpenProperties?: () => void;
		/** Opens the Exports tab with the current selection. Hides selection when absent. */
		onExportSelected?: () => void;
	}

	let {
		serverId,
		serverState,
		openRequest = null,
		dirty = $bindable(false),
		onOpenProperties,
		onExportSelected
	}: Props = $props();

	let path = $state(ROOT);
	let listing = $state.raw<DirectoryListing | null>(null);
	let loading = $state(true);
	let error = $state.raw<unknown>(null);
	let nonce = $state(0);

	let sortKey = $state<SortKey>('name');
	let sortDir = $state<SortDirection>('asc');
	let filter = $state('');

	let editing = $state<string | null>(null);
	let nameRequest = $state<NameDialogRequest | null>(null);
	let deleteEntry = $state<FileEntry | null>(null);
	/** Path of the most recently created/changed entry, highlighted once. */
	let highlight = $state<string | null>(null);
	let relocateRequest = $state<RelocateRequest | null>(null);
	let dragging = $state(false);
	/** Nested dragenter/dragleave pairs; the overlay hides only when this reaches zero. */
	let dragDepth = 0;
	let fileInput = $state<HTMLInputElement | null>(null);

	const uploads = new UploadQueue({
		serverId: untrack(() => serverId),
		canUpload: () => writable,
		onUploaded: (entry) => {
			highlight = entry.path;
			nonce += 1;
		}
	});
	$effect(() => () => uploads.destroy());

	// Load the listing whenever the folder, server state or refresh nonce changes.
	$effect(() => {
		const id = serverId;
		const dir = path;
		void serverState;
		void nonce;
		const abort = new AbortController();
		untrack(() => {
			loading = true;
			error = null;
		});
		listFiles(id, dir, { signal: abort.signal }).then(
			(result) => {
				listing = result;
				loading = false;
				pruneSelection(id, result);
			},
			(cause) => {
				if (isAbortError(cause)) return;
				error = cause;
				loading = false;
			}
		);
		return () => abort.abort();
	});

	// Open requests from outside (Settings → Edit server.properties).
	let handledNonce = -1;
	$effect(() => {
		const request = openRequest;
		if (!request || request.nonce === handledNonce) return;
		handledNonce = request.nonce;
		untrack(() => openEditor(request.path));
	});

	const stopped = $derived(serverState === 'stopped');
	const writable = $derived(stopped && (listing?.canWrite ?? false));
	const entries = $derived(
		listing ? sortEntries(filterEntries(listing.entries, filter), sortKey, sortDir) : []
	);
	const crumbs = $derived(breadcrumbs(path));
	const hasProperties = $derived(
		path === ROOT && (listing?.entries.some((e) => e.path === SERVER_PROPERTIES) ?? false)
	);

	// Export selection --------------------------------------------------------------
	const selecting = $derived(onExportSelected !== undefined);
	const selection = $derived(exportSelection.items(serverId));
	const selectableVisible = $derived(entries.filter(isSelectable));
	const allState = $derived(headerState(selection, selectableVisible));
	const outsideFolder = $derived(selection.filter((item) => parentPath(item.path) !== path).length);

	/** Drops selected paths of this folder that no longer exist (deleted, renamed, moved). */
	function pruneSelection(id: string, result: DirectoryListing) {
		if (result.truncated) return;
		const present = new Set(result.entries.map((e) => e.path));
		const stale = exportSelection
			.items(id)
			.filter((item) => parentPath(item.path) === result.path && !present.has(item.path))
			.map((item) => item.path);
		if (stale.length) exportSelection.remove(id, stale);
	}

	/** Forgets a path (and anything under it) that was deleted, renamed or moved. */
	function dropSelected(target: string) {
		const gone = exportSelection
			.paths(serverId)
			.filter((p) => p === target || p.startsWith(`${target}/`));
		if (gone.length) exportSelection.remove(serverId, gone);
	}

	function warnOverflow(skipped: number) {
		toast.warning(`Selection is limited to ${MAX_SELECTED_PATHS} paths`, {
			description: `${skipped} ${skipped === 1 ? 'entry was' : 'entries were'} not added. Select a parent folder instead.`
		});
	}

	function toggleEntry(entry: FileEntry, checked: boolean) {
		if (!isSelectable(entry)) return;
		if (!checked) return exportSelection.remove(serverId, [entry.path]);
		const result = exportSelection.add(serverId, [{ path: entry.path, kind: entry.kind }]);
		if (result.overflow.length) warnOverflow(result.overflow.length);
	}

	function toggleAllVisible() {
		if (allState === 'all') {
			exportSelection.remove(
				serverId,
				selectableVisible.map((e) => e.path)
			);
			return;
		}
		const result = exportSelection.add(
			serverId,
			selectableVisible.map((e) => ({ path: e.path, kind: e.kind as 'file' | 'directory' }))
		);
		if (result.overflow.length) warnOverflow(result.overflow.length);
	}

	function navigate(next: string) {
		if (next === path) {
			nonce += 1;
			return;
		}
		path = next;
		filter = '';
	}

	function openEditor(target: string) {
		if (target === SERVER_PROPERTIES && onOpenProperties) {
			onOpenProperties();
			return;
		}
		if (editing === target) return;
		if (editing && dirty) {
			// Ask first; the current editor stays open (with its edits) until the user decides.
			pendingOpen = target;
			return;
		}
		editing = target;
	}

	/** Another file was chosen while the editor holds unsaved changes. */
	let pendingOpen = $state<string | null>(null);

	function openEntry(entry: FileEntry) {
		if (entry.kind === 'directory') return navigate(entry.path);
		if (entry.kind !== 'file') return;
		if (entry.size > MAX_EDIT_BYTES) {
			toast.info('Too large to edit here', {
				description: 'Files over 1 MiB can only be downloaded.'
			});
			return;
		}
		openEditor(entry.path);
	}

	function toggleSort(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = key === 'name' ? 'asc' : 'desc';
		}
	}

	function ariaSort(key: SortKey) {
		if (sortKey !== key) return 'none' as const;
		return sortDir === 'asc' ? ('ascending' as const) : ('descending' as const);
	}

	function changed(target: string, message: string) {
		highlight = target;
		nonce += 1;
		toast.success(message);
	}

	const nameValidator = (value: string) => validateName(value);
	function newFolder() {
		nameRequest = {
			title: 'New folder',
			description: path ? `Created inside ${path}/.` : 'Created in the server directory.',
			label: 'Folder name',
			submitLabel: 'Create folder',
			initial: '',
			validate: nameValidator,
			submit: async (name) => {
				const target = joinPath(path, name);
				await makeDirectory(serverId, target);
				changed(target, `Created folder ${name}`);
			}
		};
	}

	function newFile() {
		nameRequest = {
			title: 'New file',
			description: 'Creates an empty text file and opens it in the editor.',
			label: 'File name',
			submitLabel: 'Create file',
			initial: '',
			validate: nameValidator,
			submit: async (name) => {
				const target = joinPath(path, name);
				// `etag: null` only creates; an existing file fails with files.exists.
				await writeFile(serverId, target, { content: '', etag: null });
				changed(target, `Created ${name}`);
				editing = target;
			}
		};
	}

	function rename(entry: FileEntry) {
		nameRequest = {
			title: `Rename ${entry.kind === 'directory' ? 'folder' : 'file'}`,
			label: 'New name',
			submitLabel: 'Rename',
			initial: entry.name,
			selectStem: entry.kind !== 'directory',
			validate: (value) =>
				validateName(value) ?? (value === entry.name ? 'Enter a different name.' : null),
			submit: async (name) => {
				const target = joinPath(parentPath(entry.path), name);
				await moveFile(serverId, entry.path, target);
				dropSelected(entry.path);
				changed(target, `Renamed to ${name}`);
			}
		};
	}

	function relocate(entry: FileEntry, mode: 'move' | 'copy') {
		relocateRequest = { entry, mode };
	}

	function relocated(request: RelocateRequest, target: string) {
		if (request.mode === 'move') dropSelected(request.entry.path);
		highlight = target;
		toast.success(`${request.mode === 'move' ? 'Moved' : 'Copied'} ${request.entry.name}`, {
			description: `to /${target}`
		});
		const where = parentPath(target);
		if (where !== path) {
			path = where;
			filter = '';
		} else nonce += 1;
	}

	function onFilesPicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files?.length) queueUploads(path, Array.from(input.files));
		input.value = '';
	}

	/** Queues files for the folder shown when they were chosen or dropped. */
	function queueUploads(dir: string, files: File[]) {
		const { duplicates } = uploads.add(dir, files);
		if (duplicates.length)
			toast.info(
				`${duplicates.length === 1 ? `${duplicates[0]} is` : `${duplicates.length} files are`} already queued`,
				{ description: 'Each destination is uploaded once.' }
			);
	}

	function resetDrag() {
		dragDepth = 0;
		dragging = false;
	}

	function ondragenter(event: DragEvent) {
		if (!carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		dragDepth += 1;
		dragging = true;
	}

	function ondragover(event: DragEvent) {
		if (!carriesFiles(event.dataTransfer)) return;
		// Always claim the drop so the browser never opens the file itself.
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = writable ? 'copy' : 'none';
	}

	function ondragleave(event: DragEvent) {
		if (!carriesFiles(event.dataTransfer)) return;
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) dragging = false;
	}

	function ondrop(event: DragEvent) {
		if (!carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		resetDrag();
		// Bind the destination now: later navigation never changes where these go.
		const dir = path;
		if (!writable) {
			toast.warning('Files are read-only right now', {
				description: stopped
					? 'The manager cannot confirm the server is stopped.'
					: 'Stop the server to upload files.'
			});
			return;
		}
		const { files, folders } = readDrop(event.dataTransfer!);
		if (folders.length)
			toast.warning(
				`${folders.length === 1 ? `Folder ${folders[0]} was` : `${folders.length} folders were`} skipped`,
				{
					description:
						'Folder upload is not supported yet. Drop the files themselves, or create the folder first.'
				}
			);
		if (files.length) queueUploads(dir, files);
	}

	/** Anywhere else on the page, a dropped file must not replace the app. */
	function guardWindowDrag(event: DragEvent) {
		if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
	}

	function guardWindowDrop(event: DragEvent) {
		resetDrag();
		if (carriesFiles(event.dataTransfer) && !event.defaultPrevented) event.preventDefault();
	}

	// Waiting uploads must not start once the server leaves the stopped state.
	$effect(() => {
		if (writable) return;
		untrack(() => {
			if (uploads.items.some((item) => item.state === 'pending'))
				uploads.hold({
					code: 'files.server_running',
					detail: 'Uploads paused: files are read-only right now. Retry once the server is stopped.'
				});
			resetDrag();
		});
	});

	function formatModified(value: string | null): string {
		if (!value) return '—';
		const date = new Date(value);
		return Number.isNaN(date.getTime())
			? '—'
			: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	function iconFor(entry: FileEntry) {
		if (entry.kind === 'directory') return FolderIcon;
		if (entry.kind === 'symlink') return LinkIcon;
		if (/\.(properties|txt|json|ya?ml|toml|cfg|conf|ini|log|md|sh)$/i.test(entry.name))
			return FileTextIcon;
		return FileIcon;
	}
</script>

<svelte:window ondragover={guardWindowDrag} ondrop={guardWindowDrop} ondragend={resetDrag} />

<UnsavedChangesDialog
	open={pendingOpen !== null}
	title="Open another file?"
	stayLabel="Keep editing"
	discardLabel="Discard and open"
	onStay={() => (pendingOpen = null)}
	onDiscard={() => {
		const target = pendingOpen;
		pendingOpen = null;
		if (!target) return;
		dirty = false;
		editing = target;
	}}
>
	{#snippet description()}
		Your edits to <code class="font-mono">{baseName(editing ?? '')}</code> have not been saved.
		Opening
		<code class="font-mono">{baseName(pendingOpen ?? '')}</code> discards them.
	{/snippet}
</UnsavedChangesDialog>

{#if editing}
	{#key editing}
		<FileEditor
			{serverId}
			path={editing}
			{writable}
			bind:dirty
			onClose={() => {
				editing = null;
				dirty = false;
				nonce += 1;
			}}
			onSaved={() => toast.success(`Saved ${baseName(editing ?? '')}`)}
		/>
	{/key}
{:else}
	<Reveal preset="fade" class="flex flex-col gap-4">
		{#if !stopped}
			<Alert.Root>
				<LockIcon />
				<Alert.Title>Files are read-only while the server runs</Alert.Title>
				<Alert.Description>
					Browse and download freely. Stop the server to upload, edit, move or delete files; changes
					take effect on the next start.
				</Alert.Description>
			</Alert.Root>
		{:else if listing && !listing.canWrite}
			<Alert.Root>
				<InfoIcon />
				<Alert.Title>Files are read-only right now</Alert.Title>
				<Alert.Description>
					The manager cannot confirm the server is stopped (Docker may be unavailable). Browsing and
					downloads still work.
				</Alert.Description>
			</Alert.Root>
		{/if}

		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex min-w-0 items-center gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => navigate(parentPath(path))}
					disabled={path === ROOT}
					aria-label="Up one folder"
				>
					<ArrowUpIcon />
				</Button>
				<Breadcrumb.Root class="min-w-0">
					<Breadcrumb.List class="flex-nowrap overflow-x-auto">
						{#each crumbs as crumb, index (crumb.path)}
							{#if index > 0}<Breadcrumb.Separator />{/if}
							<Breadcrumb.Item class="shrink-0">
								{#if index === crumbs.length - 1}
									<Breadcrumb.Page class="max-w-48 truncate font-medium"
										>{crumb.name}</Breadcrumb.Page
									>
								{:else}
									<button
										type="button"
										class="max-w-40 truncate rounded-sm transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
										onclick={() => navigate(crumb.path)}
									>
										{crumb.name}
									</button>
								{/if}
							</Breadcrumb.Item>
						{/each}
					</Breadcrumb.List>
				</Breadcrumb.Root>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<div class="relative">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						type="search"
						bind:value={filter}
						placeholder="Filter this folder"
						aria-label="Filter this folder"
						class="h-8 w-44 pl-8 text-sm"
					/>
				</div>
				<Button
					variant="outline"
					size="icon-sm"
					onclick={() => (nonce += 1)}
					disabled={loading}
					aria-label="Refresh"
				>
					<RefreshCwIcon class={loading ? 'animate-spin' : undefined} />
				</Button>
				<Button variant="outline" size="sm" onclick={newFolder} disabled={!writable}>
					<FolderPlusIcon data-icon="inline-start" />
					Folder
				</Button>
				<Button variant="outline" size="sm" onclick={newFile} disabled={!writable}>
					<FilePlusIcon data-icon="inline-start" />
					File
				</Button>
				<Button size="sm" onclick={() => fileInput?.click()} disabled={!writable}>
					<UploadIcon data-icon="inline-start" />
					Upload
				</Button>
				<input
					bind:this={fileInput}
					type="file"
					multiple
					class="hidden"
					onchange={onFilesPicked}
					aria-label="Choose files to upload"
					tabindex="-1"
				/>
			</div>
		</div>

		{#if hasProperties}
			<button
				type="button"
				class="motion-lift flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left hover:border-ring/60 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
				onclick={() => openEditor(SERVER_PROPERTIES)}
			>
				<SettingsIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span class="flex min-w-0 flex-1 flex-col">
					<span class="text-sm font-medium"
						>{onOpenProperties ? 'Minecraft settings' : 'Edit server.properties'}</span
					>
					<span class="text-xs text-muted-foreground"
						>Game rules, MOTD, difficulty, whitelist and more.</span
					>
				</span>
			</button>
		{/if}

		{#if selecting && selection.length > 0}
			<div
				class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-4 py-2"
				role="region"
				aria-label="Export selection"
				transition:collapse
			>
				<span
					class="text-sm font-medium tabular-nums"
					aria-live="polite"
					data-testid="selection-count"
				>
					{selection.length} selected
				</span>
				<span class="text-xs text-muted-foreground">
					{#if outsideFolder > 0}{outsideFolder} in other folders ·
					{/if}folders include their contents
				</span>
				{#if !stopped}
					<span class="text-xs text-warning">Exports need a stopped server</span>
				{/if}
				<div class="ml-auto flex items-center gap-2">
					<Button variant="ghost" size="sm" onclick={() => exportSelection.clear(serverId)}>
						<XIcon data-icon="inline-start" />
						Clear
					</Button>
					<Button size="sm" onclick={onExportSelected}>
						<ArchiveIcon data-icon="inline-start" />
						Export selected
					</Button>
				</div>
			</div>
		{/if}

		<UploadQueuePanel queue={uploads} />

		{#if error}
			<ErrorAlert {error}>
				<Button size="sm" variant="outline" class="mt-2" onclick={() => (nonce += 1)}>Retry</Button>
			</ErrorAlert>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class={cn(
				'relative overflow-hidden rounded-lg border border-border bg-card transition-colors',
				dragging && writable && 'border-ring bg-accent/30'
			)}
			{ondragenter}
			{ondragover}
			{ondragleave}
			{ondrop}
			data-testid="file-drop-zone"
		>
			{#if dragging}
				<div
					class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-background/80 text-sm font-medium"
					transition:fadeIn
					data-testid="drop-overlay"
				>
					{#if writable}
						<UploadIcon class="size-5 text-muted-foreground" aria-hidden="true" />
						<span>Drop files to upload into <span class="font-mono">/{path}</span></span>
						<span class="text-xs font-normal text-muted-foreground"
							>Files only, up to 128 MiB each. Existing files are never replaced without asking.</span
						>
					{:else}
						<LockIcon class="size-5 text-muted-foreground" aria-hidden="true" />
						<span>Uploads are unavailable while files are read-only</span>
					{/if}
				</div>
			{/if}
			{#if loading && !listing}
				<div class="flex flex-col gap-2 p-4">
					{#each [0, 1, 2, 3, 4] as row (row)}
						<Skeleton class="h-8 w-full" />
					{/each}
				</div>
			{:else if listing && entries.length === 0}
				<Empty.Root class="py-12">
					<Empty.Header>
						<Empty.Media variant="icon"><FolderOpenIcon /></Empty.Media>
						<Empty.Title>{filter ? 'No matches' : 'This folder is empty'}</Empty.Title>
						<Empty.Description>
							{filter
								? `Nothing in this folder matches “${filter}”.`
								: writable
									? 'Upload files or create a folder to get started.'
									: 'Nothing here yet.'}
						</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else if listing}
				<table class="w-full table-fixed text-sm">
					<thead class="border-b border-border text-xs text-muted-foreground">
						<tr>
							{#if selecting}
								<th scope="col" class="w-10 py-2 pl-4">
									<Checkbox
										checked={allState === 'all'}
										indeterminate={allState === 'some'}
										disabled={selectableVisible.length === 0}
										onCheckedChange={toggleAllVisible}
										aria-label={allState === 'all'
											? 'Clear selection of visible entries'
											: 'Select all visible entries for export'}
									/>
								</th>
							{/if}
							<th
								scope="col"
								class={['py-2 pr-4 text-left font-medium', selecting ? 'pl-2' : 'pl-4']}
								aria-sort={ariaSort('name')}
							>
								{@render sortButton('name', 'Name')}
							</th>
							<th
								scope="col"
								class="hidden w-28 px-2 py-2 text-right font-medium sm:table-cell"
								aria-sort={ariaSort('size')}
							>
								{@render sortButton('size', 'Size')}
							</th>
							<th
								scope="col"
								class="hidden w-48 px-2 py-2 text-left font-medium md:table-cell"
								aria-sort={ariaSort('modified')}
							>
								{@render sortButton('modified', 'Modified')}
							</th>
							<th scope="col" class="w-12 px-2 py-2"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each entries as entry (entry.path)}
							{@const Icon = iconFor(entry)}
							<tr
								class={cn(
									'group border-b border-border/60 transition-colors last:border-b-0 hover:bg-accent/30',
									highlight === entry.path && 'motion-highlight'
								)}
							>
								{#if selecting}
									{@const covered = coveringFolder(selection, entry.path)}
									{@const picked = exportSelection.has(serverId, entry.path)}
									<td class="py-1.5 pl-4">
										<Checkbox
											checked={picked || covered !== null}
											disabled={!isSelectable(entry) || covered !== null}
											onCheckedChange={(checked) => toggleEntry(entry, checked)}
											aria-label={covered
												? `${entry.name} is included with folder ${covered}`
												: `Select ${entry.name} for export`}
											title={covered
												? `Included with /${covered}`
												: isSelectable(entry)
													? undefined
													: 'Links and special files cannot be exported'}
										/>
									</td>
								{/if}
								<td class={['py-1.5 pr-4', selecting ? 'pl-2' : 'pl-4']}>
									{#if entry.kind === 'directory' || entry.kind === 'file'}
										<button
											type="button"
											class="flex w-full min-w-0 items-center gap-2.5 rounded-sm py-1 text-left focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
											onclick={() => openEntry(entry)}
											title={entry.path}
										>
											<Icon
												class={cn(
													'size-4 shrink-0',
													entry.kind === 'directory' ? 'text-foreground' : 'text-muted-foreground'
												)}
												aria-hidden="true"
											/>
											<span class="truncate">{entry.name}</span>
											{#if entry.readOnly}
												<LockIcon
													class="size-3 shrink-0 text-muted-foreground"
													aria-label="Protected"
												/>
											{/if}
										</button>
									{:else}
										<span class="flex min-w-0 items-center gap-2.5 py-1 text-muted-foreground">
											<Icon class="size-4 shrink-0" aria-hidden="true" />
											<span class="truncate">{entry.name}</span>
											<Badge variant="outline"
												>{entry.kind === 'symlink' ? 'link' : 'special'}</Badge
											>
										</span>
									{/if}
								</td>
								<td
									class="hidden px-2 py-1.5 text-right text-muted-foreground tabular-nums sm:table-cell"
								>
									{entry.kind === 'file' ? formatBytes(entry.size) : '—'}
								</td>
								<td class="hidden truncate px-2 py-1.5 text-muted-foreground md:table-cell">
									{formatModified(entry.modifiedAt)}
								</td>
								<td class="px-2 py-1.5 text-right">
									{@render rowMenu(entry)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if listing.truncated}
					<p class="border-t border-border px-4 py-2 text-xs text-muted-foreground">
						Showing the first {listing.entries.length} entries. Use the filter or open a subfolder.
					</p>
				{/if}
			{/if}
		</div>
	</Reveal>
{/if}

{#snippet sortButton(key: SortKey, label: string)}
	<button
		type="button"
		class="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
		onclick={() => toggleSort(key)}
	>
		{label}
		{#if sortKey === key}
			{#if sortDir === 'asc'}<ChevronUpIcon
					class="size-3"
					aria-hidden="true"
				/>{:else}<ChevronDownIcon class="size-3" aria-hidden="true" />{/if}
		{/if}
	</button>
{/snippet}

{#snippet rowMenu(entry: FileEntry)}
	{@const mutable = writable && !entry.readOnly && entry.kind !== 'other'}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="icon-xs" aria-label={`Actions for ${entry.name}`}>
					<EllipsisIcon />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-44">
			{#if entry.kind === 'directory'}
				<DropdownMenu.Item onSelect={() => navigate(entry.path)}>
					<FolderOpenIcon /> Open
				</DropdownMenu.Item>
			{:else if entry.kind === 'file'}
				<DropdownMenu.Item onSelect={() => openEntry(entry)} disabled={entry.size > MAX_EDIT_BYTES}>
					<FileTextIcon />
					{writable && !entry.readOnly ? 'Edit' : 'View'}
				</DropdownMenu.Item>
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- API attachment, not an app route -->
						<a {...props} href={fileDownloadUrl(serverId, entry.path)} download={entry.name}>
							<DownloadIcon /> Download
						</a>
					{/snippet}
				</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => rename(entry)} disabled={!mutable}>
				<PencilIcon /> Rename
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => relocate(entry, 'move')} disabled={!mutable}>
				<MoveIcon /> Move
			</DropdownMenu.Item>
			<DropdownMenu.Item
				onSelect={() => relocate(entry, 'copy')}
				disabled={!writable || entry.kind === 'symlink' || entry.kind === 'other'}
			>
				<CopyIcon /> Copy
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item
				variant="destructive"
				onSelect={() => (deleteEntry = entry)}
				disabled={!mutable}
			>
				<TrashIcon /> Delete
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<FileNameDialog bind:request={nameRequest} />
<RelocateDialog {serverId} bind:request={relocateRequest} {writable} ondone={relocated} />
<FileDeleteDialog
	{serverId}
	bind:entry={deleteEntry}
	ondeleted={(entry) => {
		toast.success(`Deleted ${entry.name}`);
		dropSelected(entry.path);
		nonce += 1;
	}}
/>
