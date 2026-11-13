<script lang="ts">
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import type { ServerAction, ServerState } from '#lib/api/index.js';

	interface Props {
		serverState: ServerState;
		busy: boolean;
		/** Action currently running, to show its spinner. */
		pending: ServerAction | null;
		onAction: (action: ServerAction) => void;
	}

	let { serverState, busy, pending, onAction }: Props = $props();
	let confirmKill = $state(false);

	const canStart = $derived(!busy && (serverState === 'stopped' || serverState === 'unknown'));
	const canStop = $derived(!busy && serverState === 'running');
	const canKill = $derived(!busy && serverState !== 'stopped');
</script>

{#snippet icon(action: ServerAction, Icon: typeof PlayIcon)}
	{#if busy && pending === action}<Spinner data-icon="inline-start" />{:else}<Icon
			data-icon="inline-start"
		/>{/if}
{/snippet}

<div class="flex flex-wrap items-center gap-2">
	<Button size="sm" disabled={!canStart} onclick={() => onAction('start')}>
		{@render icon('start', PlayIcon)}
		Start
	</Button>
	<Button size="sm" variant="outline" disabled={!canStop} onclick={() => onAction('stop')}>
		{@render icon('stop', SquareIcon)}
		Stop
	</Button>
	<Button size="sm" variant="outline" disabled={!canStop} onclick={() => onAction('restart')}>
		{@render icon('restart', RotateCwIcon)}
		Restart
	</Button>
	<AlertDialog.Root bind:open={confirmKill}>
		<AlertDialog.Trigger>
			{#snippet child({ props })}
				<Button {...props} size="sm" variant="destructive" disabled={!canKill}>
					{@render icon('kill', ZapIcon)}
					Kill
				</Button>
			{/snippet}
		</AlertDialog.Trigger>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Force kill this server?</AlertDialog.Title>
				<AlertDialog.Description>
					The container is terminated immediately without a clean Minecraft shutdown. World changes
					since the last save may be lost. Use Stop for a graceful shutdown.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action
					variant="destructive"
					onclick={() => {
						confirmKill = false;
						onAction('kill');
					}}
				>
					Force kill
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>
