<script lang="ts">
	import ServerIcon from '@lucide/svelte/icons/server';
	import { toast } from 'svelte-sonner';
	import { PageHeader } from '#lib/components/app/index.js';
	import NewServerForm from '#lib/components/servers/new-server-form.svelte';
	import type { ServerView } from '#lib/api/index.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	async function oncreated(server: ServerView) {
		if (server.software) {
			toast.success('Server installed', {
				description: 'Accept the Minecraft EULA, then start it from the server page.'
			});
		} else {
			toast.success('Server created', { description: 'Copy your server JAR into its directory.' });
		}
		await goto(resolve(`servers/${server.id}?created=1`));
	}
</script>

<PageHeader
	title="New server"
	icon={ServerIcon}
	description="Pick the server software, then name and size the Docker-backed server. Managed installs download everything on the manager host."
/>

<NewServerForm
	{oncreated}
	serverHref={(id) => resolve(`servers/${id}`)}
	cancelHref={resolve('servers')}
/>
