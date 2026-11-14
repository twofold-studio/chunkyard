<script lang="ts">
	import NetworkIcon from '@lucide/svelte/icons/network';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { CopyText, ErrorAlert } from '#lib/components/app/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import {
		getServerNetwork,
		isAbortError,
		updateServerNetwork,
		type ServerNetwork,
		type ServerView
	} from '#lib/api/index.js';
	import {
		BIND_PRESETS,
		formatEndpoint,
		toNetworkRequest,
		validateNetworkForm,
		type NetworkFormValues
	} from '#lib/servers/network.js';
	import { collapse, fadeIn } from '#lib/motion/index.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		server: ServerView;
		/** Another operation is running on this server. */
		busy: boolean;
		onServerUpdated: (server: ServerView) => void;
		/** Form expanded; the summary row is always shown. */
		open?: boolean;
	}

	let { server, busy, onServerUpdated, open = $bindable(true) }: Props = $props();
	const formId = $props.id();

	let network = $state.raw<ServerNetwork | null>(null);
	let loadError = $state.raw<unknown>(null);
	let saveError = $state.raw<unknown>(null);
	let saving = $state(false);
	let attempted = $state(false);
	let nonce = $state(0);
	const form = $state<NetworkFormValues>({ port: null, publishIp: '' });
	let saveAbort: AbortController | null = null;
	$effect(() => () => saveAbort?.abort());

	// Reload when the server, its state, its port or a manual refresh changes.
	$effect(() => {
		const id = server.id;
		void server.status.state;
		void server.port;
		void nonce;
		const abort = new AbortController();
		getServerNetwork(id, { signal: abort.signal }).then(
			(result) => {
				const pristine = untrack(() => !dirty);
				network = result;
				loadError = null;
				if (pristine) resetForm(result);
			},
			(error) => {
				if (!isAbortError(error)) loadError = error;
			}
		);
		return () => abort.abort();
	});

	function resetForm(source: ServerNetwork) {
		form.port = source.port;
		form.publishIp = source.publishIp ?? '';
		attempted = false;
		saveError = null;
	}

	const stopped = $derived(server.status.state === 'stopped');
	const locked = $derived(!stopped || busy || saving);
	const dirty = $derived(
		network !== null &&
			(form.port !== network.port || form.publishIp.trim() !== (network.publishIp ?? ''))
	);
	const errors = $derived(attempted ? validateNetworkForm(form) : {});

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (locked || !dirty) return;
		attempted = true;
		if (Object.keys(validateNetworkForm(form)).length > 0) return;
		saving = true;
		saveError = null;
		saveAbort = new AbortController();
		try {
			const { server: updated } = await updateServerNetwork(server.id, toNetworkRequest(form), {
				signal: saveAbort.signal
			});
			attempted = false;
			onServerUpdated(updated);
			// Refresh bound/effective metadata from the backend after saving.
			network = await getServerNetwork(server.id, { signal: saveAbort.signal });
			resetForm(network);
			toast.success('Network settings saved', { description: 'They apply on the next start.' });
		} catch (error) {
			if (!isAbortError(error)) saveError = error;
		} finally {
			saving = false;
		}
	}
</script>

{#snippet preset(value: string, label: string, hint: string)}
	<button
		type="button"
		class={cn(
			'motion-press rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50',
			form.publishIp.trim() === value
				? 'border-ring bg-accent text-foreground'
				: 'border-border text-muted-foreground hover:bg-accent/40'
		)}
		onclick={() => (form.publishIp = value)}
		disabled={locked}
		aria-pressed={form.publishIp.trim() === value}
		title={hint}
	>
		{label}{#if value}<code class="ml-1.5 font-mono">{value}</code>{/if}
	</button>
{/snippet}

<div class="flex flex-col">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
		<NetworkIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-sm font-medium">Network</span>
		{#if network}
			<span class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				Publishes on
				<span class="text-sm text-foreground">
					<CopyText
						value={formatEndpoint(network.effectivePublishIp, network.port)}
						label="Copy address"
					/>
				</span>
			</span>
			{#if network.restartRequired}
				<span in:fadeIn><Badge variant="warning">Restart to apply</Badge></span>
			{/if}
		{:else if !loadError}
			<Skeleton class="h-5 w-32" />
		{/if}
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
			{#if !network && loadError}
				<ErrorAlert error={loadError}>
					<Button size="sm" variant="outline" class="mt-2" onclick={() => (nonce += 1)}>
						Retry
					</Button>
				</ErrorAlert>
			{:else if !network}
				<Skeleton class="h-24 w-full" />
			{:else}
				<form class="flex flex-col gap-4" {onsubmit} novalidate>
					{#if network.restartRequired}
						<div transition:collapse>
							<Alert.Root>
								<RotateCwIcon />
								<Alert.Title>Restart to apply the new binding</Alert.Title>
								<Alert.Description>
									The running container still uses {network.boundPublishIp && network.boundPort
										? formatEndpoint(network.boundPublishIp, network.boundPort)
										: 'an older binding'}. Restart the server to publish on {formatEndpoint(
										network.effectivePublishIp,
										network.port
									)}.
								</Alert.Description>
							</Alert.Root>
						</div>
					{/if}

					<div class="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
						<Field.Field data-invalid={errors.port ? true : undefined}>
							<Field.Label for="net-port">Host port</Field.Label>
							<Input
								id="net-port"
								type="number"
								min={1}
								max={65535}
								bind:value={form.port}
								aria-invalid={errors.port ? true : undefined}
								disabled={locked}
								class="h-8"
							/>
							{#if errors.port}<Field.Error>{errors.port}</Field.Error>{/if}
						</Field.Field>
						<Field.Field data-invalid={errors.publishIp ? true : undefined}>
							<Field.Label for="net-ip">Bind address</Field.Label>
							<Input
								id="net-ip"
								bind:value={form.publishIp}
								class="h-8 font-mono"
								autocomplete="off"
								spellcheck={false}
								placeholder={network.publishIp === null
									? `Manager default (${network.effectivePublishIp})`
									: 'Manager default'}
								aria-invalid={errors.publishIp ? true : undefined}
								aria-describedby="net-ip-help"
								disabled={locked}
							/>
							{#if errors.publishIp}<Field.Error>{errors.publishIp}</Field.Error>{/if}
						</Field.Field>
					</div>

					<div
						class="flex flex-wrap items-center gap-1.5"
						role="group"
						aria-label="Bind address presets"
					>
						{#each BIND_PRESETS as item (item.value)}
							{@render preset(item.value, item.label, item.hint)}
						{/each}
						{@render preset('', 'Manager default', 'CHUNKYARD_DOCKER__PUBLISH_IP or 0.0.0.0')}
					</div>

					<p id="net-ip-help" class="text-xs text-muted-foreground">
						Minecraft listens on 25565/TCP inside the container. Servers may share a host port, but
						only one of them can run at a time. Files and worlds are kept when this changes.
					</p>
					<details class="group text-xs text-muted-foreground">
						<summary class="cursor-pointer select-none hover:text-foreground">
							Playing over NetBird or another VPN?
						</summary>
						<p class="mt-1.5">
							To play over a NetBird (or other VPN) mesh, bind to <code class="font-mono"
								>0.0.0.0</code
							>
							or the host's NetBird IP (usually <code class="font-mono">100.x.y.z</code>), then
							connect to the host's NetBird name or IP on port {form.port ?? network.port}. Binding
							to all interfaces also exposes the port on the LAN and, without a firewall, to the
							internet.
						</p>
					</details>

					{#if saveError}
						<div transition:collapse><ErrorAlert error={saveError} /></div>
					{/if}

					<div class="flex flex-wrap items-center justify-end gap-2">
						<p class="mr-auto text-xs text-muted-foreground">
							Current container:
							<span class="font-mono text-foreground"
								>{network.boundPublishIp && network.boundPort
									? formatEndpoint(network.boundPublishIp, network.boundPort)
									: 'No container'}</span
							>
						</p>
						{#if !stopped}
							<p
								class="flex w-full items-center gap-1.5 text-xs text-muted-foreground sm:order-first"
							>
								<TriangleAlertIcon class="size-3.5" aria-hidden="true" />
								Stop the server to change network settings.
							</p>
						{/if}
						<Button
							variant="outline"
							size="sm"
							disabled={!dirty || saving}
							onclick={() => network && resetForm(network)}
						>
							Reset
						</Button>
						<Button type="submit" size="sm" disabled={locked || !dirty}>
							{#if saving}<Spinner data-icon="inline-start" />{/if}
							Save network
						</Button>
					</div>
				</form>
			{/if}
		</div>
	{/if}
</div>
