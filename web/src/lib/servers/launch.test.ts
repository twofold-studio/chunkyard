import { afterEach, describe, expect, it, vi } from 'vitest';
import { installServer, type LaunchSettings } from '#lib/api/index.js';
import {
	describeProfile,
	emptyInstallForm,
	emptyLaunchForm,
	formToProfile,
	launchSettingsDirty,
	launchSettingsToForm,
	parseLines,
	profileToForm,
	toInstallOptions,
	toUpdateLaunchRequest,
	validateImage,
	validateInstallForm,
	validateLaunchForm,
	validateLaunchPath
} from './launch';

const profile = {
	mode: 'args' as const,
	path: 'libraries/net/neoforged/neoforge/21.1.77/unix_args.txt',
	javaMajor: 21,
	jvmArgs: ['-XX:+UseG1GC'],
	args: ['nogui']
};

const settings = (extra: Partial<LaunchSettings> = {}): LaunchSettings => ({
	detected: profile,
	current: profile,
	overridden: false,
	dockerImage: 'eclipse-temurin:21-jre',
	autoJava: true,
	...extra
});

describe('argument lines', () => {
	it('takes one argument per line without shell parsing', () => {
		expect(parseLines('  -Xss4M \r\n\n--world "My World"\n$(rm -rf /)\n')).toEqual([
			'-Xss4M',
			'--world "My World"',
			'$(rm -rf /)'
		]);
		expect(parseLines('')).toEqual([]);
	});

	it('round-trips a profile through the form', () => {
		expect(formToProfile(profileToForm(profile))).toEqual(profile);
	});

	it('drops JVM arguments for scripts, which choose their own flags', () => {
		const form = { ...profileToForm(profile), mode: 'script' as const, path: 'run.sh' };
		expect(formToProfile(form)).toEqual({
			mode: 'script',
			path: 'run.sh',
			javaMajor: 21,
			jvmArgs: [],
			args: ['nogui']
		});
	});

	it('describes a profile in one line', () => {
		expect(describeProfile({ mode: 'script', path: 'run.sh', javaMajor: 17 })).toBe(
			'Bash script run.sh · Java 17'
		);
	});
});

describe('validation', () => {
	it('matches backend UTF-8 and combined argument limits', () => {
		const form = { ...emptyLaunchForm(), path: 'server.jar', javaMajor: 21 };
		expect(validateLaunchForm({ ...form, args: 'é'.repeat(513) }).args).toBeDefined();
		expect(
			validateLaunchForm({
				...form,
				jvmArgs: Array(65).fill('-Dtest=true').join('\n'),
				args: Array(64).fill('world').join('\n')
			}).args
		).toMatch(/128/);
		expect(
			validateLaunchForm({ ...form, args: Array(40).fill('x'.repeat(900)).join('\n') }).args
		).toMatch(/32 KiB/);
		expect(validateLaunchPath('é'.repeat(257), 'jar')).toBeDefined();
		expect(validateLaunchPath('config:args', 'args')).toBeDefined();
	});
	it('accepts only instance-relative paths', () => {
		expect(validateLaunchPath('server.jar', 'jar')).toBeUndefined();
		expect(validateLaunchPath('libraries/x/unix_args.txt', 'args')).toBeUndefined();
		for (const bad of [
			'',
			'/etc/passwd',
			'../x.jar',
			'a//b.jar',
			'a/./b',
			'C:/x.jar',
			'a\\b.jar'
		]) {
			expect(validateLaunchPath(bad, 'jar')).toBeDefined();
		}
	});

	it('rejects Windows batch files for Bash launches', () => {
		expect(validateLaunchPath('start.bat', 'script')).toMatch(/Windows scripts/);
		expect(validateLaunchPath('start.sh', 'script')).toBeUndefined();
	});

	it('requires Java 8 to 99', () => {
		const form = { ...emptyLaunchForm('jar'), path: 'server.jar' };
		expect(validateLaunchForm({ ...form, javaMajor: 21 })).toEqual({});
		expect(validateLaunchForm({ ...form, javaMajor: 7 }).javaMajor).toBeDefined();
		expect(validateLaunchForm({ ...form, javaMajor: 100 }).javaMajor).toBeDefined();
		expect(validateLaunchForm({ ...form, javaMajor: null }).javaMajor).toBeDefined();
		expect(validateLaunchForm(form, { requireJava: false })).toEqual({});
	});

	it('validates image references but allows blank (automatic)', () => {
		expect(validateImage('')).toBeUndefined();
		expect(validateImage('eclipse-temurin:17-jre')).toBeUndefined();
		expect(validateImage('-bad')).toBeDefined();
		expect(validateImage('bad image')).toBeDefined();
	});
});

describe('launch settings request', () => {
	it('sends a null profile (detection) and omits an unchanged image', () => {
		const current = settings();
		const form = launchSettingsToForm(current);
		expect(form).toMatchObject({ override: false, image: '' });
		expect(launchSettingsDirty(form, current)).toBe(false);
		expect(toUpdateLaunchRequest(form, current)).toEqual({ profile: null });
	});

	it('sends a custom profile and an explicit image', () => {
		const current = settings();
		const form = launchSettingsToForm(current);
		form.override = true;
		form.profile = { ...form.profile, mode: 'script', path: 'run.sh', args: '' };
		form.image = 'example/java:21';
		expect(launchSettingsDirty(form, current)).toBe(true);
		expect(toUpdateLaunchRequest(form, current)).toEqual({
			profile: { mode: 'script', path: 'run.sh', javaMajor: 21, jvmArgs: [], args: [] },
			dockerImage: 'example/java:21'
		});
	});

	it('restores automatic Java when a custom image is cleared, and resets detection', () => {
		const current = settings({ overridden: true, autoJava: false, dockerImage: 'custom:1' });
		const form = launchSettingsToForm(current);
		expect(form.image).toBe('custom:1');
		form.image = '';
		form.override = false;
		expect(toUpdateLaunchRequest(form, current)).toEqual({ profile: null, dockerImage: null });
		expect(launchSettingsDirty(form, current)).toBe(true);
	});
});

describe('install options', () => {
	it('sends nothing when every field is left to detection', () => {
		expect(toInstallOptions(emptyInstallForm())).toBeNull();
		expect(validateInstallForm(emptyInstallForm())).toEqual({});
	});

	it('includes only the overrides the owner set', () => {
		const form = { ...emptyInstallForm(), minecraftVersion: ' 1.20.1 ', loader: 'forge' as const };
		expect(toInstallOptions(form)).toEqual({ minecraftVersion: '1.20.1', loader: 'forge' });
	});

	it('uses the shared Java version for a launch target and requires it', () => {
		const form = {
			...emptyInstallForm(),
			overrideLaunch: true,
			launch: { ...emptyLaunchForm('script'), path: 'startserver.sh', args: 'nogui' }
		};
		expect(validateInstallForm(form).javaMajor).toMatch(/launch target/);
		form.javaMajor = 17;
		expect(validateInstallForm(form)).toEqual({});
		expect(toInstallOptions(form)).toEqual({
			javaMajor: 17,
			launch: {
				mode: 'script',
				path: 'startserver.sh',
				javaMajor: 17,
				jvmArgs: [],
				args: ['nogui']
			}
		});
	});

	it('asks for the loader when only its version is given', () => {
		const form = { ...emptyInstallForm(), loaderVersion: '47.3.0' };
		expect(validateInstallForm(form).loader).toBeDefined();
		expect(
			validateInstallForm({ ...form, minecraftVersion: '1.20 1' }).minecraftVersion
		).toBeDefined();
	});
});

describe('installServer request', () => {
	afterEach(() => vi.unstubAllGlobals());

	function stub() {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ job: { id: 'j' } }), {
					status: 202,
					headers: { 'content-type': 'application/json' }
				})
		);
		vi.stubGlobal('fetch', fetch);
		return fetch;
	}

	it('keeps the empty body for a normal install', async () => {
		const fetch = stub();
		await installServer('s1');
		await installServer('s1', { options: {} });
		for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) {
			expect(call[0]).toBe('/api/v1/servers/s1/install');
			expect(call[1].body).toBeUndefined();
		}
	});

	it('sends advanced overrides as JSON', async () => {
		const fetch = stub();
		await installServer('s1', { options: { loader: 'neoforge', javaMajor: 21 } });
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ loader: 'neoforge', javaMajor: 21 });
	});
});
