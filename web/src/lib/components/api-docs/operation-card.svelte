<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LockIcon from '@lucide/svelte/icons/lock';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import MethodBadge from './method-badge.svelte';
	import SchemaView from './schema-view.svelte';
	import CodeBlock from './code-block.svelte';
	import {
		formatJson,
		mediaExample,
		pathSegments,
		schemaConstraints,
		typeLabel,
		type MediaType,
		type OpenApiDocument,
		type Operation
	} from './openapi';

	interface Props {
		doc: OpenApiDocument;
		op: Operation;
		open: boolean;
		onToggle: (open: boolean) => void;
	}

	let { doc, op, open, onToggle }: Props = $props();

	const segments = $derived(pathSegments(op.path));
	const bodyContent = $derived(Object.entries(op.requestBody?.content ?? {}));

	function statusTone(status: string) {
		if (status.startsWith('2')) return 'text-success';
		if (status.startsWith('3')) return 'text-sky-700 dark:text-sky-300';
		if (status.startsWith('4')) return 'text-warning';
		if (status.startsWith('5')) return 'text-destructive';
		return 'text-muted-foreground';
	}
</script>

{#snippet media(type: string, content: MediaType, label: string)}
	{@const example = formatJson(mediaExample(doc, content))}
	<div class="flex flex-col gap-2">
		<Tabs.Root value="schema">
			<div class="flex items-center justify-between gap-2">
				<Tabs.List variant="line" class="h-8">
					<Tabs.Trigger value="schema" class="text-xs">Schema</Tabs.Trigger>
					{#if example}<Tabs.Trigger value="example" class="text-xs">Example</Tabs.Trigger>{/if}
				</Tabs.List>
				<code class="truncate font-mono text-[11px] text-muted-foreground">{type}</code>
			</div>
			<Tabs.Content value="schema" class="pt-1">
				<SchemaView {doc} schema={content.schema} />
			</Tabs.Content>
			{#if example}
				<Tabs.Content value="example" class="pt-2">
					<CodeBlock code={example} label="{label} example" />
				</Tabs.Content>
			{/if}
		</Tabs.Root>
	</div>
{/snippet}

<details
	id={op.id}
	{open}
	ontoggle={(event) => onToggle(event.currentTarget.open)}
	class="group/op scroll-mt-24 rounded-lg border border-border bg-card transition-colors open:border-ring/40"
>
	<summary
		class="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 outline-none select-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
	>
		<ChevronRightIcon
			class="size-4 shrink-0 text-muted-foreground transition-transform group-open/op:rotate-90"
			aria-hidden="true"
		/>
		<MethodBadge method={op.method} />
		<span class="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
			<code
				class={[
					'font-mono text-[13px] break-all text-foreground',
					op.deprecated && 'line-through decoration-muted-foreground'
				]}
			>
				{#each segments as segment, i (i)}{#if segment.param}<span class="text-orange-400/90"
							>{segment.text}</span
						>{:else}{segment.text}{/if}{/each}
			</code>
			{#if op.summary}
				<span class="truncate text-sm text-muted-foreground">{op.summary}</span>
			{/if}
		</span>
		{#if op.deprecated}
			<span class="hidden text-[11px] text-destructive sm:inline">deprecated</span>
		{/if}
		{#if op.security.length}
			<LockIcon
				class="size-3.5 shrink-0 text-muted-foreground"
				aria-label="Requires authentication"
			/>
		{:else}
			<GlobeIcon class="size-3.5 shrink-0 text-muted-foreground" aria-label="Public" />
		{/if}
	</summary>

	{#if open}
		<div class="flex flex-col gap-6 border-t border-border px-4 py-5 sm:px-5">
			<div class="flex flex-col gap-2">
				{#if op.description && op.description !== op.summary}
					<p class="text-sm whitespace-pre-line text-muted-foreground">{op.description}</p>
				{/if}
				<dl class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
					{#if op.operationId}
						<div class="flex gap-1.5">
							<dt>Operation</dt>
							<dd><code class="font-mono text-foreground/90">{op.operationId}</code></dd>
						</div>
					{/if}
					<div class="flex gap-1.5">
						<dt>Auth</dt>
						<dd class="text-foreground/90">
							{op.security.length ? op.security.join(', ') : 'None (public)'}
						</dd>
					</div>
				</dl>
			</div>

			{#if op.parameters.length}
				<section class="flex flex-col gap-2" aria-label="Parameters">
					<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						Parameters
					</h4>
					<ul class="flex flex-col rounded-md border border-border">
						{#each op.parameters as param (`${param.in}:${param.name}`)}
							<li
								class="flex flex-col gap-1 border-b border-border/60 px-3 py-2.5 last:border-b-0 sm:flex-row sm:gap-4"
							>
								<div class="flex shrink-0 flex-wrap items-baseline gap-x-2 sm:w-56">
									<code class="font-mono text-[13px] font-medium">{param.name}</code>
									<span class="text-[11px] text-muted-foreground">{param.in}</span>
									{#if param.required}
										<span class="text-[11px] font-medium text-warning">required</span>
									{/if}
								</div>
								<div class="flex min-w-0 flex-col gap-1">
									<span class="font-mono text-xs text-muted-foreground"
										>{typeLabel(param.schema)}</span
									>
									{#if param.description}
										<p class="text-sm text-muted-foreground">{param.description}</p>
									{/if}
									{#if param.schema?.enum?.length}
										<p class="font-mono text-xs text-muted-foreground">
											{param.schema.enum.map((v) => JSON.stringify(v)).join(' | ')}
										</p>
									{/if}
									{#if param.schema && (param.schema.default !== undefined || schemaConstraints(param.schema).length)}
										<p class="font-mono text-xs text-muted-foreground">
											{[
												param.schema.default !== undefined
													? `default ${JSON.stringify(param.schema.default)}`
													: '',
												...schemaConstraints(param.schema)
											]
												.filter(Boolean)
												.join(' · ')}
										</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if op.requestBody}
				<section class="flex flex-col gap-2" aria-label="Request body">
					<h4
						class="flex items-baseline gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
					>
						Request body
						{#if op.requestBody.required}
							<span class="text-[11px] font-medium tracking-normal text-warning normal-case"
								>required</span
							>
						{/if}
					</h4>
					{#if op.requestBody.description}
						<p class="text-sm text-muted-foreground">{op.requestBody.description}</p>
					{/if}
					{#each bodyContent as [type, content] (type)}
						{@render media(type, content, 'Request')}
					{/each}
				</section>
			{/if}

			<section class="flex flex-col gap-2" aria-label="Responses">
				<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Responses</h4>
				{#if op.responses.length === 0}
					<p class="text-sm text-muted-foreground">No responses documented.</p>
				{/if}
				<ul class="flex flex-col gap-2">
					{#each op.responses as { status, response } (status)}
						{@const contents = Object.entries(response.content ?? {})}
						<li class="rounded-md border border-border">
							<div class="flex items-baseline gap-3 px-3 py-2">
								<code class={['font-mono text-sm font-semibold', statusTone(status)]}>{status}</code
								>
								<span class="text-sm text-muted-foreground">{response.description ?? ''}</span>
							</div>
							{#if contents.length}
								<div class="flex flex-col gap-3 border-t border-border/60 px-3 pt-1 pb-3">
									{#each contents as [type, content] (type)}
										{@render media(type, content, `${status} response`)}
									{/each}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		</div>
	{/if}
</details>
