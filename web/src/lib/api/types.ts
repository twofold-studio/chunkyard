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
	/** Owner-saved launch profile replacing detection; `null`/absent uses the detected launch. */
	launchOverride?: LaunchProfile | null;
	/**
	 * Chunkyard display icon (custom upload first, then the CurseForge pack logo), or `null`
	 * when none applies. Absent on backends that predate display icons. Never the Minecraft
	 * `server-icon.png`.
	 */
	icon?: ServerIconRef | null;
	/**
	 * Set while the local instance files were removed and only the pinned full S3 backup
	 * remains. `null`/absent means local (older backends omit it). Archived records stay in
	 * `GET /servers` with a stopped status; local operations refuse with `server.archived`.
	 */
	archive?: ServerArchive | null;
}

/** Restore point of an archived server: the pinned full S3 export and when files were removed. */
export interface ServerArchive {
	exportId: string;
	archivedAt: string;
}

/** Same-origin display icon reference; `url` changes after a custom icon update. */
export interface ServerIconRef {
	url: string;
	source: 'custom' | 'modpack';
}

export interface ServerLaunch {
	path: string;
	version: string;
	build: string | null;
	javaMajor: number;
	/** SHA-256 of the downloaded artifact (the server-pack ZIP for CurseForge). */
	checksum: string;
	/** How the installed target is launched; absent on older records. */
	profile?: { mode: LaunchMode; jvmArgs: string[]; args: string[] } | null;
	/** Mod loader detected or installed for this server; absent when none. */
	loader?: { type: string; version: string } | null;
}

/**
 * - `jar`: Java `-jar <path>`.
 * - `args`: Java `@<path>` argument file (modern Forge/NeoForge `unix_args.txt`).
 * - `script`: `/bin/bash <path>` inside the game container.
 */
export type LaunchMode = 'jar' | 'args' | 'script';

/** Launch target. `path` is relative to the instance directory; arguments are separate values. */
export interface LaunchProfile {
	mode: LaunchMode;
	path: string;
	javaMajor: number;
	jvmArgs: string[];
	args: string[];
}

/** `GET /api/v1/servers/{id}/launch`. */
export interface LaunchSettings {
	detected: LaunchProfile;
	current: LaunchProfile;
	overridden: boolean;
	dockerImage: string;
	autoJava: boolean;
}

/**
 * `PATCH /api/v1/servers/{id}/launch`. A `null` profile resets detection; a `null` image
 * restores automatic Temurin selection; an omitted image preserves the current policy.
 */
export interface UpdateLaunchRequest {
	profile: LaunchProfile | null;
	dockerImage?: string | null;
}

export type ModLoader = 'forge' | 'neoforge' | 'fabric';

/** Optional body of `POST /api/v1/servers/{id}/install`; every field is an override. */
export interface InstallOptions {
	minecraftVersion?: string;
	loader?: ModLoader;
	loaderVersion?: string;
	javaMajor?: number;
	launch?: LaunchProfile;
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

/**
 * A CurseForge modpack from search or `GET /api/v1/modpacks/curseforge/{projectId}`.
 * `logoUrl` is a same-origin `/api/v1/modpacks/curseforge/{id}/logo` URL on current backends.
 */
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
	/** Engine totals; `null` when the engine is unavailable. Absent on older backends. */
	capacity?: DockerCapacity | null;
}

/**
 * Totals visible to the Docker engine that runs game containers (including Docker Desktop VM
 * limits). Not free memory, reservations or the manager container's own allowance.
 */
export interface DockerCapacity {
	logicalCpus: number | null;
	memoryTotalBytes: number | null;
	architecture: string | null;
	operatingSystem: string | null;
}

export interface Isolation {
	docker: DockerInfo;
}

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobFailure {
	code: string;
	detail: string;
}

/**
 * Stages a job can report. Install: resolve → download → verify → extract → prepare_loader →
 * finalize. Export: scan → compress → upload → verify_upload → finalize. Restore: fetch_archive →
 * verify_archive → restore → finalize. Remove local files: fetch_archive → verify_archive → finalize.
 */
export type JobWorkStage =
	| 'resolve'
	| 'download'
	| 'verify'
	| 'extract'
	| 'prepare_loader'
	| 'finalize'
	| 'scan'
	| 'compress'
	| 'upload'
	| 'verify_upload'
	| 'fetch_archive'
	| 'verify_archive'
	| 'restore';

/**
 * Last observed work of a job. Byte counts belong to the current stage only; `totalBytes` is
 * `null` when the size is unknown (compression never has one). `completedStages` holds observed
 * earlier transitions (last 32, may repeat) and never includes skipped steps.
 */
export interface JobWork {
	stage: JobWorkStage;
	completedBytes: number | null;
	totalBytes: number | null;
	completedStages: JobWorkStage[];
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
	/** Stage/byte observations; omitted or `null` from older builds and jobs. Validate before use. */
	work?: JobWork | null;
}

/** `GET /api/v1/jobs`: newest first; pass `nextCursor` back as `cursor` for older jobs. */
export interface JobPage {
	items: Job[];
	nextCursor: string | null;
}

/** `GET /api/v1/auth/api-keys` item. The full token is never listed. */
export interface ApiKey {
	id: string;
	name: string;
	/** Leading characters of the token, for recognising it (e.g. `cyk_ab12`). */
	prefix: string;
	createdAt: string;
	lastUsedAt: string | null;
}

/** `POST /api/v1/auth/api-keys` (201): the only response that contains the full `token`. */
export interface CreatedApiKey {
	key: ApiKey;
	token: string;
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

/** `PATCH /api/v1/servers/{id}/resources` (stopped only). Applies on the next start. */
export interface UpdateResourcesRequest {
	memoryMinMb: number;
	memoryMaxMb: number;
	cpus: number;
}

// Properties -------------------------------------------------------------------

/**
 * `GET|PUT /api/v1/servers/{id}/properties`: the latest saved (desired)
 * server.properties. Saved versions apply on the next explicit start/restart.
 */
export interface PropertiesDocument {
	content: string;
	etag: string;
	/** Latest saved version. */
	version: number;
	/** Version the running/last started game uses; `null` when unknown (legacy container). */
	appliedVersion: number | null;
	/** A newer version is saved than the running game uses. */
	restartRequired: boolean;
	status: RuntimeStatus;
	updatedAt: string;
}

export type PropertiesVersionSource = 'import' | 'edit' | 'restore';

export interface PropertiesVersionSummary {
	version: number;
	etag: string;
	createdAt: string;
	source: PropertiesVersionSource;
}

/** `GET /api/v1/servers/{id}/properties/versions` (newest first). */
export interface PropertiesVersionPage {
	items: PropertiesVersionSummary[];
	nextBefore: number | null;
}

/** `GET /api/v1/servers/{id}/properties/versions/{version}` */
export interface PropertiesVersion extends PropertiesVersionSummary {
	content: string;
}

// Storage & exports ------------------------------------------------------------

/**
 * `GET|PUT /api/v1/storage`: the redacted S3 connection. Empty strings when unconfigured.
 * The secret is never returned; `hasSecret` reports whether one is stored.
 */
export interface StorageConnection {
	configured: boolean;
	endpoint: string;
	region: string;
	bucket: string;
	prefix: string;
	accessKeyId: string;
	hasSecret: boolean;
}

/**
 * `PUT /api/v1/storage`. Omit `secretAccessKey` (or send it empty) to keep the stored secret;
 * only allowed while `endpoint` and `accessKeyId` are unchanged.
 */
export interface UpdateStorageRequest {
	endpoint: string;
	region: string;
	bucket: string;
	prefix: string;
	accessKeyId: string;
	secretAccessKey?: string;
}

export type ExportScope = 'world' | 'selected' | 'all';
export type ExportDestination = 'local' | 's3';

/** `POST /api/v1/servers/{id}/exports` (202, `{job}`). `paths` only with `scope: "selected"`. */
export interface CreateExportRequest {
	scope: ExportScope;
	paths?: string[];
	destination: ExportDestination;
}

/**
 * A completed, SHA-256 verified `.tar.gz` archive. Records outlive their server, so
 * `serverName` is the name at export time and `serverId` may no longer exist.
 */
export interface ExportRecord {
	id: string;
	serverId: string;
	serverName: string;
	scope: ExportScope;
	destination: ExportDestination;
	createdAt: string;
	size: number;
	sha256: string;
	fileName: string;
	/** Object key in the bucket for S3 exports; `null` for local archives. */
	objectKey: string | null;
}
