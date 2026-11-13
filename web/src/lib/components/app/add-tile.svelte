<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';

	interface Props {
		href: string;
		title: string;
		description: string;
	}

	let { href, title, description }: Props = $props();
</script>

<a
	{href}
	class="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center transition-colors hover:border-ring hover:bg-accent/30 focus-visible:border-ring focus-visible:outline-none"
>
	<span class="flex size-12 items-center justify-center rounded-full border border-border">
		<PlusIcon class="size-5" aria-hidden="true" />
	</span>
	<span class="text-sm font-medium">{title}</span>
	<span class="max-w-xs text-sm text-muted-foreground">{description}</span>
</a>
