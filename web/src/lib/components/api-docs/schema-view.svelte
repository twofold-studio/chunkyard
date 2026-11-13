<script lang="ts">
	import SchemaView from './schema-view.svelte';
	import {
		deref,
		objectShape,
		refName,
		schemaConstraints,
		slug,
		typeLabel,
		type OpenApiDocument,
		type Schema
	} from './openapi';

	interface Props {
		doc: OpenApiDocument;
		schema: Schema | undefined;
		/** Nesting depth; referenced schemas are expanded only at the top level. */
		depth?: number;
		/** Set when this view already unwrapped a top-level array (prevents ref cycles). */
		unwrapped?: boolean;
	}

	let { doc, schema, depth = 0, unwrapped = false }: Props = $props();

	const MAX_DEPTH = 4;

	/** The schema whose fields are listed: top-level refs are expanded, nested refs link out. */
	const target = $derived(
		schema?.$ref && depth === 0 ? (deref<Schema>(doc, schema) ?? schema) : schema
	);
	const shape = $derived(
		target && !target.$ref ? objectShape(doc, target) : { properties: {}, required: new Set() }
	);
	const fields = $derived(Object.entries(shape.properties));
	const variants = $derived((target?.oneOf ?? target?.anyOf ?? []).filter((v) => !isNullSchema(v)));
	const arrayItems = $derived(isType(target, 'array') ? target?.items : undefined);
	const expandItems = $derived(
		!!arrayItems &&
			depth < MAX_DEPTH &&
			(arrayItems.$ref ? depth === 0 && !unwrapped : !!(arrayItems.properties || arrayItems.allOf))
	);

	function isNullSchema(s: Schema) {
		return s.type === 'null';
	}

	function isType(s: Schema | undefined, type: string) {
		return !!s && (s.type === type || (Array.isArray(s.type) && s.type.includes(type)));
	}

	/** Name of the component a property points at, through arrays and nullable unions. */
	function linkedRef(s: Schema | undefined): string | undefined {
		if (!s) return undefined;
		if (s.$ref?.startsWith('#/components/schemas/')) return refName(s.$ref);
		if (s.items) return linkedRef(s.items);
		const parts = (s.anyOf ?? s.oneOf ?? []).filter((v) => !isNullSchema(v));
		return parts.length === 1 ? linkedRef(parts[0]) : undefined;
	}

	/** Inline (non-ref) structures worth expanding under a property row. */
	function hasInlineChildren(s: Schema): boolean {
		if (s.$ref) return false;
		if (s.properties || s.allOf) return true;
		if (s.items && !s.items.$ref && (s.items.properties || s.items.allOf)) return true;
		return (s.oneOf ?? s.anyOf ?? []).filter((v) => !isNullSchema(v)).length > 1;
	}

	function literal(value: unknown) {
		return JSON.stringify(value);
	}
</script>

{#snippet typeText(s: Schema)}
	{@const ref = linkedRef(s)}
	{#if ref}
		<a
			href="#schema-{slug(ref)}"
			class="font-mono text-xs text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
			>{typeLabel(s)}</a
		>
	{:else}
		<span class="font-mono text-xs text-muted-foreground">{typeLabel(s)}</span>
	{/if}
{/snippet}

{#snippet details(s: Schema)}
	{#if s.description}
		<p class="text-sm whitespace-pre-line text-muted-foreground">{s.description}</p>
	{/if}
	{#if s.enum?.length}
		<p class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
			<span>One of</span>
			{#each s.enum as value, i (i)}
				<code class="rounded border border-border px-1 py-px font-mono text-foreground/90"
					>{literal(value)}</code
				>
			{/each}
		</p>
	{/if}
	{#if s.default !== undefined || schemaConstraints(s).length}
		<p class="text-xs text-muted-foreground">
			{#if s.default !== undefined}Default <code class="font-mono text-foreground/90"
					>{literal(s.default)}</code
				>{/if}
			{#if schemaConstraints(s).length}<span class="font-mono">
					{schemaConstraints(s).join(' · ')}</span
				>{/if}
		</p>
	{/if}
{/snippet}

{#if !target}
	<p class="text-sm text-muted-foreground">No schema.</p>
{:else if fields.length > 0}
	<ul class={['flex flex-col', depth > 0 && 'mt-2 border-l border-border pl-3']}>
		{#each fields as [name, prop] (name)}
			<li class="flex flex-col gap-1 border-b border-border/60 py-2.5 last:border-b-0">
				<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<code class="font-mono text-[13px] font-medium text-foreground">{name}</code>
					{@render typeText(prop)}
					{#if shape.required.has(name)}
						<span class="text-[11px] font-medium text-warning">required</span>
					{/if}
					{#if prop.readOnly}<span class="text-[11px] text-muted-foreground">read-only</span>{/if}
					{#if prop.writeOnly}<span class="text-[11px] text-muted-foreground">write-only</span>{/if}
					{#if prop.deprecated}<span class="text-[11px] text-destructive">deprecated</span>{/if}
				</div>
				{@render details(prop)}
				{#if hasInlineChildren(prop) && depth < MAX_DEPTH}
					<SchemaView
						{doc}
						schema={prop.items && !prop.properties ? prop.items : prop}
						depth={depth + 1}
					/>
				{/if}
			</li>
		{/each}
	</ul>
{:else if variants.length > 1}
	<div class="flex flex-col gap-2">
		{@render details(target)}
		<p class="text-xs text-muted-foreground">One of {variants.length} shapes:</p>
		{#each variants as variant, i (i)}
			<div class="rounded-md border border-border px-3 py-2">
				<div class="mb-1">{@render typeText(variant)}</div>
				{#if depth < MAX_DEPTH}<SchemaView {doc} schema={variant} depth={depth + 1} />{/if}
			</div>
		{/each}
	</div>
{:else if arrayItems && expandItems}
	<div class="flex flex-col gap-1">
		<p class="flex items-baseline gap-1.5 text-xs text-muted-foreground">
			Array of {@render typeText(arrayItems)}
		</p>
		{@render details(target)}
		<SchemaView {doc} schema={arrayItems} depth={arrayItems.$ref ? depth : depth + 1} unwrapped />
	</div>
{:else if depth === 0 || !target.$ref}
	<div class="flex flex-col gap-1">
		<div>{@render typeText(target)}</div>
		{@render details(target)}
	</div>
{/if}
