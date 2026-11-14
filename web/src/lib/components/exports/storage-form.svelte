<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import PlugZapIcon from '@lucide/svelte/icons/plug-zap';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		isAbortError,
		testStorage,
		updateStorage,
		type StorageConnection
	} from '#lib/api/index.js';
	import {
		canKeepSecret,
		storageFormDirty,
		storageFormFrom,
		toStorageRequest,
		validateStorageForm,
		type StorageFormValues
	} from '#lib/exports/exports.js';
	import { collapse, fadeIn } from '#lib/motion/index.js';

	interface Props {
		connection: StorageConnection;
		/** Number of archives stored in S3; the backend refuses retargeting while any exist. */
		s3Archives?: number;
		onSaved: (connection: StorageConnection) => void;
	}

	let { connection, s3Archives = 0, onSaved }: Props = $props();
	const id = $props.id();

	const form = $state<StorageFormValues>(storageFormFrom(untrack(() => connection)));
	let attempted = $state(false);
	let saving = $state(false);
	let saveError = $state.raw<unknown>(null);
	let testing = $state(false);
	let testResult = $state.raw<{ ok: true } | { ok: false; error: unknown } | null>(null);

	const abort = new AbortController();
	$effect(() => () => abort.abort());

	const dirty = $derived(storageFormDirty(form, connection));
	const errors = $derived(attempted ? validateStorageForm(form, connection) : {});
	const keepSecret = $derived(canKeepSecret(connection, form));

	function reset() {
		Object.assign(form, storageFormFrom(connection));
		attempted = false;
		saveError = null;
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (saving || !dirty) return;
		attempted = true;
		if (Object.keys(validateStorageForm(form, connection)).length > 0) return;
		saving = true;
		saveError = null;
		try {
			const saved = await updateStorage(toStorageRequest(form), { signal: abort.signal });
			onSaved(saved);
			Object.assign(form, storageFormFrom(saved));
			attempted = false;
			testResult = null;
			toast.success('Storage connection saved', { description: 'Test it before exporting.' });
		} catch (cause) {
			if (!isAbortError(cause)) saveError = cause;
		} finally {
			saving = false;
		}
	}

	async function test() {
		if (testing) return;
		testing = true;
		testResult = null;
		try {
			await testStorage({ signal: abort.signal });
			testResult = { ok: true };
		} catch (cause) {
			if (!isAbortError(cause)) testResult = { ok: false, error: cause };
		} finally {
			testing = false;
		}
	}
</script>

{#snippet field(
	key: Exclude<keyof StorageFormValues, 'secretAccessKey'>,
	label: string,
	placeholder: string,
	description?: string
)}
	<Field.Field data-invalid={errors[key] ? true : undefined}>
		<Field.Label for={`${id}-${key}`} class="text-xs">{label}</Field.Label>
		<Input
			id={`${id}-${key}`}
			bind:value={form[key]}
			{placeholder}
			autocomplete="off"
			spellcheck={false}
			class="h-8 font-mono text-xs md:text-xs"
			aria-invalid={errors[key] ? true : undefined}
			disabled={saving}
		/>
		{#if errors[key]}
			<Field.Error>{errors[key]}</Field.Error>
		{:else if description}
			<Field.Description class="text-xs">{description}</Field.Description>
		{/if}
	</Field.Field>
{/snippet}

<form
	class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
	aria-label="S3 storage connection"
	{onsubmit}
	novalidate
>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
		<CloudIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-sm font-medium">S3 storage</span>
		{#if connection.configured}
			<Badge variant="success">Configured</Badge>
			<span class="truncate font-mono text-xs text-muted-foreground" title={connection.endpoint}
				>{connection.bucket}{connection.prefix ? `/${connection.prefix}` : ''}</span
			>
		{:else}
			<Badge variant="outline">Not configured</Badge>
		{/if}
		<div class="ml-auto flex items-center gap-1.5">
			{#if testResult?.ok}
				<span class="inline-flex items-center gap-1 text-xs text-success" role="status" in:fadeIn>
					<CircleCheckIcon class="size-3.5" aria-hidden="true" />
					Write, read and delete verified
				</span>
			{/if}
			<Button
				variant="outline"
				size="sm"
				onclick={test}
				disabled={!connection.configured || testing || dirty || saving}
				title={dirty ? 'Save the connection before testing it' : undefined}
			>
				{#if testing}<Spinner data-icon="inline-start" />{:else}<PlugZapIcon
						data-icon="inline-start"
					/>{/if}
				Test connection
			</Button>
		</div>
	</div>

	{#if testResult && !testResult.ok}
		<div class="px-4 py-3" transition:collapse>
			<ErrorAlert error={testResult.error} />
		</div>
	{/if}

	<div class="grid gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-2">
		{@render field(
			'endpoint',
			'Endpoint',
			'https://s3.example.com',
			'Path-style. Plain HTTP is allowed for private networks.'
		)}
		{@render field('region', 'Region', 'us-east-1')}
		{@render field('bucket', 'Bucket', 'chunkyard-archives', 'Must already exist.')}
		{@render field('prefix', 'Prefix (optional)', 'minecraft/')}
		{@render field('accessKeyId', 'Access key ID', 'AKIA…')}
		<Field.Field data-invalid={errors.secretAccessKey ? true : undefined}>
			<Field.Label for={`${id}-secret`} class="text-xs">Secret access key</Field.Label>
			<Input
				id={`${id}-secret`}
				type="password"
				bind:value={form.secretAccessKey}
				placeholder={keepSecret ? '•••••••• stored' : ''}
				autocomplete="new-password"
				spellcheck={false}
				class="h-8 font-mono text-xs md:text-xs"
				aria-invalid={errors.secretAccessKey ? true : undefined}
				disabled={saving}
			/>
			{#if errors.secretAccessKey}
				<Field.Error>{errors.secretAccessKey}</Field.Error>
			{:else}
				<Field.Description class="text-xs">
					{keepSecret
						? 'Leave empty to keep the stored secret. It is never shown again.'
						: connection.hasSecret
							? 'Required again because the endpoint or access key changed.'
							: 'Stored privately on the manager host; never sent back to the browser.'}
				</Field.Description>
			{/if}
		</Field.Field>
	</div>

	{#if s3Archives > 0}
		<p class="flex items-start gap-2 px-4 py-2.5 text-xs text-muted-foreground">
			<TriangleAlertIcon class="mt-px size-3.5 shrink-0 text-warning" aria-hidden="true" />
			{s3Archives}
			{s3Archives === 1 ? 'archive is' : 'archives are'} stored in this bucket. The manager refuses to
			retarget the connection while S3 archives exist, so existing archives never point at the wrong storage.
			Delete them first to move to another endpoint or bucket.
		</p>
	{/if}

	{#if saveError}
		<div class="px-4 py-3" transition:collapse><ErrorAlert error={saveError} /></div>
	{/if}

	<div class="flex items-center justify-end gap-2 px-4 py-2.5">
		{#if dirty}
			<Button variant="ghost" size="sm" onclick={reset} disabled={saving}>Discard</Button>
		{/if}
		<Button type="submit" size="sm" disabled={!dirty || saving}>
			{#if saving}<Spinner data-icon="inline-start" />{/if}
			Save connection
		</Button>
	</div>
</form>
