<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SaveIcon from '@lucide/svelte/icons/save';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert, UnsavedChangesDialog } from '#lib/components/app/index.js';
	import { Reveal } from '#lib/components/motion/index.js';
	import { fileDownloadUrl } from '#lib/api/index.js';
	import { TextFileEditor, type EditorApi } from '#lib/files/text-editor.svelte.js';
	import { baseName, formatBytes, SERVER_PROPERTIES } from '#lib/files/paths.js';
	import { detectFormat, eolLabel, languageFor, LANGUAGE_LABELS } from '#lib/files/editor-text.js';
	import CodeEditor from '#lib/components/editor/code-editor.svelte';
	import type { EditorStatus } from '#lib/components/editor/codemirror.js';
	import { collapse, fadeIn } from '#lib/motion/index.js';
	import { formatTime } from '#lib/format.js';

	interface Props {
		serverId: string;
		path: string;
		/** Server is stopped and the manager can write files right now. */
		writable: boolean;
		/** Reports unsaved changes so the parent can guard navigation. */
		dirty?: boolean;
		onClose: () => void;
		onSaved?: () => void;
		api?: Partial<EditorApi>;
	}

	let {
		serverId,
		path,
		writable,
		dirty = $bindable(false),
		onClose,
		onSaved,
		api
	}: Props = $props();

	// The parent keys this component by path, so the editor is created once.
	const editor = new TextFileEditor(
		untrack(() => serverId),
		untrack(() => path),
		untrack(() => api)
	);
	$effect(() => {
		void editor.load();
		return () => editor.destroy();
	});
	$effect(() => {
		dirty = editor.dirty;
	});

	// Becoming writable (server stopped) re-reads a clean file: write permission comes from
	// the read, and Minecraft rewrites server.properties while it runs.
	let lastWritable = untrack(() => writable);
	$effect(() => {
		const next = writable;
		if (next === lastWritable) return;
		lastWritable = next;
		if (next && untrack(() => !editor.dirty && !editor.loading)) void editor.reload();
	});

	const canEdit = $derived(editor.editable && writable);
	const isProperties = $derived(path === SERVER_PROPERTIES);
	const language = languageFor(untrack(() => path));
	const format = $derived(detectFormat(editor.original));
	let status = $state<EditorStatus | null>(null);
	let confirmClose = $state(false);

	const readOnlyReason = $derived.by(() => {
		if (editor.loading || editor.loadError) return null;
		if (editor.readOnly)
			return path === 'eula.txt'
				? 'eula.txt is managed by the EULA setting in Settings.'
				: 'This file is protected by the manager.';
		if (!writable || !editor.canWrite) return 'Stop the server to edit files.';
		return null;
	});

	async function save() {
		if (!canEdit) return;
		if (await editor.save()) onSaved?.();
	}

	function requestClose() {
		if (editor.dirty) confirmClose = true;
		else onClose();
	}

	/** Ctrl/⌘+S anywhere inside the editor view saves instead of opening the browser dialog. */
	function onSaveShortcut(event: KeyboardEvent) {
		if (event.defaultPrevented || event.altKey) return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			void save();
		}
	}

	function onbeforeunload(event: BeforeUnloadEvent) {
		if (editor.dirty) event.preventDefault();
	}
</script>

<svelte:window {onbeforeunload} />

<Reveal preset="fade" class="flex flex-col gap-4" onkeydown={onSaveShortcut}>
	<div class="flex flex-wrap items-center gap-2">
		<Button variant="ghost" size="sm" onclick={requestClose}>
			<ArrowLeftIcon data-icon="inline-start" />
			Files
		</Button>
		<div class="flex min-w-0 flex-1 items-center gap-2">
			<FileTextIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<h3 class="truncate font-mono text-sm" title={path}>{path}</h3>
			{#if editor.dirty}
				<span in:fadeIn><Badge variant="warning">Unsaved</Badge></span>
			{:else if editor.savedAt}
				<span in:fadeIn
					><Badge variant="success">Saved {formatTime(new Date(editor.savedAt))}</Badge></span
				>
			{/if}
			{#if readOnlyReason}<Badge variant="outline">Read-only</Badge>{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				href={fileDownloadUrl(serverId, path)}
				download={baseName(path)}
			>
				<DownloadIcon data-icon="inline-start" />
				<span class="max-sm:sr-only">Download</span>
			</Button>
			<Button
				variant="outline"
				size="sm"
				onclick={() => editor.reload()}
				disabled={editor.loading || editor.saving}
				title="Discard changes and read the file again"
			>
				<RotateCcwIcon data-icon="inline-start" />
				<span class="max-sm:sr-only">Reload</span>
			</Button>
			<Button
				size="sm"
				onclick={save}
				disabled={!canEdit || !editor.dirty || editor.saving || editor.conflict}
				aria-keyshortcuts="Control+S"
			>
				{#if editor.saving}<Spinner data-icon="inline-start" />{:else}<SaveIcon
						data-icon="inline-start"
					/>{/if}
				Save
			</Button>
		</div>
	</div>

	{#if editor.conflict}
		<div transition:collapse>
			<Alert.Root variant="destructive" role="alert">
				<TriangleAlertIcon />
				<Alert.Title>This file changed since you opened it</Alert.Title>
				<Alert.Description class="flex flex-col gap-2">
					<p>
						Your changes were not saved, so nothing was overwritten. Reload to see the current file;
						copy anything you want to keep first, because reloading discards your edits.
					</p>
					<div class="flex flex-wrap gap-2">
						<Button size="sm" variant="outline" onclick={() => editor.reload()}>
							Reload latest version
						</Button>
					</div>
				</Alert.Description>
			</Alert.Root>
		</div>
	{/if}
	{#if editor.saveError}
		<div transition:collapse><ErrorAlert error={editor.saveError} /></div>
	{/if}

	{#if editor.loading}
		<Skeleton class="h-96 w-full" />
	{:else if editor.loadError}
		<ErrorAlert error={editor.loadError} />
	{:else}
		{#if readOnlyReason}
			<p class="text-sm text-muted-foreground">{readOnlyReason}</p>
		{:else if isProperties}
			<p class="text-xs text-muted-foreground">
				Edits here change the file on disk. Use the Properties tab for versioned settings that apply
				on the next start.
			</p>
		{/if}
		<div class="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
			<CodeEditor
				value={editor.content}
				onChange={(next) => (editor.content = next)}
				{language}
				readOnly={!canEdit}
				label={`Contents of ${path}`}
				bind:status
				class="h-[min(70vh,48rem)]"
			/>
			<div
				class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground"
			>
				<span class="flex flex-wrap gap-x-3 tabular-nums" data-testid="editor-status">
					{#if status}
						<span>Ln {status.line}, Col {status.column}</span>
						{#if status.selected}<span>{status.selected} selected</span>{/if}
						<span>{status.lines} {status.lines === 1 ? 'line' : 'lines'}</span>
					{/if}
					<span>{formatBytes(editor.size)} on disk</span>
				</span>
				<span class="flex flex-wrap gap-x-3">
					<span>{LANGUAGE_LABELS[language]}</span>
					<span>UTF-8{format.bom ? ' with BOM' : ''} · {eolLabel(format.eol)}</span>
					<span class="max-md:hidden">Ctrl/⌘+S saves · Ctrl/⌘+F finds · Esc then Tab leaves</span>
				</span>
			</div>
		</div>
	{/if}
</Reveal>

<UnsavedChangesDialog
	open={confirmClose}
	onStay={() => (confirmClose = false)}
	onDiscard={() => {
		confirmClose = false;
		onClose();
	}}
>
	{#snippet description()}
		Your edits to <code class="font-mono">{baseName(path)}</code> have not been saved.
	{/snippet}
</UnsavedChangesDialog>
