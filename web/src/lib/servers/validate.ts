import type { CreateServerRequest } from '#lib/api/index.js';

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

/**
 * Mirrors crates/mcm-process/src/validation.rs so most mistakes are caught before
 * a request is sent. The backend remains authoritative.
 */
export function validateServerForm(v: ServerFormValues): ServerFormErrors {
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
	if (!image || image.length > 255 || image.startsWith('-') || !IMAGE_RE.test(image)) {
		errors.dockerImage = 'Enter a valid image reference, e.g. eclipse-temurin:21-jre.';
	}
	const jar = v.jar.trim();
	const parts = jar.split('/');
	if (
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

export function toCreateRequest(v: ServerFormValues): CreateServerRequest {
	return {
		name: v.name.trim(),
		runtime: 'docker',
		port: v.port ?? 0,
		dockerImage: v.dockerImage.trim(),
		jar: v.jar.trim(),
		memoryMinMb: v.memoryMinMb ?? 0,
		memoryMaxMb: v.memoryMaxMb ?? 0,
		cpus: v.cpus ?? 0,
		acceptEula: v.acceptEula
	};
}
