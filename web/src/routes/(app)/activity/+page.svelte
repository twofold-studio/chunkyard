<script lang="ts">
	import HistoryIcon from '@lucide/svelte/icons/history';
	import { PageHeader } from '#lib/components/app/index.js';
	import { Reveal } from '#lib/components/motion/index.js';
	import ActivityView from '#lib/components/jobs/activity-view.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader
	title="Activity"
	icon={HistoryIcon}
	description="Durable background jobs: installs, lifecycle actions, exports and Java downloads. Queued and running jobs refresh while this page is open."
/>

<Reveal>
	<ActivityView initial={data.jobs} servers={data.servers} />
</Reveal>
