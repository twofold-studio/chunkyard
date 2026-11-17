import * as sdk from './generated/sdk.gen';
import { sdkOptions, type Fetch } from './client';
import type {
	CreateServerRequest,
	InstallOptions,
	ServerAction,
	UpdateNetworkRequest,
	UpdateResourcesRequest,
	UpdateLaunchRequest,
	VersionedSoftwareKind,
	BuildSoftwareKind,
	PlayerChange,
	RecoveryPolicy,
	BackupScheduleRequest,
	UpdateStorageRequest,
	CreateExportRequest
} from './types';

interface Opts {
	signal?: AbortSignal;
	fetch?: Fetch;
}
const path = (id: string) => ({ id });
const enc = encodeURIComponent;

async function noContent(response: Promise<unknown>): Promise<void> {
	await response;
}

export const getSetupStatus = (o: Opts = {}) => sdk.authSetupStatus(sdkOptions(o));
export const getMe = (o: Opts = {}) => sdk.authMe(sdkOptions(o));
export const verifySetupToken = (
	body: sdk.Options<import('./generated/types.gen').AuthVerifySetupTokenData>['body'],
	o: Opts = {}
) => noContent(sdk.authVerifySetupToken({ ...sdkOptions(o), body }));
export const setupOwner = (body: import('./generated/types.gen').SetupRequest, o: Opts = {}) =>
	sdk.authSetup({ ...sdkOptions(o), body });
export const login = (body: import('./generated/types.gen').LoginRequest, o: Opts = {}) =>
	sdk.authLogin({ ...sdkOptions(o), body });
export const logout = (o: Opts = {}) => noContent(sdk.authLogout(sdkOptions(o)));
export const listApiKeys = (o: Opts = {}) => sdk.authApiKeys(sdkOptions(o));
export const createApiKey = (body: import('./generated/types.gen').CreateKey, o: Opts = {}) =>
	sdk.authCreateApiKey({ ...sdkOptions(o), body });
export const revokeApiKey = (id: string, o: Opts = {}) =>
	noContent(sdk.authRevokeApiKey({ ...sdkOptions(o), path: path(id) }));

export const listServers = (o: Opts = {}) => sdk.serversList(sdkOptions(o));
export const getServer = (id: string, o: Opts = {}) =>
	sdk.serversGet({ ...sdkOptions(o), path: path(id) });
export const createServer = (body: CreateServerRequest, o: Opts = {}) =>
	sdk.serversCreate({ ...sdkOptions(o), body });
export const installServer = (
	id: string,
	{ options, ...o }: Opts & { options?: InstallOptions | null } = {}
) =>
	sdk.serversInstall({
		...sdkOptions(o),
		path: path(id),
		...(options && Object.keys(options).length ? { body: options } : {})
	});
export const deleteServer = (id: string, deleteFiles = false, o: Opts = {}) =>
	sdk.serversDelete({ ...sdkOptions(o), path: path(id), query: { deleteFiles } });
export const setEula = (id: string, accepted: boolean, o: Opts = {}) =>
	sdk.serversEula({ ...sdkOptions(o), path: path(id), body: { accepted } });
const actions = {
	start: sdk.serversStart,
	stop: sdk.serversStop,
	restart: sdk.serversRestart,
	kill: sdk.serversKill
};
export const serverAction = (id: string, action: ServerAction, o: Opts = {}) =>
	actions[action]({ ...sdkOptions(o), path: path(id) });
export const getConsole = (id: string, tail = 200, o: Opts = {}) =>
	sdk.serversLogs({ ...sdkOptions(o), path: path(id), query: { tail } });
export const sendCommand = (id: string, line: string, o: Opts = {}) =>
	noContent(sdk.serversCommand({ ...sdkOptions(o), path: path(id), body: { line } }));
export const getServerMetrics = (id: string, o: Opts = {}) =>
	sdk.serversMetrics({ ...sdkOptions(o), path: path(id) });
export const uploadServerIcon = (id: string, file: Blob, contentType: string, o: Opts = {}) =>
	sdk.iconsUpload({
		...sdkOptions({ ...o, rawBody: file }),
		path: path(id),
		body: file,
		headers: { 'X-MCM-CSRF': '1', 'Content-Type': contentType }
	});
export const resetServerIcon = (id: string, o: Opts = {}) =>
	sdk.iconsReset({ ...sdkOptions(o), path: path(id) });
export const getIsolation = (o: Opts = {}) => sdk.serversIsolation(sdkOptions(o));

export const getServerStatus = (id: string, o: Opts = {}) =>
	sdk.operationsStatus({ ...sdkOptions(o), path: path(id) });
export const getPlayers = (id: string, o: Opts = {}) =>
	sdk.operationsPlayers({ ...sdkOptions(o), path: path(id) });
export const changePlayer = (id: string, body: PlayerChange, o: Opts = {}) =>
	sdk.operationsChangePlayer({ ...sdkOptions(o), path: path(id), body });
export const getAutomation = (id: string, o: Opts = {}) =>
	sdk.operationsAutomation({ ...sdkOptions(o), path: path(id) });
export const setRecoveryPolicy = (id: string, body: RecoveryPolicy, o: Opts = {}) =>
	sdk.operationsRecovery({ ...sdkOptions(o), path: path(id), body });
export const setBackupSchedule = (id: string, body: BackupScheduleRequest, o: Opts = {}) =>
	sdk.operationsBackup({ ...sdkOptions(o), path: path(id), body });
export const setHistorySettings = (id: string, enabled: boolean, o: Opts = {}) =>
	sdk.operationsHistorySettings({ ...sdkOptions(o), path: path(id), body: { enabled } });
export const getMetricsHistory = (id: string, hours: number, o: Opts = {}) =>
	sdk.operationsHistory({ ...sdkOptions(o), path: path(id), query: { hours } });

export const listSoftware = (o: Opts = {}) => sdk.softwareCatalog(sdkOptions(o));
export const listSoftwareVersions = (kind: VersionedSoftwareKind, o: Opts = {}) =>
	sdk.softwareVersions({ ...sdkOptions(o), path: { kind } });
export const listSoftwareBuilds = (kind: BuildSoftwareKind, version: string, o: Opts = {}) =>
	sdk.softwareBuilds({ ...sdkOptions(o), path: { kind, version } });
export const searchCurseForgeModpacks = (query: string, index = 0, o: Opts = {}) =>
	sdk.softwareModpacks({ ...sdkOptions(o), query: { query, index } });
export const getCurseForgeModpack = (id: number, o: Opts = {}) =>
	sdk.softwareModpack({ ...sdkOptions(o), path: { id } });
export const listCurseForgeFiles = (id: number, o: Opts = {}) =>
	sdk.softwareModpackFiles({ ...sdkOptions(o), path: { id } });
export const getVersion = (o: Opts = {}) => sdk.versionVersion(sdkOptions(o));
export const getChangelog = (o: Opts = {}) => sdk.versionChangelog(sdkOptions(o));

export interface JobListFilter {
	serverId?: string;
	activeOnly?: boolean;
}
export const listJobs = ({
	limit,
	cursor,
	serverId,
	activeOnly,
	...o
}: Opts & JobListFilter & { limit?: number; cursor?: string | null } = {}) =>
	sdk.jobsJobs({
		...sdkOptions(o),
		query: { limit, cursor: cursor ?? undefined, serverId, activeOnly }
	});
export const getJob = (id: string, o: Opts = {}) =>
	sdk.jobsJob({ ...sdkOptions(o), path: path(id) });

export const listFiles = (id: string, filePath: string, o: Opts = {}) =>
	sdk.filesList({ ...sdkOptions(o), path: path(id), query: { path: filePath } });
export const readFile = (id: string, filePath: string, o: Opts = {}) =>
	sdk.filesContent({ ...sdkOptions(o), path: path(id), query: { path: filePath } });
export const writeFile = (
	id: string,
	filePath: string,
	body: import('./generated/types.gen').WriteContent,
	o: Opts = {}
) => sdk.filesSave({ ...sdkOptions(o), path: path(id), query: { path: filePath }, body });
/** Downloads remain native HTTP attachments; do not buffer them through the JSON SDK. */
export const fileDownloadUrl = (id: string, filePath: string) =>
	'/api/v1/servers/' + enc(id) + '/files/download?' + new URLSearchParams({ path: filePath });
export const uploadFile = (
	id: string,
	filePath: string,
	file: Blob,
	overwrite = false,
	o: Opts = {}
) =>
	sdk.filesUpload({
		...sdkOptions({ ...o, rawBody: file }),
		path: path(id),
		query: { path: filePath, overwrite },
		body: file
	});
export const makeDirectory = (id: string, filePath: string, o: Opts = {}) =>
	sdk.filesMkdir({ ...sdkOptions(o), path: path(id), body: { path: filePath } });
export const moveFile = (id: string, from: string, to: string, o: Opts = {}) =>
	sdk.filesMoveEntry({ ...sdkOptions(o), path: path(id), body: { from, to } });
export const copyFile = (id: string, from: string, to: string, o: Opts = {}) =>
	sdk.filesCopy({ ...sdkOptions(o), path: path(id), body: { from, to } });
export const deleteFile = (id: string, filePath: string, recursive: boolean, o: Opts = {}) =>
	noContent(
		sdk.filesDelete({ ...sdkOptions(o), path: path(id), body: { path: filePath, recursive } })
	);

export const getServerNetwork = (id: string, o: Opts = {}) =>
	sdk.serversNetwork({ ...sdkOptions(o), path: path(id) });
export const updateServerNetwork = (id: string, body: UpdateNetworkRequest, o: Opts = {}) =>
	sdk.serversSetNetwork({ ...sdkOptions(o), path: path(id), body });
export const updateServerResources = (id: string, body: UpdateResourcesRequest, o: Opts = {}) =>
	sdk.serversSetResources({ ...sdkOptions(o), path: path(id), body });
export const getServerLaunch = (id: string, o: Opts = {}) =>
	sdk.serversLaunchSettings({ ...sdkOptions(o), path: path(id) });
export const updateServerLaunch = (id: string, body: UpdateLaunchRequest, o: Opts = {}) =>
	sdk.serversSetLaunch({ ...sdkOptions(o), path: path(id), body });
export const getProperties = (id: string, o: Opts = {}) =>
	sdk.propertiesRead({ ...sdkOptions(o), path: path(id) });
export const saveProperties = (
	id: string,
	body: import('./generated/types.gen').PropertiesWrite,
	o: Opts = {}
) => sdk.propertiesSave({ ...sdkOptions(o), path: path(id), body });
export const listPropertiesVersions = (
	id: string,
	params: { limit?: number; before?: number | null } = {},
	o: Opts = {}
) =>
	sdk.propertiesHistory({
		...sdkOptions(o),
		path: path(id),
		query: { limit: params.limit, before: params.before ?? undefined }
	});
export const getPropertiesVersion = (id: string, version: number, o: Opts = {}) =>
	sdk.propertiesRevision({ ...sdkOptions(o), path: { id, version } });
export const restoreProperties = (
	id: string,
	body: import('./generated/types.gen').PropertiesRestore,
	o: Opts = {}
) => sdk.propertiesRestore({ ...sdkOptions(o), path: path(id), body });

export const getStorage = (o: Opts = {}) => sdk.exportsStorage(sdkOptions(o));
export const updateStorage = (body: UpdateStorageRequest, o: Opts = {}) =>
	sdk.exportsSetStorage({ ...sdkOptions(o), body });
export const testStorage = (o: Opts = {}) => sdk.exportsTestStorage(sdkOptions(o));
export const listExports = (o: Opts = {}) => sdk.exportsList(sdkOptions(o));
export const createExport = (id: string, body: CreateExportRequest, o: Opts = {}) =>
	sdk.exportsCreate({ ...sdkOptions(o), path: path(id), body });
export const exportDownloadUrl = (id: string) => '/api/v1/exports/' + enc(id) + '/download';
export const archiveServer = (id: string, exportId: string, o: Opts = {}) =>
	sdk.exportsArchiveInstance({
		...sdkOptions(o),
		path: path(id),
		body: { exportId, confirmDiscardChanges: true }
	});
export const restoreExport = (id: string, o: Opts = {}) =>
	sdk.exportsRestoreInstance({ ...sdkOptions(o), path: path(id) });
export const deleteExport = (id: string, o: Opts = {}) =>
	noContent(sdk.exportsDelete({ ...sdkOptions(o), path: path(id) }));
