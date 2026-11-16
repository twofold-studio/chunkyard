<script lang="ts">
	import TagIcon from '@lucide/svelte/icons/tag';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import ContainerIcon from '@lucide/svelte/icons/container';
	import XIcon from '@lucide/svelte/icons/x';
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { tick, untrack } from 'svelte';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert, SettingsPanel, SettingsSection } from '#lib/components/app/index.js';
	import { Reveal } from '#lib/components/motion/index.js';
	import SetupProgress from '#lib/components/setup/setup-progress.svelte';
	import SoftwarePicker from './software-picker.svelte';
	import SoftwareVersionPicker from './software-version-picker.svelte';
	import CurseForgePicker from './curseforge-picker.svelte';
	import ResourcePicker from './resource-picker.svelte';
	import ServerInstallPanel from './server-install-panel.svelte';
	import {
		isAbortError,
		listSoftware,
		type CurseForgeFile,
		type CurseForgeModpack,
		type InstallOptions,
		type ServerSoftware,
		type ServerView,
		type SoftwareCatalogItem,
		type SoftwareKind
	} from '#lib/api/index.js';
	import {
		defaultServerForm,
		toCreateRequest,
		validateServerForm,
		type ServerFormErrors
	} from '#lib/servers/validate.js';
	import { CreateServerFlow } from '#lib/servers/create-flow.svelte.js';
	import {
		buildSoftware,
		describeSoftware,
		hasOptionalBuild,
		isVersioned,
		needsLoader,
		SOFTWARE_LABELS
	} from '#lib/servers/software.js';
	import {
		canLeave,
		firstBlockingStep,
		stepErrors,
		stepLabel,
		wizardSteps,
		type WizardStep
	} from '#lib/servers/wizard.js';
	import { formatCpus } from '#lib/format.js';
	import { formatMib } from '#lib/servers/heap.js';
	import { collapse } from '#lib/motion/index.js';

	interface Props {
		/** Called once the server is created (and installed, for managed software). */
		oncreated: (server: ServerView) => void;
		/** Link target for an existing record, e.g. the server detail page. */
		serverHref: (id: string) => string;
		cancelHref: string;
		/** Injected small in tests. */
		jobIntervalMs?: number;
		searchDebounceMs?: number;
	}

	let { oncreated, serverHref, cancelHref, jobIntervalMs, searchDebounceMs }: Props = $props();

	// Catalog ---------------------------------------------------------------

	let catalog = $state.raw<SoftwareCatalogItem[] | null>(null);
	let catalogError = $state.raw<unknown>(null);
	let catalogNonce = $state(0);

	$effect(() => {
		void catalogNonce;
		const controller = new AbortController();
		catalog = null;
		catalogError = null;
		listSoftware({ signal: controller.signal }).then(
			({ items }) => (catalog = items),
			(error) => {
				if (!isAbortError(error)) catalogError = error;
			}
		);
		return () => controller.abort();
	});

	// Software selection ----------------------------------------------------

	let kind = $state<SoftwareKind | null>(null);
	let version = $state('');
	/** Paper build (empty = latest stable) or Fabric/Forge loader version. */
	let build = $state('');
	let pack = $state.raw<CurseForgeModpack | null>(null);
	let fileId = $state<number | null>(null);
	/** The chosen release, for the review summary (the picker is unmounted by then). */
	let release = $state.raw<CurseForgeFile | null>(null);

	const managed = $derived(kind !== null && kind !== 'custom');

	const software: ServerSoftware | null = $derived(
		buildSoftware({ kind, version, build, projectId: pack?.id ?? null, fileId })
	);

	/** Switching software starts its version selection fresh. */
	function selectKind(next: SoftwareKind | null) {
		if (next === kind) return;
		kind = next;
		version = '';
		build = '';
		pack = null;
		fileId = null;
		release = null;
	}

	const selectionComplete = $derived(kind === 'custom' || software !== null);

	// Server settings -------------------------------------------------------

	const form = $state(defaultServerForm());
	/** Managed installs: blank means the backend picks a matching Java image. */
	let imageOverride = $state('');
	/** Show validation messages for the current step after a Next/Create attempt. */
	let attempted = $state(false);

	const effectiveForm = $derived(managed ? { ...form, dockerImage: imageOverride } : form);
	const allErrors: ServerFormErrors = $derived(validateServerForm(effectiveForm, { managed }));

	// Steps -------------------------------------------------------------------

	const flow = new CreateServerFlow({ jobIntervalMs: untrack(() => jobIntervalMs) });
	$effect(() => () => flow.destroy());

	const steps = $derived(wizardSteps(kind));
	let current = $state<WizardStep>('software');
	let direction = $state<1 | -1>(1);
	let heading = $state<HTMLElement | null>(null);
	let formEl = $state<HTMLFormElement | null>(null);
	/** Furthest step reached; single-choice picks only continue on a first pass, never when editing back. */
	let furthest = $state(0);

	/** Once a record exists every further attempt installs into it: show the install stage. */
	const activeStep: WizardStep = $derived(flow.server && managed ? 'install' : current);
	const index = $derived(Math.max(0, steps.indexOf(activeStep)));
	const errors: ServerFormErrors = $derived(attempted ? stepErrors(activeStep, allErrors) : {});
	const stepState = $derived({ kind, selectionComplete, errors: allErrors });
	const locked = $derived(flow.phase !== 'editing');

	async function goTo(step: WizardStep) {
		const from = steps.indexOf(current);
		const to = steps.indexOf(step);
		if (to < 0 || step === current) return;
		direction = to > from ? 1 : -1;
		current = step;
		attempted = false;
		furthest = Math.max(furthest, to);
		await tick();
		// Bring the step's start into view below the sticky bar, then move focus to its heading.
		formEl?.scrollIntoView?.({ block: 'start' });
		heading?.focus({ preventScroll: true });
	}

	/** On a first pass a deliberate single-choice pick continues to the next step. */
	const autoAdvance = $derived(index === furthest && !locked);

	function onSoftwarePicked(picked: SoftwareKind) {
		selectKind(picked);
		// A custom JAR needs its path and image reviewed explicitly; managed kinds continue.
		if (autoAdvance && picked !== 'custom' && current === 'software') next();
	}

	function onReleasePicked() {
		if (autoAdvance && current === 'version' && selectionComplete) next();
	}

	function next() {
		if (!canLeave(current, stepState)) {
			attempted = true;
			return;
		}
		const following = steps[steps.indexOf(current) + 1];
		if (following && following !== 'install') void goTo(following);
	}

	function back() {
		const previous = steps[steps.indexOf(current) - 1];
		if (previous) void goTo(previous);
	}

	async function submit() {
		if (flow.busy || locked) return;
		const blocking = firstBlockingStep(steps, stepState);
		if (blocking) {
			await goTo(blocking);
			attempted = true;
			return;
		}
		const server = await flow.submit(toCreateRequest(effectiveForm, managed ? software : null));
		if (server) oncreated(server);
	}

	function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (current === 'review') void submit();
		else next();
	}

	async function retry(options: InstallOptions | null) {
		const server = await flow.retryInstall(options);
		if (server) oncreated(server);
	}

	const summary = $derived(software ? describeSoftware(software) : null);

	const STEP_COPY: Record<WizardStep, { title: string; description: string }> = {
		software: {
			title: 'Choose software',
			description:
				'What the manager downloads and installs for this server, or a custom JAR you provide.'
		},
		version: { title: 'Version', description: '' },
		identity: { title: 'Name & port', description: 'How the server is listed and reached.' },
		resources: {
			title: 'Resources',
			description:
				'Java heap and CPU limit. You can change these later while the server is stopped.'
		},
		review: {
			title: 'Review',
			description: 'Nothing has been created yet. Check the details, then create the server.'
		},
		install: { title: 'Install', description: '' }
	};

	const stepTitle = $derived(
		current === 'version' && kind === 'curseforge'
			? 'Choose a modpack'
			: current === 'version' && kind
				? `${SOFTWARE_LABELS[kind]} version`
				: STEP_COPY[current].title
	);
	const stepDescription = $derived.by(() => {
		if (current !== 'version' || !kind) return STEP_COPY[current].description;
		if (kind === 'curseforge')
			return 'Browse CurseForge, choose a pack, then pick a release that ships a server pack.';
		if (needsLoader(kind)) return `Minecraft version and ${SOFTWARE_LABELS[kind]} loader.`;
		if (hasOptionalBuild(kind))
			return `Minecraft version and ${SOFTWARE_LABELS[kind]} build. Stable releases are listed first.`;
		return 'Minecraft version to install. Stable releases are listed first.';
	});
	const stepLabels = $derived(steps.map((step) => stepLabel(step, kind)));
	const releaseSummary = $derived(
		pack ? `${pack.name} · ${release?.name ?? `release ${fileId}`}` : '—'
	);
</script>

{#snippet reviewRow(label: string, value: string, step: WizardStep, mono = false)}
	<div class="flex items-start justify-between gap-4 py-2.5">
		<dt class="text-sm text-muted-foreground">{label}</dt>
		<dd class="flex min-w-0 items-center gap-3 text-right">
			<span class={mono ? 'font-mono text-sm break-all' : 'text-sm'}>{value}</span>
			<button
				type="button"
				class="shrink-0 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
				onclick={() => goTo(step)}
				aria-label={`Edit ${label.toLowerCase()}`}
				disabled={locked}
			>
				Edit
			</button>
		</dd>
	</div>
{/snippet}

<div class="flex flex-col gap-6">
	{#if activeStep === 'install' && flow.server && software}
		<SetupProgress current={index} steps={stepLabels} label="New server progress" />
		<Reveal preset="step" direction={1} class="flex flex-col gap-4">
			<!-- A record exists: further attempts install into it, never create another one. -->
			<ServerInstallPanel
				{software}
				job={flow.job}
				error={flow.error}
				working={flow.busy}
				installed={flow.phase === 'done'}
				onInstall={flow.phase === 'install-failed' ? retry : undefined}
				packName={pack?.name ?? null}
				releaseName={release?.name ?? null}
			>
				{#snippet actions()}
					<Button size="sm" variant="outline" href={serverHref(flow.server!.id)}>
						Open server
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				{/snippet}
			</ServerInstallPanel>
			{#if flow.phase === 'install-failed'}
				<p class="text-sm text-muted-foreground">
					The server record “{flow.server.name}” was kept. Retrying installs into the same record;
					you can also retry later from the server page.
				</p>
			{/if}
		</Reveal>
	{:else}
		<form bind:this={formEl} class="flex scroll-mt-[72px] flex-col gap-6" {onsubmit} novalidate>
			<!-- Navigation stays reachable at the top while long lists scroll underneath. -->
			<div
				class="sticky top-[72px] z-[5] -mx-4 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-8 sm:px-8 lg:-mx-16 lg:px-16"
				data-testid="wizard-bar"
			>
				<div class="flex items-center gap-2 sm:gap-4">
					<div class="flex shrink-0 items-center gap-1.5">
						<Button
							variant="ghost"
							size="sm"
							href={cancelHref}
							aria-label="Cancel"
							title="Cancel"
							class="max-sm:px-2"
						>
							<XIcon data-icon="inline-start" class="sm:hidden" />
							<span class="max-sm:sr-only">Cancel</span>
						</Button>
						{#if index > 0}
							<Button variant="outline" size="sm" onclick={back} disabled={locked}>
								<ArrowLeftIcon data-icon="inline-start" />
								Back
							</Button>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<div class="max-lg:hidden">
							<SetupProgress current={index} steps={stepLabels} label="New server progress" />
						</div>
						<p
							class="truncate text-center text-xs text-muted-foreground lg:hidden"
							aria-hidden="true"
						>
							Step {index + 1} of {steps.length} ·
							<span class="text-foreground">{stepLabel(activeStep, kind)}</span>
						</p>
					</div>
					<div class="flex shrink-0 items-center">
						{#if current === 'review'}
							<Button type="submit" size="sm" disabled={flow.busy}>
								{#if flow.busy}<Spinner data-icon="inline-start" />{/if}
								{managed ? 'Create and install' : 'Create server'}
							</Button>
						{:else}
							<Button type="submit" size="sm" disabled={current === 'software' && !kind}>
								Next
								<ArrowRightIcon data-icon="inline-end" />
							</Button>
						{/if}
					</div>
				</div>
			</div>

			{#key current}
				<Reveal preset="step" {direction} class="flex flex-col gap-5">
					<header class="flex flex-col gap-1">
						<h2
							bind:this={heading}
							tabindex="-1"
							class="scroll-mt-32 text-lg font-semibold tracking-tight focus-visible:outline-none"
						>
							<span class="sr-only">Step {index + 1} of {steps.length}: </span>{stepTitle}
						</h2>
						{#if stepDescription}
							<p class="text-sm text-muted-foreground">{stepDescription}</p>
						{/if}
					</header>

					{#if current === 'software'}
						<SoftwarePicker
							{catalog}
							loadError={catalogError}
							bind:value={() => kind, selectKind}
							disabled={locked}
							onRetry={() => (catalogNonce += 1)}
							onPicked={onSoftwarePicked}
						/>
						{#if attempted && !kind}
							<p class="text-sm text-destructive" role="alert">Choose the server software.</p>
						{/if}
					{:else if current === 'version' && kind && isVersioned(kind)}
						<div class="rounded-lg border border-border bg-card p-5">
							{#key kind}
								<SoftwareVersionPicker {kind} bind:version bind:build disabled={locked} />
							{/key}
						</div>
						{#if attempted && !selectionComplete}
							<p class="text-sm text-destructive" role="alert">
								Wait for the versions to load and choose one.
							</p>
						{/if}
					{:else if current === 'version' && kind === 'curseforge'}
						<CurseForgePicker
							bind:pack
							bind:fileId
							bind:release
							disabled={locked}
							debounceMs={searchDebounceMs}
							{onReleasePicked}
						/>
						{#if attempted && !selectionComplete}
							<p class="text-sm text-destructive" role="alert">
								Pick a modpack and a release with a server pack.
							</p>
						{/if}
					{:else if current === 'identity'}
						<SettingsPanel>
							<SettingsSection title="Name" description="Shown in the server list." icon={TagIcon}>
								<Field.Field data-invalid={errors.name ? true : undefined}>
									<Field.Label for="name">Server name</Field.Label>
									<Input
										id="name"
										bind:value={form.name}
										maxlength={80}
										required
										autocomplete="off"
										placeholder={pack?.name.slice(0, 80) ?? 'Survival'}
										aria-invalid={errors.name ? true : undefined}
										disabled={locked}
									/>
									{#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
								</Field.Field>
							</SettingsSection>

							<SettingsSection
								title="Network"
								description="Host port published for container port 25565/TCP. The bind address (manager default, all interfaces, a VPN IP such as NetBird) can be changed after creation in Settings → Network."
								icon={NetworkIcon}
							>
								<Field.Field data-invalid={errors.port ? true : undefined}>
									<Field.Label for="port">Game port (optional)</Field.Label>
									<Input
										id="port"
										type="number"
										min={1}
										max={65535}
										bind:value={form.port}
										placeholder="Automatic"
										class="max-w-40"
										aria-invalid={errors.port ? true : undefined}
										disabled={locked}
									/>
									<Field.Description>
										Leave blank to pick the first port from 25565 upwards that no other managed
										server uses. You can reuse another server's port, but only one of them can run
										at a time. Programs outside the manager could still occupy a port.
									</Field.Description>
									{#if errors.port}<Field.Error>{errors.port}</Field.Error>{/if}
								</Field.Field>
							</SettingsSection>
						</SettingsPanel>
					{:else if current === 'resources'}
						<div class="rounded-lg border border-border bg-card p-5 sm:p-6">
							<ResourcePicker
								id="create-resources"
								bind:memoryMaxMb={form.memoryMaxMb}
								bind:memoryMinMb={form.memoryMinMb}
								bind:cpus={form.cpus}
								{errors}
								disabled={locked}
							/>
						</div>
						<p class="text-xs text-muted-foreground">
							Docker also needs memory outside the Java heap, so the container limit sits above
							Server RAM.
						</p>

						<SettingsPanel>
							{#if managed}
								<SettingsSection
									title="Docker image"
									description="Chosen automatically to match the Java version this software needs."
									icon={ContainerIcon}
								>
									<Field.Field data-invalid={errors.dockerImage ? true : undefined}>
										<Field.Label for="image">Image override (optional)</Field.Label>
										<Input
											id="image"
											bind:value={imageOverride}
											class="font-mono"
											autocomplete="off"
											spellcheck={false}
											placeholder="Automatic"
											aria-invalid={errors.dockerImage ? true : undefined}
											disabled={locked}
										/>
										<Field.Description>
											Leave blank unless you need a specific image, e.g.
											<code class="font-mono">eclipse-temurin:21-jre</code>.
										</Field.Description>
										{#if errors.dockerImage}<Field.Error>{errors.dockerImage}</Field.Error>{/if}
									</Field.Field>
								</SettingsSection>
							{:else}
								<SettingsSection
									title="Docker image"
									description="Java runs inside the server container and comes from this image; the manager host needs no Java."
									icon={ContainerIcon}
								>
									<Field.Field data-invalid={errors.dockerImage ? true : undefined}>
										<Field.Label for="image">Image</Field.Label>
										<Input
											id="image"
											bind:value={form.dockerImage}
											class="font-mono"
											autocomplete="off"
											spellcheck={false}
											aria-invalid={errors.dockerImage ? true : undefined}
											disabled={locked}
										/>
										<Field.Description>
											Pick a Temurin tag matching your Minecraft version, e.g. <code
												class="font-mono">eclipse-temurin:17-jre</code
											>. Public images are pulled on first start; pull private images with Docker
											beforehand.
										</Field.Description>
										{#if errors.dockerImage}<Field.Error>{errors.dockerImage}</Field.Error>{/if}
									</Field.Field>
								</SettingsSection>

								<SettingsSection
									title="Server JAR"
									description="Nothing is downloaded. After creation, upload this file in the server's Files tab or copy it into its directory on the manager host."
									icon={FileArchiveIcon}
								>
									<Field.Field data-invalid={errors.jar ? true : undefined}>
										<Field.Label for="jar">JAR path</Field.Label>
										<Input
											id="jar"
											bind:value={form.jar}
											class="font-mono"
											autocomplete="off"
											spellcheck={false}
											aria-invalid={errors.jar ? true : undefined}
											disabled={locked}
										/>
										<Field.Description
											>Relative to the server directory. Only plain JAR launches are supported.</Field.Description
										>
										{#if errors.jar}<Field.Error>{errors.jar}</Field.Error>{/if}
									</Field.Field>
								</SettingsSection>
							{/if}
						</SettingsPanel>
					{:else if current === 'review'}
						<SettingsPanel>
							<SettingsSection
								title="Summary"
								description={managed
									? 'Creating saves the server record, then downloads and verifies its software. The server is never started automatically.'
									: 'Creating saves the server record. Nothing is downloaded and the server is not started.'}
								icon={ClipboardCheckIcon}
							>
								<dl class="flex flex-col divide-y divide-border">
									{@render reviewRow('Software', kind ? SOFTWARE_LABELS[kind] : '—', 'software')}
									{#if managed}
										{@render reviewRow(
											kind === 'curseforge' ? 'Modpack' : 'Version',
											kind === 'curseforge' ? releaseSummary : (summary?.detail ?? '—'),
											'version'
										)}
									{/if}
									{@render reviewRow('Name', form.name.trim() || '—', 'identity')}
									{@render reviewRow(
										'Game port',
										form.port != null ? String(form.port) : 'Automatic (first free from 25565)',
										'identity'
									)}
									{@render reviewRow('Server RAM', formatMib(form.memoryMaxMb) || '—', 'resources')}
									{@render reviewRow(
										'Initial heap',
										formatMib(form.memoryMinMb) || '—',
										'resources'
									)}
									{@render reviewRow('CPU limit', formatCpus(form.cpus ?? 0), 'resources')}
									{@render reviewRow(
										'Docker image',
										managed
											? imageOverride.trim() || 'Automatic (matches required Java)'
											: form.dockerImage.trim(),
										'resources',
										true
									)}
									{#if !managed}
										{@render reviewRow('Server JAR', form.jar.trim(), 'resources', true)}
									{/if}
								</dl>
							</SettingsSection>

							<SettingsSection
								title="Minecraft EULA"
								description="The server will not start until the EULA is accepted. You can also accept it later; installing never accepts it for you."
								icon={ScaleIcon}
							>
								<Field.Field orientation="horizontal">
									<Checkbox id="eula" bind:checked={form.acceptEula} disabled={locked} />
									<Field.Label for="eula" class="font-normal">
										I accept the <a
											href="https://aka.ms/MinecraftEULA"
											target="_blank"
											rel="noreferrer noopener"
											class="underline underline-offset-4">Minecraft EULA</a
										>
									</Field.Label>
								</Field.Field>
							</SettingsSection>
						</SettingsPanel>
					{/if}
				</Reveal>
			{/key}

			{#if flow.error}
				<div transition:collapse><ErrorAlert error={flow.error} /></div>
			{/if}
		</form>
	{/if}
</div>
