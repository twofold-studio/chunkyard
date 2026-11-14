<script lang="ts">
	import JobDetail from '#lib/components/jobs/job-detail.svelte';
	import { Reveal } from '#lib/components/motion/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#if data.job}
	<Reveal>
		<JobDetail job={data.job} servers={data.servers} />
	</Reveal>
{/if}
