<script lang="ts">
	import TrashIcon from '@lucide/svelte/icons/trash';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { CopyText, ErrorAlert } from '#lib/components/app/index.js';
	import {
		errorCode,
		isAbortError,
		type DeletedServer,
		type Job,
		type ServerView
	} from '#lib/api/index.js';
	import { deleteAndWait, type DeleteApi } from '#lib/servers/delete.js';

	interface Props {
		server: Pick<ServerView, 'id' | 'name' | 'directory' | 'port' | 'status'>;
		/** Another operation is running on this server. */
		disabled?: boolean;
		/** True from the DELETE request until its job finishes. */
		deleting?: boolean;
		ondeleted: (deleted: DeletedServer) => void;
		/** Injected in tests. */
		jobIntervalMs?: number;
		api?: Partial<DeleteApi>;
	}

	let {
		server,
		disabled = false,
		deleting = $bindable(false),
		ondeleted,
		jobIntervalMs,
		api
	}: Props = $props();

	let open = $state(false);
	let deleteFiles = $state(false);
	let job = $state.raw<Job | null>(null);
	let error = $state.raw<unknown>(null);

	const stopped = $derived(server.status.state === 'stopped');
	const canDelete = $derived(stopped && !disabled && !deleting);

	let abort: AbortController | null = null;
	$effect(() => () => abort?.abort());

	function setOpen(next: boolean) {
		// Keep the dialog up while the job runs so its outcome is visible.
		if (deleting) return;
		open = next;
		if (next) {
			deleteFiles = false;
			error = null;
			job = null;
		}
	}

	async function confirm() {
		if (deleting || !stopped) return;
		deleting = true;
		error = null;
		job = null;
		abort = new AbortController();
		try {
			const outcome = await deleteAndWait(server.id, deleteFiles, {
				signal: abort.signal,
				intervalMs: jobIntervalMs,
				api,
				onUpdate: (update) => (job = update)
			});
			job = outcome.job;
			if (outcome.deleted) {
				deleting = false;
				open = false;
				ondeleted(outcome.deleted);
				return;
			}
			error = outcome.error;
		} catch (caught) {
			if (isAbortError(caught)) return;
			error = caught;
		}
		deleting = false;
	}

	const errorHint = $derived(
		errorCode(error) === 'server.running'
			? 'Stop the server, then delete it. Deleting never stops a running server.'
			: undefined
	);
</script>

<AlertDialog.Root bind:open={() => open, setOpen}>
	<AlertDialog.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				size="sm"
				variant="outline"
				class="text-destructive hover:text-destructive"
				disabled={!canDelete}
				title={stopped ? undefined : 'Stop the server before deleting it'}
			>
				<TrashIcon data-icon="inline-start" />
				Delete
			</Button>
		{/snippet}
	</AlertDialog.Trigger>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete “{server.name}”?</AlertDialog.Title>
			<AlertDialog.Description>
				Removes this server from the manager together with its stopped Docker container. Other
				instances configured on port {server.port} are unchanged. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>

		<div class="flex min-w-0 flex-col gap-3">
			<Field.Field orientation="horizontal" data-disabled={deleting ? true : undefined}>
				<Checkbox id="delete-files" bind:checked={deleteFiles} disabled={deleting} />
				<Field.Content>
					<Field.Label for="delete-files" class="font-normal">
						Also delete world and server files
					</Field.Label>
					<Field.Description>
						{#if deleteFiles}
							Permanently deletes this server's directory on the manager host, including worlds,
							configuration and logs.
						{:else}
							Files stay on the manager host (not in your browser) at the path below. Back them up
							or remove them there yourself.
						{/if}
					</Field.Description>
				</Field.Content>
			</Field.Field>
			<CopyText value={server.directory} label="Copy directory path" />

			{#if deleting}
				<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
					<Spinner />
					Deleting… {job ? `job ${job.state}` : 'requesting'}
				</p>
			{/if}
			{#if error}
				<ErrorAlert {error} hint={errorHint}>
					<p class="text-muted-foreground">
						{deleteFiles
							? 'Some requested cleanup may already have completed. Check the instance list before retrying.'
							: 'Server files are retained on the manager host. Check the instance list before retrying.'}
					</p>
				</ErrorAlert>
			{/if}
		</div>

		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
			<Button variant="destructive" disabled={deleting || !stopped} onclick={confirm}>
				{#if deleting}<Spinner data-icon="inline-start" />{/if}
				{deleteFiles ? 'Delete server and files' : 'Delete server'}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
