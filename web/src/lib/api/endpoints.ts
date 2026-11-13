import { request, type Fetch } from './client';
import type {
	AvailableJava,
	ConsoleLine,
	CreateServerRequest,
	Isolation,
	Items,
	JavaRuntime,
	Job,
	LoginResponse,
	Me,
	ServerAction,
	ServerView,
	SessionMe,
	SetupStatus
} from './types';

interface Opts {
	signal?: AbortSignal;
	fetch?: Fetch;
}

const enc = encodeURIComponent;

// Auth -----------------------------------------------------------------------

export const getSetupStatus = (o: Opts = {}) => request<SetupStatus>('/api/v1/setup/status', o);

export const getMe = (o: Opts = {}) => request<Me>('/api/v1/auth/me', o);

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

export const getIsolation = (o: Opts = {}) => request<Isolation>('/api/v1/system/isolation', o);

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
