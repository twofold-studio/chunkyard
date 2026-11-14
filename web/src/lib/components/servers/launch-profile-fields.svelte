<script lang="ts">
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { cn } from '#lib/utils.js';
	import {
		JAVA_MAX,
		JAVA_MIN,
		LAUNCH_MODE_HINTS,
		LAUNCH_MODE_LABELS,
		LAUNCH_MODES,
		type LaunchForm,
		type LaunchFormErrors
	} from '#lib/servers/launch.js';

	interface Props {
		/** Edited in place; bind it from the owner's `$state`. */
		form: LaunchForm;
		errors?: LaunchFormErrors;
		disabled?: boolean;
		/** Hide the Java field when the caller owns it (install options). */
		showJava?: boolean;
	}

	let { form = $bindable(), errors = {}, disabled = false, showJava = true }: Props = $props();
	const id = $props.id();

	const JVM_PLACEHOLDER = '-XX:+UseG1GC\n-Dfml.queryResult=confirm';
	const PATH_PLACEHOLDER = {
		jar: 'server.jar',
		args: 'libraries/net/neoforged/neoforge/21.1.77/unix_args.txt',
		script: 'startserver.sh'
	} as const;
</script>

<div class="flex flex-col gap-4">
	<fieldset class="flex min-w-0 flex-col gap-2" {disabled}>
		<legend class="mb-2 text-sm font-medium">Launch type</legend>
		<div class="grid gap-2 sm:grid-cols-3">
			{#each LAUNCH_MODES as mode (mode)}
				{@const selected = form.mode === mode}
				<label
					class={cn(
						'flex cursor-pointer flex-col gap-0.5 rounded-md border border-border px-3 py-2 transition-colors',
						'hover:border-ring/60 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
						selected && 'border-primary bg-primary/5 hover:border-primary',
						disabled && 'cursor-not-allowed opacity-60'
					)}
				>
					<input
						type="radio"
						name={`${id}-mode`}
						class="sr-only"
						value={mode}
						bind:group={form.mode}
						{disabled}
						aria-describedby={`${id}-${mode}-hint`}
					/>
					<span class="text-sm font-medium">{LAUNCH_MODE_LABELS[mode]}</span>
					<span id={`${id}-${mode}-hint`} class="text-xs text-muted-foreground"
						>{LAUNCH_MODE_HINTS[mode]}</span
					>
				</label>
			{/each}
		</div>
	</fieldset>

	<div class={cn('grid gap-3', showJava && 'sm:grid-cols-[1fr_8rem]')}>
		<Field.Field data-invalid={errors.path ? true : undefined}>
			<Field.Label for={`${id}-path`}>
				{form.mode === 'script'
					? 'Script path'
					: form.mode === 'args'
						? 'Argument file path'
						: 'JAR path'}
			</Field.Label>
			<Input
				id={`${id}-path`}
				bind:value={form.path}
				class="h-8 font-mono"
				autocomplete="off"
				spellcheck={false}
				maxlength={512}
				placeholder={PATH_PLACEHOLDER[form.mode]}
				aria-invalid={errors.path ? true : undefined}
				{disabled}
			/>
			<Field.Description>Relative to the server directory.</Field.Description>
			{#if errors.path}<Field.Error>{errors.path}</Field.Error>{/if}
		</Field.Field>
		{#if showJava}
			<Field.Field data-invalid={errors.javaMajor ? true : undefined}>
				<Field.Label for={`${id}-java`}>Java version</Field.Label>
				<Input
					id={`${id}-java`}
					type="number"
					min={JAVA_MIN}
					max={JAVA_MAX}
					step={1}
					bind:value={form.javaMajor}
					class="h-8"
					aria-invalid={errors.javaMajor ? true : undefined}
					{disabled}
				/>
				{#if errors.javaMajor}<Field.Error>{errors.javaMajor}</Field.Error>{/if}
			</Field.Field>
		{/if}
	</div>

	<div class={cn('grid gap-3', form.mode !== 'script' && 'sm:grid-cols-2')}>
		{#if form.mode !== 'script'}
			<Field.Field data-invalid={errors.jvmArgs ? true : undefined}>
				<Field.Label for={`${id}-jvm`}>Extra JVM arguments (one per line)</Field.Label>
				<Textarea
					id={`${id}-jvm`}
					bind:value={form.jvmArgs}
					rows={3}
					class="min-h-20 font-mono text-xs md:text-xs"
					spellcheck={false}
					placeholder={JVM_PLACEHOLDER}
					aria-invalid={errors.jvmArgs ? true : undefined}
					{disabled}
				/>
				<Field.Description>
					Heap (-Xms/-Xmx) comes from Resources. Each line is one value; nothing is shell-parsed.
				</Field.Description>
				{#if errors.jvmArgs}<Field.Error>{errors.jvmArgs}</Field.Error>{/if}
			</Field.Field>
		{/if}
		<Field.Field data-invalid={errors.args ? true : undefined}>
			<Field.Label for={`${id}-args`}>
				{form.mode === 'script'
					? 'Script arguments (one per line)'
					: 'Game arguments (one per line)'}
			</Field.Label>
			<Textarea
				id={`${id}-args`}
				bind:value={form.args}
				rows={3}
				class="min-h-20 font-mono text-xs md:text-xs"
				spellcheck={false}
				placeholder="nogui"
				aria-invalid={errors.args ? true : undefined}
				{disabled}
			/>
			{#if form.mode === 'script'}
				<Field.Description>
					Passed to the script as separate values. The script may set its own JVM flags; the
					container's memory and CPU limits still apply.
				</Field.Description>
			{:else}
				<Field.Description>Passed after the launch target, one value per line.</Field.Description>
			{/if}
			{#if errors.args}<Field.Error>{errors.args}</Field.Error>{/if}
		</Field.Field>
	</div>

	{#if form.mode === 'script'}
		<p class="text-xs text-muted-foreground">
			Runs with Bash inside the Linux game container, never on the manager host. Windows
			<code class="font-mono">.bat</code>/<code class="font-mono">.cmd</code> files do not work. A custom
			image must provide Bash, Java and any tools the script needs.
		</p>
	{/if}
</div>
