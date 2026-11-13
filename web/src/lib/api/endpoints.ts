import { request, type Fetch } from './client';
import type {
	AvailableJava,
	Changelog,
	BuildSoftwareKind,
	ConsoleLine,
	CreateServerRequest,
	CurseForgeFile,
	CurseForgeSearch,
	Isolation,
	Items,
	JavaRuntime,
	Job,
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

/** Installs the persisted software selection (202). No request body; never starts the server. */
export const installServer = (id: string, o: Opts = {}) =>
	request<{ job: Job }>(`/api/v1/servers/${enc(id)}/install`, { ...o, method: 'POST' });

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

export const getJob = (id: string, o: Opts = {}) => request<Job>(`/api/v1/jobs/${enc(id)}`, o);
