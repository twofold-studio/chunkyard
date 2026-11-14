<script lang="ts">
	import LifeBuoyIcon from '@lucide/svelte/icons/life-buoy';
</script>

<details class="group rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
	<summary
		class="flex cursor-pointer list-none items-center gap-2 font-medium marker:hidden [&::-webkit-details-marker]:hidden"
	>
		<LifeBuoyIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		Restoring an archive
		<span class="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">Manual</span>
	</summary>
	<div class="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
		<p>
			There is no one-click restore yet. Restoring is a manual extraction: stop the target server,
			download the archive and extract it into the server directory on the manager host, for example <code
				class="font-mono text-foreground">tar -xzf archive.tar.gz -C &lt;server dir&gt;</code
			>.
		</p>
		<p>
			Full-instance archives also contain the desired <code class="font-mono"
				>server.properties</code
			>, a server configuration manifest and the managed server JAR, so you can recreate the
			instance with the same software and settings. World and selected-path archives contain only
			those files.
		</p>
		<p>Compare the SHA-256 shown in the archive list after downloading.</p>
	</div>
</details>
