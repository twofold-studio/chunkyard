<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { isAbortError, updateServerResources, type ServerView } from '#lib/api/index.js';
	import { validateResources, type ResourceValues } from '#lib/servers/validate.js';
	import { formatCpus, formatMemoryRange } from '#lib/format.js';
	import { collapse } from '#lib/motion/index.js';

	interface Props {
		server: ServerView;
		/** Another operation is running on this server. */
		busy: boolean;
		onServerUpdated: (server: ServerView) => void;
		/** Form expanded; the summary row is always shown. */
		open?: boolean;
	}

	let { server, busy, onServerUpdated, open = $bindable(false) }: Props = $props();
	const formId = $props.id();

	const current = $derived({
		memoryMinMb: server.memoryMinMb,
		memoryMaxMb: server.memoryMaxMb,
		cpus: server.cpus
	});
	const form = $state<ResourceValues>(untrack(() => ({ ...current })));
	let attempted = $state(false);
	let saving = $state(false);
	let saveError = $state.raw<unknown>(null);
	let abort: AbortController | null = null;
	$effect(() => () => abort?.abort());

	const dirty = $derived(
		form.memoryMinMb !== current.memoryMinMb ||
			form.memoryMaxMb !== current.memoryMaxMb ||
			form.cpus !== current.cpus
	);

	/** Values the form was last synced from; edits are kept when the record refreshes. */
	let baseline: ResourceValues = untrack(() => ({ ...current }));
	$effect(() => {
		const next = {
			memoryMinMb: server.memoryMinMb,
			memoryMaxMb: server.memoryMaxMb,
			cpus: server.cpus
		};
		untrack(() => {
			const pristine =
				form.memoryMinMb === baseline.memoryMinMb &&
				form.memoryMaxMb === baseline.memoryMaxMb &&
				form.cpus === baseline.cpus;
			baseline = next;
			if (pristine && !saving) Object.assign(form, next);
		});
	});

	const stopped = $derived(server.status.state === 'stopped');
	const locked = $derived(!stopped || busy || saving);
	const errors = $derived(attempted ? validateResources(form) : {});

	function reset() {
		Object.assign(form, current);
		attempted = false;
		saveError = null;
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (locked || !dirty) return;
		attempted = true;
		if (Object.keys(validateResources(form)).length > 0) return;
		saving = true;
		saveError = null;
		abort = new AbortController();
		try {
			const { server: updated } = await updateServerResources(
				server.id,
				{
					memoryMinMb: form.memoryMinMb ?? 0,
					memoryMaxMb: form.memoryMaxMb ?? 0,
					cpus: form.cpus ?? 0
				},
				{ signal: abort.signal }
			);
			attempted = false;
			baseline = {
				memoryMinMb: updated.memoryMinMb,
				memoryMaxMb: updated.memoryMaxMb,
				cpus: updated.cpus
			};
			onServerUpdated(updated);
			Object.assign(form, {
				memoryMinMb: updated.memoryMinMb,
				memoryMaxMb: updated.memoryMaxMb,
				cpus: updated.cpus
			});
			toast.success('Resources saved', { description: 'They apply on the next start.' });
		} catch (error) {
			if (!isAbortError(error)) saveError = error;
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex flex-col">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
		<CpuIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-sm font-medium">Resources</span>
		<span class="text-xs text-muted-foreground">
			Heap <span class="text-foreground"
				>{formatMemoryRange(server.memoryMinMb, server.memoryMaxMb)}</span
			>
			· <span class="text-foreground">{formatCpus(server.cpus)}</span>
		</span>
		<Button
			variant="ghost"
			size="sm"
			class="ml-auto"
			aria-expanded={open}
			aria-controls={formId}
			onclick={() => (open = !open)}
		>
			{open ? 'Hide' : 'Edit'}
			<ChevronRightIcon
				data-icon="inline-end"
				class={['transition-transform duration-(--motion-fast)', open && 'rotate-90']}
			/>
		</Button>
	</div>

	{#if open}
		<div id={formId} transition:collapse class="border-t border-border px-4 py-4">
			<form class="flex flex-col gap-4" {onsubmit} novalidate aria-label="Resources">
				<div class="grid gap-3 sm:grid-cols-3">
					<Field.Field data-invalid={errors.memoryMinMb ? true : undefined}>
						<Field.Label for={`${formId}-min`}>Min heap (MiB)</Field.Label>
						<Input
							id={`${formId}-min`}
							type="number"
							min={128}
							max={262144}
							step={128}
							bind:value={form.memoryMinMb}
							aria-invalid={errors.memoryMinMb ? true : undefined}
							disabled={locked}
							class="h-8"
						/>
						{#if errors.memoryMinMb}<Field.Error>{errors.memoryMinMb}</Field.Error>{/if}
					</Field.Field>
					<Field.Field data-invalid={errors.memoryMaxMb ? true : undefined}>
						<Field.Label for={`${formId}-max`}>Max heap (MiB)</Field.Label>
						<Input
							id={`${formId}-max`}
							type="number"
							min={128}
							max={262144}
							step={128}
							bind:value={form.memoryMaxMb}
							aria-invalid={errors.memoryMaxMb ? true : undefined}
							disabled={locked}
							class="h-8"
						/>
						{#if errors.memoryMaxMb}<Field.Error>{errors.memoryMaxMb}</Field.Error>{/if}
					</Field.Field>
					<Field.Field data-invalid={errors.cpus ? true : undefined}>
						<Field.Label for={`${formId}-cpus`}>CPU limit</Field.Label>
						<Input
							id={`${formId}-cpus`}
							type="number"
							min={0.1}
							max={256}
							step={0.1}
							bind:value={form.cpus}
							aria-invalid={errors.cpus ? true : undefined}
							disabled={locked}
							class="h-8"
						/>
						{#if errors.cpus}<Field.Error>{errors.cpus}</Field.Error>{/if}
					</Field.Field>
				</div>

				<p class="text-xs text-muted-foreground">
					Heap bounds are passed to Java (-Xms/-Xmx); the CPU limit caps the container. The stopped
					container is replaced on save and the next start uses the new limits. Files and worlds are
					kept.
				</p>

				{#if saveError}
					<div transition:collapse><ErrorAlert error={saveError} /></div>
				{/if}

				<div class="flex flex-wrap items-center justify-end gap-2">
					{#if !stopped}
						<p class="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
							<TriangleAlertIcon class="size-3.5" aria-hidden="true" />
							Stop the server to change resources.
						</p>
					{:else if busy}
						<p class="mr-auto text-xs text-muted-foreground">
							Wait for the current operation to finish.
						</p>
					{/if}
					<Button variant="outline" size="sm" disabled={!dirty || saving} onclick={reset}>
						Reset
					</Button>
					<Button type="submit" size="sm" disabled={locked || !dirty}>
						{#if saving}<Spinner data-icon="inline-start" />{/if}
						Save resources
					</Button>
				</div>
			</form>
		</div>
	{/if}
</div>
