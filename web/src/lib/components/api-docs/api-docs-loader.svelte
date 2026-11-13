<script lang="ts">
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { ApiError, UNEXPECTED_RESPONSE, isAbortError } from '#lib/api/client.js';
	import ApiDocsViewer from './api-docs-viewer.svelte';
	import { fetchOpenApi, isOpenApiDocument, type OpenApiDocument } from './openapi';

	type State =
		| { kind: 'loading' }
		| { kind: 'ready'; doc: OpenApiDocument }
		| { kind: 'error'; error: unknown };

	let { onLoad }: { onLoad?: (doc: OpenApiDocument) => void } = $props();

	let view = $state.raw<State>({ kind: 'loading' });
	let controller: AbortController | undefined;
	$effect(() => () => controller?.abort());

	async function load() {
		controller?.abort();
		const current = (controller = new AbortController());
		view = { kind: 'loading' };
		try {
			const doc = await fetchOpenApi({ signal: current.signal });
			if (!isOpenApiDocument(doc)) {
				throw new ApiError(
					200,
					UNEXPECTED_RESPONSE,
					'The backend did not return an OpenAPI 3 document.'
				);
			}
			if (current !== controller) return;
			view = { kind: 'ready', doc };
			onLoad?.(doc);
		} catch (error) {
			if (isAbortError(error) || current !== controller) return;
			view = { kind: 'error', error };
		}
	}

	load();
</script>

{#if view.kind === 'loading'}
	<div class="flex flex-col gap-3" role="status" aria-live="polite">
		<span class="sr-only">Loading API reference…</span>
		<Skeleton class="h-28 w-full" />
		<Skeleton class="h-9 w-full" />
		{#each [0, 1, 2, 3, 4] as i (i)}
			<Skeleton class="h-12 w-full" />
		{/each}
	</div>
{:else if view.kind === 'error'}
	<ErrorAlert error={view.error}>
		<Button variant="outline" size="sm" class="mt-2" onclick={load}>
			<RotateCwIcon data-icon="inline-start" />
			Retry
		</Button>
	</ErrorAlert>
{:else}
	<ApiDocsViewer doc={view.doc} />
{/if}
