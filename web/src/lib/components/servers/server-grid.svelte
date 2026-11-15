<script lang="ts">
	import { AddTile } from '#lib/components/app/index.js';
	import ServerCard from './server-card.svelte';
	import { rise, stagger } from '#lib/motion/index.js';
	import type { ServerView } from '#lib/api/index.js';
	import type { BackupIndex } from '#lib/exports/backups.js';
	import type { BackupOperations } from '#lib/exports/backup-operations.svelte.js';
	import { cardBackup } from './card-backup.js';

	interface Props {
		servers: ServerView[];
		createHref: string;
		/** Newest full S3 backups: `null` while loading, `'error'` if the catalog failed; omit to hide. */
		backups?: BackupIndex | null | 'error';
		/** Archive/restore tracking shared by the list. */
		operations?: BackupOperations;
		onRestore?: (server: ServerView) => void;
		now?: number;
	}

	let { servers, createHref, backups, operations, onRestore, now }: Props = $props();
</script>

<!-- The create tile always holds the first slot, also when servers exist. -->
<ul class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Servers">
	<li class="min-w-0">
		<AddTile
			href={createHref}
			title="Create server"
			description={servers.length
				? 'Add a Vanilla, Paper or CurseForge server.'
				: 'Install Vanilla, Paper or CurseForge, or use a custom JAR.'}
			class="h-full min-h-40 gap-2 p-5"
		/>
	</li>
	{#each servers as server, index (server.id)}
		<li class="min-w-0" in:rise|global={{ delay: stagger(index + 1) }}>
			<ServerCard
				{server}
				backup={backups === undefined ? undefined : cardBackup(backups, server.id)}
				job={operations?.jobs.get(server.id) ?? null}
				requesting={operations?.requested.has(server.id) ?? false}
				error={operations?.errors.get(server.id) ?? null}
				{onRestore}
				{now}
			/>
		</li>
	{/each}
</ul>
