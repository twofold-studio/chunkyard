<script lang="ts" module>
	import type { FileEntry } from '#lib/api/index.js';

	export interface RelocateRequest {
		entry: FileEntry;
		mode: 'move' | 'copy';
	}
</script>

<script lang="ts">
	import FolderIcon from '@lucide/svelte/icons/folder';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { copyFile, isAbortError, moveFile, type DirectoryListing } from '#lib/api/index.js';
	import {
		baseName,
		joinPath,
		parentPath,
		parseRelativePath,
		relocationError,
		type Relocation
	} from '#lib/files/paths.js';
	import { collapse } from '#lib/motion/index.js';
	import FolderPicker from './folder-picker.svelte';

	interface Props {
		serverId: string;
		/** `null` closes the dialog. */
		request: RelocateRequest | null;
		/** Generic file writes are allowed (stopped server, writable listing). */
		writable: boolean;
		/** Called with the server's answer after a successful move/copy. */
		ondone: (request: RelocateRequest, target: string, entry: FileEntry) => void;
	}

	let { serverId, request = $bindable(), writable, ondone }: Props = $props();

	let folder = $state('');
	let name = $state('');
	let manual = $state(false);
	let manualPath = $state('');
	let attempted = $state(false);
	let working = $state(false);
	let error = $state.raw<unknown>(null);
	let listing = $state.raw<DirectoryListing | null>(null);
	let shown: RelocateRequest | null = null;

	$effect.pre(() => {
		if (request && request !== shown) {
			shown = request;
			folder = parentPath(request.entry.path);
			name = request.mode === 'copy' ? copyName(request.entry) : request.entry.name;
			manual = false;
			manualPath = '';
			attempted = false;
			working = false;
			error = null;
		} else if (!request) {
			shown = null;
		}
	});

	const source = $derived<Relocation | null>(
		request ? { from: request.entry.path, directory: request.entry.kind === 'directory' } : null
	);
	const verb = $derived(request?.mode === 'copy' ? 'Copy' : 'Move');

	/** Destination folder and name, from the picker or the typed path. */
	const target = $derived.by(
		(): { ok: true; folder: string; name: string } | { ok: false; error: string } => {
			if (!manual) return { ok: true, folder, name };
			const parsed = parseRelativePath(manualPath);
			if (!parsed.ok) return parsed;
			return { ok: true, folder: parentPath(parsed.path), name: baseName(parsed.path) };
		}
	);

	const problem = $derived.by(() => {
		if (!source) return null;
		if (!target.ok) return target.error;
		return relocationError(source, target.folder, target.name);
	});

	/** Known clash in the folder being browsed; the backend still refuses any clash. */
	const clash = $derived(
		!manual && listing && !problem && listing.entries.some((e) => e.name === name)
			? `${name} already exists in this folder. Nothing is overwritten; choose another name or folder.`
			: null
	);

	const folderWritable = $derived(manual || (listing?.canWrite ?? false));
	const blocked = $derived(!writable || !folderWritable);
	const shownError = $derived(attempted || manual ? problem : null);
	const destination = $derived(target.ok ? joinPath(target.folder, target.name) : null);

	function copyName(entry: FileEntry): string {
		const dot = entry.kind === 'file' ? entry.name.lastIndexOf('.') : -1;
		return dot > 0
			? `${entry.name.slice(0, dot)} copy${entry.name.slice(dot)}`
			: `${entry.name} copy`;
	}

	function setManual(next: boolean) {
		if (next) {
			manualPath = joinPath(folder, name);
		} else if (target.ok) {
			folder = target.folder;
			name = target.name;
		}
		manual = next;
		error = null;
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		const current = request;
		if (!current || !source || working || blocked) return;
		attempted = true;
		if (problem || clash || !target.ok) return;
		const to = joinPath(target.folder, target.name);
		working = true;
		error = null;
		try {
			const run = current.mode === 'move' ? moveFile : copyFile;
			const { entry } = await run(serverId, current.entry.path, to);
			if (request === current) request = null;
			ondone(current, to, entry);
		} catch (caught) {
			// The source stays where it was; show why and keep the dialog open.
			if (!isAbortError(caught)) error = caught;
		} finally {
			working = false;
		}
	}
</script>

<Dialog.Root
	bind:open={
		() => request !== null,
		(open) => {
			if (!open && !working) request = null;
		}
	}
>
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto">
		{#if request && source}
			<form class="flex min-w-0 flex-col gap-4" {onsubmit} novalidate>
				<Dialog.Header>
					<Dialog.Title>{verb} {request.entry.name}</Dialog.Title>
					<Dialog.Description>
						Pick a folder, then confirm the name. Existing files and folders are never overwritten.
					</Dialog.Description>
				</Dialog.Header>

				{#if manual}
					<Field.Field data-invalid={shownError ? true : undefined}>
						<Field.Label for="relocate-path">Destination path</Field.Label>
						<Input
							id="relocate-path"
							bind:value={manualPath}
							class="font-mono"
							autocomplete="off"
							spellcheck={false}
							placeholder="plugins/old/config.yml"
							aria-invalid={shownError ? true : undefined}
							aria-describedby="relocate-path-hint"
							disabled={working}
						/>
						<Field.Description id="relocate-path-hint">
							Relative to the server directory, including the new name.
						</Field.Description>
						{#if shownError}<Field.Error>{shownError}</Field.Error>{/if}
					</Field.Field>
				{:else}
					<FolderPicker {serverId} bind:path={folder} bind:listing {source} disabled={working} />
					<Field.Field data-invalid={shownError || clash ? true : undefined}>
						<Field.Label for="relocate-name">Name</Field.Label>
						<Input
							id="relocate-name"
							bind:value={name}
							class="font-mono"
							autocomplete="off"
							spellcheck={false}
							aria-invalid={shownError || clash ? true : undefined}
							disabled={working}
						/>
						{#if shownError}
							<Field.Error>{shownError}</Field.Error>
						{:else if clash}
							<Field.Error>{clash}</Field.Error>
						{/if}
					</Field.Field>
				{/if}

				<div
					class="flex min-w-0 items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
					data-testid="relocate-summary"
				>
					<FolderIcon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<p class="min-w-0 break-all" aria-live="polite">
						<span class="text-muted-foreground">{verb} to</span>
						<span class="font-mono">/{destination ?? '…'}</span>
					</p>
				</div>

				{#if !writable}
					<p class="text-xs text-warning" transition:collapse>
						Stop the server to {verb.toLowerCase()} files.
					</p>
				{:else if !folderWritable && listing}
					<p class="text-xs text-warning" transition:collapse>
						Files are read-only right now; the manager cannot confirm the server is stopped.
					</p>
				{/if}

				{#if error}
					<div transition:collapse><ErrorAlert {error} /></div>
				{/if}

				<Dialog.Footer class="items-center gap-2 sm:justify-between">
					<Button
						variant="link"
						size="sm"
						class="h-auto px-0 text-xs"
						onclick={() => setManual(!manual)}
						disabled={working}
					>
						{manual ? 'Browse folders' : 'Type a path'}
					</Button>
					<div class="flex gap-2">
						<Button variant="outline" disabled={working} onclick={() => (request = null)}>
							Cancel
						</Button>
						<Button type="submit" disabled={working || blocked || (!manual && !listing)}>
							{#if working}<Spinner data-icon="inline-start" />{/if}
							{verb}
						</Button>
					</div>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
