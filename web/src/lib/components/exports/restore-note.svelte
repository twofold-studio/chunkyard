<script lang="ts">
	import LifeBuoyIcon from '@lucide/svelte/icons/life-buoy';
</script>

<details class="group rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
	<summary
		class="flex cursor-pointer list-none items-center gap-2 font-medium marker:hidden [&::-webkit-details-marker]:hidden"
	>
		<LifeBuoyIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		Restoring archives
	</summary>
	<div class="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
		<p>
			<span class="text-foreground">Full instance</span> archives restore with
			<span class="text-foreground">Restore</span> when the server is archived or no longer in the manager.
			A local instance is never overwritten, the game stays stopped, and a recreated server starts with
			the Minecraft EULA not accepted.
		</p>
		<p>
			<span class="text-foreground">World</span> and
			<span class="text-foreground">Selected paths</span> archives cannot rebuild an instance.
			Download them and extract manually into a stopped server's directory, for example
			<code class="font-mono text-foreground">tar -xzf archive.tar.gz -C &lt;server dir&gt;</code>.
		</p>
		<p>Compare the SHA-256 shown in the archive list after downloading.</p>
	</div>
</details>
