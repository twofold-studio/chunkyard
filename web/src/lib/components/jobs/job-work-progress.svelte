<!--
	Compact stage/byte progress of one job. Shows a percentage only for the current stage and only
	when its size is known; otherwise an indeterminate bar with bytes so far. Job state wins over the
	last observation. Renders from data the caller already tracks; it never polls.
-->
<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Job } from '#lib/api/index.js';
	import { describeJobWork, stageText } from '#lib/jobs/work.js';
	import { cn } from '#lib/utils.js';

	interface Props {
		job: Job;
		/** Headline while running without a stage observation (older builds or jobs). */
		fallback?: string;
		/** Show observed earlier steps. */
		history?: boolean;
		class?: string;
	}

	let { job, fallback = 'Working', history = true, class: className }: Props = $props();

	const view = $derived(describeJobWork(job, fallback));
	const running = $derived(view.phase === 'running');
	const ended = $derived(view.phase === 'failed' || view.phase === 'interrupted');
	/** The stage of the last observation, shown after the completed steps (not while queued). */
	const current = $derived(
		view.work && view.phase !== 'queued' && view.phase !== 'cancelled'
			? { label: stageText(view.work.stage).done, done: view.phase === 'succeeded' }
			: null
	);
	const valueText = $derived(
		[view.headline, view.bytes, view.percent !== null ? `${view.percent}%` : null]
			.filter(Boolean)
			.join(', ')
	);
</script>

<div
	class={cn('flex min-w-0 flex-col gap-1.5', className)}
	role="group"
	aria-label="Job progress"
	data-testid="work-progress"
	data-phase={view.phase}
>
	<div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
		<span
			class={cn('font-medium', ended ? 'text-destructive' : 'text-foreground')}
			aria-live="polite">{view.headline}</span
		>
		{#if view.bytes}
			<span class="font-mono text-muted-foreground tabular-nums" data-testid="work-bytes"
				>{view.bytes}</span
			>
		{/if}
		{#if view.percent !== null}
			<span class="ml-auto font-mono text-muted-foreground tabular-nums" data-testid="work-percent"
				>{view.percent}%</span
			>
		{/if}
	</div>

	{#if running}
		<div
			class="relative h-1 w-full overflow-hidden rounded-full bg-muted"
			role="progressbar"
			aria-label={view.percent !== null ? 'Current step progress' : 'Current step, size unknown'}
			aria-valuemin={view.percent !== null ? 0 : undefined}
			aria-valuemax={view.percent !== null ? 100 : undefined}
			aria-valuenow={view.percent ?? undefined}
			aria-valuetext={valueText}
		>
			{#if view.percent !== null}
				<div
					class="h-full rounded-full bg-primary transition-[width] duration-(--motion-base) ease-(--motion-ease-out)"
					style:width={`${view.percent}%`}
				></div>
			{:else}
				<div class="work-indeterminate h-full rounded-full bg-primary"></div>
			{/if}
		</div>
	{/if}

	{#if history && (view.history.length || current)}
		<ol
			class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
			aria-label="Observed steps"
			data-testid="work-history"
		>
			{#if view.truncated}
				<li class="italic">Earlier steps not shown</li>
			{/if}
			{#each view.history as step, index (index)}
				<li class="inline-flex items-center gap-1">
					<CheckIcon class="size-3 text-success" aria-hidden="true" />
					<span>{step.label}</span>
					{#if step.count > 1}<span
							class="font-mono tabular-nums"
							title="Observed {step.count} times">×{step.count}</span
						>{/if}
				</li>
			{/each}
			{#if current}
				<li
					class={cn(
						'inline-flex items-center gap-1',
						running && 'text-foreground',
						ended && 'text-destructive'
					)}
					aria-current={running ? 'step' : undefined}
				>
					{#if current.done}
						<CheckIcon class="size-3 text-success" aria-hidden="true" />
					{:else if ended}
						<XIcon class="size-3" aria-hidden="true" />
					{:else}
						<span class="size-1.5 rounded-full bg-primary" aria-hidden="true"></span>
					{/if}
					<span>{current.label}{ended ? ' (stopped)' : ''}</span>
				</li>
			{/if}
		</ol>
	{/if}
</div>

<style>
	/* Reduced motion: a dim full-width track, never a moving or partial (misreadable) bar. */
	.work-indeterminate {
		width: 100%;
		opacity: 0.35;
	}
	@media (prefers-reduced-motion: no-preference) {
		.work-indeterminate {
			width: 35%;
			opacity: 1;
			animation: work-slide 1.4s var(--motion-ease-out) infinite;
		}
	}
	@keyframes work-slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(290%);
		}
	}
</style>
