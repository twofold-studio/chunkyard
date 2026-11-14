<script lang="ts">
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import AppSidebar from '#lib/components/app/app-sidebar.svelte';
	import type { AuthContext } from '#lib/auth.js';

	let {
		auth,
		onSignOut,
		activeJobs = null
	}: { auth: AuthContext; onSignOut: () => void; activeJobs?: number | null } = $props();
</script>

<Sidebar.Provider>
	<AppSidebar {auth} {onSignOut} {activeJobs} />
</Sidebar.Provider>
