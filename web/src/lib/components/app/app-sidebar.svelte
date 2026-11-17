<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import ShieldOffIcon from '@lucide/svelte/icons/shield-off';
	import UserIcon from '@lucide/svelte/icons/user';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import DockerStatus from './docker-status.svelte';
	import VersionBadge from './version-badge.svelte';
	import type { AuthContext } from '#lib/auth.js';

	interface Props {
		auth: AuthContext;
		onSignOut: () => void;
		signingOut?: boolean;
		/** Jobs queued or running among the newest jobs; hidden when 0 or unknown. */
		activeJobs?: number | null;
	}

	let { auth, onSignOut, signingOut = false, activeJobs = null }: Props = $props();
	const activityHref = resolve('activity');
	const sidebar = Sidebar.useSidebar();

	const nav = [
		{ label: 'Servers', href: resolve('servers'), icon: ServerIcon },
		{ label: 'Activity', href: resolve('activity'), icon: HistoryIcon },
		{ label: 'Storage & exports', href: resolve('exports'), icon: ArchiveIcon },
		{ label: 'Integrations', href: resolve('integrations'), icon: PlugIcon },
		{ label: 'API reference', href: resolve('api-docs'), icon: BookOpenIcon },
		{ label: 'Settings', href: resolve('settings'), icon: SettingsIcon }
	];

	function isActive(href: string) {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<Sidebar.Root>
	<Sidebar.Header class="h-[72px] shrink-0 justify-center border-b border-sidebar-border px-5">
		<a
			href={resolve('servers')}
			class="flex items-center gap-2.5 text-sm font-semibold text-foreground"
		>
			<span class="flex size-7 items-center justify-center rounded-md border border-border">
				<img src="/logo.png" alt="" class="size-6 object-contain" />
			</span>
			Chunkyard
		</a>
	</Sidebar.Header>

	<Sidebar.Content class="py-3">
		<Sidebar.Group>
			<Sidebar.GroupLabel>Manage</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each nav as item (item.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={isActive(item.href)} class="h-10 px-3">
								{#snippet child({ props })}
									<a
										href={item.href}
										{...props}
										aria-current={isActive(item.href) ? 'page' : undefined}
										onclick={() => sidebar.setOpenMobile(false)}
									>
										<item.icon />
										<span>{item.label}</span>
										{#if item.href === activityHref && activeJobs}
											<span
												class="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums group-data-[collapsible=icon]:hidden"
												title="{activeJobs} {activeJobs === 1 ? 'job' : 'jobs'} queued or running"
											>
												<span class="size-1.5 rounded-full bg-warning" aria-hidden="true"></span>
												{activeJobs}
												<span class="sr-only">{activeJobs === 1 ? 'job' : 'jobs'} in progress</span>
											</span>
										{/if}
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer class="gap-1 border-t border-sidebar-border p-3">
		<DockerStatus />
		<Sidebar.Menu>
			{#if !sidebar.isMobile}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton class="h-10 px-3" onclick={() => sidebar.setOpen(false)}>
						<PanelLeftCloseIcon />
						<span>Collapse sidebar</span>
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{/if}
			{#if auth.mode === 'session'}
				<Sidebar.MenuItem>
					<div class="flex h-10 items-center gap-2 px-3 text-sm text-sidebar-foreground">
						<UserIcon class="size-4 shrink-0" aria-hidden="true" />
						<span class="truncate" title={auth.user.email}>{auth.user.email}</span>
					</div>
				</Sidebar.MenuItem>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton class="h-10 px-3" onclick={onSignOut} aria-disabled={signingOut}>
						<LogOutIcon />
						<span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{:else}
				<Sidebar.MenuItem>
					<div
						class="flex h-10 items-center gap-2 px-3 text-sm text-muted-foreground"
						title="The backend runs with CHUNKYARD_AUTH__ENABLED=false; anyone who can reach it has full control."
					>
						<ShieldOffIcon class="size-4 shrink-0" aria-hidden="true" />
						<span class="truncate">Authentication disabled</span>
					</div>
				</Sidebar.MenuItem>
			{/if}
		</Sidebar.Menu>
		<div class="flex px-3 pt-1 group-data-[collapsible=icon]:hidden">
			<VersionBadge />
		</div>
	</Sidebar.Footer>
</Sidebar.Root>
