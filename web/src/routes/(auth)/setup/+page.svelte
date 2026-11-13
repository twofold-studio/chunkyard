<script lang="ts">
	import SetupWizard from '#lib/components/setup/setup-wizard.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
</script>

<svelte:head><title>Initial setup · Chunkyard</title></svelte:head>

<SetupWizard oncomplete={() => goto(resolve('servers'), { invalidateAll: true })} />
