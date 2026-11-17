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
let isolationCalls: number;
const GiB = 1024 ** 3;
let isolation: unknown;

const server = (state: ServerState = 'stopped', extra: Partial<ServerView> = {}): ServerView => ({
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
	status: { state, containerId: null, exitCode: null, oomKilled: false },
	...extra
});

beforeEach(() => {
	calls = [];
	responses = {};
	isolationCalls = 0;
	isolation = {
		docker: {
			available: true,
			version: '27.0',
			reason: null,
			capacity: {
				logicalCpus: 8,
				memoryTotalBytes: 16 * GiB,
				architecture: 'x86_64',
				operatingSystem: 'Debian GNU/Linux 12'
			}
		}
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const method = init.method ?? 'GET';
			if (url === '/api/v1/system/isolation') {
				// Host capacity for guidance, fetched once when the form opens.
				isolationCalls++;
				return new Response(JSON.stringify(isolation), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
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

const ramInput = () => field('Server RAM (MiB)');
const cpuInput = () => field('CPU limit (cores)');
const initialInput = () => field('Initial heap (MiB)');
const openAdvanced = () => page.getByRole('button', { name: /Advanced · initial heap/ }).click();
const pressed = (name: string) => page.getByRole('button', { name, exact: true });

describe('ServerResources', () => {
	it('shows a compact summary and expands on demand', async () => {
		render(ServerResources, { server: server(), busy: false, onServerUpdated: vi.fn() });
		await expect.element(page.getByText('2 GiB', { exact: true })).toBeVisible();
		await expect.element(page.getByText('(initial 512 MiB)')).toBeVisible();
		await expect.element(page.getByRole('slider')).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Edit' }).click();
		await expect.element(page.getByTestId(/-ram-value$/)).toHaveTextContent(/^2\s*GB$/);
		await expect.element(pressed('2 GB')).toHaveAttribute('aria-pressed', 'true');
		await expect.element(pressed('2 cores')).toHaveAttribute('aria-pressed', 'true');
		expect(isolationCalls).toBe(1);
		await expect
			.element(page.getByTestId(/-capacity$/))
			.toHaveTextContent(/16\.0 GiB RAM\s*·\s*8 logical CPUs/);
	});

	it('saves presets, a custom CPU limit and an advanced initial heap', async () => {
		const updated = server('stopped', { memoryMinMb: 1024, memoryMaxMb: 4096, cpus: 1.5 });
		responses[`PATCH ${URL}`] = [{ status: 200, body: { server: updated } }];
		const onServerUpdated = vi.fn();
		render(ServerResources, { server: server(), busy: false, onServerUpdated, open: true });
		await pressed('4 GB').click();
		await pressed('Custom CPU limit').click();
		await cpuInput().fill('1.5');
		await openAdvanced();
		await initialInput().fill('1024');
		await page.getByRole('button', { name: 'Save resources' }).click();
		await vi.waitFor(() => expect(onServerUpdated).toHaveBeenCalledWith(updated));
		expect(calls).toEqual([
			{ url: URL, method: 'PATCH', body: { memoryMinMb: 1024, memoryMaxMb: 4096, cpus: 1.5 } }
		]);
	});

	it('keeps unusual existing allocations exact as Custom', async () => {
		const updated = server('stopped', { memoryMinMb: 512, memoryMaxMb: 8048, cpus: 3 });
		responses[`PATCH ${URL}`] = [{ status: 200, body: { server: updated } }];
		const onServerUpdated = vi.fn();
		render(ServerResources, {
			server: server('stopped', { memoryMinMb: 512, memoryMaxMb: 8048, cpus: 2 }),
			busy: false,
			onServerUpdated,
			open: true
		});
		// Not rounded to 8 GB: shown as an exact custom amount, no preset pressed.
		await expect.element(ramInput()).toHaveValue(8048);
		await expect
			.element(page.getByTestId(/-ram-value$/))
			.toHaveTextContent(/^8,048\s*MiB\s*custom$/);
		await expect.element(pressed('8 GB')).toHaveAttribute('aria-pressed', 'false');
		await expect
			.element(page.getByRole('button', { name: /Advanced · initial heap 512 MiB/ }))
			.toBeVisible();
		// Nothing changed yet, so nothing can be saved.
		await expect.element(page.getByRole('button', { name: 'Save resources' })).toBeDisabled();
		// Changing only the CPU sends the heap values exactly as they were.
		await pressed('4 cores').click();
		await pressed('Custom CPU limit').click();
		await cpuInput().fill('3');
		await page.getByRole('button', { name: 'Save resources' }).click();
		await vi.waitFor(() => expect(onServerUpdated).toHaveBeenCalledWith(updated));
		expect(calls[0].body).toEqual({ memoryMinMb: 512, memoryMaxMb: 8048, cpus: 3 });
	});

	it('moves the slider in whole binary gigabytes', async () => {
		render(ServerResources, {
			server: server(),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		const slider = page.getByRole('slider', { name: 'Server RAM (GB)' });
		await expect.element(slider).toHaveValue('2');
		await slider.fill('6');
		await expect.element(page.getByTestId(/-ram-value$/)).toHaveTextContent(/^6\s*GB$/);
		await expect.element(page.getByText('6,144 MiB (1 GB = 1,024 MiB)')).toBeVisible();
	});

	it('validates locally before sending', async () => {
		render(ServerResources, {
			server: server(),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await openAdvanced();
		await initialInput().fill('4096');
		await page.getByRole('button', { name: 'Save resources' }).click();
		await expect
			.element(page.getByText('Maximum heap must be at least the minimum heap.'))
			.toBeVisible();
		await pressed('Custom CPU limit').click();
		await cpuInput().fill('300');
		await expect.element(page.getByText('Enter between 0.1 and 256 CPUs.')).toBeVisible();
		await initialInput().fill('100');
		await expect.element(page.getByText('Minimum heap must be at least 128 MiB.')).toBeVisible();
		expect(calls).toHaveLength(0);
	});

	it('warns about oversized allocations without blocking or clamping', async () => {
		const updated = server('stopped', { memoryMaxMb: 16384, cpus: 16 });
		responses[`PATCH ${URL}`] = [{ status: 200, body: { server: updated } }];
		const onServerUpdated = vi.fn();
		render(ServerResources, { server: server(), busy: false, onServerUpdated, open: true });
		await pressed('16 GB').click();
		await expect
			.element(page.getByTestId(/-memory-warning$/))
			.toHaveTextContent(/more than the 16\.0 GiB/);
		await pressed('Custom CPU limit').click();
		await cpuInput().fill('16');
		await expect.element(page.getByTestId(/-cpu-warning$/)).toHaveTextContent('8 logical CPUs');
		await page.getByRole('button', { name: 'Save resources' }).click();
		await vi.waitFor(() => expect(onServerUpdated).toHaveBeenCalledWith(updated));
		expect(calls[0].body).toEqual({ memoryMinMb: 512, memoryMaxMb: 16384, cpus: 16 });
	});

	it('does not block when host capacity is unknown', async () => {
		isolation = { docker: { available: false, version: null, reason: 'down', capacity: null } };
		render(ServerResources, {
			server: server(),
			busy: false,
			onServerUpdated: vi.fn(),
			open: true
		});
		await expect.element(page.getByText(/Docker host capacity unknown/)).toBeVisible();
		await pressed('16 GB').click();
		await expect.element(page.getByTestId(/-memory-warning$/)).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Save resources' })).toBeEnabled();
	});

	it('is locked with stop-first help while running or unknown', async () => {
		for (const state of ['running', 'unknown'] as const) {
			const view = render(ServerResources, {
				server: server(state),
				busy: false,
				onServerUpdated: vi.fn(),
				open: true
			});
			await expect.element(pressed('4 GB')).toBeDisabled();
			await expect.element(page.getByRole('slider')).toBeDisabled();
			await expect.element(page.getByText('Stop the server to change resources.')).toBeVisible();
			view.unmount();
		}
	});

	it('is locked while another operation runs', async () => {
		render(ServerResources, { server: server(), busy: true, onServerUpdated: vi.fn(), open: true });
		await expect.element(pressed('2 cores')).toBeDisabled();
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
		await pressed('4 cores').click();
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
		await pressed('4 cores').click();
		await view.rerender({ server: server('stopped', { port: 25570 }) });
		await expect.element(pressed('4 cores')).toHaveAttribute('aria-pressed', 'true');
		await view.rerender({ server: server('stopped', { memoryMaxMb: 3072 }) });
		await expect.element(pressed('4 cores')).toHaveAttribute('aria-pressed', 'true');
		expect(isolationCalls).toBe(1);
	});
});
