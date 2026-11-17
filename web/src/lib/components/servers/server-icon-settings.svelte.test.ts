import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerIconSettings from './server-icon-settings.svelte';
import type { ServerView } from '#lib/api/index.js';

interface Call {
	url: string;
	method: string;
	contentType: string | null;
	body: unknown;
}
let calls: Call[];
let replies: { status: number; body: unknown }[];

const server = (extra: Partial<ServerView> = {}): ServerView => ({
	archive: null,
	autoJava: false,
	launchOverride: null,
	publishIp: null,
	launch: null,
	id: 'srv-1',
	name: 'ATM',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 2048,
	cpus: 2,
	acceptEula: true,
	directory: '/srv/srv-1',
	status: { state: 'running', containerId: 'c', exitCode: null, oomKilled: false },
	software: { type: 'curseforge', projectId: 925200, fileId: 555 },
	icon: { url: '/api/v1/servers/srv-1/icon', source: 'modpack' },
	...extra
});

beforeEach(() => {
	calls = [];
	replies = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const headers = new Headers(init.headers);
			calls.push({
				url,
				method: init.method ?? 'GET',
				contentType: headers.get('content-type'),
				body: init.body
			});
			const next = replies.shift();
			if (!next) throw new Error(`unexpected ${init.method} ${url}`);
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

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const png = (size = 64, name = 'logo.png', type = 'image/png') =>
	new File([new Uint8Array(size)], name, { type });

describe('ServerIconSettings', () => {
	it('uploads raw image bytes while running and applies the returned server', async () => {
		const updated = server({ icon: { url: '/api/v1/servers/srv-1/icon?v=2', source: 'custom' } });
		replies.push({ status: 200, body: { server: updated } });
		const onServerUpdated = vi.fn();
		render(ServerIconSettings, { server: server(), onServerUpdated });
		await expect.element(page.getByText(/Using the modpack logo/)).toBeVisible();
		await expect.element(page.getByText(/server list icon is not changed/)).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
		const file = png();
		await userEvent.upload(fileInput(), file);
		await vi.waitFor(() => expect(onServerUpdated).toHaveBeenCalledWith(updated));
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			url: '/api/v1/servers/srv-1/icon',
			method: 'PUT',
			contentType: 'image/png'
		});
		expect((calls[0].body as Blob).size).toBe(64);
	});

	it('rejects unsupported or oversized files before sending', async () => {
		render(ServerIconSettings, { server: server(), onServerUpdated: vi.fn() });
		await userEvent.upload(fileInput(), png(10, 'logo.svg', 'image/svg+xml'));
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Choose a PNG, JPEG, WebP or ICO image.');
		await userEvent.upload(fileInput(), png(2 * 1024 * 1024 + 1));
		await expect.element(page.getByRole('alert')).toHaveTextContent('larger than 2 MiB');
		expect(calls).toHaveLength(0);
	});

	it('shows backend icon errors', async () => {
		replies.push({ status: 415, body: { code: 'icons.unsupported', detail: 'Not an image.' } });
		const onServerUpdated = vi.fn();
		render(ServerIconSettings, { server: server(), onServerUpdated });
		await userEvent.upload(fileInput(), png());
		await expect.element(page.getByText('Unsupported image type')).toBeVisible();
		expect(onServerUpdated).not.toHaveBeenCalled();
	});

	it('resets a custom icon back to the pack logo', async () => {
		const reset = server();
		replies.push({ status: 200, body: { server: reset } });
		const onServerUpdated = vi.fn();
		render(ServerIconSettings, {
			server: server({ icon: { url: '/api/v1/servers/srv-1/icon?v=2', source: 'custom' } }),
			onServerUpdated
		});
		await expect.element(page.getByRole('button', { name: 'Change' })).toBeVisible();
		await page.getByRole('button', { name: 'Reset' }).click();
		await vi.waitFor(() => expect(onServerUpdated).toHaveBeenCalledWith(reset));
		expect(calls[0]).toMatchObject({ url: '/api/v1/servers/srv-1/icon', method: 'DELETE' });
	});

	it('reports a failed reset and keeps the custom icon', async () => {
		replies.push({ status: 500, body: { code: 'icons.storage', detail: 'Disk full.' } });
		const onServerUpdated = vi.fn();
		render(ServerIconSettings, {
			server: server({ icon: { url: '/api/v1/servers/srv-1/icon?v=2', source: 'custom' } }),
			onServerUpdated
		});
		await page.getByRole('button', { name: 'Reset' }).click();
		await expect.element(page.getByText('Could not store the icon')).toBeVisible();
		expect(onServerUpdated).not.toHaveBeenCalled();
	});
});
