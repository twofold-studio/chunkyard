<script lang="ts">
	import './layout.css';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
	<link rel="icon" type="image/png" href="/favicon-32.png" sizes="32x32" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
	<title>Chunkyard</title>
</svelte:head>

{@render children()}
<Toaster theme="dark" position="bottom-right" />
