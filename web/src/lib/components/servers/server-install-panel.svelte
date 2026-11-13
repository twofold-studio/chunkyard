<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import type { Snippet } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import type { Job, ServerSoftware } from '#lib/api/index.js';
	import { describeSoftware } from '#lib/servers/software.js';

	interface Props {
		software: ServerSoftware;
		/** Install job being tracked, if any. */
		job: Job | null;
		/** Failure of the last attempt (ApiError or JobFailure). */
		error?: unknown;
		/** A request or job is in flight. */
		working: boolean;
		/** The install has completed successfully. */
		installed?: boolean;
		/** Disables the install button (e.g. while another operation runs). */
		disabled?: boolean;
		onInstall?: () => void;
		/** Extra actions shown next to the install button. */
		actions?: Snippet;
	}

	let {
		software,
		job,
		error = null,
		working,
		installed = false,
		disabled = false,
		onInstall,
		actions
	}: Props = $props();

	const summary = $derived(describeSoftware(software));
	const failed = $derived(!working && !installed && error != null);

	const status = $derived.by(() => {
		if (installed) return 'Installed. The server has not been started.';
		if (working && job?.state === 'queued') return 'Install queued…';
		if (working && job?.state === 'running') return 'Installing…';
		if (working) return 'Requesting install…';
		if (failed) return 'The install did not finish.';
		return 'Not installed yet. The server cannot start until its software is installed.';
	});
</script>

<section
	class="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-5 sm:px-6"
	aria-labelledby="install-heading"
>
	<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
		<div class="flex min-w-0 gap-3">
			<span
				class="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground"
			>
				{#if installed}
					<CircleCheckIcon class="size-4 text-success" aria-hidden="true" />
				{:else if working}
					<Spinner class="size-4" />
				{:else}
					<CircleDashedIcon class="size-4" aria-hidden="true" />
				{/if}
			</span>
			<div class="flex min-w-0 flex-col gap-1">
				<h2 id="install-heading" class="text-sm font-medium">
					{summary.kind}
					{#if summary.detail}<span class="font-normal text-muted-foreground">
							· {summary.detail}</span
						>{/if}
				</h2>
				<p class="text-sm text-muted-foreground" role="status" aria-live="polite">{status}</p>
				{#if working && job?.message}
					<p class="truncate font-mono text-xs text-muted-foreground">{job.message}</p>
				{/if}
			</div>
		</div>
		{#if (onInstall && !installed) || actions}
			<div class="flex shrink-0 flex-wrap items-center gap-2">
				{@render actions?.()}
				{#if onInstall && !installed}
					<Button size="sm" disabled={disabled || working} onclick={onInstall}>
						{#if working}
							<Spinner data-icon="inline-start" />
						{:else if failed}
							<RotateCcwIcon data-icon="inline-start" />
						{:else}
							<DownloadIcon data-icon="inline-start" />
						{/if}
						{failed ? 'Retry install' : 'Install'}
					</Button>
				{/if}
			</div>
		{/if}
	</div>

	{#if failed}
		<ErrorAlert {error} />
	{/if}

	{#if !installed}
		<p class="text-xs text-muted-foreground">
			Downloads run on the manager host and report no percentage. Installing never starts the server
			or accepts the Minecraft EULA.
		</p>
	{/if}
</section>
