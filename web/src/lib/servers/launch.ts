import type {
	InstallOptions,
	LaunchMode,
	LaunchProfile,
	LaunchSettings,
	ModLoader,
	UpdateLaunchRequest
} from '#lib/api/index.js';

export const LAUNCH_MODES: readonly LaunchMode[] = ['jar', 'args', 'script'];

export const LAUNCH_MODE_LABELS: Record<LaunchMode, string> = {
	jar: 'Jar',
	args: 'Java argument file',
	script: 'Bash script'
};

export const LAUNCH_MODE_HINTS: Record<LaunchMode, string> = {
	jar: 'Runs java -jar <path>.',
	args: 'Runs java @<path>, e.g. Forge/NeoForge unix_args.txt.',
	script: 'Runs /bin/bash <path> inside the container.'
};

export const MOD_LOADERS: readonly ModLoader[] = ['forge', 'neoforge', 'fabric'];

export const LOADER_LABELS: Record<string, string> = {
	forge: 'Forge',
	neoforge: 'NeoForge',
	fabric: 'Fabric',
	quilt: 'Quilt'
};

export function loaderLabel(type: string): string {
	return LOADER_LABELS[type.toLowerCase()] ?? type;
}

export const JAVA_MIN = 8;
export const JAVA_MAX = 99;
const MAX_PATH = 512;
const MAX_ARGS = 128;
const MAX_ARG_LENGTH = 1024;
const MAX_TOTAL_ARG_BYTES = 32 * 1024;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** Editable launch profile; argument lists are one value per line, never shell-parsed. */
export interface LaunchForm {
	mode: LaunchMode;
	path: string;
	javaMajor: number | null | undefined;
	jvmArgs: string;
	args: string;
}

export type LaunchFormErrors = Partial<Record<keyof LaunchForm, string>>;

/** One argument per non-blank line; surrounding whitespace is trimmed, nothing else is parsed. */
export function parseLines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function formatLines(values: readonly string[]): string {
	return values.join('\n');
}

export function emptyLaunchForm(mode: LaunchMode = 'jar'): LaunchForm {
	return { mode, path: '', javaMajor: null, jvmArgs: '', args: '' };
}

export function profileToForm(profile: LaunchProfile): LaunchForm {
	return {
		mode: profile.mode,
		path: profile.path,
		javaMajor: profile.javaMajor,
		jvmArgs: formatLines(profile.jvmArgs),
		args: formatLines(profile.args)
	};
}

/** Script launches choose their own JVM flags, so JVM arguments are not sent for them. */
export function formToProfile(form: LaunchForm): LaunchProfile {
	return {
		mode: form.mode,
		path: form.path.trim(),
		javaMajor: form.javaMajor ?? 0,
		jvmArgs: form.mode === 'script' ? [] : parseLines(form.jvmArgs),
		args: parseLines(form.args)
	};
}

export function sameProfile(a: LaunchProfile, b: LaunchProfile): boolean {
	const list = (x: readonly string[], y: readonly string[]) =>
		x.length === y.length && x.every((value, i) => value === y[i]);
	return (
		a.mode === b.mode &&
		a.path === b.path &&
		a.javaMajor === b.javaMajor &&
		list(a.jvmArgs, b.jvmArgs) &&
		list(a.args, b.args)
	);
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function validateJava(value: number | null | undefined): string | undefined {
	if (value == null || !Number.isInteger(value) || value < JAVA_MIN || value > JAVA_MAX) {
		return `Enter a Java major version from ${JAVA_MIN} to ${JAVA_MAX}.`;
	}
	return undefined;
}

/** Instance-relative POSIX path; mirrors the backend's rules so most mistakes fail early. */
export function validateLaunchPath(path: string, mode: LaunchMode): string | undefined {
	const value = path.trim();
	if (!value) return 'Enter the launch file path, relative to the server directory.';
	const parts = value.split('/');
	if (
		byteLength(value) > MAX_PATH ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.includes(':') ||
		CONTROL.test(value) ||
		parts.some((part) => part === '' || part === '.' || part === '..')
	) {
		return 'Use a relative path inside the server directory, e.g. run.sh or libraries/…/unix_args.txt.';
	}
	if (mode === 'script' && /\.(bat|cmd|ps1)$/i.test(value)) {
		return 'Windows scripts do not run on Linux. Use a Bash script (.sh).';
	}
	return undefined;
}

function validateArgs(text: string): string | undefined {
	const values = parseLines(text);
	if (values.length > MAX_ARGS) return `Use at most ${MAX_ARGS} arguments.`;
	if (values.some((value) => byteLength(value) > MAX_ARG_LENGTH || CONTROL.test(value))) {
		return `Each argument must be at most ${MAX_ARG_LENGTH} UTF-8 bytes without control characters.`;
	}
	return undefined;
}

export function validateLaunchForm(
	form: LaunchForm,
	{ requireJava = true }: { requireJava?: boolean } = {}
): LaunchFormErrors {
	const errors: LaunchFormErrors = {};
	const path = validateLaunchPath(form.path, form.mode);
	if (path) errors.path = path;
	if (requireJava) {
		const java = validateJava(form.javaMajor);
		if (java) errors.javaMajor = java;
	}
	if (form.mode !== 'script') {
		const jvm = validateArgs(form.jvmArgs);
		if (jvm) errors.jvmArgs = jvm;
	}
	const args = validateArgs(form.args);
	if (args) errors.args = args;
	const allArgs = [
		...(form.mode === 'script' ? [] : parseLines(form.jvmArgs)),
		...parseLines(form.args)
	];
	if (allArgs.length > MAX_ARGS)
		errors.args = `Use at most ${MAX_ARGS} JVM and game arguments in total.`;
	if (allArgs.reduce((total, value) => total + byteLength(value), 0) > MAX_TOTAL_ARG_BYTES) {
		errors.args = 'Keep JVM and game arguments within 32 KiB in total.';
	}
	return errors;
}

/** "Bash script run.sh · Java 17" */
export function describeProfile(
	profile: Pick<LaunchProfile, 'mode' | 'path' | 'javaMajor'>
): string {
	return `${LAUNCH_MODE_LABELS[profile.mode] ?? profile.mode} ${profile.path} · Java ${profile.javaMajor}`;
}

// Launch settings (Settings → Launch) ---------------------------------------------

const IMAGE_RE = /^[A-Za-z0-9/_.:@-]+$/;

export function validateImage(value: string): string | undefined {
	const image = value.trim();
	if (!image) return undefined;
	if (image.length > 255 || image.startsWith('-') || !IMAGE_RE.test(image)) {
		return 'Enter a valid image reference, e.g. eclipse-temurin:21-jre, or leave blank for automatic.';
	}
	return undefined;
}

export interface LaunchSettingsForm {
	/** Use `profile` instead of the detected launch. */
	override: boolean;
	profile: LaunchForm;
	/** Blank means automatic Temurin selection. */
	image: string;
}

export function launchSettingsToForm(settings: LaunchSettings): LaunchSettingsForm {
	return {
		override: settings.overridden,
		profile: profileToForm(settings.current),
		image: settings.autoJava ? '' : settings.dockerImage
	};
}

/**
 * Builds the PATCH body. The image is omitted when unchanged so the current policy is
 * preserved; a cleared image restores automatic selection.
 */
export function toUpdateLaunchRequest(
	form: LaunchSettingsForm,
	settings: LaunchSettings
): UpdateLaunchRequest {
	const body: UpdateLaunchRequest = { profile: form.override ? formToProfile(form.profile) : null };
	const image = form.image.trim();
	const initial = settings.autoJava ? '' : settings.dockerImage;
	if (image !== initial) body.dockerImage = image || null;
	return body;
}

export function launchSettingsDirty(form: LaunchSettingsForm, settings: LaunchSettings): boolean {
	const body = toUpdateLaunchRequest(form, settings);
	if ('dockerImage' in body) return true;
	if (form.override !== settings.overridden) return true;
	return body.profile !== null && !sameProfile(body.profile, settings.current);
}

// Install options (advanced install / retry) --------------------------------------

export interface InstallForm {
	minecraftVersion: string;
	loader: ModLoader | '';
	loaderVersion: string;
	javaMajor: number | null | undefined;
	overrideLaunch: boolean;
	launch: LaunchForm;
}

export type InstallFormErrors = Partial<
	Record<'minecraftVersion' | 'loader' | 'loaderVersion' | 'javaMajor', string>
> & { launch?: LaunchFormErrors };

export function emptyInstallForm(): InstallForm {
	return {
		minecraftVersion: '',
		loader: '',
		loaderVersion: '',
		javaMajor: null,
		overrideLaunch: false,
		launch: emptyLaunchForm('script')
	};
}

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

export function validateInstallForm(form: InstallForm): InstallFormErrors {
	const errors: InstallFormErrors = {};
	const mc = form.minecraftVersion.trim();
	if (mc && !VERSION_RE.test(mc)) errors.minecraftVersion = 'Enter a version such as 1.20.1.';
	const loaderVersion = form.loaderVersion.trim();
	if (loaderVersion && !VERSION_RE.test(loaderVersion)) {
		errors.loaderVersion = 'Enter a loader version such as 47.3.0.';
	} else if (loaderVersion && !form.loader) {
		errors.loader = 'Choose the loader this version belongs to.';
	}
	const javaRequired = form.overrideLaunch;
	if (form.javaMajor != null || javaRequired) {
		const java = validateJava(form.javaMajor);
		if (java)
			errors.javaMajor =
				javaRequired && form.javaMajor == null ? `${java} A launch target needs it.` : java;
	}
	if (form.overrideLaunch) {
		const launch = validateLaunchForm(form.launch, { requireJava: false });
		if (Object.keys(launch).length > 0) errors.launch = launch;
	}
	return errors;
}

export function hasErrors(errors: object): boolean {
	return Object.keys(errors).length > 0;
}

/** Only fields the owner filled are sent; `null` means "detect everything" (empty body). */
export function toInstallOptions(form: InstallForm): InstallOptions | null {
	const options: InstallOptions = {};
	const mc = form.minecraftVersion.trim();
	if (mc) options.minecraftVersion = mc;
	if (form.loader) options.loader = form.loader;
	const loaderVersion = form.loaderVersion.trim();
	if (loaderVersion) options.loaderVersion = loaderVersion;
	if (form.javaMajor != null) options.javaMajor = form.javaMajor;
	if (form.overrideLaunch) {
		options.launch = formToProfile({ ...form.launch, javaMajor: form.javaMajor });
	}
	return Object.keys(options).length > 0 ? options : null;
}
