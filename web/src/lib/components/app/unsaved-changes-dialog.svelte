<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';

	interface Props {
		open: boolean;
		title?: string;
		/** What will be lost; plain text or a snippet. */
		description?: string | Snippet;
		stayLabel?: string;
		discardLabel?: string;
		/** Dialog dismissed (Stay, Escape or overlay): nothing happens. */
		onStay: () => void;
		onDiscard: () => void;
	}

	let {
		open,
		title = 'Discard unsaved changes?',
		description = 'Your edits have not been saved.',
		stayLabel = 'Keep editing',
		discardLabel = 'Discard changes',
		onStay,
		onDiscard
	}: Props = $props();

	// If the primitive also reports Discard as a close, do not treat it as Stay.
	let discarding = false;
	function discard() {
		discarding = true;
		onDiscard();
		setTimeout(() => (discarding = false));
	}
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(next) => {
		if (!next && !discarding) onStay();
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>
				{#if typeof description === 'string'}{description}{:else}{@render description()}{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{stayLabel}</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={discard}>
				{discardLabel}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
