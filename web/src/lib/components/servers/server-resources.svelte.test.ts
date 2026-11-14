import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerResources from './server-resources.svelte';
import type { ServerState, ServerView } from '#lib/api/index.js';

interface Call {
	url: string;
	method: string;
	body: unknown;
}
let calls: Call[];
let responses: Record<string, { status: number; body: unknown }[]>;

const server = (state: ServerState = 'stopped', extra: Partial<ServerView> = {}): ServerView => ({
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
	status: { state, containerId: null, exitCode: null, oomKilled: false },
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

const URL = '/api/v1/servers/srv-1/resources';
const field = (name: string) => page.getByLabelText(name);

describe('ServerResources', () => {
	it('shows a compact summary and expands on demand', async () => {
		render(ServerResources, { server: server(), busy: false, onServerUpdated: vi.fn() });
		await expect.element(page.getByText('512 MiB – 2 GiB')).toBeVisible();
		await expect.element(field('CPU limit')).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Edit' }).click();
		await expect.element(field('CPU limit')).toHaveValue(2);
	});

	it('saves new limits for a stopped server', async () => {
		const updated = server('stopped', { memoryMinMb: 1024, memoryMaxMb: 4096, cpus: 1.5 });
		responses[`PATCH ${URL}`] = [{ status: 200, body: { server: updated } }];
		const onServerUpdated = vi.fn();
		render(ServerResources, { server: server(), busy: false, onServerUpdated, open: true });
		await field('Min heap (MiB)').fill('1024');
		await field('Max heap (MiB)').fill('4096');
		await field('CPU limit').fill('1.5');
		await page.getByRole('button', { name: 'Save resources' }).click();
		await vi.waitFor(() => expect(onServerUpdated).toHaveBeenCalledWith(updated));
		expect(calls).toEqual([
			{ url: URL, method: 'PATCH', body: { memoryMinMb: 1024, memoryMaxMb: 4096, cpus: 1.5 } }
		]);
	});

	it('validates locally before sending', async () => {
		render(ServerResources, {
			server: server(),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await field('Min heap (MiB)').fill('4096');
		await page.getByRole('button', { name: 'Save resources' }).click();
		await expect
			.element(page.getByText('Maximum heap must be at least the minimum heap.'))
			.toBeVisible();
		await field('CPU limit').fill('300');
		await expect.element(page.getByText('Enter between 0.1 and 256 CPUs.')).toBeVisible();
		expect(calls).toHaveLength(0);
	});

	it('is locked with stop-first help while running or unknown', async () => {
		for (const state of ['running', 'unknown'] as const) {
			const view = render(ServerResources, {
				server: server(state),
				busy: false,
				onServerUpdated: vi.fn(),
				open: true
			});
			await expect.element(field('CPU limit')).toBeDisabled();
			await expect.element(page.getByText('Stop the server to change resources.')).toBeVisible();
			view.unmount();
		}
	});

	it('is locked while another operation runs', async () => {
		render(ServerResources, { server: server(), busy: true, onServerUpdated: vi.fn(), open: true });
		await expect.element(field('Max heap (MiB)')).toBeDisabled();
		await expect.element(page.getByText('Wait for the current operation to finish.')).toBeVisible();
	});

	it('shows backend rejections', async () => {
		responses[`PATCH ${URL}`] = [
			{ status: 409, body: { code: 'server.running', detail: 'The server is running.' } }
		];
		render(ServerResources, {
			server: server(),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await field('CPU limit').fill('3');
		await page.getByRole('button', { name: 'Save resources' }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Server is running');
	});

	it('keeps local edits when the record refreshes', async () => {
		const view = render(ServerResources, {
			server: server(),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await field('CPU limit').fill('3');
		await view.rerender({ server: server('stopped', { port: 25570 }) });
		await expect.element(field('CPU limit')).toHaveValue(3);
		await view.rerender({ server: server('stopped', { memoryMaxMb: 3072 }) });
		await expect.element(field('CPU limit')).toHaveValue(3);
	});
});
