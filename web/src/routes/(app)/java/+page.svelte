<script lang="ts">
	import CoffeeIcon from '@lucide/svelte/icons/coffee';
	import InfoIcon from '@lucide/svelte/icons/info';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ScanSearchIcon from '@lucide/svelte/icons/scan-search';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert, PageHeader } from '#lib/components/app/index.js';
	import JavaRuntimeRow from '#lib/components/java/java-runtime-row.svelte';
	import JavaInstallDialog from '#lib/components/java/java-install-dialog.svelte';
	import {
		discoverJavaRuntimes,
		installJava,
		isAbortError,
		listJavaRuntimes,
		waitForJob,
		type Job
	} from '#lib/api/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let runtimes = $derived(data.runtimes);
	let installOpen = $state(false);
	let discovering = $state(false);
	let error = $state.raw<unknown>(null);
	/** Install jobs started from this page, newest first. */
	let installs = $state.raw<{ major: number; job: Job }[]>([]);

	// Cancels job polling and follow-up requests when leaving the page.
	const abort = new AbortController();
	$effect(() => () => abort.abort());

	const sorted = $derived(
		[...runtimes].sort((a, b) => b.major - a.major || Number(b.managed) - Number(a.managed))
	);

	function track(major: number, job: Job) {
		installs = [{ major, job }, ...installs.filter((i) => i.job.id !== job.id)];
	}

	async function refresh() {
		runtimes = (await listJavaRuntimes({ signal: abort.signal })).items;
	}

	async function install(major: number) {
		// Rejections (e.g. job.busy) propagate to the dialog.
		const { job } = await installJava(major, { signal: abort.signal });
		track(major, job);
		follow(major, job);
	}

	async function follow(major: number, job: Job) {
		try {
			const final = await waitForJob(job, {
				signal: abort.signal,
				onUpdate: (update) => track(major, update)
			});
			if (final.state === 'succeeded') {
				toast.success(`Java ${major} installed`);
				installs = installs.filter((i) => i.job.id !== final.id);
				await refresh();
			}
		} catch (cause) {
			if (!isAbortError(cause)) error = cause;
		}
	}

	async function discover() {
		discovering = true;
		error = null;
		try {
			runtimes = (await discoverJavaRuntimes({ signal: abort.signal })).items;
			toast.success('Discovery finished', {
				description: `${runtimes.length} ${runtimes.length === 1 ? 'runtime' : 'runtimes'} known.`
			});
		} catch (cause) {
			if (!isAbortError(cause)) error = cause;
		} finally {
			discovering = false;
		}
	}

	function dismiss(id: string) {
		installs = installs.filter((i) => i.job.id !== id);
	}
</script>

<PageHeader
	title="Java runtimes"
	icon={CoffeeIcon}
	description="Java installations on the manager host: system runtimes found by discovery and Temurin JREs installed by the manager."
	meta={runtimes.length ? `${runtimes.length} known` : undefined}
>
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={discover} disabled={discovering}>
			{#if discovering}<Spinner data-icon="inline-start" />{:else}<ScanSearchIcon
					data-icon="inline-start"
				/>{/if}
			Discover
		</Button>
		<Button size="sm" onclick={() => (installOpen = true)}>
			<DownloadIcon data-icon="inline-start" />
			Install Java
		</Button>
	{/snippet}
</PageHeader>

<Alert.Root>
	<InfoIcon />
	<Alert.Title>Docker servers do not use these runtimes</Alert.Title>
	<Alert.Description>
		A Docker server runs the JVM inside its image (default <code class="font-mono"
			>eclipse-temurin:21-jre</code
		>). Change the image to change its Java version. Host runtimes are for a native runtime that is
		not available yet.
	</Alert.Description>
</Alert.Root>

{#if error}<ErrorAlert {error} />{/if}

{#each installs as { major, job } (job.id)}
	{#if job.state === 'queued' || job.state === 'running'}
		<div
			class="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4 text-sm"
			role="status"
		>
			<Spinner />
			<span>Installing Java {major}</span>
			<span class="text-muted-foreground">{job.state === 'queued' ? 'Queued' : 'Running'}</span>
			{#if job.message}<span class="truncate text-muted-foreground">{job.message}</span>{/if}
		</div>
	{:else}
		<ErrorAlert error={job.error ?? { code: `job.${job.state}`, detail: `Install ${job.state}.` }}>
			<Button variant="outline" size="sm" class="mt-2" onclick={() => dismiss(job.id)}>
				Dismiss
			</Button>
		</ErrorAlert>
	{/if}
{/each}

{#if sorted.length === 0}
	<Empty.Root class="border border-dashed border-border">
		<Empty.Header>
			<Empty.Media variant="icon"><CoffeeIcon /></Empty.Media>
			<Empty.Title>No Java runtimes yet</Empty.Title>
			<Empty.Description>
				Discover Java already installed on the host, or install a Temurin JRE.
			</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{:else}
	<ul class="overflow-hidden rounded-lg border border-border bg-card" aria-label="Java runtimes">
		{#each sorted as runtime (runtime.id)}
			<JavaRuntimeRow {runtime} />
		{/each}
	</ul>
{/if}

<JavaInstallDialog bind:open={installOpen} onInstall={install} />
