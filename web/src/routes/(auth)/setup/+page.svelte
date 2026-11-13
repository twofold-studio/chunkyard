<script lang="ts">
	import SetupWizard from '#lib/components/setup/setup-wizard.svelte';
	import ThreadsBackground from '#lib/components/backgrounds/threads-background.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Warm grey threads blending into the logo's copper glow; kept dim and slow behind the form.
	const THREADS = {
		color: [0.32, 0.26, 0.22],
		accentColor: [1, 0.45, 0.12],
		lineCount: 36,
		amplitude: 1.3,
		distance: 0.32,
		speed: 0.35,
		thickness: 0.5,
		angle: -18,
		fade: 0.35,
		opacity: 0.55,
		brightness: 1
	} as const;
</script>

<svelte:head><title>Initial setup · Chunkyard</title></svelte:head>

<ThreadsBackground options={THREADS} class="-z-10" />
<SetupWizard oncomplete={() => goto(resolve('servers'), { invalidateAll: true })} />
