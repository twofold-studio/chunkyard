<script lang="ts">
	import ImageIcon from '@lucide/svelte/icons/image';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import {
		isAbortError,
		resetServerIcon,
		uploadServerIcon,
		type ServerView
	} from '#lib/api/index.js';
	import { checkIconFile, ICON_ACCEPT } from '#lib/servers/icons.js';
	import { collapse } from '#lib/motion/index.js';
	import ServerAvatar from './server-avatar.svelte';

	interface Props {
		server: ServerView;
		/** The record is being deleted or another blocking operation runs. */
		disabled?: boolean;
		onServerUpdated: (server: ServerView) => void;
	}

	let { server, disabled = false, onServerUpdated }: Props = $props();
	const uid = $props.id();

	let input = $state<HTMLInputElement | null>(null);
	let working = $state<'upload' | 'reset' | null>(null);
	let error = $state.raw<unknown>(null);
	let localError = $state<string | null>(null);
	let abort: AbortController | null = null;
	$effect(() => () => abort?.abort());

	const custom = $derived(server.icon?.source === 'custom');
	const isPack = $derived(server.software?.type === 'curseforge');
	const description = $derived(
		custom
			? 'Custom icon uploaded to Chunkyard.'
			: isPack
				? 'Using the modpack logo. Upload an image to replace it here.'
				: 'Using the generic icon. Upload an image to replace it here.'
	);

	async function run(
		kind: 'upload' | 'reset',
		request: (signal: AbortSignal) => Promise<{ server: ServerView }>
	) {
		abort?.abort();
		const controller = (abort = new AbortController());
		working = kind;
		error = null;
		localError = null;
		const target = server.id;
		try {
			const { server: updated } = await request(controller.signal);
			// Ignore a reply for a server this view no longer shows.
			if (updated?.id !== target) return;
			onServerUpdated(updated);
			toast.success(kind === 'upload' ? 'Display icon updated' : 'Display icon reset');
		} catch (cause) {
			if (!isAbortError(cause)) error = cause;
		} finally {
			if (abort === controller) {
				working = null;
				abort = null;
			}
		}
	}

	function onchange(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		// Allow choosing the same file again after an error.
		event.currentTarget.value = '';
		if (!file) return;
		const check = checkIconFile(file);
		if (!check.ok) {
			error = null;
			localError = check.message;
			return;
		}
		void run('upload', (signal) =>
			uploadServerIcon(server.id, file, check.contentType, { signal })
		);
	}

	function reset() {
		void run('reset', (signal) => resetServerIcon(server.id, { signal }));
	}
</script>

<div class="flex flex-col">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
		<ImageIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<ServerAvatar {server} class="size-8 rounded-md" iconClass="size-4" />
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="text-sm font-medium">Display icon</span>
			<span id={`${uid}-desc`} class="text-xs text-muted-foreground">
				{description} Shown in Chunkyard only; the Minecraft server list icon is not changed.
			</span>
		</span>
		<div class="flex items-center gap-1.5">
			<input
				bind:this={input}
				type="file"
				accept={ICON_ACCEPT}
				class="sr-only"
				tabindex="-1"
				aria-hidden="true"
				{onchange}
			/>
			<Button
				size="sm"
				variant="outline"
				onclick={() => input?.click()}
				disabled={disabled || working !== null}
				aria-describedby={`${uid}-desc ${uid}-limits`}
			>
				{#if working === 'upload'}<Spinner data-icon="inline-start" />{:else}<UploadIcon
						data-icon="inline-start"
					/>{/if}
				{custom ? 'Change' : 'Upload'}
			</Button>
			{#if custom}
				<Button size="sm" variant="ghost" onclick={reset} disabled={disabled || working !== null}>
					{#if working === 'reset'}<Spinner data-icon="inline-start" />{:else}<RotateCcwIcon
							data-icon="inline-start"
						/>{/if}
					Reset
				</Button>
			{/if}
		</div>
		<span id={`${uid}-limits`} class="sr-only">PNG, JPEG, WebP or ICO, up to 2 MiB.</span>
	</div>
	{#if localError}
		<p class="px-4 pb-2.5 text-sm text-destructive" role="alert" transition:collapse>
			{localError} PNG, JPEG, WebP or ICO, up to 2 MiB.
		</p>
	{:else if error}
		<div class="px-4 pb-3" transition:collapse><ErrorAlert {error} /></div>
	{/if}
</div>
