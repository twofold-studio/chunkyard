import { LAUNCH_MODE_LABELS, loaderLabel } from './launch.js';
import type {
	BuildSoftwareKind,
	ServerLaunch,
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

/**
 * Human-readable summary of a server's managed software, e.g. "Paper · 1.21.1 build 130".
 * With the installed `launch`, a "latest" Paper selection shows the build actually installed.
 */
export function describeSoftware(
	software: ServerSoftware,
	launch: ServerLaunch | null = null
): { kind: string; detail: string } {
	switch (software.type) {
		case 'vanilla':
			return { kind: SOFTWARE_LABELS.vanilla, detail: String(software.version) };
		case 'paper': {
			const build = software.build || launch?.build;
			return {
				kind: SOFTWARE_LABELS.paper,
				detail: build ? `${software.version} build ${build}` : `${software.version} latest build`
			};
		}
		case 'fabric':
		case 'forge':
			return {
				kind: SOFTWARE_LABELS[software.type],
				detail: `${software.version} loader ${software.loaderVersion}`
			};
		case 'curseforge':
			return {
				kind: SOFTWARE_LABELS.curseforge,
				detail: `project ${software.projectId} · release ${software.fileId}`
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

export interface DetailRow {
	label: string;
	value: string;
	mono?: boolean;
}

/**
 * Installed details for a managed server: Minecraft, loader, Paper build, Java and launch
 * mode. Build numbers are only labelled as Paper builds for Paper servers.
 */
export function installedDetails(
	server: Pick<ServerView, 'software' | 'launch' | 'launchOverride'>
): DetailRow[] {
	const launch = server.launch ?? null;
	if (!launch) return [];
	const software = server.software ?? null;
	const rows: DetailRow[] = [];
	if (launch.version) rows.push({ label: 'Minecraft', value: launch.version });
	const loader = installedLoader(server);
	if (loader) rows.push({ label: 'Loader', value: loader });
	if (software?.type === 'paper' && launch.build) {
		rows.push({ label: 'Paper build', value: launch.build });
	}
	const override = server.launchOverride ?? null;
	rows.push({ label: 'Java', value: `Java ${override?.javaMajor ?? launch.javaMajor}` });
	const mode = override?.mode ?? launch.profile?.mode;
	if (mode) {
		rows.push({
			label: 'Launch',
			value: `${LAUNCH_MODE_LABELS[mode] ?? mode}${override ? ' (custom)' : ''}`
		});
	}
	return rows;
}

/** "NeoForge 21.1.77" from the installed loader, or the requested Fabric/Forge loader. */
export function installedLoader(server: Pick<ServerView, 'software' | 'launch'>): string | null {
	const loader = server.launch?.loader;
	if (loader?.type) return `${loaderLabel(loader.type)} ${loader.version}`.trim();
	const software = server.software;
	if (software?.type === 'fabric' || software?.type === 'forge') {
		return `${SOFTWARE_LABELS[software.type]} ${software.loaderVersion}`;
	}
	return null;
}

/**
 * One-line software summary for headers. Installed CurseForge packs show their detected
 * Minecraft version and loader instead of raw IDs.
 */
export function softwareHeadline(server: Pick<ServerView, 'software' | 'launch'>): string | null {
	const software = server.software ?? null;
	if (!software) return null;
	const launch = server.launch ?? null;
	const summary = describeSoftware(software, launch);
	if (software.type === 'curseforge' && launch) {
		const loader = launch.loader?.type
			? `${loaderLabel(launch.loader.type)} ${launch.loader.version}`.trim()
			: null;
		return [summary.kind, launch.version && `Minecraft ${launch.version}`, loader]
			.filter(Boolean)
			.join(' · ');
	}
	return summary.detail ? `${summary.kind} ${summary.detail}` : summary.kind;
}

/**
 * Short labels for a server card: software type ("Paper", "Vanilla", "Custom", …) and the
 * Minecraft version, preferring the installed launch version over the requested selection.
 */
export function cardSummary(server: Pick<ServerView, 'software' | 'launch'>): {
	software: string;
	version: string | null;
} {
	const software = server.software ?? null;
	const type = software ? describeSoftware(software).kind : 'Custom';
	const loader = server.launch?.loader?.type ? loaderLabel(server.launch.loader.type) : null;
	const label =
		software?.type === 'curseforge' ? (loader ? `CurseForge · ${loader}` : 'CurseForge') : type;
	const requested =
		software && 'version' in software && typeof software.version === 'string'
			? software.version
			: null;
	return { software: label, version: server.launch?.version || requested };
}
