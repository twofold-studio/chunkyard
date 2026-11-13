import { describe, expect, it } from 'vitest';
import {
	buildSoftware,
	cardSummary,
	describeSoftware,
	monogram,
	needsInstall,
	safeCurseForgeUrl
} from './software';

const base = { kind: null, version: '', build: '', projectId: null, fileId: null } as const;

describe('buildSoftware', () => {
	it('omits Paper build for latest stable and requires loaders for Fabric/Forge', () => {
		expect(buildSoftware({ ...base, kind: 'vanilla', version: '1.21.1' })).toEqual({
			type: 'vanilla',
			version: '1.21.1'
		});
		expect(buildSoftware({ ...base, kind: 'paper', version: '1.21.1' })).toEqual({
			type: 'paper',
			version: '1.21.1'
		});
		expect(buildSoftware({ ...base, kind: 'paper', version: '1.21.1', build: '130' })).toEqual({
			type: 'paper',
			version: '1.21.1',
			build: '130'
		});
		expect(buildSoftware({ ...base, kind: 'fabric', version: '1.21.1' })).toBeNull();
		expect(buildSoftware({ ...base, kind: 'forge', version: '1.20.1', build: '47.4.0' })).toEqual({
			type: 'forge',
			version: '1.20.1',
			loaderVersion: '47.4.0'
		});
	});

	it('needs both CurseForge IDs and returns null for custom', () => {
		expect(buildSoftware({ ...base, kind: 'curseforge', projectId: 1 })).toBeNull();
		expect(buildSoftware({ ...base, kind: 'curseforge', projectId: 1, fileId: 2 })).toEqual({
			type: 'curseforge',
			projectId: 1,
			fileId: 2
		});
		expect(buildSoftware({ ...base, kind: 'custom', version: 'x' })).toBeNull();
	});
});

describe('needsInstall', () => {
	it('is true only for managed servers without a launch', () => {
		expect(needsInstall({ software: null, launch: null })).toBe(false);
		expect(needsInstall({})).toBe(false);
		expect(needsInstall({ software: { type: 'vanilla', version: '1.21.1' }, launch: null })).toBe(
			true
		);
		expect(
			needsInstall({
				software: { type: 'vanilla', version: '1.21.1' },
				launch: { path: 'server.jar', version: '1.21.1', build: null, javaMajor: 21, checksum: 'a' }
			})
		).toBe(false);
	});
});

describe('describeSoftware', () => {
	it('summarises known kinds and tolerates unknown ones', () => {
		expect(describeSoftware({ type: 'paper', version: '1.21.1' })).toEqual({
			kind: 'Paper',
			detail: '1.21.1 latest build'
		});
		expect(describeSoftware({ type: 'quilt' } as never)).toEqual({ kind: 'quilt', detail: '' });
	});
});

describe('safeCurseForgeUrl', () => {
	it('allows only https CurseForge links', () => {
		expect(safeCurseForgeUrl('https://www.curseforge.com/minecraft/modpacks/atm')).toBe(
			'https://www.curseforge.com/minecraft/modpacks/atm'
		);
		for (const bad of [
			'javascript:alert(1)',
			'http://www.curseforge.com/x',
			'https://evil.example/x',
			'https://curseforge.com.evil.example/x',
			'https://user:pw@www.curseforge.com/x',
			'not a url',
			null,
			42
		]) {
			expect(safeCurseForgeUrl(bad)).toBeNull();
		}
	});
});

describe('monogram', () => {
	it('uses up to two initials', () => {
		expect(monogram('All the Mods 10')).toBe('AT');
		expect(monogram('  ')).toBe('?');
	});
});

describe('cardSummary', () => {
	const launch = { path: 'server.jar', build: null, javaMajor: 21, checksum: 'ab' };

	it('prefers the persisted launch version over the requested one', () => {
		expect(
			cardSummary({
				software: { type: 'paper', version: '1.21.1' },
				launch: { ...launch, version: '1.21.4' }
			})
		).toEqual({ software: 'Paper', version: '1.21.4' });
	});

	it('falls back to the requested version before install', () => {
		expect(cardSummary({ software: { type: 'vanilla', version: '1.20.1' }, launch: null })).toEqual(
			{ software: 'Vanilla', version: '1.20.1' }
		);
	});

	it('labels manual JAR servers as Custom without a known version', () => {
		expect(cardSummary({ software: null, launch: null })).toEqual({
			software: 'Custom',
			version: null
		});
	});
});
