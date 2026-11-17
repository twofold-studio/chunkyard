import type { ServerView } from '#lib/api/index.js';

/**
 * Image sources the UI may load. The page CSP allows same-origin images only, so upstream
 * (CurseForge CDN) or arbitrary URLs are never rendered: the backend proxies and validates
 * pack logos and display icons under these routes.
 */
const IMAGE_PATHS = [
	/^\/api\/v1\/modpacks\/curseforge\/\d{1,12}\/logo$/,
	/^\/api\/v1\/servers\/[A-Za-z0-9_-]{1,128}\/icon$/
];

/**
 * Returns a same-origin path (with query) for an allowed image route, or `null` for anything
 * else: other origins, protocol-relative or `javascript:`/`data:` URLs, credentials, or paths
 * outside the logo/icon routes.
 */
export function safeImageUrl(value: unknown, origin = globalThis.location?.origin): string | null {
	if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || !origin) {
		return null;
	}
	// Protocol-relative and backslash tricks resolve off-site in browsers.
	if (value.startsWith('//') || value.includes('\\')) return null;
	let url: URL;
	try {
		url = new URL(value, origin);
	} catch {
		return null;
	}
	if (url.origin !== origin || url.username || url.password) return null;
	if (!IMAGE_PATHS.some((pattern) => pattern.test(url.pathname))) return null;
	return `${url.pathname}${url.search}`;
}

/** Same-origin logo route for a CurseForge project (proxied and cached by the backend). */
export function curseForgeLogoUrl(projectId: number): string | null {
	return Number.isSafeInteger(projectId) && projectId > 0
		? `/api/v1/modpacks/curseforge/${projectId}/logo`
		: null;
}

/**
 * Display icon for a server: the backend-resolved icon (custom upload, then pack logo).
 * Older backends omit `icon`; CurseForge servers then fall back to the pack logo route.
 * `null` means the generic icon.
 */
export function serverIconUrl(
	server: Partial<Pick<ServerView, 'icon' | 'software'>>,
	origin = globalThis.location?.origin
): string | null {
	if (server.icon !== undefined) return safeImageUrl(server.icon?.url, origin);
	const software = server.software ?? null;
	return software?.type === 'curseforge'
		? safeImageUrl(curseForgeLogoUrl(software.projectId), origin)
		: null;
}

export const ICON_MAX_BYTES = 2 * 1024 * 1024;

const ICON_TYPES: Record<string, string> = {
	'image/png': 'image/png',
	'image/jpeg': 'image/jpeg',
	'image/webp': 'image/webp',
	'image/x-icon': 'image/x-icon',
	'image/vnd.microsoft.icon': 'image/x-icon'
};

const ICON_EXTENSIONS: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	ico: 'image/x-icon'
};

/** `accept` attribute for the icon file input. */
export const ICON_ACCEPT =
	'.png,.jpg,.jpeg,.webp,.ico,image/png,image/jpeg,image/webp,image/x-icon';

export type IconFileCheck = { ok: true; contentType: string } | { ok: false; message: string };

/**
 * Local pre-check before `PUT /servers/{id}/icon`; the backend still validates the bytes.
 * Returns the content type to send.
 */
export function checkIconFile(file: Pick<File, 'name' | 'size' | 'type'>): IconFileCheck {
	const byType = ICON_TYPES[file.type.toLowerCase()];
	const extension = file.name.toLowerCase().split('.').pop() ?? '';
	const contentType = byType ?? (file.type === '' ? ICON_EXTENSIONS[extension] : undefined);
	if (!contentType) {
		return { ok: false, message: 'Choose a PNG, JPEG, WebP or ICO image.' };
	}
	if (file.size === 0) return { ok: false, message: 'The selected file is empty.' };
	if (file.size > ICON_MAX_BYTES) {
		return { ok: false, message: 'The image is larger than 2 MiB.' };
	}
	return { ok: true, contentType };
}
