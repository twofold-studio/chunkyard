<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { AppSidebar, AppTopbar, BackendUnavailable } from '#lib/components/app/index.js';
	import { Swap } from '#lib/components/motion/index.js';
	import { describeError, logout, onAuthLost } from '#lib/api/index.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { provideTopbarSlot } from '#lib/components/app/topbar-context.svelte.js';
	import { activityIndicator } from '#lib/jobs/activity-indicator.svelte.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let signingOut = $state(false);
	// Scoped to this shell instance: pages render their header content through it.
	const topbar = provideTopbarSlot();

	// A protected request reported an expired session or pending setup: leave the app shell.
	$effect(() =>
		onAuthLost((error) => {
			goto(error.code === 'setup_required' ? resolve('setup') : resolve('login'), {
				invalidateAll: true
			});
		})
	);

	// Discreet active-job count: one throttled check per route change, no timer.
	$effect(() => {
		void page.url.pathname;
		if (!data.auth || data.unavailable) return;
		untrack(() => void activityIndicator.check());
	});
	$effect(() => () => activityIndicator.cancel());

	async function signOut() {
		if (signingOut) return;
		signingOut = true;
		try {
			await logout();
			await goto(resolve('login'), { invalidateAll: true });
		} catch (error) {
			const message = describeError(error);
			toast.error(message.title, { description: message.detail });
		} finally {
			signingOut = false;
		}
	}

	const crumbs = $derived(page.data.crumbs ?? []);
	const onCreatePage = $derived(page.url.pathname === resolve('servers/new'));
</script>

{#if data.unavailable || !data.auth}
	<main class="flex min-h-svh items-center justify-center p-6">
		<div class="w-full max-w-lg">
			<BackendUnavailable
				message={data.unavailable ?? { title: 'Not signed in', detail: 'Reload to continue.' }}
			/>
		</div>
	</main>
{:else}
	<Sidebar.Provider style="--sidebar-width: 16.5rem;">
		<AppSidebar
			auth={data.auth}
			onSignOut={signOut}
			{signingOut}
			activeJobs={activityIndicator.active}
		/>
		<Sidebar.Inset class="min-w-0">
			<AppTopbar {crumbs} context={topbar.content}>
				{#snippet actions()}
					{#if !onCreatePage}
						<Button href={resolve('servers/new')} size="sm">
							<PlusIcon data-icon="inline-start" />
							New server
						</Button>
					{/if}
				{/snippet}
			</AppTopbar>
			<main
				class="mx-auto flex w-full max-w-[72rem] flex-1 flex-col px-4 py-8 sm:px-8 lg:px-16 lg:py-10"
			>
				<!-- Route changes replay a short enter transition; query-only changes do not. -->
				<Swap key={page.url.pathname} preset="rise" class="flex flex-col gap-8">
					{@render children()}
				</Swap>
			</main>
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}
