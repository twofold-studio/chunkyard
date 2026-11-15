<script lang="ts" module>
	import type { ApiKey, CreatedApiKey } from '#lib/api/index.js';

	export interface ApiKeysApi {
		list: (signal: AbortSignal) => Promise<ApiKey[]>;
		create: (name: string) => Promise<CreatedApiKey>;
		revoke: (id: string) => Promise<void>;
	}
</script>

<script lang="ts">
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { CopyText, ErrorAlert } from '#lib/components/app/index.js';
	import {
		createApiKey,
		describeError,
		isAbortError,
		listApiKeys,
		revokeApiKey
	} from '#lib/api/index.js';

	interface Props {
		/** Injected in tests; defaults to `/api/v1/auth/api-keys`. */
		api?: ApiKeysApi;
	}

	const defaultApi: ApiKeysApi = {
		list: async (signal) => (await listApiKeys({ signal })).items,
		create: (name) => createApiKey({ name }),
		revoke: (id) => revokeApiKey(id)
	};

	let { api: apiProp }: Props = $props();
	const api = untrack(() => apiProp) ?? defaultApi;

	let keys = $state.raw<ApiKey[] | null>(null);
	let loadError = $state.raw<unknown>(null);
	let reload = $state(0);

	let name = $state('');
	let nameError = $state<string | null>(null);
	let creating = $state(false);
	let createError = $state.raw<unknown>(null);

	/**
	 * The only copy of a new token, kept just for the dialog: never stored, logged or put in a
	 * URL, and cleared when the dialog closes.
	 */
	let created = $state.raw<CreatedApiKey | null>(null);

	let revoking = $state.raw<ApiKey | null>(null);
	let revokeBusy = $state(false);
	let revokeError = $state.raw<unknown>(null);

	$effect(() => {
		void reload;
		const abort = new AbortController();
		untrack(() => (loadError = null));
		api.list(abort.signal).then(
			(items) => (keys = items),
			(error: unknown) => {
				if (!isAbortError(error)) loadError = error;
			}
		);
		return () => abort.abort();
	});

	/** Same limit as the backend: 1–80 UTF-8 bytes, no control characters. */
	function validateName(value: string): string | null {
		const trimmed = value.trim();
		if (!trimmed) return 'Name the integration that will use this key.';
		if (new TextEncoder().encode(trimmed).length > 80) return 'Use at most 80 bytes.';
		// eslint-disable-next-line no-control-regex
		if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) return 'Remove control characters.';
		return null;
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (creating) return;
		nameError = validateName(name);
		if (nameError) return;
		creating = true;
		createError = null;
		try {
			const result = await api.create(name.trim());
			created = result;
			keys = [result.key, ...(keys ?? []).filter((k) => k.id !== result.key.id)];
			name = '';
		} catch (error) {
			createError = error;
		} finally {
			creating = false;
		}
	}

	function closeCreated() {
		created = null;
	}

	async function confirmRevoke() {
		const key = revoking;
		if (!key || revokeBusy) return;
		revokeBusy = true;
		revokeError = null;
		try {
			await api.revoke(key.id);
			keys = (keys ?? []).filter((k) => k.id !== key.id);
			revoking = null;
			toast.success(`Revoked ${key.name}`);
		} catch (error) {
			revokeError = error;
		} finally {
			revokeBusy = false;
		}
	}

	function when(iso: string | null): string {
		if (!iso) return 'Never';
		const date = new Date(iso);
		return Number.isNaN(date.getTime())
			? iso
			: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<div class="flex flex-col gap-4">
	<form onsubmit={create} class="flex flex-col gap-2" novalidate>
		<Field.Field data-invalid={nameError ? true : undefined}>
			<Field.Label for="api-key-name">New key name</Field.Label>
			<div class="flex flex-wrap gap-2">
				<Input
					id="api-key-name"
					bind:value={name}
					oninput={() => (nameError = null)}
					placeholder="e.g. Claude Code on laptop"
					autocomplete="off"
					maxlength={80}
					aria-invalid={nameError ? true : undefined}
					aria-describedby="api-key-name-help"
					class="min-w-48 flex-1"
				/>
				<Button type="submit" disabled={creating}>
					{#if creating}<Spinner data-icon="inline-start" />{:else}<PlusIcon
							data-icon="inline-start"
						/>{/if}
					Create key
				</Button>
			</div>
			{#if nameError}
				<Field.Error>{nameError}</Field.Error>
			{:else}
				<Field.Description id="api-key-name-help">
					One key per integration, so each can be revoked on its own. Keys have full owner access.
				</Field.Description>
			{/if}
		</Field.Field>
		{#if createError}<ErrorAlert error={createError} />{/if}
	</form>

	{#if loadError}
		<ErrorAlert error={loadError}>
			<Button size="sm" variant="outline" class="mt-2" onclick={() => (reload += 1)}>Retry</Button>
		</ErrorAlert>
	{:else if keys === null}
		<div class="flex flex-col gap-2" aria-busy="true">
			<Skeleton class="h-12" />
			<Skeleton class="h-12" />
		</div>
	{:else if keys.length === 0}
		<p
			class="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
		>
			No API keys yet.
		</p>
	{:else}
		<ul class="divide-y divide-border rounded-md border border-border" aria-label="API keys">
			{#each keys as key (key.id)}
				<li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
					<KeyRoundIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="truncate font-medium" title={key.name}>{key.name}</span>
						<span class="text-xs text-muted-foreground">
							<code class="font-mono">{key.prefix}…</code> · Created {when(key.createdAt)} · Last used
							{when(key.lastUsedAt)}
						</span>
					</div>
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							revokeError = null;
							revoking = key;
						}}
						aria-label={`Revoke ${key.name}`}
					>
						Revoke
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<Dialog.Root
	open={created !== null}
	onOpenChange={(open) => {
		if (!open) closeCreated();
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Copy your new API key</Dialog.Title>
			<Dialog.Description>
				This is the only time <span class="font-medium text-foreground">{created?.key.name}</span>
				is shown in full. Store it in your client's configuration; closing this dialog removes it from
				the page.
			</Dialog.Description>
		</Dialog.Header>
		{#if created}
			<CopyText value={created.token} label="Copy API key" />
			<p class="flex items-start gap-2 text-xs text-muted-foreground">
				<TriangleAlertIcon class="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
				Anyone with this key can control every server. Revoke it here if it leaks.
			</p>
		{/if}
		<Dialog.Footer>
			<Button onclick={closeCreated}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	open={revoking !== null}
	onOpenChange={(open) => {
		if (!open && !revokeBusy) revoking = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Revoke {revoking?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				Requests using <code class="font-mono">{revoking?.prefix}…</code> stop working right away. This
				cannot be undone; create a new key if the integration still needs access.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if revokeError}
			<p class="text-sm text-destructive" role="alert">{describeError(revokeError).title}</p>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={revokeBusy}>Keep key</AlertDialog.Cancel>
			<Button variant="destructive" onclick={confirmRevoke} disabled={revokeBusy}>
				{#if revokeBusy}<Spinner data-icon="inline-start" />{/if}
				Revoke key
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
