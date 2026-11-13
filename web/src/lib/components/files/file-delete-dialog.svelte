<script lang="ts">
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { deleteFile, errorCode, isAbortError, type FileEntry } from '#lib/api/index.js';
	import { collapse } from '#lib/motion/index.js';

	interface Props {
		serverId: string;
		/** `null` closes the dialog. */
		entry: FileEntry | null;
		ondeleted: (entry: FileEntry) => void;
	}

	let { serverId, entry = $bindable(), ondeleted }: Props = $props();

	let recursive = $state(false);
	let working = $state(false);
	let error = $state.raw<unknown>(null);
	let abort: AbortController | null = null;
	let shown: FileEntry | null = null;
	$effect(() => () => abort?.abort());

	$effect.pre(() => {
		if (entry && entry !== shown) {
			shown = entry;
			recursive = false;
			working = false;
			error = null;
		} else if (!entry) {
			shown = null;
		}
	});

	const isDir = $derived(entry?.kind === 'directory');

	async function confirm() {
		if (!entry || working) return;
		const target = entry;
		working = true;
		error = null;
		abort = new AbortController();
		try {
			await deleteFile(serverId, target.path, isDir && recursive, { signal: abort.signal });
			entry = null;
			ondeleted(target);
		} catch (caught) {
			if (!isAbortError(caught)) error = caught;
		} finally {
			working = false;
		}
	}
</script>

<AlertDialog.Root
	bind:open={
		() => entry !== null,
		(open) => {
			if (!open && !working) entry = null;
		}
	}
>
	<AlertDialog.Content>
		{#if entry}
			<AlertDialog.Header>
				<AlertDialog.Title>
					Delete {isDir ? 'folder' : 'file'} “{entry.name}”?
				</AlertDialog.Title>
				<AlertDialog.Description>
					<code class="font-mono break-all">{entry.path}</code> is permanently removed from the manager
					host. There is no trash and this cannot be undone.
				</AlertDialog.Description>
			</AlertDialog.Header>
			{#if isDir}
				<Field.Field orientation="horizontal" data-disabled={working ? true : undefined}>
					<Checkbox id="delete-recursive" bind:checked={recursive} disabled={working} />
					<Field.Content>
						<Field.Label for="delete-recursive" class="font-normal">
							Also delete everything inside this folder
						</Field.Label>
						<Field.Description>
							Required for folders that are not empty, such as worlds or plugin folders.
						</Field.Description>
					</Field.Content>
				</Field.Field>
			{/if}
			{#if error}
				<div transition:collapse>
					<ErrorAlert
						{error}
						hint={errorCode(error) === 'files.not_empty'
							? 'Tick “Also delete everything inside this folder” to remove its contents too.'
							: undefined}
					/>
				</div>
			{/if}
			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={working}>Cancel</AlertDialog.Cancel>
				<Button variant="destructive" disabled={working} onclick={confirm}>
					{#if working}<Spinner data-icon="inline-start" />{/if}
					{isDir && recursive ? 'Delete folder and contents' : 'Delete permanently'}
				</Button>
			</AlertDialog.Footer>
		{/if}
	</AlertDialog.Content>
</AlertDialog.Root>
