<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { describeError } from '#lib/api/index.js';
	import type { Snippet } from 'svelte';

	interface Props {
		error: unknown;
		/** Overrides the generic hint (e.g. with server-specific instructions). */
		hint?: string;
		children?: Snippet;
	}

	let { error, hint, children }: Props = $props();
	const message = $derived(describeError(error));
</script>

<Alert.Root variant="destructive" role="alert">
	<CircleAlertIcon />
	<Alert.Title>{message.title}</Alert.Title>
	<Alert.Description>
		<p>{message.detail}</p>
		{#if hint ?? message.hint}<p class="text-muted-foreground">{hint ?? message.hint}</p>{/if}
		{@render children?.()}
	</Alert.Description>
</Alert.Root>
