<script lang="ts" module>
	export interface NameDialogRequest {
		title: string;
		description?: string;
		label: string;
		submitLabel: string;
		initial: string;
		/** Returns an error message, or `null` when the value is acceptable. */
		validate: (value: string) => string | null;
		/** Performs the request; throw to show the error inline and keep the dialog open. */
		submit: (value: string) => Promise<void>;
		/** Select only the stem (`config` of `config.yml`) when the dialog opens. */
		selectStem?: boolean;
	}
</script>

<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { isAbortError } from '#lib/api/index.js';
	import { collapse } from '#lib/motion/index.js';

	interface Props {
		/** `null` closes the dialog. */
		request: NameDialogRequest | null;
	}

	let { request = $bindable() }: Props = $props();

	let value = $state('');
	let attempted = $state(false);
	let working = $state(false);
	let error = $state.raw<unknown>(null);
	let input = $state<HTMLInputElement | null>(null);
	let shown: NameDialogRequest | null = null;

	// Reset the form whenever a new request opens the dialog.
	$effect.pre(() => {
		if (request && request !== shown) {
			shown = request;
			value = request.initial;
			attempted = false;
			working = false;
			error = null;
		} else if (!request) {
			shown = null;
		}
	});

	const validation = $derived(request && attempted ? request.validate(value) : null);

	function focusInput(event: Event) {
		event.preventDefault();
		const el = input;
		if (!el) return;
		el.focus();
		const dot = value.lastIndexOf('.');
		if (request?.selectStem && dot > 0) el.setSelectionRange(0, dot);
		else el.select();
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!request || working) return;
		attempted = true;
		if (request.validate(value)) return;
		working = true;
		error = null;
		const current = request;
		try {
			await current.submit(value);
			if (request === current) request = null;
		} catch (caught) {
			if (!isAbortError(caught)) error = caught;
		} finally {
			working = false;
		}
	}
</script>

<Dialog.Root
	bind:open={
		() => request !== null,
		(open) => {
			if (!open && !working) request = null;
		}
	}
>
	<Dialog.Content onOpenAutoFocus={focusInput}>
		{#if request}
			<form class="flex flex-col gap-6" {onsubmit} novalidate>
				<Dialog.Header>
					<Dialog.Title>{request.title}</Dialog.Title>
					{#if request.description}
						<Dialog.Description>{request.description}</Dialog.Description>
					{/if}
				</Dialog.Header>
				<Field.Field data-invalid={validation ? true : undefined}>
					<Field.Label for="file-name-input">{request.label}</Field.Label>
					<Input
						id="file-name-input"
						bind:ref={input}
						bind:value
						class="font-mono"
						autocomplete="off"
						spellcheck={false}
						aria-invalid={validation ? true : undefined}
						disabled={working}
					/>
					{#if validation}<Field.Error>{validation}</Field.Error>{/if}
				</Field.Field>
				{#if error}
					<div transition:collapse><ErrorAlert {error} /></div>
				{/if}
				<Dialog.Footer>
					<Button variant="outline" disabled={working} onclick={() => (request = null)}>
						Cancel
					</Button>
					<Button type="submit" disabled={working}>
						{#if working}<Spinner data-icon="inline-start" />{/if}
						{request.submitLabel}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
