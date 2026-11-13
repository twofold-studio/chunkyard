<script lang="ts">
	import './layout.css';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="/logo.png" />
	<title>Chunkyard</title>
</svelte:head>

{@render children()}
<Toaster theme="dark" position="bottom-right" />
