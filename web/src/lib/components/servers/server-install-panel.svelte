<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import LaunchProfileFields from './launch-profile-fields.svelte';
	import type { InstallOptions, Job, ModLoader, ServerSoftware } from '#lib/api/index.js';
	import { describeSoftware } from '#lib/servers/software.js';
	import {
		emptyInstallForm,
		hasErrors,
		JAVA_MAX,
		JAVA_MIN,
		LOADER_LABELS,
		MOD_LOADERS,
		toInstallOptions,
		validateInstallForm
	} from '#lib/servers/launch.js';
	import { collapse } from '#lib/motion/index.js';

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
		/**
		 * Starts (or retries) the install. `options` holds advanced overrides, or `null` when
		 * everything should be detected (the normal path).
		 */
		onInstall?: (options: InstallOptions | null) => void;
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
	const formId = $props.id();

	/** Overrides are for unusual server packs; normal installs never show them. */
	const advancedAvailable = $derived(software.type === 'curseforge' && !installed && !!onInstall);
	let advancedOpen = $state(false);
	const options = $state(emptyInstallForm());
	let attempted = $state(false);
	const errors = $derived(attempted ? validateInstallForm(options) : {});
	const overrides = $derived(advancedAvailable ? toInstallOptions(options) : null);

	function install() {
		if (!onInstall) return;
		if (!advancedAvailable) return onInstall(null);
		if (hasErrors(validateInstallForm(options))) {
			attempted = true;
			advancedOpen = true;
			return;
		}
		attempted = false;
		onInstall(toInstallOptions(options));
	}

	function clearOverrides() {
		Object.assign(options, emptyInstallForm());
		attempted = false;
	}

	const loaderValue = $derived(options.loader || 'auto');

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
					<Button size="sm" disabled={disabled || working} onclick={install}>
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

	{#if advancedAvailable}
		<div class="flex flex-col rounded-md border border-border">
			<button
				type="button"
				class="flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/30 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
				aria-expanded={advancedOpen}
				aria-controls={formId}
				onclick={() => (advancedOpen = !advancedOpen)}
			>
				<ChevronRightIcon
					class={[
						'size-4 text-muted-foreground transition-transform duration-(--motion-fast)',
						advancedOpen && 'rotate-90'
					]}
					aria-hidden="true"
				/>
				<span class="font-medium">Advanced options</span>
				<span class="text-xs text-muted-foreground">
					{overrides ? 'Overrides set' : 'For unusual server packs'}
				</span>
			</button>
			{#if advancedOpen}
				<div
					id={formId}
					transition:collapse
					class="flex flex-col gap-4 border-t border-border px-3 py-3"
					role="group"
					aria-label="Advanced install options"
				>
					<p class="text-xs text-muted-foreground">
						Leave blank to detect from the pack's settings, manifests and installer names. Official
						loader installers run in an isolated container; downloaded scripts are never run on the
						manager host, and installing never starts the server.
					</p>
					<div class="grid gap-3 sm:grid-cols-4">
						<Field.Field data-invalid={errors.minecraftVersion ? true : undefined}>
							<Field.Label for={`${formId}-mc`}>Minecraft version</Field.Label>
							<Input
								id={`${formId}-mc`}
								bind:value={options.minecraftVersion}
								class="h-8"
								placeholder="Detect"
								autocomplete="off"
								spellcheck={false}
								maxlength={64}
								aria-invalid={errors.minecraftVersion ? true : undefined}
								disabled={working}
							/>
							{#if errors.minecraftVersion}<Field.Error>{errors.minecraftVersion}</Field.Error>{/if}
						</Field.Field>
						<Field.Field data-invalid={errors.loader ? true : undefined}>
							<Field.Label for={`${formId}-loader`}>Loader</Field.Label>
							<Select.Root
								type="single"
								bind:value={
									() => loaderValue,
									(value) => (options.loader = value === 'auto' ? '' : (value as ModLoader))
								}
								disabled={working}
							>
								<Select.Trigger id={`${formId}-loader`} class="h-8 w-full">
									{options.loader ? LOADER_LABELS[options.loader] : 'Detect'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="auto" label="Detect">Detect</Select.Item>
									{#each MOD_LOADERS as loader (loader)}
										<Select.Item value={loader} label={LOADER_LABELS[loader]}
											>{LOADER_LABELS[loader]}</Select.Item
										>
									{/each}
								</Select.Content>
							</Select.Root>
							{#if errors.loader}<Field.Error>{errors.loader}</Field.Error>{/if}
						</Field.Field>
						<Field.Field data-invalid={errors.loaderVersion ? true : undefined}>
							<Field.Label for={`${formId}-loader-version`}>Loader version</Field.Label>
							<Input
								id={`${formId}-loader-version`}
								bind:value={options.loaderVersion}
								class="h-8"
								placeholder="Detect"
								autocomplete="off"
								spellcheck={false}
								maxlength={64}
								aria-invalid={errors.loaderVersion ? true : undefined}
								disabled={working}
							/>
							{#if errors.loaderVersion}<Field.Error>{errors.loaderVersion}</Field.Error>{/if}
						</Field.Field>
						<Field.Field data-invalid={errors.javaMajor ? true : undefined}>
							<Field.Label for={`${formId}-java`}>Java version</Field.Label>
							<Input
								id={`${formId}-java`}
								type="number"
								min={JAVA_MIN}
								max={JAVA_MAX}
								step={1}
								bind:value={options.javaMajor}
								class="h-8"
								placeholder="Detect"
								aria-invalid={errors.javaMajor ? true : undefined}
								disabled={working}
							/>
							{#if errors.javaMajor}<Field.Error>{errors.javaMajor}</Field.Error>{/if}
						</Field.Field>
					</div>

					<Field.Field orientation="horizontal">
						<Switch
							id={`${formId}-launch`}
							bind:checked={options.overrideLaunch}
							disabled={working}
						/>
						<Field.Content>
							<Field.Label for={`${formId}-launch`}>Set launch target</Field.Label>
							<Field.Description>
								Use when detection picks the wrong file. Uses the Java version above. You can also
								change it later in Settings → Launch.
							</Field.Description>
						</Field.Content>
					</Field.Field>
					{#if options.overrideLaunch}
						<div transition:collapse>
							<LaunchProfileFields
								bind:form={options.launch}
								errors={errors.launch}
								disabled={working}
								showJava={false}
							/>
						</div>
					{/if}

					{#if overrides}
						<div class="flex justify-end">
							<Button size="xs" variant="ghost" onclick={clearOverrides} disabled={working}>
								Clear overrides
							</Button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if !installed}
		<p class="text-xs text-muted-foreground">
			Downloads run on the manager host and report no percentage. Installing never starts the server
			or accepts the Minecraft EULA.
		</p>
	{/if}
</section>
