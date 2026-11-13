<script lang="ts">
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { login } from '#lib/api/index.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	let email = $state('');
	let password = $state('');
	let submitting = $state(false);
	let error = $state.raw<unknown>(null);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		error = null;
		try {
			await login({ email: email.trim(), password });
			await goto(resolve('servers'), { invalidateAll: true });
		} catch (cause) {
			error = cause;
			password = '';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>Sign in · Chunkyard</title></svelte:head>

<form {onsubmit} class="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">
	<div class="flex flex-col gap-1">
		<h1 class="text-base font-semibold">Sign in</h1>
		<p class="text-sm text-muted-foreground">Use the owner account for this manager.</p>
	</div>
	<Field.Group>
		<Field.Field>
			<Field.Label for="email">Email</Field.Label>
			<Input id="email" type="email" bind:value={email} autocomplete="username" required />
		</Field.Field>
		<Field.Field>
			<Field.Label for="password">Password</Field.Label>
			<Input
				id="password"
				type="password"
				bind:value={password}
				autocomplete="current-password"
				required
			/>
		</Field.Field>
	</Field.Group>
	{#if error}<ErrorAlert {error} />{/if}
	<Button type="submit" disabled={submitting || !email || !password}>
		{#if submitting}<Spinner data-icon="inline-start" />{/if}
		Sign in
	</Button>
</form>
<p class="mt-4 text-center text-xs text-muted-foreground">
	There is no email-based password reset.
</p>
