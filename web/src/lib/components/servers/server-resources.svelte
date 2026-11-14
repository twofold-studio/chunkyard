<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.js';
	import ResourcePicker from './resource-picker.svelte';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { isAbortError, updateServerResources, type ServerView } from '#lib/api/index.js';
	import { validateResources, type ResourceValues } from '#lib/servers/validate.js';
	import { formatCpus, formatMemory } from '#lib/format.js';
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
			RAM <span class="text-foreground">{formatMemory(server.memoryMaxMb)}</span>
			<span class="max-sm:hidden">(initial {formatMemory(server.memoryMinMb)})</span>
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
				<ResourcePicker
					id={formId}
					bind:memoryMaxMb={form.memoryMaxMb}
					bind:memoryMinMb={form.memoryMinMb}
					bind:cpus={form.cpus}
					{errors}
					disabled={locked}
				/>

				<p class="text-xs text-muted-foreground">
					Server RAM and initial heap are passed to Java (-Xmx/-Xms); the CPU limit caps the
					container. The stopped container is replaced on save and the next start uses the new
					limits. Files and worlds are kept.
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
