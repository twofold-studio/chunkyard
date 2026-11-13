<!--
	First-run setup in two steps: verify the setup token with the backend, then create the
	owner account. The token lives only in this component's memory (never storage or the URL);
	a page refresh therefore restarts at step one. The final request re-sends the original token
	so the backend validates it again.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { ErrorAlert } from '#lib/components/app/index.js';
	import { errorCode, setupOwner, verifySetupToken } from '#lib/api/index.js';
	import SetupProgress from './setup-progress.svelte';

	interface Props {
		/** Called after the owner account and session were created. */
		oncomplete: () => void | Promise<void>;
	}

	let { oncomplete }: Props = $props();

	const MIN_PASSWORD = 10;
	const MAX_PASSWORD = 256;
	const STEPS = ['Setup token', 'Owner account'] as const;
	const TOKEN_HINT =
		'Read the current token again on the manager host, e.g. docker exec <container> cat /data/setup-token.';

	let step = $state<0 | 1>(0);
	let tokenInput = $state('');
	/** Token accepted by the backend in step one; sent again with the final request. */
	let verifiedToken = '';
	let email = $state('');
	let password = $state('');
	let confirm = $state('');
	let attempted = $state(false);
	let busy = $state(false);
	let error = $state.raw<unknown>(null);

	let tokenRef = $state<HTMLInputElement | null>(null);
	let emailRef = $state<HTMLInputElement | null>(null);

	const code = $derived(errorCode(error));
	const passwordError = $derived(
		password.length > 0 && password.length < MIN_PASSWORD
			? `Use at least ${MIN_PASSWORD} characters.`
			: password.length > MAX_PASSWORD
				? `Use at most ${MAX_PASSWORD} characters.`
				: undefined
	);
	const confirmError = $derived(
		attempted && confirm !== password ? 'Passwords do not match.' : undefined
	);

	function clearPasswords() {
		password = '';
		confirm = '';
		attempted = false;
	}

	/** Returns to step one and drops the previous verification. */
	async function backToToken(cause: unknown = null) {
		verifiedToken = '';
		clearPasswords();
		error = cause;
		step = 0;
		await tick();
		tokenRef?.focus();
	}

	async function onverify(event: SubmitEvent) {
		event.preventDefault();
		const token = tokenInput.trim();
		if (!token || busy) return;
		busy = true;
		error = null;
		try {
			await verifySetupToken({ setupToken: token });
			verifiedToken = token;
			step = 1;
			busy = false;
			await tick();
			emailRef?.focus();
		} catch (cause) {
			error = cause;
			busy = false;
			await tick();
			tokenRef?.focus();
		}
	}

	async function oncreate(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		if (busy || passwordError || confirm !== password) return;
		if (!verifiedToken) return backToToken();
		busy = true;
		error = null;
		try {
			await setupOwner({ setupToken: verifiedToken, email: email.trim(), password });
		} catch (cause) {
			busy = false;
			// The original token is checked again; if it no longer works, verify a new one.
			if (errorCode(cause) === 'setup.invalid_token') return backToToken(cause);
			error = cause;
			return;
		}
		verifiedToken = '';
		clearPasswords();
		try {
			await oncomplete();
		} finally {
			busy = false;
		}
	}
</script>

{#snippet failure()}
	{#if error}
		<ErrorAlert {error} hint={code === 'setup.invalid_token' ? TOKEN_HINT : undefined}>
			{#if code === 'setup.already_done'}
				<p>
					<a class="text-foreground underline underline-offset-4" href={resolve('login')}
						>Go to sign in</a
					>
				</p>
			{:else if code === 'auth.disabled'}
				<p>
					<a class="text-foreground underline underline-offset-4" href={resolve('servers')}
						>Open Chunkyard</a
					>
				</p>
			{/if}
		</ErrorAlert>
	{/if}
{/snippet}

<div class="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">
	<SetupProgress current={step} steps={STEPS} />

	{#if step === 0}
		<form
			onsubmit={onverify}
			class="flex flex-col gap-6"
			aria-labelledby="setup-token-heading"
			novalidate
		>
			<div class="flex flex-col gap-1">
				<h1 id="setup-token-heading" class="text-base font-semibold">Verify the setup token</h1>
				<p class="text-sm text-muted-foreground">
					This manager has a single owner. Prove you have access to the host before creating it.
				</p>
			</div>
			<Field.Group>
				<Field.Field data-invalid={code === 'setup.invalid_token' ? true : undefined}>
					<Field.Label for="token">Setup token</Field.Label>
					<Input
						id="token"
						bind:ref={tokenRef}
						bind:value={tokenInput}
						class="font-mono"
						autocomplete="off"
						spellcheck={false}
						aria-invalid={code === 'setup.invalid_token' ? true : undefined}
						disabled={busy}
						required
					/>
					<Field.Description>
						Docker: <code class="font-mono"
							>docker exec &lt;container&gt; cat /data/setup-token</code
						>. Otherwise read <code class="font-mono">&lt;data-dir&gt;/setup-token</code> on the manager
						host.
					</Field.Description>
				</Field.Field>
			</Field.Group>
			{@render failure()}
			<Button type="submit" disabled={busy || !tokenInput.trim()}>
				{#if busy}<Spinner data-icon="inline-start" />{/if}
				Continue
			</Button>
		</form>
	{:else}
		<form
			onsubmit={oncreate}
			class="flex flex-col gap-6"
			aria-labelledby="setup-owner-heading"
			novalidate
		>
			<div class="flex flex-col gap-1">
				<h1 id="setup-owner-heading" class="text-base font-semibold">Create the owner account</h1>
				<p class="text-sm text-muted-foreground">
					Token verified. Setup can only be completed once.
				</p>
			</div>
			<Field.Group>
				<Field.Field>
					<Field.Label for="email">Email</Field.Label>
					<Input
						id="email"
						type="email"
						bind:ref={emailRef}
						bind:value={email}
						autocomplete="username"
						disabled={busy}
						required
					/>
				</Field.Field>
				<Field.Field data-invalid={passwordError ? true : undefined}>
					<Field.Label for="password">Password</Field.Label>
					<Input
						id="password"
						type="password"
						bind:value={password}
						autocomplete="new-password"
						aria-invalid={passwordError ? true : undefined}
						aria-describedby="password-help"
						disabled={busy}
						required
					/>
					{#if passwordError}
						<Field.Error id="password-help">{passwordError}</Field.Error>
					{:else}
						<Field.Description id="password-help"
							>10–256 characters; common passwords are rejected.</Field.Description
						>
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
						aria-describedby={confirmError ? 'confirm-error' : undefined}
						disabled={busy}
						required
					/>
					{#if confirmError}<Field.Error id="confirm-error">{confirmError}</Field.Error>{/if}
				</Field.Field>
			</Field.Group>
			{@render failure()}
			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
				<Button type="button" variant="ghost" disabled={busy} onclick={() => backToToken()}>
					<ArrowLeftIcon data-icon="inline-start" />
					Change token
				</Button>
				<Button type="submit" disabled={busy || !email.trim() || !password || !confirm}>
					{#if busy}<Spinner data-icon="inline-start" />{/if}
					Create owner
				</Button>
			</div>
		</form>
	{/if}
</div>
