<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CircleSlashIcon from '@lucide/svelte/icons/circle-slash';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { JOB_STATE_LABELS } from '#lib/jobs/jobs.js';
	import type { JobState } from '#lib/api/index.js';

	interface Props {
		state: JobState;
		class?: string;
	}

	let { state, class: className }: Props = $props();

	const variant = $derived(
		state === 'succeeded'
			? 'success'
			: state === 'failed'
				? 'destructive'
				: state === 'running'
					? 'secondary'
					: 'outline'
	);
</script>

<Badge {variant} class={className} data-state={state}>
	{#if state === 'running'}
		<Spinner class="size-3" aria-hidden="true" role="presentation" />
	{:else if state === 'queued'}
		<ClockIcon aria-hidden="true" />
	{:else if state === 'succeeded'}
		<CircleCheckIcon aria-hidden="true" />
	{:else if state === 'failed'}
		<CircleXIcon aria-hidden="true" />
	{:else}
		<CircleSlashIcon aria-hidden="true" />
	{/if}
	{JOB_STATE_LABELS[state] ?? state}
</Badge>
