<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { cn } from '#lib/utils.js';

	interface Props {
		href: string;
		title: string;
		description: string;
		class?: string;
	}

	let { href, title, description, class: className }: Props = $props();
</script>

<a
	{href}
	class={cn(
		'flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8 text-center transition-colors hover:border-ring hover:bg-accent/30 focus-visible:border-ring focus-visible:outline-none',
		className
	)}
>
	<span class="flex size-10 items-center justify-center rounded-full border border-border">
		<PlusIcon class="size-5" aria-hidden="true" />
	</span>
	<span class="text-sm font-medium">{title}</span>
	<span class="max-w-xs text-sm text-muted-foreground">{description}</span>
</a>
