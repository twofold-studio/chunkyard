import { describe, expect, it } from 'vitest';
import {
	buildSoftware,
	cardSummary,
	describeSoftware,
	hasBuilds,
	hasOptionalBuild,
	installedDetails,
	isVersioned,
	needsLoader,
	installedLoader,
	monogram,
	needsInstall,
	safeCurseForgeUrl,
	softwareHeadline
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

	it('builds Purpur like Paper and NeoForge like the other loaders', () => {
		expect(buildSoftware({ ...base, kind: 'purpur', version: '1.21.1' })).toEqual({
			type: 'purpur',
			version: '1.21.1'
		});
		expect(buildSoftware({ ...base, kind: 'purpur', version: '1.21.1', build: '2329' })).toEqual({
			type: 'purpur',
			version: '1.21.1',
			build: '2329'
		});
		expect(buildSoftware({ ...base, kind: 'neoforge', version: '1.21.1' })).toBeNull();
		expect(
			buildSoftware({ ...base, kind: 'neoforge', version: '1.21.1', build: '21.1.77' })
		).toEqual({ type: 'neoforge', version: '1.21.1', loaderVersion: '21.1.77' });
		expect(buildSoftware({ ...base, kind: 'fabric', version: '1.21.1', build: '0.16.9' })).toEqual({
			type: 'fabric',
			version: '1.21.1',
			loaderVersion: '0.16.9'
		});
	});

	it('classifies versioned, optional-build and loader kinds', () => {
		for (const kind of ['vanilla', 'paper', 'purpur', 'fabric', 'forge', 'neoforge'] as const) {
			expect(isVersioned(kind)).toBe(true);
		}
		expect(isVersioned('curseforge')).toBe(false);
		expect(hasBuilds('vanilla')).toBe(false);
		expect(hasOptionalBuild('purpur')).toBe(true);
		expect(hasOptionalBuild('neoforge')).toBe(false);
		expect(needsLoader('neoforge')).toBe(true);
		expect(needsLoader('purpur')).toBe(false);
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
		expect(describeSoftware({ type: 'purpur', version: '1.21.1', build: '2329' })).toEqual({
			kind: 'Purpur',
			detail: '1.21.1 build 2329'
		});
		expect(
			describeSoftware({ type: 'neoforge', version: '1.21.1', loaderVersion: '21.1.77' })
		).toEqual({ kind: 'NeoForge', detail: '1.21.1 loader 21.1.77' });
		expect(
			installedLoader({
				software: { type: 'neoforge', version: '1.21.1', loaderVersion: '21.1.77' },
				launch: null
			})
		).toBe('NeoForge 21.1.77');
		expect(cardSummary({ software: { type: 'purpur', version: '1.21.1' }, launch: null })).toEqual({
			software: 'Purpur',
			version: '1.21.1'
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

describe('installed software labels', () => {
	const launch = {
		path: 'server.jar',
		version: '1.21.1',
		build: null,
		javaMajor: 21,
		checksum: 'ab'
	};
	const pack = { type: 'curseforge' as const, projectId: 101, fileId: 555 };

	it('shows the installed Paper build for a latest-build selection', () => {
		expect(
			describeSoftware({ type: 'paper', version: '1.21.1' }, { ...launch, build: '130' }).detail
		).toBe('1.21.1 build 130');
		expect(describeSoftware({ type: 'paper', version: '1.21.1' }).detail).toBe(
			'1.21.1 latest build'
		);
	});

	it('describes a CurseForge selection without Paper wording', () => {
		const summary = describeSoftware(pack);
		expect(summary).toEqual({ kind: 'CurseForge modpack', detail: 'project 101 · release 555' });
	});

	it('lists Minecraft, loader, Java and launch for an installed pack', () => {
		const server = {
			software: pack,
			launch: {
				...launch,
				version: '1.20.1',
				build: '5555',
				javaMajor: 17,
				loader: { type: 'forge' as const, version: '47.3.0' },
				profile: { mode: 'args' as const, jvmArgs: [], args: [] }
			}
		};
		const rows = installedDetails(server);
		expect(rows).toEqual([
			{ label: 'Minecraft', value: '1.20.1' },
			{ label: 'Loader', value: 'Forge 47.3.0' },
			{ label: 'Java', value: 'Java 17' },
			{ label: 'Launch', value: 'Java argument file' }
		]);
		// A build number is only ever labelled as a Paper build for Paper servers.
		expect(rows.some((row) => /build/i.test(row.label))).toBe(false);
		expect(softwareHeadline(server)).toBe('CurseForge modpack · Minecraft 1.20.1 · Forge 47.3.0');
		expect(softwareHeadline(server, 'Better MC')).toBe(
			'Better MC · Minecraft 1.20.1 · Forge 47.3.0'
		);
		expect(cardSummary(server)).toEqual({ software: 'CurseForge · Forge', version: '1.20.1' });
	});

	it('marks a custom launch override and uses its Java', () => {
		const rows = installedDetails({
			software: pack,
			launch: { ...launch, loader: { type: 'neoforge', version: '21.1.77' } },
			launchOverride: { mode: 'script', path: 'run.sh', javaMajor: 21, jvmArgs: [], args: [] }
		});
		expect(rows).toContainEqual({ label: 'Loader', value: 'NeoForge 21.1.77' });
		expect(rows).toContainEqual({ label: 'Launch', value: 'Bash script (custom)' });
	});

	it('labels Paper builds and Fabric loaders for their own kinds', () => {
		expect(
			installedDetails({
				software: { type: 'paper', version: '1.21.1' },
				launch: { ...launch, build: '130' }
			})
		).toContainEqual({ label: 'Paper build', value: '130' });
		expect(
			installedLoader({
				software: { type: 'fabric', version: '1.21.1', loaderVersion: '0.16.5' },
				launch
			})
		).toBe('Fabric 0.16.5');
		// Raw project/file IDs are never shown as the headline.
		expect(softwareHeadline({ software: pack, launch: null })).toBe('CurseForge modpack');
		expect(softwareHeadline({ software: pack, launch: null }, 'All the Mods 10')).toBe(
			'All the Mods 10'
		);
		expect(installedDetails({ software: pack, launch: null })).toEqual([]);
	});
});
