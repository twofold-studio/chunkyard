import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerNetwork from './server-network.svelte';
import type { ServerState } from '#lib/api/index.js';

interface Call {
	url: string;
	method: string;
	body: unknown;
}
let calls: Call[];
let responses: Record<string, unknown[]>;

const status = (state: ServerState) => ({
	state,
	containerId: null,
	exitCode: null,
	oomKilled: false
});

const server = (state: ServerState = 'stopped', extra: Record<string, unknown> = {}) => ({
	archive: null,
	autoJava: false,
	launchOverride: null,
	publishIp: null,
	icon: null,
	software: null,
	launch: null,
	id: 'srv-1',
	name: 'Survival',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 2048,
	cpus: 2,
	acceptEula: true,
	directory: '/srv/srv-1',
	status: status(state),
	...extra
});

const network = (extra: Record<string, unknown> = {}) => ({
	port: 25565,
	publishIp: null,
	effectivePublishIp: '0.0.0.0',
	boundPublishIp: null,
	boundPort: null,
	restartRequired: false,
	status: status('stopped'),
	...extra
});

beforeEach(() => {
	calls = [];
	responses = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const method = init.method ?? 'GET';
			calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined });
			const queue = responses[`${method} ${url}`];
			const next = queue?.shift();
			if (!next) throw new Error(`unexpected ${method} ${url}`);
			return new Response(JSON.stringify(next), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
});
afterEach(() => vi.unstubAllGlobals());

const URL = '/api/v1/servers/srv-1/network';

describe('ServerNetwork', () => {
	it('saves a new port and NetBird-friendly bind address, then refreshes metadata', async () => {
		responses[`GET ${URL}`] = [
			network(),
			network({ port: 25570, publishIp: '100.80.1.2', effectivePublishIp: '100.80.1.2' })
		];
		responses[`PATCH ${URL}`] = [{ server: server('stopped', { port: 25570 }) }];
		const onServerUpdated = vi.fn();
		render(ServerNetwork, { server: server(), busy: false, onServerUpdated });

		const save = page.getByRole('button', { name: 'Save network' });
		await expect.element(page.getByLabelText('Host port')).toHaveValue(25565);
		await expect.element(save).toBeDisabled();
		await page.getByText('Playing over NetBird or another VPN?').click();
		await expect.element(page.getByText(/NetBird \(or other VPN\)/)).toBeVisible();

		await page.getByLabelText('Host port').fill('25570');
		await page.getByLabelText('Bind address', { exact: true }).fill('not-an-ip');
		await save.click();
		await expect.element(page.getByText(/Enter an IPv4 or IPv6 address/)).toBeVisible();
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

		await page.getByLabelText('Bind address', { exact: true }).fill('100.80.1.2');
		await save.click();
		await vi.waitFor(() => expect(onServerUpdated).toHaveBeenCalledOnce());
		expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
			port: 25570,
			publishIp: '100.80.1.2'
		});
		await expect.element(page.getByText('100.80.1.2:25570')).toBeVisible();
	});

	it('restores the manager default with a null bind address', async () => {
		responses[`GET ${URL}`] = [
			network({ publishIp: '127.0.0.1', effectivePublishIp: '127.0.0.1' }),
			network()
		];
		responses[`PATCH ${URL}`] = [{ server: server() }];
		render(ServerNetwork, { server: server(), busy: false, onServerUpdated: vi.fn() });
		await expect
			.element(page.getByLabelText('Bind address', { exact: true }))
			.toHaveValue('127.0.0.1');
		await page.getByRole('button', { name: /Manager default/ }).click();
		await page.getByRole('button', { name: 'Save network' }).click();
		await vi.waitFor(() =>
			expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
				port: 25565,
				publishIp: null
			})
		);
	});

	it('is read-only while running and explains a pending restart', async () => {
		responses[`GET ${URL}`] = [
			network({
				status: status('running'),
				boundPublishIp: '127.0.0.1',
				boundPort: 25565,
				restartRequired: true
			})
		];
		render(ServerNetwork, { server: server('running'), busy: false, onServerUpdated: vi.fn() });
		await expect.element(page.getByText('Restart to apply the new binding')).toBeVisible();
		await expect.element(page.getByLabelText('Host port')).toBeDisabled();
		await expect.element(page.getByLabelText('Bind address', { exact: true })).toBeDisabled();
		await expect
			.element(page.getByText('Stop the server to change network settings.'))
			.toBeVisible();
		await expect.element(page.getByText('127.0.0.1:25565', { exact: true })).toBeVisible();
	});

	it('collapses to a one-line summary that still flags a pending restart', async () => {
		responses[`GET ${URL}`] = [
			network({ restartRequired: true, boundPublishIp: '127.0.0.1', boundPort: 25565 })
		];
		render(ServerNetwork, {
			server: server('running'),
			busy: false,
			onServerUpdated: vi.fn(),
			open: false
		});
		await expect.element(page.getByText('0.0.0.0:25565')).toBeVisible();
		await expect.element(page.getByText('Restart to apply', { exact: true })).toBeVisible();
		await expect.element(page.getByLabelText('Host port')).not.toBeInTheDocument();
		const toggle = page.getByRole('button', { name: 'Edit' });
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
		await toggle.click();
		await expect.element(page.getByLabelText('Host port')).toBeDisabled();
		await expect
			.element(page.getByRole('button', { name: 'Hide' }))
			.toHaveAttribute('aria-expanded', 'true');
	});
});
