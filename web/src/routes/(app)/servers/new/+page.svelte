<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import TagIcon from '@lucide/svelte/icons/tag';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import ContainerIcon from '@lucide/svelte/icons/container';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import { toast } from 'svelte-sonner';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import {
		ErrorAlert,
		PageHeader,
		SettingsPanel,
		SettingsSection
	} from '#lib/components/app/index.js';
	import { createServer } from '#lib/api/index.js';
	import {
		defaultServerForm,
		toCreateRequest,
		validateServerForm,
		type ServerFormErrors
	} from '#lib/servers/validate.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const form = $state(defaultServerForm());
	let submitError = $state<unknown>(null);
	let submitting = $state(false);
	let attempted = $state(false);

	// Re-validate as the user edits once they've tried to submit.
	const liveErrors: ServerFormErrors = $derived(attempted ? validateServerForm(form) : {});

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		if (Object.keys(validateServerForm(form)).length > 0) return;
		submitting = true;
		submitError = null;
		try {
			const { server } = await createServer(toCreateRequest(form));
			toast.success('Server created', { description: 'Copy your server JAR into its directory.' });
			await goto(resolve(`servers/${server.id}?created=1`));
		} catch (error) {
			submitError = error;
		} finally {
			submitting = false;
		}
	}
</script>

<PageHeader
	title="New server"
	icon={ServerIcon}
	description="Register a Docker-backed server. The manager creates a directory for it; you supply the server JAR."
/>

<form class="flex flex-col gap-6" {onsubmit} novalidate>
	<SettingsPanel>
		<SettingsSection title="Name" description="Shown in the server list." icon={TagIcon}>
			<Field.Field data-invalid={liveErrors.name ? true : undefined}>
				<Field.Label for="name">Server name</Field.Label>
				<Input
					id="name"
					bind:value={form.name}
					maxlength={80}
					required
					autocomplete="off"
					placeholder="Survival"
					aria-invalid={liveErrors.name ? true : undefined}
				/>
				{#if liveErrors.name}<Field.Error>{liveErrors.name}</Field.Error>{/if}
			</Field.Field>
		</SettingsSection>

		<SettingsSection
			title="Network"
			description="Host port published for container port 25565/TCP. It binds to CHUNKYARD_DOCKER__PUBLISH_IP (loopback by default)."
			icon={NetworkIcon}
		>
			<Field.Field data-invalid={liveErrors.port ? true : undefined}>
				<Field.Label for="port">Game port</Field.Label>
				<Input
					id="port"
					type="number"
					min={1}
					max={65535}
					bind:value={form.port}
					class="max-w-40"
					aria-invalid={liveErrors.port ? true : undefined}
				/>
				{#if liveErrors.port}<Field.Error>{liveErrors.port}</Field.Error>{/if}
			</Field.Field>
		</SettingsSection>

		<SettingsSection
			title="Docker image"
			description="The container's Java comes from this image, not from host Java runtimes managed on the Java page."
			icon={ContainerIcon}
		>
			<Field.Field data-invalid={liveErrors.dockerImage ? true : undefined}>
				<Field.Label for="image">Image</Field.Label>
				<Input
					id="image"
					bind:value={form.dockerImage}
					class="font-mono"
					autocomplete="off"
					spellcheck={false}
					aria-invalid={liveErrors.dockerImage ? true : undefined}
				/>
				<Field.Description>
					Pick a Temurin tag matching your Minecraft version, e.g. <code class="font-mono"
						>eclipse-temurin:17-jre</code
					>. Public images are pulled on first start; pull private images with Docker beforehand.
				</Field.Description>
				{#if liveErrors.dockerImage}<Field.Error>{liveErrors.dockerImage}</Field.Error>{/if}
			</Field.Field>
		</SettingsSection>

		<SettingsSection
			title="Resources"
			description="Java heap bounds and CPU limit. The container memory limit adds overhead above the maximum heap."
			icon={CpuIcon}
		>
			<Field.Group class="grid gap-4 sm:grid-cols-3">
				<Field.Field data-invalid={liveErrors.memoryMinMb ? true : undefined}>
					<Field.Label for="mem-min">Min heap (MiB)</Field.Label>
					<Input
						id="mem-min"
						type="number"
						min={128}
						step={128}
						bind:value={form.memoryMinMb}
						aria-invalid={liveErrors.memoryMinMb ? true : undefined}
					/>
					{#if liveErrors.memoryMinMb}<Field.Error>{liveErrors.memoryMinMb}</Field.Error>{/if}
				</Field.Field>
				<Field.Field data-invalid={liveErrors.memoryMaxMb ? true : undefined}>
					<Field.Label for="mem-max">Max heap (MiB)</Field.Label>
					<Input
						id="mem-max"
						type="number"
						min={128}
						step={128}
						bind:value={form.memoryMaxMb}
						aria-invalid={liveErrors.memoryMaxMb ? true : undefined}
					/>
					{#if liveErrors.memoryMaxMb}<Field.Error>{liveErrors.memoryMaxMb}</Field.Error>{/if}
				</Field.Field>
				<Field.Field data-invalid={liveErrors.cpus ? true : undefined}>
					<Field.Label for="cpus">CPUs</Field.Label>
					<Input
						id="cpus"
						type="number"
						min={0.1}
						step={0.5}
						bind:value={form.cpus}
						aria-invalid={liveErrors.cpus ? true : undefined}
					/>
					{#if liveErrors.cpus}<Field.Error>{liveErrors.cpus}</Field.Error>{/if}
				</Field.Field>
			</Field.Group>
		</SettingsSection>

		<SettingsSection
			title="Server JAR"
			description="Nothing is downloaded. After creation, copy this file into the server directory on the manager host."
			icon={FileArchiveIcon}
		>
			<Field.Field data-invalid={liveErrors.jar ? true : undefined}>
				<Field.Label for="jar">JAR path</Field.Label>
				<Input
					id="jar"
					bind:value={form.jar}
					class="font-mono"
					autocomplete="off"
					spellcheck={false}
					aria-invalid={liveErrors.jar ? true : undefined}
				/>
				<Field.Description
					>Relative to the server directory. Only plain JAR launches are supported.</Field.Description
				>
				{#if liveErrors.jar}<Field.Error>{liveErrors.jar}</Field.Error>{/if}
			</Field.Field>
		</SettingsSection>

		<SettingsSection
			title="Minecraft EULA"
			description="The server will not start until the EULA is accepted. You can also accept it later."
			icon={ScaleIcon}
		>
			<Field.Field orientation="horizontal">
				<Checkbox id="eula" bind:checked={form.acceptEula} />
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

	{#if submitError}
		<ErrorAlert error={submitError} />
	{/if}

	<div class="flex justify-end gap-2">
		<Button variant="outline" href={resolve('servers')}>Cancel</Button>
		<Button type="submit" disabled={submitting}>
			{#if submitting}<Spinner data-icon="inline-start" />{/if}
			Create server
		</Button>
	</div>
</form>
