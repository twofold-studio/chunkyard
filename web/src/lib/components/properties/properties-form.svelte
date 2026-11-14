<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { toast } from 'svelte-sonner';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import {
		getProperty,
		parseProperties,
		revertProperty,
		setProperty,
		UnsafePropertyEdit,
		validatePropertyKey
	} from '#lib/files/properties.js';
	import {
		KNOWN_PROPERTY_KEYS,
		MANAGED_GAME_PORT,
		matchesQuery,
		parseBooleanProperty,
		PROPERTY_GROUPS,
		validatePropertyValue,
		type PropertyField,
		type PropertyGroup
	} from '#lib/files/server-properties-schema.js';
	import { collapse, fadeIn } from '#lib/motion/index.js';

	interface Props {
		/** Current (possibly unsaved) file text. */
		content: string;
		/** Text as last read or saved, to mark and revert changed settings. */
		original: string;
		disabled: boolean;
		/**
		 * Receives the patched text; only the edited entry changes. `immediate` marks discrete
		 * changes (switches, selects, revert, add) that should be saved right away.
		 */
		onChange: (next: string, immediate: boolean) => void;
		/** Enter in a single-line field: save typed text now. */
		onCommit?: () => void;
		/** Keys whose values differ get a dot; label for that comparison. */
		changedLabel?: string;
		/** Switch to the raw text editor (for entries the form cannot edit safely). */
		onRawRequest?: () => void;
		/** Open Settings → Network for the published host port. */
		onEditNetwork?: () => void;
	}

	let {
		content,
		original,
		disabled,
		onChange,
		onCommit,
		changedLabel = 'Changed',
		onRawRequest,
		onEditNetwork
	}: Props = $props();

	const doc = $derived(parseProperties(content));
	const originalDoc = $derived(parseProperties(original));

	let query = $state('');
	let openGroups = $state<Record<string, boolean>>({});
	let newKey = $state('');
	let newValue = $state('');
	let newKeyError = $state<string | null>(null);

	const searching = $derived(query.trim().length > 0);

	/** Keys the schema does not know, in file order, once each. */
	const otherFields = $derived.by((): PropertyField[] => {
		// Local to this derivation; not reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();
		const fields: PropertyField[] = [];
		for (const entry of doc.entries) {
			if (KNOWN_PROPERTY_KEYS.has(entry.key) || seen.has(entry.key)) continue;
			seen.add(entry.key);
			fields.push({ key: entry.key, label: entry.key, help: '', kind: 'text', defaultValue: '' });
		}
		return fields;
	});

	const groups = $derived.by((): PropertyGroup[] => [
		...PROPERTY_GROUPS,
		{ id: 'other', title: 'Other properties', advanced: true, fields: otherFields }
	]);

	const visible = $derived(
		groups
			.map((group) => ({
				group,
				fields: group.fields.filter((field) =>
					matchesQuery(field, query, doc.effective.get(field.key)?.value)
				)
			}))
			.filter(({ group, fields }) => fields.length > 0 || (group.id === 'other' && !searching))
	);

	const changedKeys = $derived.by(() => {
		const keys = new Set([...doc.effective.keys(), ...originalDoc.effective.keys()]);
		return [...keys].filter((key) => getProperty(doc, key) !== getProperty(originalDoc, key));
	});

	function isOpen(group: PropertyGroup): boolean {
		return searching || (openGroups[group.id] ?? !group.advanced);
	}

	function toggle(group: PropertyGroup) {
		openGroups[group.id] = !isOpen(group);
	}

	function set(key: string, value: string, immediate = true) {
		if (disabled) return;
		try {
			onChange(setProperty(content, key, value), immediate);
		} catch (error) {
			if (!(error instanceof UnsafePropertyEdit)) throw error;
			toast.error('Edit this setting as raw text', { description: error.message });
		}
	}

	function revert(key: string) {
		if (!disabled) onChange(revertProperty(content, original, key), true);
	}

	function addProperty(event: SubmitEvent) {
		event.preventDefault();
		const key = newKey.trim();
		const error =
			validatePropertyKey(key) ??
			(doc.effective.has(key) || KNOWN_PROPERTY_KEYS.has(key)
				? `${key} is already listed; edit it above.`
				: null);
		newKeyError = error;
		if (error) return;
		set(key, newValue);
		newKey = '';
		newValue = '';
	}

	const fieldId = (key: string) => `prop-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
	const groupCount = (group: PropertyGroup) =>
		group.fields.filter((f) => changedKeys.includes(f.key)).length;
</script>

{#snippet control(field: PropertyField)}
	{@const entry = doc.effective.get(field.key)}
	{@const value = entry?.value ?? ''}
	{@const locked = disabled || (entry?.malformed ?? false)}
	{@const id = fieldId(field.key)}
	{#if field.kind === 'managed'}
		<div class="flex flex-wrap items-center gap-2 sm:justify-end">
			<span class="font-mono text-sm">{MANAGED_GAME_PORT}</span>
			<Badge variant="outline">Managed</Badge>
			{#if onEditNetwork}
				<Button variant="ghost" size="xs" onclick={onEditNetwork}>
					Host port
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			{/if}
		</div>
	{:else if field.kind === 'boolean' && entry}
		<div class="flex items-center gap-2 sm:justify-end">
			<span class="text-xs text-muted-foreground" aria-hidden="true">
				{parseBooleanProperty(value) ? 'On' : 'Off'}
			</span>
			<Switch
				{id}
				checked={parseBooleanProperty(value)}
				onCheckedChange={(checked) => set(field.key, String(checked))}
				disabled={locked}
			/>
		</div>
	{:else if field.kind === 'enum' || field.kind === 'boolean'}
		{@const options =
			field.kind === 'boolean'
				? [
						{ value: 'true', label: 'On' },
						{ value: 'false', label: 'Off' }
					]
				: (field.options ?? [])}
		{@const known = options.some((o) => o.value === value)}
		<Select.Root
			type="single"
			{value}
			onValueChange={(next) => set(field.key, next)}
			disabled={locked}
		>
			<Select.Trigger {id} size="sm" class="w-full sm:w-56">
				{options.find((o) => o.value === value)?.label ?? (value || 'Not set')}
			</Select.Trigger>
			<Select.Content>
				{#each options as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
				{#if value && !known}
					<Select.Item {value} label={value}>{value} (current)</Select.Item>
				{/if}
			</Select.Content>
		</Select.Root>
	{:else}
		<Input
			{id}
			type={field.kind === 'secret' ? 'password' : 'text'}
			inputmode={field.kind === 'integer' ? 'numeric' : undefined}
			value={entry?.value ?? ''}
			placeholder={field.defaultValue ? `Example: ${field.defaultValue}` : 'Not set'}
			oninput={(event) => set(field.key, event.currentTarget.value, false)}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					onCommit?.();
				}
			}}
			disabled={locked}
			autocomplete="off"
			spellcheck={false}
			class={['h-8 w-full sm:w-56', field.kind === 'integer' && 'font-mono']}
		/>
	{/if}
{/snippet}

{#snippet row(field: PropertyField)}
	{@const entry = doc.effective.get(field.key)}
	{@const count = doc.counts.get(field.key) ?? 0}
	{@const changed = changedKeys.includes(field.key)}
	{@const problem =
		entry && field.kind !== 'managed' && field.kind !== 'text' && field.kind !== 'secret'
			? validatePropertyValue(field, entry.value)
			: null}
	<div
		class="grid gap-x-6 gap-y-2 border-t border-border px-4 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
		data-property={field.key}
	>
		<div class="flex min-w-0 flex-col gap-0.5">
			<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
				{#if field.kind === 'managed'}
					<span class="text-sm font-medium">{field.label}</span>
				{:else}
					<label for={fieldId(field.key)} class="text-sm font-medium">{field.label}</label>
				{/if}
				{#if field.label !== field.key}
					<code class="font-mono text-[11px] text-muted-foreground">{field.key}</code>
				{/if}
				{#if changed}
					<span in:fadeIn class="flex items-center gap-1">
						<span class="size-1.5 rounded-full bg-warning" aria-hidden="true"></span>
						<span class="sr-only">{changedLabel}</span>
						<Button
							variant="ghost"
							size="icon-xs"
							onclick={() => revert(field.key)}
							{disabled}
							aria-label={`Revert ${field.key}`}
							title="Revert to the saved value"
						>
							<RotateCcwIcon />
						</Button>
					</span>
				{:else if !entry && field.kind !== 'managed'}
					<span class="text-[11px] text-muted-foreground">not set</span>
				{/if}
			</div>
			{#if field.help}<p class="text-xs text-muted-foreground">{field.help}</p>{/if}
			{#if entry?.malformed}
				<p class="flex items-center gap-1 text-xs text-warning">
					<TriangleAlertIcon class="size-3" aria-hidden="true" />
					Contains an invalid escape.
					{#if onRawRequest}
						<button type="button" class="underline underline-offset-2" onclick={onRawRequest}
							>Edit as raw text</button
						>
					{/if}
				</p>
			{:else if problem}
				<p class="text-xs text-warning">{problem}</p>
			{/if}
			{#if count > 1}
				<p class="text-xs text-muted-foreground">
					Set {count} times; line {entry?.line} applies and is the one edited here.
				</p>
			{/if}
			{#if field.key === 'online-mode' && entry && !parseBooleanProperty(entry.value)}
				<p class="text-xs text-warning">Off: unverified players can join under any name.</p>
			{:else if field.key === 'server-ip' && entry && entry.value.trim()}
				<p class="text-xs text-warning">
					Set: Minecraft listens only on this address inside the container, which can block players.
				</p>
			{:else if field.kind === 'managed' && entry && entry.value.trim() !== MANAGED_GAME_PORT}
				<p class="text-xs text-muted-foreground">
					The file says {entry.value}; Chunkyard starts Minecraft on {MANAGED_GAME_PORT} anyway.
				</p>
			{/if}
		</div>
		<div class="min-w-0">{@render control(field)}</div>
	</div>
{/snippet}

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-3">
		<div class="relative w-full sm:max-w-xs">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				type="search"
				bind:value={query}
				placeholder="Search settings"
				aria-label="Search settings"
				class="h-8 pl-8"
			/>
		</div>
		{#if changedKeys.length > 0}
			<span in:fadeIn class="text-xs text-muted-foreground" role="status">
				{changedKeys.length}
				{changedKeys.length === 1 ? 'setting' : 'settings'} changed
			</span>
		{/if}
	</div>

	{#each visible as { group, fields } (group.id)}
		{@const open = isOpen(group)}
		{@const changes = groupCount(group)}
		<section
			class="overflow-hidden rounded-lg border border-border bg-card"
			aria-label={group.title}
		>
			<h3>
				<button
					type="button"
					class="motion-press flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-accent/40"
					aria-expanded={open}
					onclick={() => toggle(group)}
					disabled={searching}
				>
					<ChevronRightIcon
						class={[
							'size-3.5 text-muted-foreground transition-transform duration-(--motion-fast)',
							open && 'rotate-90'
						]}
						aria-hidden="true"
					/>
					{group.title}
					<span class="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
						{#if changes > 0}<span>{changes} changed</span>{/if}
						{#if group.id === 'other'}{fields.length}{/if}
					</span>
				</button>
			</h3>
			{#if open}
				<div transition:collapse class="border-t border-border">
					{#each fields as field (field.key)}
						{@render row(field)}
					{/each}
					{#if group.id === 'other' && !searching}
						{#if fields.length === 0}
							<p class="px-4 py-2.5 text-xs text-muted-foreground">
								No other properties in this file.
							</p>
						{/if}
						<form
							class="flex flex-wrap items-start gap-2 border-t border-border px-4 py-2.5"
							onsubmit={addProperty}
							novalidate
						>
							<div class="flex min-w-0 flex-1 flex-col gap-1">
								<Input
									bind:value={newKey}
									placeholder="property-name"
									aria-label="New property name"
									aria-invalid={newKeyError ? true : undefined}
									class="h-8 font-mono"
									autocomplete="off"
									spellcheck={false}
									{disabled}
								/>
								{#if newKeyError}<p class="text-xs text-destructive">{newKeyError}</p>{/if}
							</div>
							<Input
								bind:value={newValue}
								placeholder="value"
								aria-label="New property value"
								class="h-8 min-w-0 flex-1"
								autocomplete="off"
								spellcheck={false}
								{disabled}
							/>
							<Button
								type="submit"
								size="sm"
								variant="outline"
								disabled={disabled || !newKey.trim()}
							>
								<PlusIcon data-icon="inline-start" />
								Add
							</Button>
						</form>
					{/if}
				</div>
			{/if}
		</section>
	{:else}
		<p class="py-6 text-center text-sm text-muted-foreground">No settings match “{query}”.</p>
	{/each}
</div>
