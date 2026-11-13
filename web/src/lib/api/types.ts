/**
 * Wire types mirroring the Rust DTOs in crates/mcm-core and crates/mcm-api.
 * Keep these in sync with docs/http-api.md and docs/docker.md.
 */

export interface SetupStatus {
	required: boolean;
	authEnabled: boolean;
}

export interface User {
	id: string;
	email: string;
	role: string;
	createdAt: string;
}

/** `GET /api/v1/auth/me` when a session cookie authenticated the request. */
export interface SessionMe {
	authEnabled: true;
	user: User;
	principal: { kind: 'session' };
	isAdmin: boolean;
}

/** `GET /api/v1/auth/me` when the backend runs with `MCM_AUTH__ENABLED=false`. */
export interface AuthDisabledMe {
	authEnabled: false;
	user: null;
	principal: { kind: 'auth_disabled' };
	isAdmin: boolean;
}

export type Me = SessionMe | AuthDisabledMe;

export interface LoginResponse {
	kind: 'session';
	me: SessionMe;
}

export type ServerState = 'stopped' | 'running' | 'paused' | 'unknown';

export interface RuntimeStatus {
	state: ServerState;
	containerId: string | null;
	exitCode: number | null;
	oomKilled: boolean;
}

export interface ServerView {
	id: string;
	name: string;
	runtime: string;
	jar: string;
	dockerImage: string;
	port: number;
	memoryMinMb: number;
	memoryMaxMb: number;
	cpus: number;
	acceptEula: boolean;
	/** Managed directory on the manager host; the server JAR must be copied here. */
	directory: string;
	status: RuntimeStatus;
}

export interface CreateServerRequest {
	name: string;
	runtime?: 'docker';
	port: number;
	jar?: string;
	dockerImage?: string;
	memoryMinMb?: number;
	memoryMaxMb?: number;
	cpus?: number;
	acceptEula?: boolean;
}

export interface ConsoleLine {
	stream: string;
	text: string;
}

export interface DockerInfo {
	available: boolean;
	version: string | null;
	reason: string | null;
}

export interface Isolation {
	docker: DockerInfo;
}

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobFailure {
	code: string;
	detail: string;
}

export interface Job {
	id: string;
	kind: string;
	serverId: string | null;
	state: JobState;
	/** `null` while work is in progress (indeterminate), `1` on success. */
	progress: number | null;
	message: string | null;
	error: JobFailure | null;
	result: unknown;
	createdBy: string | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}

export interface JavaRuntime {
	id: string;
	vendor: string;
	major: number;
	fullVersion: string;
	os: string;
	arch: string;
	path: string;
	managed: boolean;
	sha256: string | null;
}

export interface AvailableJava {
	lts: number[];
	all: number[];
	mostRecentLts: number;
}

export interface Items<T> {
	items: T[];
}

export type ServerAction = 'start' | 'stop' | 'restart' | 'kill';
