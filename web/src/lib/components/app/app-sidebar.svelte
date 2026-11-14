<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import CoffeeIcon from '@lucide/svelte/icons/coffee';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
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
	}

	let { auth, onSignOut, signingOut = false }: Props = $props();
	const sidebar = Sidebar.useSidebar();

	const nav = [
		{ label: 'Servers', href: resolve('servers'), icon: ServerIcon },
		{ label: 'Storage & exports', href: resolve('exports'), icon: ArchiveIcon },
		{ label: 'Java runtimes', href: resolve('java'), icon: CoffeeIcon },
		{ label: 'API reference', href: resolve('api-docs'), icon: BookOpenIcon }
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
