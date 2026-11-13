import type { CreateServerRequest, ServerSoftware } from '#lib/api/index.js';

/** Raw form values; numeric inputs bound with `type="number"` may be null when empty. */
export interface ServerFormValues {
	name: string;
	port: number | null;
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
		port: 25565,
		dockerImage: DEFAULT_DOCKER_IMAGE,
		jar: 'server.jar',
		memoryMinMb: 512,
		memoryMaxMb: 2048,
		cpus: 2,
		acceptEula: false
	};
}

const IMAGE_RE = /^[A-Za-z0-9/_.:@-]+$/;

function isInt(value: number | null): value is number {
	return value !== null && Number.isInteger(value);
}

export interface ValidateOptions {
	/**
	 * Managed install: the backend writes the server JAR and picks a Java image, so
	 * `jar` is ignored and an empty `dockerImage` means "automatic".
	 */
	managed?: boolean;
}

/**
 * Mirrors crates/mcm-process/src/validation.rs so most mistakes are caught before
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
	if (!isInt(v.port) || v.port < 1 || v.port > 65535) {
		errors.port = 'Enter a port between 1 and 65535.';
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
	if (!isInt(v.memoryMinMb) || v.memoryMinMb < 128) {
		errors.memoryMinMb = 'Minimum heap must be at least 128 MiB.';
	}
	if (!isInt(v.memoryMaxMb) || v.memoryMaxMb > 262144) {
		errors.memoryMaxMb = 'Maximum heap must be at most 262144 MiB.';
	} else if (isInt(v.memoryMinMb) && v.memoryMaxMb < v.memoryMinMb) {
		errors.memoryMaxMb = 'Maximum heap must be at least the minimum heap.';
	}
	if (v.cpus === null || !Number.isFinite(v.cpus) || v.cpus < 0.1 || v.cpus > 256) {
		errors.cpus = 'Enter between 0.1 and 256 CPUs.';
	}
	return errors;
}

/**
 * Builds the `POST /api/v1/servers` body. With `software`, `jar` is omitted and
 * `dockerImage` is only sent when explicitly overridden (which disables automatic Java).
 */
export function toCreateRequest(
	v: ServerFormValues,
	software: ServerSoftware | null = null
): CreateServerRequest {
	const base: CreateServerRequest = {
		name: v.name.trim(),
		runtime: 'docker',
		port: v.port ?? 0,
		memoryMinMb: v.memoryMinMb ?? 0,
		memoryMaxMb: v.memoryMaxMb ?? 0,
		cpus: v.cpus ?? 0,
		acceptEula: v.acceptEula
	};
	if (!software) return { ...base, dockerImage: v.dockerImage.trim(), jar: v.jar.trim() };
	const image = v.dockerImage.trim();
	return image ? { ...base, dockerImage: image, software } : { ...base, software };
}
