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

/** `GET /api/v1/auth/me` when the backend runs with `CHUNKYARD_AUTH__ENABLED=false`. */
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
	/**
	 * Managed software the server was created with, or `null` for a manual JAR server.
	 * Optional so records from older backends still type-check.
	 */
	software?: ServerSoftware | null;
	/**
	 * Resolved launch details written by a successful install.
	 * `software != null && launch == null` means the server is not installed and cannot start.
	 */
	launch?: ServerLaunch | null;
	/** The Docker image was chosen automatically to match the required Java. */
	autoJava?: boolean;
}

export interface ServerLaunch {
	path: string;
	version: string;
	build: string | null;
	javaMajor: number;
	checksum: string;
}

/** Software kinds listed by `GET /api/v1/software`. */
export type SoftwareKind = 'vanilla' | 'paper' | 'fabric' | 'forge' | 'curseforge' | 'custom';

/** Kinds that expose `GET /api/v1/software/{kind}/versions`. */
export type VersionedSoftwareKind = 'vanilla' | 'paper' | 'fabric' | 'forge';

/** Kinds with `GET /api/v1/software/{kind}/versions/{version}/builds`. */
export type BuildSoftwareKind = 'paper' | 'fabric' | 'forge';

/** Kinds that require a loader build (`loaderVersion`). */
export type LoaderSoftwareKind = 'fabric' | 'forge';

export interface SoftwareCatalogItem {
	id: SoftwareKind;
	name: string;
	available: boolean;
	/** Why the kind is unavailable (e.g. no CurseForge API key on the backend). */
	reason: string | null;
}

export interface SoftwareVersion {
	id: string;
	stable: boolean;
}

/** `software` in `POST /api/v1/servers`; omitted for custom/manual JAR servers. */
export type ServerSoftware =
	| { type: 'vanilla'; version: string }
	/** `build` omitted/null selects the latest stable Paper build at install time. */
	| { type: 'paper'; version: string; build?: string | null }
	| { type: LoaderSoftwareKind; version: string; loaderVersion: string }
	| { type: 'curseforge'; projectId: number; fileId: number };

export interface CurseForgeModpack {
	id: number;
	name: string;
	summary: string;
	websiteUrl: string | null;
	logoUrl: string | null;
	downloads: number;
}

export interface CurseForgePagination {
	index: number;
	pageSize: number;
	totalCount: number;
}

export interface CurseForgeSearch {
	items: CurseForgeModpack[];
	pagination: CurseForgePagination;
}

/** An installable modpack release; only releases with a server pack are listed. */
export interface CurseForgeFile {
	id: number;
	name: string;
	gameVersions: string[];
	serverPackFileId: number;
}

export interface CreateServerRequest {
	name: string;
	runtime?: 'docker';
	/**
	 * Host game port. Omit (or `null`) to let the backend assign the first managed port from
	 * 25565 upwards that no other server uses. An explicit port may be shared with other
	 * servers; only one of them can run at a time (start/restart fails with
	 * `server.port_in_use`). The response's `server.port` is the port actually assigned.
	 */
	port?: number | null;
	jar?: string;
	dockerImage?: string;
	memoryMinMb?: number;
	memoryMaxMb?: number;
	cpus?: number;
	acceptEula?: boolean;
	/** Managed install; the backend picks a matching Java image unless `dockerImage` is set. */
	software?: ServerSoftware;
}

/** `result.deleted` of a succeeded `server.delete` job. */
export interface DeletedServer {
	id: string;
	filesDeleted: boolean;
	/** Managed directory left on the manager host when files were kept; `null` when deleted. */
	retainedDirectory: string | null;
}

/**
 * `GET /api/v1/servers/{id}/metrics`: one on-demand Docker stats sample.
 * Resource fields are `null` when the container is stopped/paused or the value is unknown.
 */
export interface ServerMetrics {
	serverId: string;
	status: RuntimeStatus;
	/** RFC 3339 time the sample was taken. */
	sampledAt: string;
	startedAt: string | null;
	uptimeSeconds: number | null;
	/** Relative to one logical core, so it can exceed 100. */
	cpuPercent: number | null;
	memoryUsageBytes: number | null;
	/** Usage minus inactive file cache when available; not the JVM heap. */
	memoryWorkingSetBytes: number | null;
	memoryLimitBytes: number | null;
	/** Cumulative counters since container start, not rates. */
	networkRxBytes: number | null;
	networkTxBytes: number | null;
	/** Cumulative block I/O, not disk usage. */
	blockReadBytes: number | null;
	blockWriteBytes: number | null;
	pids: number | null;
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

/**
 * `GET /api/v1/system/version` (public). Disabled with `CHUNKYARD_HTTP__SHOW_VERSION=false`,
 * in which case every field except `enabled` is `null`.
 */
export type VersionInfo =
	| { enabled: true; version: string; channel: string | null }
	| { enabled: false; version: null; channel: null };

/** `GET /api/v1/system/changelog` (public): the generated CHANGELOG.md. 404 `version.disabled` when off. */
export interface Changelog {
	version: string;
	markdown: string;
}

// Files ------------------------------------------------------------------------

/** Kind of a directory entry. Symlinks are listed but never followed. */
export type FileKind = 'file' | 'directory' | 'symlink' | 'other';

export interface FileEntry {
	name: string;
	/** Server-relative POSIX path, e.g. `world/level.dat`. */
	path: string;
	kind: FileKind;
	size: number;
	/** RFC 3339 modification time, when known. */
	modifiedAt: string | null;
	/** Protected manager artifact or root `eula.txt`. */
	readOnly: boolean;
}

/** `GET /api/v1/servers/{id}/files?path=` */
export interface DirectoryListing {
	path: string;
	/** Directories first; at most 5000 entries. */
	entries: FileEntry[];
	truncated: boolean;
	/** False while the server runs or Docker is unavailable. */
	canWrite: boolean;
}

/** `GET /api/v1/servers/{id}/files/content?path=` (UTF-8 only, at most 1 MiB). */
export interface FileContent {
	path: string;
	content: string;
	/** SHA-256 of the content; send it back on save to detect concurrent edits. */
	etag: string;
	size: number;
	readOnly: boolean;
	canWrite: boolean;
}

/** `PUT /api/v1/servers/{id}/files/content?path=` */
export interface SavedFile {
	path: string;
	etag: string;
	size: number;
}

// Network ----------------------------------------------------------------------

/** `GET /api/v1/servers/{id}/network` */
export interface ServerNetwork {
	port: number;
	/** Per-server bind address; `null` uses the manager default. */
	publishIp: string | null;
	/** Address the next container will bind to. */
	effectivePublishIp: string;
	/** Address and port of the current container, `null` when none exists. */
	boundPublishIp: string | null;
	boundPort: number | null;
	/** The running container still uses an older binding. */
	restartRequired: boolean;
	status: RuntimeStatus;
}

export interface UpdateNetworkRequest {
	port: number;
	/** `null` restores the manager default bind address. */
	publishIp: string | null;
}
