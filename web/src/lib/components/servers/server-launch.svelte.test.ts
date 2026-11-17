import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerLaunch from './server-launch.svelte';
import type { LaunchSettings, ServerState, ServerView } from '#lib/api/index.js';

interface Call {
	url: string;
	method: string;
	body: unknown;
}
let calls: Call[];
let responses: Record<string, { status: number; body: unknown }[]>;

const detected = {
	mode: 'args' as const,
	path: 'libraries/net/minecraftforge/forge/1.20.1-47.3.0/unix_args.txt',
	javaMajor: 17,
	jvmArgs: [],
	args: ['nogui']
};

const server = (state: ServerState = 'stopped', extra: Partial<ServerView> = {}): ServerView => ({
	archive: null,
	publishIp: null,
	icon: null,
	id: 'srv-1',
	name: 'Pack',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:17-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 4096,
	cpus: 2,
	acceptEula: true,
	directory: '/srv/srv-1',
	status: { state, containerId: null, exitCode: null, oomKilled: false },
	software: { type: 'curseforge', projectId: 101, fileId: 555 },
	launch: {
		path: detected.path,
		version: '1.20.1',
		build: null,
		javaMajor: 17,
		checksum: 'ab',
		profile: { mode: 'args', jvmArgs: [], args: ['nogui'] },
		loader: { type: 'forge', version: '47.3.0' }
	},
	autoJava: true,
	launchOverride: null,
	...extra
});

const settings = (extra: Partial<LaunchSettings> = {}): LaunchSettings => ({
	detected,
	current: detected,
	overridden: false,
	dockerImage: 'eclipse-temurin:17-jre',
	autoJava: true,
	...extra
});

const URL = '/api/v1/servers/srv-1/launch';

beforeEach(() => {
	calls = [];
	responses = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const method = init.method ?? 'GET';
			calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined });
			const next = responses[`${method} ${url}`]?.shift();
			if (!next) throw new Error(`unexpected ${method} ${url}`);
			return new Response(JSON.stringify(next.body), {
				status: next.status,
				headers: {
					'content-type': next.status >= 400 ? 'application/problem+json' : 'application/json'
				}
			});
		})
	);
});
afterEach(() => vi.unstubAllGlobals());

const field = (name: string | RegExp) => page.getByLabelText(name);

describe('ServerLaunch', () => {
	it('summarises the detected launch without a request, then loads on expand', async () => {
		responses[`GET ${URL}`] = [{ status: 200, body: settings() }];
		render(ServerLaunch, { server: server(), busy: false, onServerUpdated: vi.fn() });
		await expect
			.element(page.getByText(`Java argument file ${detected.path} · Java 17`))
			.toBeVisible();
		expect(calls).toHaveLength(0);
		await page.getByRole('button', { name: 'Edit launch settings' }).click();
		await expect.element(page.getByRole('switch', { name: 'Custom launch' })).not.toBeChecked();
		expect(calls).toEqual([{ url: URL, method: 'GET', body: undefined }]);
	});

	it('saves a Bash script override with one argument per line', async () => {
		const updated = server('stopped', {
			launchOverride: { mode: 'script', path: 'run.sh', javaMajor: 17, jvmArgs: [], args: [] }
		});
		responses[`GET ${URL}`] = [
			{ status: 200, body: settings() },
			{ status: 200, body: settings({ overridden: true, current: updated.launchOverride! }) }
		];
		responses[`PATCH ${URL}`] = [{ status: 200, body: { server: updated } }];
		const onServerUpdated = vi.fn();
		render(ServerLaunch, { server: server(), busy: false, onServerUpdated, open: true });

		await page.getByRole('switch', { name: 'Custom launch' }).click();
		await page.getByRole('radio', { name: /Bash script/ }).click();
		// JVM flags belong to the script in Bash mode.
		await expect.element(field(/Extra JVM arguments/)).not.toBeInTheDocument();
		await field('Script path').fill('run.sh');
		await field(/Script arguments/).fill('--port\n25565\n\n');
		await page.getByRole('button', { name: 'Save launch' }).click();

		await vi.waitFor(() => expect(onServerUpdated).toHaveBeenCalledWith(updated));
		expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
			profile: {
				mode: 'script',
				path: 'run.sh',
				javaMajor: 17,
				jvmArgs: [],
				args: ['--port', '25565']
			}
		});
	});

	it('rejects unsafe paths and Windows scripts before sending', async () => {
		responses[`GET ${URL}`] = [{ status: 200, body: settings() }];
		render(ServerLaunch, {
			server: server(),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await page.getByRole('switch', { name: 'Custom launch' }).click();
		await field('Argument file path').fill('../outside.txt');
		await page.getByRole('button', { name: 'Save launch' }).click();
		await expect.element(page.getByText(/Use a relative path/)).toBeVisible();
		await page.getByRole('radio', { name: /Bash script/ }).click();
		await field('Script path').fill('start.bat');
		await expect.element(page.getByText(/Windows scripts do not run on Linux/)).toBeVisible();
		await field('Java version').fill('7');
		await expect.element(page.getByText(/from 8 to 99/)).toBeVisible();
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
	});

	it('resets detection and restores automatic Java', async () => {
		const custom = { ...detected, mode: 'jar' as const, path: 'forge.jar' };
		responses[`GET ${URL}`] = [
			{
				status: 200,
				body: settings({
					overridden: true,
					current: custom,
					autoJava: false,
					dockerImage: 'example/java:17'
				})
			},
			{ status: 200, body: settings() }
		];
		responses[`PATCH ${URL}`] = [{ status: 200, body: { server: server() } }];
		render(ServerLaunch, {
			server: server('stopped', { launchOverride: custom, autoJava: false }),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await expect.element(field('Docker image (optional)')).toHaveValue('example/java:17');
		await page.getByRole('button', { name: 'Reset detection' }).click();
		await field('Docker image (optional)').fill('');
		await page.getByRole('button', { name: 'Save launch' }).click();
		await vi.waitFor(() =>
			expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
				profile: null,
				dockerImage: null
			})
		);
	});

	it('is locked while the server runs', async () => {
		responses[`GET ${URL}`] = [{ status: 200, body: settings() }];
		render(ServerLaunch, {
			server: server('running'),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await expect.element(page.getByRole('switch', { name: 'Custom launch' })).toBeDisabled();
		await expect.element(page.getByText('Stop the server to change the launch.')).toBeVisible();
	});

	it('points uninstalled servers to the install options without loading', async () => {
		render(ServerLaunch, {
			server: server('stopped', { launch: null }),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await expect.element(page.getByText('Override in the install options')).toBeVisible();
		expect(calls).toHaveLength(0);
	});

	it('shows backend failures with a retry', async () => {
		responses[`GET ${URL}`] = [
			{ status: 404, body: { code: 'server.not_found', detail: 'Missing.' } },
			{ status: 200, body: settings() }
		];
		render(ServerLaunch, { server: server(), busy: false, onServerUpdated: vi.fn(), open: true });
		await expect.element(page.getByText('Server not found')).toBeVisible();
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect.element(page.getByRole('switch', { name: 'Custom launch' })).toBeVisible();
	});
});
