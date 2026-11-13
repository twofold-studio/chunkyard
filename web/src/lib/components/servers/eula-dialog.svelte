<script lang="ts">
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';

	interface Props {
		open: boolean;
		onAccept: () => void;
	}

	let { open = $bindable(), onAccept }: Props = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Accept the Minecraft EULA?</AlertDialog.Title>
			<AlertDialog.Description>
				Minecraft servers only start after you agree to the
				<a
					href="https://aka.ms/MinecraftEULA"
					target="_blank"
					rel="noreferrer noopener"
					class="text-foreground underline underline-offset-4"
					>Minecraft End User License Agreement</a
				>. The manager writes <code class="font-mono">eula=true</code> to this server's directory.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					open = false;
					onAccept();
				}}
			>
				I accept
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
