<script lang="ts">
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import { PageHeader } from '#lib/components/app/index.js';
	import ApiDocsLoader from '#lib/components/api-docs/api-docs-loader.svelte';
	import { OPENAPI_PATH, type OpenApiDocument } from '#lib/components/api-docs/openapi.js';

	let doc = $state.raw<OpenApiDocument | null>(null);
	const meta = $derived(doc ? `v${doc.info.version}` : undefined);
</script>

<svelte:head><title>API reference · {doc?.info.title ?? 'Chunkyard'}</title></svelte:head>

<PageHeader
	title="API reference"
	icon={BookOpenIcon}
	description="Every HTTP route the manager exposes, generated from its live OpenAPI document. Read-only: nothing on this page sends requests on your behalf."
	{meta}
>
	{#snippet actions()}
		<!-- Backend endpoints, not SvelteKit routes: resolve() does not apply. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={OPENAPI_PATH}
			target="_blank"
			rel="noopener"
			class={buttonVariants({ variant: 'outline', size: 'sm' })}
		>
			<ExternalLinkIcon data-icon="inline-start" />
			Raw JSON
		</a>
		<a
			href={OPENAPI_PATH}
			download="chunkyard-openapi.json"
			class={buttonVariants({ variant: 'outline', size: 'sm' })}
		>
			<DownloadIcon data-icon="inline-start" />
			Download
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/snippet}
</PageHeader>

<ApiDocsLoader onLoad={(loaded) => (doc = loaded)} />
