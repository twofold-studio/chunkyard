<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		isAbortError,
		listSoftwareBuilds,
		listSoftwareVersions,
		type SoftwareVersion,
		type VersionedSoftwareKind
	} from '#lib/api/index.js';
	import { hasBuilds, needsLoader, SOFTWARE_LABELS } from '#lib/servers/software.js';

	interface Props {
		kind: VersionedSoftwareKind;
		version: string;
		/**
		 * Paper/Purpur build or Fabric/Forge/NeoForge loader version.
		 * Empty = Paper/Purpur's latest stable build.
		 */
		build: string;
		disabled?: boolean;
	}

	let { kind, version = $bindable(), build = $bindable(), disabled = false }: Props = $props();

	/** Select value standing for "omit build" (Paper resolves the latest stable build). */
	const LATEST = '__latest__';

	let versions = $state.raw<SoftwareVersion[] | null>(null);
	let versionsError = $state.raw<unknown>(null);
	let builds = $state.raw<SoftwareVersion[] | null>(null);
	let buildsError = $state.raw<unknown>(null);
	let showUnstable = $state(false);
	let versionsNonce = $state(0);
	let buildsNonce = $state(0);

	const label = $derived(SOFTWARE_LABELS[kind]);
	const loader = $derived(needsLoader(kind));
	const buildLabel = $derived(loader ? `${label} loader` : `${label} build`);

	function pickDefault(items: SoftwareVersion[]): string {
		// The backend lists newest first; prefer the newest stable entry.
		return (items.find((item) => item.stable) ?? items[0])?.id ?? '';
	}

	// Versions for this kind (the parent re-mounts the picker when the kind changes).
	$effect(() => {
		const k = kind;
		void versionsNonce;
		const controller = new AbortController();
		versions = null;
		versionsError = null;
		listSoftwareVersions(k, { signal: controller.signal }).then(
			({ items }) => {
				versions = items;
				if (!items.some((item) => item.id === version)) version = pickDefault(items);
				if (version && !items.find((item) => item.id === version)?.stable) showUnstable = true;
			},
			(error) => {
				if (!isAbortError(error)) versionsError = error;
			}
		);
		return () => controller.abort();
	});

	// Builds per selected game version.
	$effect(() => {
		const k = kind;
		const v = version;
		void buildsNonce;
		builds = null;
		buildsError = null;
		if (!hasBuilds(k) || !v) return;
		const controller = new AbortController();
		listSoftwareBuilds(k, v, { signal: controller.signal }).then(
			({ items }) => {
				builds = items;
				if (!items.some((item) => item.id === build)) {
					// Paper defaults to "latest stable at install time"; loaders need an explicit pick.
					build = needsLoader(k) ? pickDefault(items) : '';
				}
			},
			(error) => {
				if (!isAbortError(error)) buildsError = error;
			}
		);
		return () => controller.abort();
	});

	const visibleVersions = $derived(
		(versions ?? []).filter((item) => showUnstable || item.stable || item.id === version)
	);
	const hasUnstable = $derived((versions ?? []).some((item) => !item.stable));
	const versionStable = $derived(versions?.find((item) => item.id === version)?.stable ?? true);
	const buildStable = $derived(builds?.find((item) => item.id === build)?.stable ?? true);
	const buildValue = $derived(build || (loader ? '' : LATEST));
</script>

{#snippet unstableTag()}
	<span class="text-xs text-muted-foreground">unstable</span>
{/snippet}

{#snippet retry(error: unknown, onclick: () => void)}
	<ErrorAlert {error}>
		<Button size="sm" variant="outline" class="mt-2" {onclick}>
			<RefreshCwIcon data-icon="inline-start" />
			Retry
		</Button>
	</ErrorAlert>
{/snippet}

{#if versionsError}
	{@render retry(versionsError, () => (versionsNonce += 1))}
{:else if versions === null}
	<Skeleton class="h-9 w-full max-w-sm" />
{:else if versions.length === 0}
	<p class="text-sm text-muted-foreground">No {label} versions are available right now.</p>
{:else}
	<div class="grid gap-4 sm:grid-cols-2">
		<Field.Field>
			<Field.Label for="game-version">Minecraft version</Field.Label>
			<Select.Root
				type="single"
				bind:value={
					() => version,
					(next) => {
						version = next;
						build = '';
					}
				}
				{disabled}
			>
				<Select.Trigger id="game-version" class="w-full">
					{version || 'Select a version'}
					{#if version && !versionStable}{@render unstableTag()}{/if}
				</Select.Trigger>
				<Select.Content class="max-h-72">
					<Select.Group>
						{#each visibleVersions as item (item.id)}
							<Select.Item value={item.id} label={item.id}>
								{item.id}
								{#if !item.stable}{@render unstableTag()}{/if}
							</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</Field.Field>

		{#if hasBuilds(kind)}
			<Field.Field>
				<Field.Label for="software-build">{buildLabel}</Field.Label>
				{#if buildsError}
					{@render retry(buildsError, () => (buildsNonce += 1))}
				{:else if builds === null}
					<Skeleton class="h-9 w-full" />
				{:else if builds.length === 0 && loader}
					<p class="text-sm text-muted-foreground">No {label} loader exists for {version} yet.</p>
				{:else}
					<Select.Root
						type="single"
						bind:value={() => buildValue, (next) => (build = next === LATEST ? '' : next)}
						{disabled}
					>
						<Select.Trigger id="software-build" class="w-full">
							{#if build}
								{build}
								{#if !buildStable}{@render unstableTag()}{/if}
							{:else}
								{loader ? 'Select a loader' : 'Latest stable'}
							{/if}
						</Select.Trigger>
						<Select.Content class="max-h-72">
							<Select.Group>
								{#if !loader}
									<Select.Item value={LATEST} label="Latest stable">
										Latest stable
										<span class="text-xs text-muted-foreground">resolved at install</span>
									</Select.Item>
								{/if}
								{#each builds as item (item.id)}
									<Select.Item value={item.id} label={item.id}>
										{item.id}
										{#if !item.stable}{@render unstableTag()}{/if}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				{/if}
			</Field.Field>
		{/if}
	</div>

	{#if hasUnstable}
		<Field.Field orientation="horizontal">
			<Switch id="show-unstable" bind:checked={showUnstable} {disabled} />
			<Field.Label for="show-unstable" class="font-normal">
				Show snapshots and pre-releases
			</Field.Label>
		</Field.Field>
	{/if}
{/if}
