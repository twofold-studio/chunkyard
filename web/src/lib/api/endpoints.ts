import { request, type Fetch } from './client';
import type {
	AvailableJava,
	Changelog,
	CreateExportRequest,
	ExportRecord,
	StorageConnection,
	UpdateStorageRequest,
	BuildSoftwareKind,
	ConsoleLine,
	CreateServerRequest,
	CurseForgeFile,
	CurseForgeSearch,
	DirectoryListing,
	FileContent,
	FileEntry,
	PropertiesDocument,
	PropertiesVersion,
	PropertiesVersionPage,
	InstallOptions,
	Isolation,
	LaunchSettings,
	SavedFile,
	ServerNetwork,
	UpdateLaunchRequest,
	UpdateNetworkRequest,
	UpdateResourcesRequest,
	Items,
	JavaRuntime,
	Job,
	JobPage,
	LoginResponse,
	Me,
	ServerAction,
	ServerMetrics,
	ServerView,
	SessionMe,
	SetupStatus,
	SoftwareCatalogItem,
	SoftwareVersion,
	VersionedSoftwareKind,
	VersionInfo
} from './types';

interface Opts {
	signal?: AbortSignal;
	fetch?: Fetch;
}

const enc = encodeURIComponent;

// Auth -----------------------------------------------------------------------

export const getSetupStatus = (o: Opts = {}) => request<SetupStatus>('/api/v1/setup/status', o);

export const getMe = (o: Opts = {}) => request<Me>('/api/v1/auth/me', o);

/** Checks the first-run setup token without consuming it or creating an account (204). */
export const verifySetupToken = (body: { setupToken: string }, o: Opts = {}) =>
	request<void>('/api/v1/setup/verify-token', { ...o, method: 'POST', body });

export const setupOwner = (
	body: { setupToken: string; email: string; password: string },
	o: Opts = {}
) => request<SessionMe>('/api/v1/setup', { ...o, method: 'POST', body });

export const login = (body: { email: string; password: string }, o: Opts = {}) =>
	request<LoginResponse>('/api/v1/auth/login', { ...o, method: 'POST', body });

export const logout = (o: Opts = {}) =>
	request<void>('/api/v1/auth/logout', { ...o, method: 'POST' });

// Servers --------------------------------------------------------------------

export const listServers = (o: Opts = {}) => request<Items<ServerView>>('/api/v1/servers', o);

export const getServer = (id: string, o: Opts = {}) =>
	request<ServerView>(`/api/v1/servers/${enc(id)}`, o);

export const createServer = (body: CreateServerRequest, o: Opts = {}) =>
	request<{ server: ServerView }>('/api/v1/servers', { ...o, method: 'POST', body });

/**
 * Installs the persisted software selection (202); never starts the server. Without
 * `options` (or with an empty object) no request body is sent and everything is detected.
 */
export const installServer = (
	id: string,
	{ options, ...o }: Opts & { options?: InstallOptions | null } = {}
) =>
	request<{ job: Job }>(`/api/v1/servers/${enc(id)}/install`, {
		...o,
		method: 'POST',
		...(options && Object.keys(options).length > 0 ? { body: options } : {})
	});

/**
 * `DELETE /api/v1/servers/{id}?deleteFiles=…` (202, job kind `server.delete`). Only stopped
 * servers with no running operation; never force-stops. `deleteFiles` defaults to false, which
 * keeps the managed directory (worlds, config, logs) on the manager host.
 */
export const deleteServer = (id: string, deleteFiles = false, o: Opts = {}) =>
	request<{ job: Job }>(
		`/api/v1/servers/${enc(id)}?deleteFiles=${deleteFiles ? 'true' : 'false'}`,
		{
			...o,
			method: 'DELETE'
		}
	);

export const setEula = (id: string, accepted: boolean, o: Opts = {}) =>
	request<{ server: ServerView }>(`/api/v1/servers/${enc(id)}/eula`, {
		...o,
		method: 'POST',
		body: { accepted }
	});

export const serverAction = (id: string, action: ServerAction, o: Opts = {}) =>
	request<{ job: Job }>(`/api/v1/servers/${enc(id)}/${action}`, { ...o, method: 'POST' });

export const getConsole = (id: string, tail = 200, o: Opts = {}) =>
	request<Items<ConsoleLine>>(`/api/v1/servers/${enc(id)}/console?tail=${tail}`, o);

export const sendCommand = (id: string, line: string, o: Opts = {}) =>
	request<void>(`/api/v1/servers/${enc(id)}/console/commands`, {
		...o,
		method: 'POST',
		body: { line }
	});

export const getServerMetrics = (id: string, o: Opts = {}) =>
	request<ServerMetrics>(`/api/v1/servers/${enc(id)}/metrics`, o);

export const getIsolation = (o: Opts = {}) => request<Isolation>('/api/v1/system/isolation', o);

// Software catalog & modpacks ----------------------------------------------------

export const listSoftware = (o: Opts = {}) =>
	request<Items<SoftwareCatalogItem>>('/api/v1/software', o);

export const listSoftwareVersions = (kind: VersionedSoftwareKind, o: Opts = {}) =>
	request<Items<SoftwareVersion>>(`/api/v1/software/${enc(kind)}/versions`, o);

export const listSoftwareBuilds = (kind: BuildSoftwareKind, version: string, o: Opts = {}) =>
	request<Items<SoftwareVersion>>(
		`/api/v1/software/${enc(kind)}/versions/${enc(version)}/builds`,
		o
	);

export const searchCurseForgeModpacks = (query: string, index = 0, o: Opts = {}) => {
	const params = new URLSearchParams({ query, index: String(index) });
	return request<CurseForgeSearch>(`/api/v1/modpacks/curseforge?${params}`, o);
};

export const listCurseForgeFiles = (projectId: number, o: Opts = {}) =>
	request<Items<CurseForgeFile>>(`/api/v1/modpacks/curseforge/${enc(String(projectId))}/files`, o);

// Public build information (no session required) ------------------------------

export const getVersion = (o: Opts = {}) => request<VersionInfo>('/api/v1/system/version', o);

export const getChangelog = (o: Opts = {}) => request<Changelog>('/api/v1/system/changelog', o);

// Java & jobs ----------------------------------------------------------------

export const listJavaRuntimes = (o: Opts = {}) =>
	request<Items<JavaRuntime>>('/api/v1/java/runtimes', o);

export const discoverJavaRuntimes = (o: Opts = {}) =>
	request<Items<JavaRuntime>>('/api/v1/java/runtimes/discover', { ...o, method: 'POST' });

export const getAvailableJava = (o: Opts = {}) =>
	request<AvailableJava>('/api/v1/java/available', o);

export const installJava = (major: number, o: Opts = {}) =>
	request<{ job: Job }>('/api/v1/java/runtimes/install', {
		...o,
		method: 'POST',
		body: { major }
	});

/** Server-side filters for `GET /api/v1/jobs`; keep them identical across cursor pages. */
export interface JobListFilter {
	/** Only jobs recorded for this server (the record may since have been deleted). */
	serverId?: string;
	/** Only `queued`/`running` jobs. */
	activeOnly?: boolean;
}

/** Newest first; `limit` 1–200 (backend default 50). Filters apply before paging. */
export const listJobs = ({
	limit,
	cursor,
	serverId,
	activeOnly,
	...o
}: Opts & JobListFilter & { limit?: number; cursor?: string | null } = {}) => {
	const params = new URLSearchParams();
	if (limit !== undefined) params.set('limit', String(limit));
	if (cursor) params.set('cursor', cursor);
	if (serverId) params.set('serverId', serverId);
	if (activeOnly) params.set('activeOnly', 'true');
	const query = params.toString();
	return request<JobPage>(`/api/v1/jobs${query ? `?${query}` : ''}`, o);
};

export const getJob = (id: string, o: Opts = {}) => request<Job>(`/api/v1/jobs/${enc(id)}`, o);

// Server files -------------------------------------------------------------------
// Paths are server-relative POSIX strings. Mutations require a stopped server.

const filesUrl = (id: string, suffix = '', params: Record<string, string> = {}) => {
	const query = new URLSearchParams(params).toString();
	return `/api/v1/servers/${enc(id)}/files${suffix}${query ? `?${query}` : ''}`;
};

export const listFiles = (id: string, path: string, o: Opts = {}) =>
	request<DirectoryListing>(filesUrl(id, '', { path }), o);

export const readFile = (id: string, path: string, o: Opts = {}) =>
	request<FileContent>(filesUrl(id, '/content', { path }), o);

/**
 * Saves UTF-8 text. `etag` must match the last read (409 `files.conflict` otherwise);
 * `null` only creates a file that does not exist yet.
 */
export const writeFile = (
	id: string,
	path: string,
	body: { content: string; etag: string | null },
	o: Opts = {}
) => request<SavedFile>(filesUrl(id, '/content', { path }), { ...o, method: 'PUT', body });

/** Same-origin attachment URL for a single regular file; use with `<a download>`. */
export const fileDownloadUrl = (id: string, path: string) => filesUrl(id, '/download', { path });

/** Raw binary upload (201). Existing targets fail with 409 `files.exists` unless `overwrite`. */
export const uploadFile = (id: string, path: string, file: Blob, overwrite = false, o: Opts = {}) =>
	request<{ entry: FileEntry }>(
		filesUrl(id, '/upload', { path, overwrite: overwrite ? 'true' : 'false' }),
		{ ...o, method: 'POST', rawBody: file }
	);

export const makeDirectory = (id: string, path: string, o: Opts = {}) =>
	request<{ entry: FileEntry }>(filesUrl(id, '/mkdir'), { ...o, method: 'POST', body: { path } });

/** Moves or renames; never overwrites an existing destination. */
export const moveFile = (id: string, from: string, to: string, o: Opts = {}) =>
	request<{ entry: FileEntry }>(filesUrl(id, '/move'), {
		...o,
		method: 'POST',
		body: { from, to }
	});

/** Copies a file or directory; never overwrites an existing destination. */
export const copyFile = (id: string, from: string, to: string, o: Opts = {}) =>
	request<{ entry: FileEntry }>(filesUrl(id, '/copy'), {
		...o,
		method: 'POST',
		body: { from, to }
	});

/** Permanent deletion (204). Non-empty directories need `recursive`. */
export const deleteFile = (id: string, path: string, recursive: boolean, o: Opts = {}) =>
	request<void>(filesUrl(id, '/delete'), { ...o, method: 'POST', body: { path, recursive } });

// Server network -----------------------------------------------------------------

export const getServerNetwork = (id: string, o: Opts = {}) =>
	request<ServerNetwork>(`/api/v1/servers/${enc(id)}/network`, o);

/** Stopped servers only. A `null` bind address restores the manager default. */
export const updateServerNetwork = (id: string, body: UpdateNetworkRequest, o: Opts = {}) =>
	request<{ server: ServerView }>(`/api/v1/servers/${enc(id)}/network`, {
		...o,
		method: 'PATCH',
		body
	});

/**
 * Stopped servers only. Replaces the owned stopped container so the next start uses the new
 * heap bounds and CPU limit. Same limits as creation.
 */
export const updateServerResources = (id: string, body: UpdateResourcesRequest, o: Opts = {}) =>
	request<{ server: ServerView }>(`/api/v1/servers/${enc(id)}/resources`, {
		...o,
		method: 'PATCH',
		body
	});

/** Detected and effective launch profile plus the image policy. */
export const getServerLaunch = (id: string, o: Opts = {}) =>
	request<LaunchSettings>(`/api/v1/servers/${enc(id)}/launch`, o);

/**
 * Stopped servers only. Removes the owned stopped container (files are kept); the new
 * launch applies on the next start, which also validates the target.
 */
export const updateServerLaunch = (id: string, body: UpdateLaunchRequest, o: Opts = {}) =>
	request<{ server: ServerView }>(`/api/v1/servers/${enc(id)}/launch`, {
		...o,
		method: 'PATCH',
		body
	});

// Server properties (desired versions) --------------------------------------------
// Editable while the server runs; saved versions apply on the next explicit start/restart.

const propertiesUrl = (id: string, suffix = '') => `/api/v1/servers/${enc(id)}/properties${suffix}`;

export const getProperties = (id: string, o: Opts = {}) =>
	request<PropertiesDocument>(propertiesUrl(id), o);

/** Saves a new version; `etag` must match the latest (409 `properties.conflict`). */
export const saveProperties = (id: string, body: { content: string; etag: string }, o: Opts = {}) =>
	request<PropertiesDocument>(propertiesUrl(id), { ...o, method: 'PUT', body });

export const listPropertiesVersions = (
	id: string,
	params: { limit?: number; before?: number | null } = {},
	o: Opts = {}
) => {
	const query = new URLSearchParams();
	if (params.limit) query.set('limit', String(params.limit));
	if (params.before != null) query.set('before', String(params.before));
	const suffix = query.size ? `/versions?${query}` : '/versions';
	return request<PropertiesVersionPage>(propertiesUrl(id, suffix), o);
};

export const getPropertiesVersion = (id: string, version: number, o: Opts = {}) =>
	request<PropertiesVersion>(propertiesUrl(id, `/versions/${version}`), o);

/** Copies `version` into a new latest version. Never restarts the server. */
export const restoreProperties = (
	id: string,
	body: { version: number; etag: string },
	o: Opts = {}
) => request<PropertiesDocument>(propertiesUrl(id, '/restore'), { ...o, method: 'POST', body });

// Storage & exports ---------------------------------------------------------------
// Archives are independent of server records and stay listed after a server is deleted.

export const getStorage = (o: Opts = {}) => request<StorageConnection>('/api/v1/storage', o);

/** Saves the S3 connection; omit/empty `secretAccessKey` keeps the stored secret. */
export const updateStorage = (body: UpdateStorageRequest, o: Opts = {}) =>
	request<StorageConnection>('/api/v1/storage', { ...o, method: 'PUT', body });

/** Writes, verifies and removes a disposable object using the saved connection. */
export const testStorage = (o: Opts = {}) =>
	request<{ ok: true }>('/api/v1/storage/test', { ...o, method: 'POST' });

/** Newest first, including archives of deleted servers. */
export const listExports = (o: Opts = {}) => request<Items<ExportRecord>>('/api/v1/exports', o);

/** Stopped servers only (202). The job's successful `result` is an {@link ExportRecord}. */
export const createExport = (serverId: string, body: CreateExportRequest, o: Opts = {}) =>
	request<{ job: Job }>(`/api/v1/servers/${enc(serverId)}/exports`, {
		...o,
		method: 'POST',
		body
	});

/** Same-origin attachment URL, streamed through the backend for local and S3 archives. */
export const exportDownloadUrl = (id: string) => `/api/v1/exports/${enc(id)}/download`;

/** Removes the archive and its catalog record (204). Never touches the server. */
export const deleteExport = (id: string, o: Opts = {}) =>
	request<void>(`/api/v1/exports/${enc(id)}`, { ...o, method: 'DELETE' });
