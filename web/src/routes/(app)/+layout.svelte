<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
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
	import { isPublicPath } from '#lib/navigation/public-pages.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let signingOut = $state(false);
	let paletteOpen = $state(false);
	// Lazy-loaded so the palette never weighs on first paint or chart/console hot paths.
	const paletteModule = import('#lib/components/app/command-palette.svelte');
	// Scoped to this shell instance: pages render their header content through it.
	const topbar = provideTopbarSlot();

	// A protected request reported an expired session or pending setup: leave the app shell.
	// Not for signed-out visitors of a public page: their 401s are expected (e.g. the login
	// page checking the session) and must not restart navigation.
	$effect(() => {
		if (!data.auth) return;
		return onAuthLost((error) => {
			goto(error.code === 'setup_required' ? resolve('setup') : resolve('login'), {
				invalidateAll: true
			});
		});
	});

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

	/** Palette caches are scoped to this session; a different sign-in starts empty. */
	const paletteSession = $derived(
		data.auth?.mode === 'session' ? `session:${data.auth.user.id}` : 'auth-disabled'
	);
	const crumbs = $derived(page.data.crumbs ?? []);
	const onCreatePage = $derived(page.url.pathname === resolve('servers/new'));
	/** Signed-out visitor on a public page (the API reference): no app shell. */
	const visitorView = $derived(!data.auth && data.visitor && isPublicPath(page.url.pathname));
</script>

{#if visitorView}
	<div class="flex min-h-svh flex-col">
		<header
			class="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sm:px-8"
		>
			<span class="flex items-center gap-2.5 text-sm font-semibold">
				<span class="flex size-7 items-center justify-center rounded-md border border-border">
					<img src="/logo.png" alt="" class="size-6 object-contain" />
				</span>
				Chunkyard
			</span>
			<Button href={resolve('login')} variant="outline" size="sm">Sign in</Button>
		</header>
		<main
			class="mx-auto flex w-full max-w-[72rem] flex-1 flex-col gap-8 px-4 py-8 sm:px-8 lg:px-16 lg:py-10"
		>
			{@render children()}
		</main>
	</div>
{:else if data.unavailable || !data.auth}
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
					<Button
						variant="outline"
						size="sm"
						onclick={() => (paletteOpen = true)}
						aria-label="Quick navigation"
						aria-keyshortcuts="Control+K Meta+K"
						title="Quick navigation (Ctrl/⌘ K)"
					>
						<SearchIcon data-icon="inline-start" />
						<span class="hidden md:inline">Go to</span>
						<kbd class="hidden font-mono text-[10px] text-muted-foreground md:inline">⌘K</kbd>
					</Button>
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
	{#await paletteModule then { default: CommandPalette }}
		<CommandPalette bind:open={paletteOpen} sessionKey={paletteSession} />
	{/await}
{/if}
