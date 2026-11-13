<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { getAvailableJava, isAbortError, type AvailableJava } from '#lib/api/index.js';

	interface Props {
		open: boolean;
		/** Submits the install request; resolves once the job is accepted. Throws on rejection. */
		onInstall: (major: number) => Promise<void>;
	}

	let { open = $bindable(), onInstall }: Props = $props();

	let available = $state.raw<AvailableJava | null>(null);
	let loadError = $state.raw<unknown>(null);
	let submitError = $state.raw<unknown>(null);
	let selected = $state('');
	let submitting = $state(false);

	// Fetch release metadata each time the dialog opens; cancel if it closes first.
	$effect(() => {
		if (!open) return;
		const controller = new AbortController();
		loadError = null;
		submitError = null;
		getAvailableJava({ signal: controller.signal }).then(
			(result) => {
				available = result;
				if (!selected) selected = String(result.mostRecentLts);
			},
			(error) => {
				if (!isAbortError(error)) loadError = error;
			}
		);
		return () => controller.abort();
	});

	const versions = $derived(available ? [...available.all].sort((a, b) => b - a) : []);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		const major = Number(selected);
		if (!major) return;
		submitting = true;
		submitError = null;
		try {
			await onInstall(major);
			open = false;
		} catch (error) {
			submitError = error;
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<form {onsubmit} class="flex flex-col gap-5">
			<Dialog.Header>
				<Dialog.Title>Install Java</Dialog.Title>
				<Dialog.Description>
					Downloads and verifies an Eclipse Temurin JRE on the manager host. Docker servers keep
					using the JVM from their image.
				</Dialog.Description>
			</Dialog.Header>

			{#if loadError}
				<ErrorAlert error={loadError} />
			{:else if !available}
				<Skeleton class="h-9 w-full" />
			{:else}
				<Field.Field>
					<Field.Label for="java-major">Java version</Field.Label>
					<Select.Root type="single" bind:value={selected}>
						<Select.Trigger id="java-major" class="w-full">
							{selected ? `Java ${selected}` : 'Select a version'}
							{#if available.lts.includes(Number(selected))}
								<span class="text-muted-foreground">LTS</span>
							{/if}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each versions as major (major)}
									<Select.Item value={String(major)} label={`Java ${major}`}>
										Java {major}
										{#if available.lts.includes(major)}
											<span class="text-muted-foreground">LTS</span>
										{/if}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<Field.Description>
						Progress is reported as queued, running, then finished; there is no percentage.
					</Field.Description>
				</Field.Field>
			{/if}

			{#if submitError}<ErrorAlert error={submitError} />{/if}

			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline">Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={!available || !selected || submitting}>
					{#if submitting}<Spinner data-icon="inline-start" />{/if}
					Install
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
