<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SaveIcon from '@lucide/svelte/icons/save';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { Reveal } from '#lib/components/motion/index.js';
	import { fileDownloadUrl } from '#lib/api/index.js';
	import { TextFileEditor, type EditorApi } from '#lib/files/text-editor.svelte.js';
	import { baseName, formatBytes, SERVER_PROPERTIES } from '#lib/files/paths.js';
	import { detectEol } from '#lib/files/properties.js';
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
	const lineCount = $derived(editor.content ? editor.content.split('\n').length : 1);
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

	/** Set by Escape so the next Tab leaves the editor (keyboard trap escape hatch). */
	let tabEscapes = false;

	// Textareas report every line break as LF. Map them back to the file's own line ending
	// so editing a CRLF file as raw text does not silently convert it.
	const fileEol = $derived(detectEol(editor.original));
	const withFileEol = (text: string) => (fileEol === '\n' ? text : text.replace(/\n/g, fileEol));

	function onkeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			void save();
			return;
		}
		if (event.key === 'Escape') {
			tabEscapes = true;
			return;
		}
		// Tab inserts a tab character; press Escape first (or Shift+Tab) to move focus out.
		const escaping = tabEscapes;
		tabEscapes = false;
		if (event.key === 'Tab' && !escaping && !event.shiftKey && !event.altKey && canEdit) {
			const area = event.currentTarget as HTMLTextAreaElement;
			event.preventDefault();
			const { selectionStart: start, selectionEnd: end } = area;
			const text = area.value;
			editor.content = withFileEol(`${text.slice(0, start)}\t${text.slice(end)}`);
			queueMicrotask(() => area.setSelectionRange(start + 1, start + 1));
		}
	}

	function onbeforeunload(event: BeforeUnloadEvent) {
		if (editor.dirty) event.preventDefault();
	}
</script>

<svelte:window {onbeforeunload} />

<Reveal preset="fade" class="flex flex-col gap-4">
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
		<div class="overflow-hidden rounded-lg border border-border bg-background">
			<textarea
				value={editor.content.replace(/\r\n?/g, '\n')}
				oninput={(event) => (editor.content = withFileEol(event.currentTarget.value))}
				{onkeydown}
				readonly={!canEdit}
				spellcheck={false}
				autocomplete="off"
				autocapitalize="off"
				wrap="off"
				aria-label={`Contents of ${path}`}
				class="block min-h-96 w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed [tab-size:4] outline-none read-only:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
				style:height="min(70vh, {Math.max(24, lineCount + 2) * 1.625}em)"></textarea>
			<div
				class="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground"
			>
				<span
					>{lineCount}
					{lineCount === 1 ? 'line' : 'lines'} · {formatBytes(editor.size)} on disk</span
				>
				<span>UTF-8 · Ctrl/⌘ + S saves · Esc then Tab leaves the editor</span>
			</div>
		</div>
	{/if}
</Reveal>

<AlertDialog.Root bind:open={confirmClose}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Discard unsaved changes?</AlertDialog.Title>
			<AlertDialog.Description>
				Your edits to <code class="font-mono">{baseName(path)}</code> have not been saved.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					confirmClose = false;
					onClose();
				}}
			>
				Discard
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
