<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import StethoscopeIcon from '@lucide/svelte/icons/stethoscope';
	import { Button } from '#lib/components/ui/button/index.js';
	import { CopyText } from '#lib/components/app/index.js';
	import { collapse } from '#lib/motion/index.js';
	import type { ServerView } from '#lib/api/index.js';

	interface Props {
		server: ServerView;
		open?: boolean;
	}

	let { server, open = $bindable(false) }: Props = $props();
	const uid = $props.id();

	const launch = $derived(server.launch ?? null);
	const software = $derived(server.software ?? null);
	const status = $derived(server.status);

	interface Row {
		label: string;
		value: string;
		copy?: boolean;
	}

	/** Identifiers and paths for troubleshooting; none are needed day to day. */
	const rows = $derived.by(() => {
		const out: Row[] = [{ label: 'Server ID', value: server.id, copy: true }];
		out.push({ label: 'Manager directory', value: server.directory, copy: true });
		if (!software) out.push({ label: 'Server JAR', value: server.jar, copy: true });
		if (software?.type === 'curseforge') {
			out.push({ label: 'CurseForge project ID', value: String(software.projectId), copy: true });
			out.push({ label: 'CurseForge file ID', value: String(software.fileId), copy: true });
		}
		if (launch) {
			out.push({
				label: 'Launch file',
				value: server.launchOverride?.path ?? launch.path,
				copy: true
			});
			if (launch.checksum) {
				out.push({
					label: software?.type === 'curseforge' ? 'Server pack SHA-256' : 'SHA-256',
					value: launch.checksum,
					copy: true
				});
			}
		}
		if (status.containerId)
			out.push({ label: 'Container ID', value: status.containerId, copy: true });
		if (status.exitCode !== null)
			out.push({ label: 'Last exit code', value: String(status.exitCode) });
		if (status.oomKilled) out.push({ label: 'Out of memory', value: 'Killed by the OOM killer' });
		return out;
	});
</script>

<div class="flex flex-col">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
		<StethoscopeIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="text-sm font-medium">Advanced diagnostics</span>
		<span class="text-xs text-muted-foreground max-sm:hidden">IDs, paths and checksums</span>
		<Button
			variant="ghost"
			size="sm"
			class="ml-auto"
			aria-expanded={open}
			aria-controls={uid}
			onclick={() => (open = !open)}
		>
			{open ? 'Hide' : 'Show'}
			<ChevronRightIcon
				data-icon="inline-end"
				class={['transition-transform duration-(--motion-fast)', open && 'rotate-90']}
			/>
		</Button>
	</div>
	{#if open}
		<dl
			id={uid}
			transition:collapse
			class="grid gap-3 border-t border-border px-4 py-4 sm:grid-cols-2"
		>
			{#each rows as row (row.label)}
				<div class="flex min-w-0 flex-col gap-1">
					<dt class="text-xs text-muted-foreground">{row.label}</dt>
					<dd class="min-w-0">
						{#if row.copy}
							<CopyText value={row.value} label={`Copy ${row.label.toLowerCase()}`} />
						{:else}
							<span class="font-mono text-sm">{row.value}</span>
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	{/if}
</div>
