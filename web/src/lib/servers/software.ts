import type {
	BuildSoftwareKind,
	LoaderSoftwareKind,
	ServerSoftware,
	ServerView,
	SoftwareKind,
	VersionedSoftwareKind
} from '#lib/api/index.js';

/** Display order of the catalog; unknown kinds from a newer backend are ignored. */
export const SOFTWARE_ORDER: readonly SoftwareKind[] = [
	'vanilla',
	'paper',
	'fabric',
	'forge',
	'curseforge',
	'custom'
];

export const SOFTWARE_LABELS: Record<SoftwareKind, string> = {
	vanilla: 'Vanilla',
	paper: 'Paper',
	fabric: 'Fabric',
	forge: 'Forge',
	curseforge: 'CurseForge modpack',
	custom: 'Custom JAR'
};

export const SOFTWARE_BLURBS: Record<SoftwareKind, string> = {
	vanilla: 'Official Mojang server.',
	paper: 'Fast, plugin-ready fork.',
	fabric: 'Lightweight mod loader.',
	forge: 'Classic mod loader.',
	curseforge: 'Install a server pack.',
	custom: 'Bring your own server JAR.'
};

export function isVersioned(kind: SoftwareKind): kind is VersionedSoftwareKind {
	return kind === 'vanilla' || kind === 'paper' || kind === 'fabric' || kind === 'forge';
}

export function hasBuilds(kind: SoftwareKind): kind is BuildSoftwareKind {
	return kind === 'paper' || kind === 'fabric' || kind === 'forge';
}

/** Fabric/Forge need an explicit loader; Paper's build is optional. */
export function needsLoader(kind: SoftwareKind): kind is LoaderSoftwareKind {
	return kind === 'fabric' || kind === 'forge';
}

/** A managed server that has not completed a successful install yet. */
export function needsInstall(server: Pick<ServerView, 'software' | 'launch'>): boolean {
	return server.software != null && server.launch == null;
}

/**
 * Builds the `software` object for `POST /api/v1/servers` from the picker state,
 * or `null` while the selection is incomplete (or for a custom JAR).
 */
export function buildSoftware(selection: {
	kind: SoftwareKind | null;
	version: string;
	build: string;
	projectId: number | null;
	fileId: number | null;
}): ServerSoftware | null {
	const { kind, version, build, projectId, fileId } = selection;
	switch (kind) {
		case 'vanilla':
			return version ? { type: 'vanilla', version } : null;
		case 'paper':
			// No build means "latest stable at install time".
			return version
				? build
					? { type: 'paper', version, build }
					: { type: 'paper', version }
				: null;
		case 'fabric':
		case 'forge':
			return version && build ? { type: kind, version, loaderVersion: build } : null;
		case 'curseforge':
			return projectId !== null && fileId !== null
				? { type: 'curseforge', projectId, fileId }
				: null;
		default:
			return null;
	}
}

/** Human-readable summary of a server's managed software, e.g. "Paper · 1.21.1 build 130". */
export function describeSoftware(software: ServerSoftware): { kind: string; detail: string } {
	switch (software.type) {
		case 'vanilla':
			return { kind: SOFTWARE_LABELS.vanilla, detail: String(software.version) };
		case 'paper':
			return {
				kind: SOFTWARE_LABELS.paper,
				detail: software.build
					? `${software.version} build ${software.build}`
					: `${software.version} latest build`
			};
		case 'fabric':
		case 'forge':
			return {
				kind: SOFTWARE_LABELS[software.type],
				detail: `${software.version} loader ${software.loaderVersion}`
			};
		case 'curseforge':
			return {
				kind: SOFTWARE_LABELS.curseforge,
				detail: `project ${software.projectId}, file ${software.fileId}`
			};
		default: {
			// A newer backend may report a kind this UI does not know yet.
			const type = (software as { type?: unknown }).type;
			return { kind: typeof type === 'string' ? type : 'Managed', detail: '' };
		}
	}
}

const CURSEFORGE_HOSTS = ['curseforge.com', 'www.curseforge.com'];

/**
 * Accepts only https links to CurseForge for upstream-provided project URLs, so a
 * hostile catalog entry cannot produce `javascript:` or arbitrary off-site links.
 */
export function safeCurseForgeUrl(value: unknown): string | null {
	if (typeof value !== 'string' || value.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password) return null;
	if (!CURSEFORGE_HOSTS.includes(url.hostname.toLowerCase())) return null;
	return url.href;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function formatDownloads(value: number): string {
	return Number.isFinite(value) && value >= 0 ? compact.format(value) : '–';
}

/** First letters of a pack name for a local monogram (remote logos are not loaded). */
export function monogram(name: string): string {
	const letters = name
		.split(/\s+/)
		.map((word) => [...word.replace(/[^\p{L}\p{N}]/gu, '')][0] ?? '')
		.filter(Boolean)
		.slice(0, 2)
		.join('');
	return letters.toUpperCase() || '?';
}
