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
	import { CopyText, ErrorAlert, SettingsSection } from '#lib/components/app/index.js';
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
	import { collapse } from '#lib/motion/index.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		server: ServerView;
		/** Another operation is running on this server. */
		busy: boolean;
		onServerUpdated: (server: ServerView) => void;
	}

	let { server, busy, onServerUpdated }: Props = $props();

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

<SettingsSection
	title="Network"
	description="Host address and port Docker publishes for the game. Inside the container Minecraft always listens on 25565/TCP."
	icon={NetworkIcon}
>
	{#if !network && loadError}
		<ErrorAlert error={loadError}>
			<Button size="sm" variant="outline" class="mt-2" onclick={() => (nonce += 1)}>Retry</Button>
		</ErrorAlert>
	{:else if !network}
		<Skeleton class="h-40 w-full" />
	{:else}
		<form class="flex flex-col gap-5" {onsubmit} novalidate>
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

			<div class="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
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
					/>
					{#if errors.port}<Field.Error>{errors.port}</Field.Error>{/if}
				</Field.Field>
				<Field.Field data-invalid={errors.publishIp ? true : undefined}>
					<Field.Label for="net-ip">Bind address</Field.Label>
					<Input
						id="net-ip"
						bind:value={form.publishIp}
						class="font-mono"
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

			<div class="flex flex-wrap gap-2" role="group" aria-label="Bind address presets">
				{#each BIND_PRESETS as preset (preset.value)}
					<button
						type="button"
						class={cn(
							'motion-press flex flex-col rounded-md border px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50',
							form.publishIp.trim() === preset.value
								? 'border-ring bg-accent text-foreground'
								: 'border-border hover:bg-accent/40'
						)}
						onclick={() => (form.publishIp = preset.value)}
						disabled={locked}
						aria-pressed={form.publishIp.trim() === preset.value}
					>
						<span class="font-medium">{preset.label}</span>
						<span class="text-muted-foreground"
							><code class="font-mono">{preset.value}</code> · {preset.hint}</span
						>
					</button>
				{/each}
				<button
					type="button"
					class={cn(
						'motion-press flex flex-col rounded-md border px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50',
						form.publishIp.trim() === ''
							? 'border-ring bg-accent text-foreground'
							: 'border-border hover:bg-accent/40'
					)}
					onclick={() => (form.publishIp = '')}
					disabled={locked}
					aria-pressed={form.publishIp.trim() === ''}
				>
					<span class="font-medium">Manager default</span>
					<span class="text-muted-foreground">CHUNKYARD_DOCKER__PUBLISH_IP or 0.0.0.0</span>
				</button>
			</div>

			<div id="net-ip-help" class="flex flex-col gap-1.5 text-sm text-muted-foreground">
				<p>
					To play over a NetBird (or other VPN) mesh, bind to <code class="font-mono">0.0.0.0</code>
					or the host's NetBird IP (usually <code class="font-mono">100.x.y.z</code>), then connect
					to the host's NetBird name or IP on port {form.port ?? network.port}. Binding to all
					interfaces also exposes the port on the LAN and, without a firewall, to the internet.
				</p>
				<p>
					Other servers may share this port, but only one of them can run at a time. Files and
					worlds are kept when the network changes.
				</p>
			</div>

			<dl
				class="grid gap-3 rounded-md border border-border bg-background px-4 py-3 text-sm sm:grid-cols-2"
			>
				<div class="flex flex-col gap-1">
					<dt class="text-xs text-muted-foreground">Next start publishes on</dt>
					<dd>
						<CopyText
							value={formatEndpoint(network.effectivePublishIp, network.port)}
							label="Copy address"
						/>
					</dd>
				</div>
				<div class="flex flex-col gap-1">
					<dt class="text-xs text-muted-foreground">Current container</dt>
					<dd class="font-mono text-sm">
						{network.boundPublishIp && network.boundPort
							? formatEndpoint(network.boundPublishIp, network.boundPort)
							: 'No container'}
					</dd>
				</div>
			</dl>

			{#if saveError}
				<div transition:collapse><ErrorAlert error={saveError} /></div>
			{/if}

			<div class="flex flex-wrap items-center justify-end gap-2">
				{#if !stopped}
					<p class="mr-auto flex items-center gap-1.5 text-sm text-muted-foreground">
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
</SettingsSection>
