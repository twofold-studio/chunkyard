<script lang="ts">
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { setupOwner } from '#lib/api/index.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const MIN_PASSWORD = 10;

	let setupToken = $state('');
	let email = $state('');
	let password = $state('');
	let confirm = $state('');
	let submitting = $state(false);
	let error = $state.raw<unknown>(null);
	let attempted = $state(false);

	const passwordError = $derived(
		password.length > 0 && password.length < MIN_PASSWORD
			? `Use at least ${MIN_PASSWORD} characters.`
			: password.length > 256
				? 'Use at most 256 characters.'
				: undefined
	);
	const confirmError = $derived(
		attempted && confirm !== password ? 'Passwords do not match.' : undefined
	);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		if (passwordError || confirm !== password) return;
		submitting = true;
		error = null;
		try {
			await setupOwner({ setupToken: setupToken.trim(), email: email.trim(), password });
			await goto(resolve('servers'), { invalidateAll: true });
		} catch (cause) {
			error = cause;
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>Initial setup · Minecraft Manager</title></svelte:head>

<form {onsubmit} class="flex flex-col gap-6 rounded-lg border border-border bg-card p-6" novalidate>
	<div class="flex flex-col gap-1">
		<h1 class="text-base font-semibold">Create the owner account</h1>
		<p class="text-sm text-muted-foreground">
			This manager has a single owner. Setup can only be completed once.
		</p>
	</div>
	<Field.Group>
		<Field.Field>
			<Field.Label for="token">Setup token</Field.Label>
			<Input
				id="token"
				bind:value={setupToken}
				class="font-mono"
				autocomplete="off"
				spellcheck={false}
				required
			/>
			<Field.Description>
				Read it on the manager host from <code class="font-mono">&lt;data-dir&gt;/setup-token</code
				>.
			</Field.Description>
		</Field.Field>
		<Field.Field>
			<Field.Label for="email">Email</Field.Label>
			<Input id="email" type="email" bind:value={email} autocomplete="username" required />
		</Field.Field>
		<Field.Field data-invalid={passwordError ? true : undefined}>
			<Field.Label for="password">Password</Field.Label>
			<Input
				id="password"
				type="password"
				bind:value={password}
				autocomplete="new-password"
				aria-invalid={passwordError ? true : undefined}
				required
			/>
			{#if passwordError}
				<Field.Error>{passwordError}</Field.Error>
			{:else}
				<Field.Description>10–256 characters; common passwords are rejected.</Field.Description>
			{/if}
		</Field.Field>
		<Field.Field data-invalid={confirmError ? true : undefined}>
			<Field.Label for="confirm">Confirm password</Field.Label>
			<Input
				id="confirm"
				type="password"
				bind:value={confirm}
				autocomplete="new-password"
				aria-invalid={confirmError ? true : undefined}
				required
			/>
			{#if confirmError}<Field.Error>{confirmError}</Field.Error>{/if}
		</Field.Field>
	</Field.Group>
	{#if error}<ErrorAlert {error} />{/if}
	<Button
		type="submit"
		disabled={submitting || !setupToken.trim() || !email.trim() || !password || !confirm}
	>
		{#if submitting}<Spinner data-icon="inline-start" />{/if}
		Create owner
	</Button>
</form>
