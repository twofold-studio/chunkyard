<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import LaunchProfileFields from './launch-profile-fields.svelte';
	import {
		getServerLaunch,
		isAbortError,
		updateServerLaunch,
		type LaunchSettings,
		type ServerView
	} from '#lib/api/index.js';
	import {
		describeProfile,
		hasErrors,
		LAUNCH_MODE_LABELS,
		launchSettingsDirty,
		launchSettingsToForm,
		profileToForm,
		toUpdateLaunchRequest,
		validateImage,
		validateLaunchForm,
		type LaunchSettingsForm
	} from '#lib/servers/launch.js';
	import { needsInstall } from '#lib/servers/software.js';
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

	const uninstalled = $derived(needsInstall(server));
	/** Record refreshes (polling) must not reload the form and drop edits. */
	const serverId = $derived(server.id);

	/** Summary from the record, so the collapsed row needs no request. */
	const summary = $derived.by(() => {
		const override = server.launchOverride ?? null;
		if (override) return `${describeProfile(override)} · custom`;
		if (uninstalled) return 'Detected during install';
		const launch = server.launch ?? null;
		if (launch) {
			const mode = launch.profile?.mode;
			return describeProfile({
				mode: mode ?? 'jar',
				path: launch.path,
				javaMajor: launch.javaMajor
			});
		}
		return `${LAUNCH_MODE_LABELS.jar} ${server.jar}`;
	});

	let settings = $state.raw<LaunchSettings | null>(null);
	let loadError = $state.raw<unknown>(null);
	let loadNonce = $state(0);
	let form = $state<LaunchSettingsForm | null>(null);
	let attempted = $state(false);
	let saving = $state(false);
	let saveError = $state.raw<unknown>(null);
	let saveAbort: AbortController | null = null;
	$effect(() => () => saveAbort?.abort());

	// Load the detected/current profile when expanded (and after each save).
	$effect(() => {
		if (!open || uninstalled) return;
		void loadNonce;
		const id = serverId;
		const controller = new AbortController();
		loadError = null;
		getServerLaunch(id, { signal: controller.signal }).then(
			(next) => {
				settings = next;
				form = launchSettingsToForm(next);
				attempted = false;
			},
			(error) => {
				if (!isAbortError(error)) loadError = error;
			}
		);
		return () => controller.abort();
	});

	const stopped = $derived(server.status.state === 'stopped');
	const locked = $derived(!stopped || busy || saving);

	const profileErrors = $derived(
		attempted && form?.override ? validateLaunchForm(form.profile) : {}
	);
	const imageError = $derived(attempted && form ? validateImage(form.image) : undefined);
	const dirty = $derived(form && settings ? launchSettingsDirty(form, settings) : false);

	function revert() {
		if (!settings) return;
		form = launchSettingsToForm(settings);
		attempted = false;
		saveError = null;
	}

	function resetDetection() {
		if (!form || !settings) return;
		form.override = false;
		form.profile = profileToForm(settings.detected);
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (locked || !form || !settings || !dirty) return;
		attempted = true;
		if (
			(form.override && hasErrors(validateLaunchForm(form.profile))) ||
			validateImage(form.image)
		) {
			return;
		}
		saving = true;
		saveError = null;
		saveAbort = new AbortController();
		try {
			const { server: updated } = await updateServerLaunch(
				server.id,
				toUpdateLaunchRequest(form, settings),
				{ signal: saveAbort.signal }
			);
			attempted = false;
			onServerUpdated(updated);
			loadNonce += 1;
			toast.success('Launch settings saved', { description: 'They apply on the next start.' });
		} catch (error) {
			if (!isAbortError(error)) saveError = error;
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex flex-col">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
		<RocketIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-sm font-medium">Launch</span>
		<span class="min-w-0 truncate font-mono text-xs text-muted-foreground" title={summary}
			>{summary}</span
		>
		{#if !uninstalled}
			<Button
				variant="ghost"
				size="sm"
				class="ml-auto"
				aria-expanded={open}
				aria-controls={formId}
				aria-label={open ? 'Hide launch settings' : 'Edit launch settings'}
				onclick={() => (open = !open)}
			>
				{open ? 'Hide' : 'Edit'}
				<ChevronRightIcon
					data-icon="inline-end"
					class={['transition-transform duration-(--motion-fast)', open && 'rotate-90']}
				/>
			</Button>
		{:else}
			<span class="ml-auto text-xs text-muted-foreground">Override in the install options</span>
		{/if}
	</div>

	{#if open && !uninstalled}
		<div id={formId} transition:collapse class="border-t border-border px-4 py-4">
			{#if loadError}
				<ErrorAlert error={loadError}>
					<Button size="sm" variant="outline" class="mt-2" onclick={() => (loadNonce += 1)}>
						<RefreshCwIcon data-icon="inline-start" />
						Retry
					</Button>
				</ErrorAlert>
			{:else if !form || !settings}
				<div class="flex flex-col gap-2" aria-busy="true">
					<Skeleton class="h-8 w-full" />
					<Skeleton class="h-8 w-2/3" />
				</div>
			{:else}
				<form class="flex flex-col gap-4" {onsubmit} novalidate aria-label="Launch">
					<Field.Field orientation="horizontal">
						<Switch id={`${formId}-override`} bind:checked={form.override} disabled={locked} />
						<Field.Content>
							<Field.Label for={`${formId}-override`}>Custom launch</Field.Label>
							<Field.Description>
								{#if form.override}
									Replaces the detected launch until you reset detection.
								{:else}
									Detected: <span class="font-mono">{describeProfile(settings.detected)}</span>
								{/if}
							</Field.Description>
						</Field.Content>
					</Field.Field>

					{#if form.override}
						<div transition:collapse>
							<LaunchProfileFields
								bind:form={form.profile}
								errors={profileErrors}
								disabled={locked}
							/>
						</div>
					{/if}

					<Field.Field data-invalid={imageError ? true : undefined}>
						<Field.Label for={`${formId}-image`}>Docker image (optional)</Field.Label>
						<Input
							id={`${formId}-image`}
							bind:value={form.image}
							class="h-8 font-mono"
							autocomplete="off"
							spellcheck={false}
							placeholder={settings.autoJava
								? `Automatic (${settings.dockerImage})`
								: 'Automatic Temurin'}
							aria-invalid={imageError ? true : undefined}
							disabled={locked}
						/>
						<Field.Description>
							Blank picks a Temurin image for the Java version. A custom image must provide Bash and
							Java.
						</Field.Description>
						{#if imageError}<Field.Error>{imageError}</Field.Error>{/if}
					</Field.Field>

					<p class="text-xs text-muted-foreground">
						Saving replaces the stopped container; files and worlds are kept. Start checks that the
						launch file exists, so you can save first and add the file in Files.
					</p>

					{#if saveError}
						<div transition:collapse><ErrorAlert error={saveError} /></div>
					{/if}

					<div class="flex flex-wrap items-center justify-end gap-2">
						{#if !stopped}
							<p class="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
								<TriangleAlertIcon class="size-3.5" aria-hidden="true" />
								Stop the server to change the launch.
							</p>
						{:else if busy}
							<p class="mr-auto text-xs text-muted-foreground">
								Wait for the current operation to finish.
							</p>
						{/if}
						{#if settings.overridden && form.override}
							<Button variant="ghost" size="sm" disabled={locked} onclick={resetDetection}>
								Reset detection
							</Button>
						{/if}
						<Button variant="outline" size="sm" disabled={!dirty || saving} onclick={revert}>
							Revert
						</Button>
						<Button type="submit" size="sm" disabled={locked || !dirty}>
							{#if saving}<Spinner data-icon="inline-start" />{/if}
							Save launch
						</Button>
					</div>
				</form>
			{/if}
		</div>
	{/if}
</div>
