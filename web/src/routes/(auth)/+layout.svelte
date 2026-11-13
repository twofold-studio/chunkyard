<script lang="ts">
	import { BackendUnavailable, VersionBadge } from '#lib/components/app/index.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<main class="relative flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-12">
	<div class="flex items-center gap-2.5 text-sm font-semibold">
		<span class="flex size-7 items-center justify-center rounded-md border border-border">
			<img src="/logo.png" alt="" class="size-6 object-contain" />
		</span>
		Chunkyard
	</div>
	<div class="w-full max-w-sm">
		{#if data.unavailable}
			<BackendUnavailable message={data.unavailable} />
		{:else}
			{@render children()}
		{/if}
	</div>
	<footer class="absolute inset-x-0 bottom-4 flex justify-center">
		<VersionBadge />
	</footer>
</main>
