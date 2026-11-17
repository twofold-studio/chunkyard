import type { CreateServerRequest, ServerSoftware } from '#lib/api/index.js';

/** Raw form values; numeric inputs bound with `type="number"` may be null when empty. */
export interface ServerFormValues {
	name: string;
	/** `null`/blank means "Automatic": the backend assigns the first free managed port. */
	port: number | null | undefined;
	dockerImage: string;
	jar: string;
	memoryMinMb: number | null;
	memoryMaxMb: number | null;
	cpus: number | null;
	acceptEula: boolean;
}

export type ServerFormErrors = Partial<Record<keyof ServerFormValues, string>>;

export const DEFAULT_DOCKER_IMAGE = 'eclipse-temurin:21-jre';

export function defaultServerForm(): ServerFormValues {
	return {
		name: '',
		port: null,
		dockerImage: DEFAULT_DOCKER_IMAGE,
		jar: 'server.jar',
		memoryMinMb: 512,
		memoryMaxMb: 2048,
		cpus: 2,
		acceptEula: false
	};
}

const IMAGE_RE = /^[A-Za-z0-9/_.:@-]+$/;

function isInt(value: number | null | undefined): value is number {
	return value != null && Number.isInteger(value);
}

export interface ValidateOptions {
	/**
	 * Managed install: the backend writes the server JAR and picks a Java image, so
	 * `jar` is ignored and an empty `dockerImage` means "automatic".
	 */
	managed?: boolean;
}

export interface ResourceValues {
	memoryMinMb: number | null | undefined;
	memoryMaxMb: number | null | undefined;
	cpus: number | null | undefined;
}

export type ResourceErrors = Partial<Record<keyof ResourceValues, string>>;

/** Creation and edit limits: 128 ≤ min ≤ max ≤ 262144 MiB, 0.1 ≤ CPUs ≤ 256. */
export function validateResources(v: ResourceValues): ResourceErrors {
	const errors: ResourceErrors = {};
	if (!isInt(v.memoryMinMb) || v.memoryMinMb < 128) {
		errors.memoryMinMb = 'Minimum heap must be at least 128 MiB.';
	}
	if (!isInt(v.memoryMaxMb) || v.memoryMaxMb > 262144) {
		errors.memoryMaxMb = 'Maximum heap must be at most 262144 MiB.';
	} else if (isInt(v.memoryMinMb) && v.memoryMaxMb < v.memoryMinMb) {
		errors.memoryMaxMb = 'Maximum heap must be at least the minimum heap.';
	}
	if (v.cpus == null || !Number.isFinite(v.cpus) || v.cpus < 0.1 || v.cpus > 256) {
		errors.cpus = 'Enter between 0.1 and 256 CPUs.';
	}
	return errors;
}

/**
 * Mirrors crates/process/src/validation.rs so most mistakes are caught before
 * a request is sent. The backend remains authoritative.
 */
export function validateServerForm(
	v: ServerFormValues,
	{ managed = false }: ValidateOptions = {}
): ServerFormErrors {
	const errors: ServerFormErrors = {};
	const name = v.name.trim();
	// eslint-disable-next-line no-control-regex
	if (!name || [...v.name].length > 80 || /[\u0000-\u001f\u007f]/.test(v.name)) {
		errors.name = 'Use 1–80 characters without control characters.';
	}
	if (v.port != null && (!isInt(v.port) || v.port < 1 || v.port > 65535)) {
		errors.port = 'Enter a port between 1 and 65535, or leave it blank for automatic.';
	}
	const image = v.dockerImage.trim();
	if (managed && !image) {
		// Automatic image selection.
	} else if (!image || image.length > 255 || image.startsWith('-') || !IMAGE_RE.test(image)) {
		errors.dockerImage = 'Enter a valid image reference, e.g. eclipse-temurin:21-jre.';
	}
	const jar = v.jar.trim();
	const parts = jar.split('/');
	if (managed) {
		// The installer decides the launch target.
	} else if (
		!jar.endsWith('.jar') ||
		jar.length > 512 ||
		jar.startsWith('/') ||
		/[\\:]/.test(jar) ||
		parts.some((p) => p === '' || p === '.' || p === '..')
	) {
		errors.jar = 'Use a relative .jar path inside the server directory, e.g. server.jar.';
	}
	Object.assign(errors, validateResources(v));
	return errors;
}

/**
 * Builds the `POST /api/v1/servers` body. A blank port is omitted (automatic assignment). With `software`, `jar` is omitted and
 * `dockerImage` is only sent when explicitly overridden (which disables automatic Java).
 */
export function toCreateRequest(
	v: ServerFormValues,
	software: ServerSoftware | null = null
): CreateServerRequest {
	const base: CreateServerRequest = {
		name: v.name.trim(),
		runtime: 'docker',
		// Blank port is omitted so the backend assigns one; an explicit port is sent as-is.
		...(v.port != null ? { port: v.port } : {}),
		memoryMinMb: v.memoryMinMb ?? 0,
		memoryMaxMb: v.memoryMaxMb ?? 0,
		cpus: v.cpus ?? 0,
		acceptEula: v.acceptEula
	};
	if (!software) return { ...base, dockerImage: v.dockerImage.trim(), jar: v.jar.trim() };
	const image = v.dockerImage.trim();
	return image ? { ...base, dockerImage: image, software } : { ...base, software };
}
