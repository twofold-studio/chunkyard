<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<Empty.Root class="border border-dashed border-border">
	<Empty.Header>
		<Empty.Media variant="icon"><CircleAlertIcon /></Empty.Media>
		<Empty.Title>{page.status === 404 ? 'Not found' : 'Something went wrong'}</Empty.Title>
		<Empty.Description>
			{page.error?.message ?? 'The page could not be loaded.'}
			{#if page.error?.hint}<br />{page.error.hint}{/if}
		</Empty.Description>
	</Empty.Header>
	<Empty.Content>
		<Button variant="outline" size="sm" href={resolve('servers')}>
			<ArrowLeftIcon data-icon="inline-start" />
			Back to servers
		</Button>
	</Empty.Content>
</Empty.Root>
