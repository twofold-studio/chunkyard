<script lang="ts">
	import ServerOffIcon from '@lucide/svelte/icons/server-off';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { invalidateAll } from '$app/navigation';
	import type { ErrorMessage } from '#lib/api/index.js';

	let { message }: { message: ErrorMessage } = $props();
	let retrying = $state(false);

	async function retry() {
		retrying = true;
		try {
			await invalidateAll();
		} finally {
			retrying = false;
		}
	}
</script>

<Empty.Root class="border border-dashed border-border">
	<Empty.Header>
		<Empty.Media variant="icon"><ServerOffIcon /></Empty.Media>
		<Empty.Title>{message.title}</Empty.Title>
		<Empty.Description>
			{message.detail}
			{#if message.hint}<br />{message.hint}{/if}
		</Empty.Description>
	</Empty.Header>
	<Empty.Content>
		<Button variant="outline" size="sm" onclick={retry} disabled={retrying}>
			{#if retrying}<Spinner data-icon="inline-start" />{:else}<RotateCwIcon
					data-icon="inline-start"
				/>{/if}
			Retry
		</Button>
	</Empty.Content>
</Empty.Root>
