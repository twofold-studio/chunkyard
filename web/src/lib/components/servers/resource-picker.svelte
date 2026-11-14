<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import MemoryStickIcon from '@lucide/svelte/icons/memory-stick';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import ServerIcon from '@lucide/svelte/icons/server';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { getIsolation, isAbortError, type DockerCapacity } from '#lib/api/index.js';
	import { capacityWarnings, formatHostMemory, knownCapacity } from '#lib/servers/capacity.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { cn } from '#lib/utils.js';
	import { collapse } from '#lib/motion/index.js';
	import type { ResourceErrors } from '#lib/servers/validate.js';
	import {
		CPU_PRESETS,
		formatMib,
		gbToMb,
		HEAP_MAX_MB,
		HEAP_MIN_MB,
		isCpuPreset,
		RAM_QUICK_GB,
		RAM_SLIDER_MAX_GB,
		RAM_SLIDER_MIN_GB,
		sliderGb,
		sliderPosition
	} from '#lib/servers/heap.js';

	interface Props {
		/** Maximum Java heap (-Xmx) in MiB: the primary "Server RAM" value. */
		memoryMaxMb: number | null | undefined;
		/** Initial Java heap (-Xms) in MiB, under Advanced. */
		memoryMinMb: number | null | undefined;
		cpus: number | null | undefined;
		/** Prefix for element IDs. */
		id: string;
		errors?: ResourceErrors;
		disabled?: boolean;
		/**
		 * Docker host totals. Omit to fetch them once when the picker opens; pass `null` for
		 * unknown (tests, or a caller that already has them).
		 */
		capacity?: DockerCapacity | null;
	}

	let {
		memoryMaxMb = $bindable(),
		memoryMinMb = $bindable(),
		cpus = $bindable(),
		id,
		errors = {},
		disabled = false,
		capacity: givenCapacity
	}: Props = $props();

	// Host capacity --------------------------------------------------------

	let fetchedCapacity = $state.raw<DockerCapacity | null>(null);
	let capacityState = $state<'loading' | 'done'>('loading');
	const capacity = $derived(givenCapacity !== undefined ? givenCapacity : fetchedCapacity);

	// One request when the controls open; no polling. Failure only means "unknown".
	$effect(() => {
		if (givenCapacity !== undefined) {
			capacityState = 'done';
			return;
		}
		const controller = new AbortController();
		getIsolation({ signal: controller.signal }).then(
			(info) => {
				fetchedCapacity = info?.docker?.capacity ?? null;
				capacityState = 'done';
			},
			(cause) => {
				if (isAbortError(cause)) return;
				fetchedCapacity = null;
				capacityState = 'done';
			}
		);
		return () => controller.abort();
	});

	const host = $derived(knownCapacity(capacity));
	const warnings = $derived(capacityWarnings({ memoryMaxMb, cpus }, capacity));
	const memoryWarning = $derived(warnings.find((warning) => warning.field === 'memory') ?? null);
	const cpuWarning = $derived(warnings.find((warning) => warning.field === 'cpus') ?? null);

	// Server RAM -------------------------------------------------------------

	const standardGb = $derived(sliderGb(memoryMaxMb));
	/** Custom was chosen explicitly; a non-standard amount always shows the exact field. */
	let ramCustomChosen = $state(false);
	const ramCustom = $derived(ramCustomChosen || standardGb === null);

	function setRamGb(gb: number) {
		ramCustomChosen = false;
		memoryMaxMb = gbToMb(gb);
	}

	const ramHeadline = $derived.by(() => {
		if (memoryMaxMb == null || !Number.isFinite(memoryMaxMb)) return { amount: '—', unit: '' };
		if (!ramCustom && standardGb !== null) return { amount: String(standardGb), unit: 'GB' };
		return { amount: new Intl.NumberFormat('en').format(memoryMaxMb), unit: 'MiB' };
	});

	// CPU --------------------------------------------------------------------

	let cpuCustomChosen = $state(false);
	const cpuCustom = $derived(cpuCustomChosen || !isCpuPreset(cpus));

	function setCpus(value: number) {
		cpuCustomChosen = false;
		cpus = value;
	}

	// Advanced ---------------------------------------------------------------

	let advancedOpen = $state(false);
	/** An initial-heap problem must be visible, so Advanced opens for it. */
	const showAdvanced = $derived(advancedOpen || !!errors.memoryMinMb);

	const chip =
		'h-8 min-w-10 rounded-md border border-border bg-background px-2.5 text-xs font-medium tabular-nums transition-colors hover:border-ring/60 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50';
	const chipOn =
		'border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary';
</script>

{#snippet advisory(warning: { level: 'over' | 'tight'; message: string }, testid: string)}
	<p
		class={cn(
			'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
			warning.level === 'over'
				? 'border-destructive/30 bg-destructive/10 text-foreground'
				: 'border-warning/30 bg-warning/10 text-foreground'
		)}
		role="status"
		data-testid={testid}
	>
		<TriangleAlertIcon
			class={cn(
				'mt-0.5 size-3.5 shrink-0',
				warning.level === 'over' ? 'text-destructive' : 'text-warning'
			)}
			aria-hidden="true"
		/>
		<span>{warning.message} You can still save it.</span>
	</p>
{/snippet}

<div class="flex min-w-0 flex-col gap-5">
	<!-- Engine totals for guidance only; never limits or changes the values below. -->
	<p
		class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
		data-testid={`${id}-capacity`}
		aria-live="polite"
	>
		<ServerIcon class="size-3.5 shrink-0" aria-hidden="true" />
		{#if capacityState === 'loading'}
			Checking Docker host capacity…
		{:else if host.cpus === null && host.memoryMb === null}
			Docker host capacity unknown; choose limits that fit your host.
		{:else}
			<span>
				Docker host:
				<span class="text-foreground">
					{host.memoryMb !== null ? `${formatHostMemory(host.memoryMb)} RAM` : 'RAM unknown'} ·
					{host.cpus !== null
						? `${host.cpus} logical ${host.cpus === 1 ? 'CPU' : 'CPUs'}`
						: 'CPUs unknown'}
				</span>
				{#if capacity?.architecture || capacity?.operatingSystem}
					<span class="max-sm:hidden">
						· {[capacity?.operatingSystem, capacity?.architecture].filter(Boolean).join(', ')}</span
					>
				{/if}
			</span>
			<span>Totals, not free memory; leave headroom for the OS and other services.</span>
		{/if}
	</p>

	<!-- Server RAM: the one primary choice. -->
	<fieldset class="flex min-w-0 flex-col gap-3">
		<legend class="sr-only">Server RAM</legend>
		<div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
			<div class="flex items-center gap-2" aria-hidden="true">
				<MemoryStickIcon class="size-4 text-muted-foreground" />
				<span class="text-sm font-medium">Server RAM</span>
				<span class="text-xs text-muted-foreground">maximum Java heap</span>
			</div>
			<p class="flex items-baseline gap-1" data-testid={`${id}-ram-value`}>
				<span class="text-3xl leading-none font-semibold tracking-tight tabular-nums"
					>{ramHeadline.amount}</span
				>
				<span class="text-sm text-muted-foreground">{ramHeadline.unit}</span>
				{#if ramCustom}<span class="ml-1 text-xs text-muted-foreground">custom</span>{/if}
			</p>
		</div>

		<input
			type="range"
			class="w-full accent-primary disabled:opacity-50"
			min={RAM_SLIDER_MIN_GB}
			max={RAM_SLIDER_MAX_GB}
			step={1}
			value={sliderPosition(memoryMaxMb)}
			aria-label="Server RAM (GB)"
			aria-valuetext={ramCustom ? `Custom ${formatMib(memoryMaxMb)}` : `${standardGb} GB`}
			oninput={(event) => setRamGb(Number(event.currentTarget.value))}
			{disabled}
		/>

		<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Server RAM presets">
			{#each RAM_QUICK_GB as gb (gb)}
				{@const active = !ramCustom && standardGb === gb}
				<button
					type="button"
					class={cn(chip, active && chipOn)}
					aria-pressed={active}
					aria-label={`${gb} GB`}
					onclick={() => setRamGb(gb)}
					{disabled}
				>
					{gb} GB
				</button>
			{/each}
			<button
				type="button"
				class={cn(chip, ramCustom && 'border-primary bg-primary/10 hover:border-primary')}
				aria-pressed={ramCustom}
				aria-label="Custom Server RAM"
				onclick={() => (ramCustomChosen = true)}
				{disabled}
			>
				Custom
			</button>
		</div>

		{#if ramCustom}
			<div class="flex flex-wrap items-center gap-2">
				<label for={`${id}-ram`} class="text-xs text-muted-foreground">Server RAM (MiB)</label>
				<Input
					id={`${id}-ram`}
					type="number"
					min={HEAP_MIN_MB}
					max={HEAP_MAX_MB}
					step={1}
					inputmode="numeric"
					bind:value={memoryMaxMb}
					aria-invalid={errors.memoryMaxMb ? true : undefined}
					aria-describedby={errors.memoryMaxMb ? `${id}-ram-error` : undefined}
					class="h-8 w-36 font-mono"
					{disabled}
				/>
				<span class="text-xs text-muted-foreground">Exact amount; never rounded.</span>
			</div>
		{:else}
			<p class="text-xs text-muted-foreground">{formatMib(memoryMaxMb)} (1 GB = 1,024 MiB)</p>
		{/if}
		{#if memoryWarning}{@render advisory(memoryWarning, `${id}-memory-warning`)}{/if}
		{#if errors.memoryMaxMb}
			<p id={`${id}-ram-error`} class="text-sm text-destructive" role="alert">
				{errors.memoryMaxMb}
			</p>
		{/if}
	</fieldset>

	<!-- CPU: a compact row. -->
	<fieldset class="flex min-w-0 flex-col gap-2 border-t border-border pt-4">
		<legend class="sr-only">CPU limit</legend>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
			<span class="flex items-center gap-2 text-sm font-medium" aria-hidden="true">
				<CpuIcon class="size-4 text-muted-foreground" />
				CPU limit
			</span>
			<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="CPU presets">
				{#each CPU_PRESETS as value (value)}
					{@const active = !cpuCustom && cpus === value}
					<button
						type="button"
						class={cn(chip, active && chipOn)}
						aria-pressed={active}
						aria-label={`${value} ${value === 1 ? 'core' : 'cores'}`}
						onclick={() => setCpus(value)}
						{disabled}
					>
						{value}
					</button>
				{/each}
				<button
					type="button"
					class={cn(chip, cpuCustom && 'border-primary bg-primary/10 hover:border-primary')}
					aria-pressed={cpuCustom}
					aria-label="Custom CPU limit"
					onclick={() => (cpuCustomChosen = true)}
					{disabled}
				>
					Custom
				</button>
			</div>
			{#if cpuCustom}
				<label for={`${id}-cpus`} class="sr-only">CPU limit (cores)</label>
				<Input
					id={`${id}-cpus`}
					type="number"
					min={0.1}
					max={256}
					step={0.1}
					inputmode="decimal"
					bind:value={cpus}
					aria-invalid={errors.cpus ? true : undefined}
					aria-describedby={errors.cpus ? `${id}-cpus-error` : undefined}
					class="h-8 w-24 font-mono"
					{disabled}
				/>
			{/if}
			<span class="text-xs text-muted-foreground">cores · hard container limit</span>
		</div>
		{#if cpuWarning}{@render advisory(cpuWarning, `${id}-cpu-warning`)}{/if}
		{#if errors.cpus}
			<p id={`${id}-cpus-error`} class="text-sm text-destructive" role="alert">{errors.cpus}</p>
		{/if}
	</fieldset>

	<!-- Advanced: initial heap, preserved exactly. -->
	<div class="flex flex-col gap-3 border-t border-border pt-3">
		<button
			type="button"
			class="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground focus-visible:underline focus-visible:outline-none"
			aria-expanded={showAdvanced}
			aria-controls={`${id}-advanced`}
			onclick={() => (advancedOpen = !showAdvanced)}
		>
			<ChevronRightIcon
				class={[
					'size-3.5 transition-transform duration-(--motion-fast)',
					showAdvanced && 'rotate-90'
				]}
				aria-hidden="true"
			/>
			Advanced · initial heap {formatMib(memoryMinMb) || '—'}
		</button>
		{#if showAdvanced}
			<div id={`${id}-advanced`} transition:collapse class="flex flex-col gap-1.5">
				<div class="flex flex-wrap items-center gap-2">
					<label for={`${id}-min`} class="text-xs text-muted-foreground">Initial heap (MiB)</label>
					<Input
						id={`${id}-min`}
						type="number"
						min={HEAP_MIN_MB}
						max={HEAP_MAX_MB}
						step={1}
						inputmode="numeric"
						bind:value={memoryMinMb}
						aria-invalid={errors.memoryMinMb ? true : undefined}
						aria-describedby={errors.memoryMinMb ? `${id}-min-error` : `${id}-min-help`}
						class="h-8 w-36 font-mono"
						{disabled}
					/>
				</div>
				<p id={`${id}-min-help`} class="text-xs text-muted-foreground">
					Java -Xms: heap reserved at start. At least 128 MiB and no more than Server RAM.
				</p>
				{#if errors.memoryMinMb}
					<p id={`${id}-min-error`} class="text-sm text-destructive" role="alert">
						{errors.memoryMinMb}
					</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
