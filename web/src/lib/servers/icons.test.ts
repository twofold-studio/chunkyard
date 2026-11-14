import { describe, expect, it } from 'vitest';
import {
	checkIconFile,
	curseForgeLogoUrl,
	safeImageUrl,
	serverIconUrl,
	ICON_MAX_BYTES
} from './icons';

const ORIGIN = 'https://chunkyard.example';

describe('safeImageUrl', () => {
	it('accepts only same-origin logo and icon routes', () => {
		expect(safeImageUrl('/api/v1/modpacks/curseforge/925200/logo', ORIGIN)).toBe(
			'/api/v1/modpacks/curseforge/925200/logo'
		);
		expect(safeImageUrl('/api/v1/servers/srv-1/icon?v=abc', ORIGIN)).toBe(
			'/api/v1/servers/srv-1/icon?v=abc'
		);
		expect(safeImageUrl(`${ORIGIN}/api/v1/servers/srv-1/icon`, ORIGIN)).toBe(
			'/api/v1/servers/srv-1/icon'
		);
	});

	it('rejects remote, scripted, protocol-relative and off-route URLs', () => {
		for (const value of [
			'https://media.forgecdn.net/avatars/1/2/logo.png',
			'https://evil.example/api/v1/servers/srv-1/icon',
			'//evil.example/api/v1/servers/srv-1/icon',
			'/\\evil.example/api/v1/servers/srv-1/icon',
			'javascript:alert(1)',
			'data:image/png;base64,AAAA',
			'/api/v1/servers/srv-1/files/download?path=x',
			'/api/v1/servers/../../etc/icon',
			`https://user:pw@chunkyard.example/api/v1/servers/s/icon`,
			'',
			null,
			42
		]) {
			expect(safeImageUrl(value, ORIGIN)).toBeNull();
		}
	});
});

describe('serverIconUrl', () => {
	const pack = { type: 'curseforge', projectId: 925200, fileId: 1 } as const;

	it('prefers the backend icon, including an explicit none', () => {
		expect(
			serverIconUrl(
				{ icon: { url: '/api/v1/servers/s/icon?v=2', source: 'custom' }, software: pack },
				ORIGIN
			)
		).toBe('/api/v1/servers/s/icon?v=2');
		expect(serverIconUrl({ icon: null, software: pack }, ORIGIN)).toBeNull();
	});

	it('falls back to the pack logo for records from older backends, else generic', () => {
		expect(serverIconUrl({ software: pack }, ORIGIN)).toBe(curseForgeLogoUrl(925200));
		expect(serverIconUrl({ software: { type: 'vanilla', version: '1.21.1' } }, ORIGIN)).toBeNull();
		expect(serverIconUrl({ software: null }, ORIGIN)).toBeNull();
		expect(curseForgeLogoUrl(-1)).toBeNull();
	});

	it('never loads an unsafe backend URL', () => {
		expect(
			serverIconUrl(
				{ icon: { url: 'https://evil.example/x.png', source: 'custom' }, software: null },
				ORIGIN
			)
		).toBeNull();
	});
});

describe('checkIconFile', () => {
	it('accepts PNG, JPEG, WebP and ICO up to 2 MiB', () => {
		expect(checkIconFile({ name: 'a.png', size: 10, type: 'image/png' })).toEqual({
			ok: true,
			contentType: 'image/png'
		});
		expect(checkIconFile({ name: 'a.ico', size: 10, type: 'image/vnd.microsoft.icon' })).toEqual({
			ok: true,
			contentType: 'image/x-icon'
		});
		// Some platforms report no type; the extension decides.
		expect(checkIconFile({ name: 'logo.WEBP', size: 10, type: '' })).toEqual({
			ok: true,
			contentType: 'image/webp'
		});
		expect(checkIconFile({ name: 'a.jpg', size: ICON_MAX_BYTES, type: 'image/jpeg' }).ok).toBe(
			true
		);
	});

	it('rejects other types, empty files and oversize files', () => {
		expect(checkIconFile({ name: 'a.svg', size: 10, type: 'image/svg+xml' }).ok).toBe(false);
		expect(checkIconFile({ name: 'a.png', size: 10, type: 'text/html' }).ok).toBe(false);
		expect(checkIconFile({ name: 'a.png', size: 0, type: 'image/png' }).ok).toBe(false);
		expect(checkIconFile({ name: 'a.png', size: ICON_MAX_BYTES + 1, type: 'image/png' })).toEqual({
			ok: false,
			message: 'The image is larger than 2 MiB.'
		});
	});
});
