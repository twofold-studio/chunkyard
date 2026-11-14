import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerExports from './server-exports.svelte';

type Reply = { status: number; body?: unknown };
let calls: { path: string; method: string; body?: unknown }[];
let replies: Record<string, Reply[]>;
const reply = (method: string, path: string, ...queue: Reply[]) =>
	(replies[`${method} ${path}`] = queue);

const storage = (configured: boolean) => ({
	configured,
	endpoint: configured ? 'http://10.0.0.5:9000' : '',
	region: configured ? 'us-east-1' : '',
	bucket: configured ? 'mc' : '',
	prefix: '',
	accessKeyId: configured ? 'AKIA' : '',
	hasSecret: configured
});

const archive = (id: string, serverId = 'srv-1', destination = 'local') => ({
	id,
	serverId,
	serverName: 'Survival',
	scope: 'world',
	destination,
	createdAt: '2026-11-14T10:00:00Z',
	size: 2048,
	sha256: 'abcdef0123456789'.repeat(4),
	fileName: `survival-${id}.tar.gz`,
	objectKey: destination === 's3' ? `survival-${id}.tar.gz` : null
});

const job = (state: string, extra: Record<string, unknown> = {}) => ({
	id: 'job-x',
	kind: 'server.export',
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
			calls.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
			const next = replies[`${method} ${path}`]?.shift();
			if (!next) throw new Error(`unexpected request ${method} ${path}`);
			if (next.status === 204) return new Response(null, { status: 204 });
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

const exportButton = () => page.getByRole('button', { name: 'Export', exact: true });

describe('ServerExports', () => {
	it('lists only this server’s archives and requires a stopped server', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
		reply('GET', '/api/v1/exports', {
			status: 200,
			body: { items: [archive('a'), archive('b', 'srv-2')] }
		});
		render(ServerExports, { serverId: 'srv-1', serverState: 'running' });
		await expect.element(page.getByText('survival-a.tar.gz')).toBeVisible();
		await expect.element(page.getByText('survival-b.tar.gz')).not.toBeInTheDocument();
		await expect.element(page.getByText('Stop the server to export')).toBeVisible();
		await expect.element(exportButton()).toBeDisabled();
		await expect.element(page.getByRole('radio', { name: 'S3' })).toBeDisabled();
	});

	it('exports selected paths to S3 and shows the verified archive', async () => {
		const created = archive('new', 'srv-1', 's3');
		reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
		reply('POST', '/api/v1/servers/srv-1/exports', { status: 202, body: { job: job('queued') } });
		reply(
			'GET',
			'/api/v1/jobs/job-x',
			{ status: 200, body: job('running') },
			{ status: 200, body: job('succeeded', { result: created }) }
		);
		render(ServerExports, { serverId: 'srv-1', serverState: 'stopped', jobIntervalMs: 5 });

		await page.getByRole('radio', { name: 'Selected paths' }).click();
		await exportButton().click();
		await expect.element(page.getByText('Enter at least one path.')).toBeVisible();

		await page.getByRole('textbox').fill('world\n/plugins/\nworld');
		await page.getByRole('radio', { name: 'S3' }).click();
		await exportButton().click();

		await expect.element(page.getByText('Export verified', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('listitem')).toHaveTextContent('survival-new.tar.gz');
		const post = calls.find((c) => c.method === 'POST');
		expect(post?.body).toEqual({
			scope: 'selected',
			destination: 's3',
			paths: ['world', 'plugins']
		});
	});

	it('reports a failed export job without touching files', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
		reply('POST', '/api/v1/servers/srv-1/exports', {
			status: 202,
			body: { job: job('failed', { error: { code: 'exports.limit', detail: 'Too big.' } }) }
		});
		render(ServerExports, { serverId: 'srv-1', serverState: 'stopped', jobIntervalMs: 5 });
		await exportButton().click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Export too large');
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Server files were not changed.');
	});

	it('deletes an archive after confirmation', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [archive('a')] } });
		reply('DELETE', '/api/v1/exports/a', { status: 204 });
		render(ServerExports, { serverId: 'srv-1', serverState: 'running' });
		await page.getByRole('button', { name: 'Delete survival-a.tar.gz' }).click();
		await expect.element(page.getByRole('alertdialog')).toHaveTextContent('not affected');
		await page.getByRole('button', { name: 'Delete archive' }).click();
		await expect.element(page.getByText('survival-a.tar.gz')).not.toBeInTheDocument();
		expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/exports/a')).toBe(true);
	});

	it('links downloads through the authenticated backend route', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
		reply('GET', '/api/v1/exports', {
			status: 200,
			body: { items: [archive('s', 'srv-1', 's3')] }
		});
		render(ServerExports, { serverId: 'srv-1', serverState: 'stopped' });
		await expect
			.element(page.getByRole('link', { name: 'Download survival-s.tar.gz' }))
			.toHaveAttribute('href', '/api/v1/exports/s/download');
	});
});
