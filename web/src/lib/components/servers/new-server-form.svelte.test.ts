import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import NewServerForm from './new-server-form.svelte';

type Reply = { status: number; body?: unknown };
interface Call {
	path: string;
	method: string;
	body: unknown;
}

let calls: Call[];
let replies: Record<string, Reply[]>;

const key = (method: string, path: string) => `${method} ${path}`;
function reply(method: string, path: string, ...queue: Reply[]) {
	replies[key(method, path)] = queue;
}
const ok = (body: unknown, status = 200): Reply => ({ status, body });

const CATALOG = {
	items: [
		{ id: 'vanilla', name: 'Vanilla', available: true, reason: null },
		{ id: 'paper', name: 'Paper', available: true, reason: null },
		{
			id: 'curseforge',
			name: 'CurseForge',
			available: false,
			reason: 'Set a CurseForge API key on the manager.'
		},
		{ id: 'custom', name: 'Custom', available: true, reason: null }
	]
};

const managedServer = (extra: Record<string, unknown> = {}) => ({
	id: 'srv-1',
	name: 'Survival',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 2048,
	cpus: 2,
	acceptEula: false,
	directory: '/srv/srv-1',
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	software: { type: 'vanilla', version: '1.21.1' },
	launch: null,
	autoJava: true,
	...extra
});

const job = (state: string, extra: Record<string, unknown> = {}) => ({
	id: 'job-1',
	kind: 'server.install',
	serverId: 'srv-1',
	state,
	progress: null,
	message: null,
	error: null,
	result: null,
	createdBy: null,
	createdAt: '',
	startedAt: null,
	finishedAt: null,
	...extra
});

beforeEach(() => {
	calls = [];
	replies = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init: RequestInit) => {
			const method = init.method ?? 'GET';
			calls.push({ path, method, body: init.body ? JSON.parse(init.body as string) : undefined });
			const next = replies[key(method, path)]?.shift();
			if (!next) throw new Error(`unexpected request ${method} ${path}`);
			return new Response(JSON.stringify(next.body ?? {}), {
				status: next.status,
				headers: {
					'content-type': next.status >= 400 ? 'application/problem+json' : 'application/json'
				}
			});
		})
	);
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
	const oncreated = vi.fn();
	render(NewServerForm, {
		oncreated,
		serverHref: (id: string) => `/servers/${id}`,
		cancelHref: '/servers',
		jobIntervalMs: 5,
		searchDebounceMs: 5
	});
	return { oncreated };
}

const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path);

async function chooseVanilla() {
	reply(
		'GET',
		'/api/v1/software/vanilla/versions',
		ok({
			items: [
				{ id: '24w10a', stable: false },
				{ id: '1.21.1', stable: true },
				{ id: '1.20.1', stable: true }
			]
		})
	);
	await page.getByText('Vanilla', { exact: true }).click();
	await next();
	await expect
		.element(page.getByRole('combobox', { name: 'Minecraft version' }))
		.toHaveTextContent('1.21.1');
	await next();
	await page.getByLabelText('Server name').fill('Survival');
}

const next = () => page.getByRole('button', { name: 'Next' }).click();

/** From the name & port step, continue through resources to the review step. */
async function toReview() {
	await next();
	await expect.element(page.getByLabelText('Min heap (MiB)')).toBeVisible();
	await next();
	await expect.element(page.getByRole('checkbox', { name: /I accept the/ })).toBeVisible();
}

describe('NewServerForm', () => {
	it('lists real catalog availability, including why CurseForge is unavailable', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		setup();
		await expect.element(page.getByText('Set a CurseForge API key on the manager.')).toBeVisible();
		await expect.element(page.getByRole('radio', { name: /CurseForge/ })).toBeDisabled();
		await expect.element(page.getByRole('radio', { name: /Paper/ })).toBeEnabled();
		// Fabric/Forge are not in this catalog, so they are not offered.
		await expect.element(page.getByText('Fabric', { exact: true })).not.toBeInTheDocument();
		// Nothing chosen yet: the wizard cannot continue and no create button exists.
		await expect.element(page.getByRole('button', { name: 'Next' })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: /Create/ })).not.toBeInTheDocument();
	});

	it('creates a managed server, installs it, and never starts it', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		const { oncreated } = setup();
		await chooseVanilla();

		const installed = managedServer({
			launch: { path: 'server.jar', version: '1.21.1', build: null, javaMajor: 21, checksum: 'ab' }
		});
		reply('POST', '/api/v1/servers', ok({ server: managedServer() }, 201));
		reply('POST', '/api/v1/servers/srv-1/install', ok({ job: job('queued') }, 202));
		reply(
			'GET',
			'/api/v1/jobs/job-1',
			ok(job('running')),
			ok(job('succeeded', { progress: 1, result: { server: installed } }))
		);
		await toReview();
		// Nothing is created before the review step is confirmed.
		expect(posts('/api/v1/servers')).toHaveLength(0);
		await expect.element(page.getByText('Automatic (first free from 25565)')).toBeVisible();
		await page.getByRole('button', { name: 'Create and install' }).click();

		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
		expect(oncreated.mock.calls[0][0].launch.javaMajor).toBe(21);
		const [create] = posts('/api/v1/servers');
		expect(create.body).toMatchObject({
			name: 'Survival',
			acceptEula: false,
			software: { type: 'vanilla', version: '1.21.1' }
		});
		expect(create.body).not.toHaveProperty('jar');
		expect(create.body).not.toHaveProperty('dockerImage');
		// Blank game port means automatic assignment: the field is omitted.
		expect(create.body).not.toHaveProperty('port');
		expect(calls.some((c) => c.path.endsWith('/start') || c.path.endsWith('/eula'))).toBe(false);
	});

	it('defaults the game port to automatic', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		setup();
		await chooseVanilla();
		const port = page.getByLabelText('Game port (optional)');
		await expect.element(port).toHaveValue(null);
		await expect.element(port).toHaveAttribute('placeholder', 'Automatic');
	});

	it('sends an explicit port even when another server already uses it', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		const { oncreated } = setup();
		await chooseVanilla();
		await page.getByLabelText('Game port (optional)').fill('25565');
		await expect.element(page.getByText(/only one of them can run\s+at a time/)).toBeVisible();
		reply('POST', '/api/v1/servers', ok({ server: managedServer({ id: 'srv-1' }) }, 201));
		reply('POST', '/api/v1/servers/srv-1/install', ok({ job: job('queued') }, 202));
		reply(
			'GET',
			'/api/v1/jobs/job-1',
			ok(
				job('succeeded', {
					result: {
						server: managedServer({
							launch: {
								path: 'server.jar',
								version: '1.21.1',
								build: null,
								javaMajor: 21,
								checksum: 'ab'
							}
						})
					}
				})
			)
		);
		await toReview();
		await page.getByRole('button', { name: 'Create and install' }).click();
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
		const creates = posts('/api/v1/servers');
		expect(creates).toHaveLength(1);
		// The chosen port is never renumbered.
		expect(creates[0].body).toMatchObject({ port: 25565 });
	});

	it('rejects port 0 before sending a request', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		setup();
		await chooseVanilla();
		await page.getByLabelText('Game port (optional)').fill('0');
		await next();
		await expect.element(page.getByText(/or leave it blank for automatic/)).toBeVisible();
		// The wizard stays on the name & port step.
		await expect.element(page.getByLabelText('Min heap (MiB)')).not.toBeInTheDocument();
		expect(posts('/api/v1/servers')).toHaveLength(0);
	});

	it('moves back and forward without losing entered values', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		setup();
		await chooseVanilla();
		await page.getByLabelText('Game port (optional)').fill('25570');
		await next();
		await page.getByLabelText('Max heap (MiB)').fill('4096');
		await page.getByRole('button', { name: 'Back' }).click();
		await expect.element(page.getByLabelText('Server name')).toHaveValue('Survival');
		await expect.element(page.getByLabelText('Game port (optional)')).toHaveValue(25570);
		// The version picker remounts with the earlier choice preserved.
		reply(
			'GET',
			'/api/v1/software/vanilla/versions',
			ok({
				items: [
					{ id: '1.21.2', stable: true },
					{ id: '1.21.1', stable: true }
				]
			})
		);
		await page.getByRole('button', { name: 'Back' }).click();
		await expect
			.element(page.getByRole('combobox', { name: 'Minecraft version' }))
			.toHaveTextContent('1.21.1');
		await next();
		await toReview();
		await expect.element(page.getByText('512 MiB – 4 GiB heap')).toBeVisible();
		await expect.element(page.getByText('25570', { exact: true })).toBeVisible();
		// Review "Edit" jumps straight back to the step that owns the value.
		await page.getByRole('button', { name: 'Edit name' }).click();
		await expect.element(page.getByLabelText('Server name')).toHaveValue('Survival');
		expect(calls.some((c) => c.method !== 'GET')).toBe(false);
	});

	it('blocks continuing with an empty name and invalid heap bounds', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		setup();
		await chooseVanilla();
		await page.getByLabelText('Server name').fill('');
		await next();
		await expect.element(page.getByText(/Use 1–80 characters/)).toBeVisible();
		await page.getByLabelText('Server name').fill('Survival');
		await next();
		await page.getByLabelText('Max heap (MiB)').fill('256');
		await next();
		await expect
			.element(page.getByText('Maximum heap must be at least the minimum heap.'))
			.toBeVisible();
		await expect
			.element(page.getByRole('checkbox', { name: /I accept the/ }))
			.not.toBeInTheDocument();
	});

	it('clears the previous Paper build when the Minecraft version changes', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		reply(
			'GET',
			'/api/v1/software/paper/versions',
			ok({
				items: [
					{ id: '1.21.4', stable: true },
					{ id: '1.20.1', stable: true }
				]
			})
		);
		reply(
			'GET',
			'/api/v1/software/paper/versions/1.21.4/builds',
			ok({ items: [{ id: '232', stable: true }] })
		);
		reply(
			'GET',
			'/api/v1/software/paper/versions/1.20.1/builds',
			ok({ items: [{ id: '196', stable: true }] })
		);
		setup();
		await page.getByText('Paper', { exact: true }).click();
		await next();
		const gameVersion = page.getByRole('combobox', { name: 'Minecraft version' });
		const paperBuild = page.getByRole('combobox', { name: 'Paper build' });
		await expect.element(gameVersion).toHaveTextContent('1.21.4');
		await paperBuild.click();
		await page.getByRole('option', { name: '232', exact: true }).click();
		await expect.element(paperBuild).toHaveTextContent('232');
		await gameVersion.click();
		await page.getByRole('option', { name: '1.20.1', exact: true }).click();
		await expect.element(paperBuild).toHaveTextContent('Latest stable');
		await paperBuild.click();
		await expect.element(page.getByRole('option', { name: '196', exact: true })).toBeVisible();
		await expect
			.element(page.getByRole('option', { name: '232', exact: true }))
			.not.toBeInTheDocument();
	});

	it('keeps the record after a failed install and retries on the same ID', async () => {
		reply('GET', '/api/v1/software', ok(CATALOG));
		const { oncreated } = setup();
		await chooseVanilla();

		reply('POST', '/api/v1/servers', ok({ server: managedServer() }, 201));
		reply(
			'POST',
			'/api/v1/servers/srv-1/install',
			ok({ job: job('queued') }, 202),
			ok({ job: job('queued') }, 202)
		);
		reply(
			'GET',
			'/api/v1/jobs/job-1',
			ok(
				job('failed', {
					error: {
						code: 'software.upstream',
						detail: 'The software provider could not be reached.'
					}
				})
			),
			ok(job('succeeded', { result: { server: managedServer({ launch: {} }) } }))
		);
		await toReview();
		await page.getByRole('button', { name: 'Create and install' }).click();

		await expect.element(page.getByText('Software provider unavailable')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: /Open server/ }))
			.toHaveAttribute('href', '/servers/srv-1');
		expect(oncreated).not.toHaveBeenCalled();

		await page.getByRole('button', { name: 'Retry install' }).click();
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
		expect(posts('/api/v1/servers')).toHaveLength(1);
		expect(posts('/api/v1/servers/srv-1/install')).toHaveLength(2);
	});

	it('keeps the manual JAR path available when the catalog fails', async () => {
		reply('GET', '/api/v1/software', {
			status: 502,
			body: { code: 'software.upstream', detail: 'x' }
		});
		const { oncreated } = setup();
		await expect.element(page.getByText('Software provider unavailable')).toBeVisible();
		await page.getByRole('radio', { name: /Custom JAR/ }).click({ force: true });
		// Custom JARs skip the version stage and have no install stage.
		await expect.element(page.getByText(/step 1 of 4/)).toBeInTheDocument();
		expect(
			document.querySelector('ol[aria-label="New server progress"]')?.textContent
		).not.toContain('Install');
		await next();
		await page.getByLabelText('Server name').fill('Manual');
		await next();
		await expect.element(page.getByLabelText('JAR path')).toHaveValue('server.jar');
		await next();
		await expect.element(page.getByText('server.jar', { exact: true })).toBeVisible();

		reply(
			'POST',
			'/api/v1/servers',
			ok({ server: managedServer({ software: null, name: 'Manual' }) }, 201)
		);
		await page.getByRole('button', { name: 'Create server' }).click();

		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
		const [create] = posts('/api/v1/servers');
		expect(create.body).toMatchObject({ jar: 'server.jar', dockerImage: 'eclipse-temurin:21-jre' });
		expect(create.body).not.toHaveProperty('software');
		expect(calls.some((c) => c.path.includes('/install'))).toBe(false);
	});

	it('searches CurseForge, picks a pack and release, and drops unsafe links', async () => {
		reply(
			'GET',
			'/api/v1/software',
			ok({
				items: [{ id: 'curseforge', name: 'CurseForge', available: true, reason: null }]
			})
		);
		setup();
		await page.getByText('CurseForge modpack', { exact: true }).click();
		await next();

		reply(
			'GET',
			'/api/v1/modpacks/curseforge?query=atm&index=0',
			ok({
				items: [
					{
						id: 101,
						name: 'All the Mods 10',
						summary: '<img src=x onerror=alert(1)>',
						websiteUrl: 'javascript:alert(1)',
						logoUrl: 'https://evil.example/logo.png',
						downloads: 1_234_567
					}
				],
				pagination: { index: 0, pageSize: 20, totalCount: 1 }
			})
		);
		await page.getByLabelText('Search modpacks').fill('atm');
		await expect.element(page.getByText('All the Mods 10')).toBeVisible();
		// Upstream text is rendered as text, never markup or remote images.
		await expect.element(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
		expect(document.querySelector('img')).toBeNull();
		expect(document.querySelector('a[href^="javascript:"]')).toBeNull();

		reply(
			'GET',
			'/api/v1/modpacks/curseforge/101/files',
			ok({
				items: [{ id: 555, name: 'ATM10 2.0', gameVersions: ['1.21.1'], serverPackFileId: 556 }]
			})
		);
		await page.getByRole('button', { name: 'Select All the Mods 10' }).click();
		await expect
			.element(page.getByRole('combobox', { name: 'Release' }))
			.toHaveTextContent('ATM10 2.0');
		await next();
		await page.getByLabelText('Server name').fill('ATM');

		reply(
			'POST',
			'/api/v1/servers',
			ok(
				{
					server: managedServer({ software: { type: 'curseforge', projectId: 101, fileId: 555 } })
				},
				201
			)
		);
		reply('POST', '/api/v1/servers/srv-1/install', {
			status: 409,
			body: { code: 'server.busy', detail: 'Busy.' }
		});
		await toReview();
		await expect.element(page.getByText('All the Mods 10 (file 555)')).toBeVisible();
		await page.getByRole('button', { name: 'Create and install' }).click();
		await expect.element(page.getByText('Operation in progress')).toBeVisible();
		expect(posts('/api/v1/servers')[0].body).toMatchObject({
			software: { type: 'curseforge', projectId: 101, fileId: 555 }
		});
	});
});
