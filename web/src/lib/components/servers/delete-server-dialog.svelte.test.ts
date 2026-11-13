import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import DeleteServerDialog from './delete-server-dialog.svelte';

type Reply = { status: number; body?: unknown };
let calls: { path: string; method: string }[];
let replies: Record<string, Reply[]>;

const reply = (method: string, path: string, ...queue: Reply[]) =>
	(replies[`${method} ${path}`] = queue);

const job = (state: string, extra: Record<string, unknown> = {}) => ({
	id: 'job-d',
	kind: 'server.delete',
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

const status = (state: string) => ({ state, containerId: null, exitCode: null, oomKilled: false });
const server = (state = 'stopped') => ({
	id: 'srv-1',
	name: 'Survival',
	directory: '/data/servers/srv-1',
	port: 25566,
	status: status(state) as never
});

beforeEach(() => {
	calls = [];
	replies = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init: RequestInit) => {
			const method = init.method ?? 'GET';
			calls.push({ path, method });
			const next = replies[`${method} ${path}`]?.shift();
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

function setup(state = 'stopped') {
	const ondeleted = vi.fn();
	render(DeleteServerDialog, { server: server(state), ondeleted, jobIntervalMs: 5 });
	return { ondeleted };
}

const trigger = () => page.getByRole('button', { name: 'Delete', exact: true });

describe('DeleteServerDialog', () => {
	it('is unavailable unless the server is stopped', async () => {
		setup('running');
		await expect.element(trigger()).toBeDisabled();
		expect(calls).toHaveLength(0);
	});

	it('requires confirmation and keeps files by default', async () => {
		const { ondeleted } = setup();
		await trigger().click();
		const dialog = page.getByRole('alertdialog');
		await expect.element(dialog).toHaveTextContent('Delete “Survival”?');
		await expect.element(dialog).toHaveTextContent('/data/servers/srv-1');
		await expect.element(dialog).toHaveTextContent(/stay on the manager host/);
		await expect
			.element(page.getByRole('checkbox', { name: 'Also delete world and server files' }))
			.not.toBeChecked();
		// Opening the dialog alone sends nothing.
		expect(calls).toHaveLength(0);

		reply('DELETE', '/api/v1/servers/srv-1?deleteFiles=false', {
			status: 202,
			body: { job: job('queued') }
		});
		reply(
			'GET',
			'/api/v1/jobs/job-d',
			{ status: 200, body: job('running') },
			{
				status: 200,
				body: job('succeeded', {
					result: {
						deleted: { id: 'srv-1', filesDeleted: false, retainedDirectory: '/data/servers/srv-1' }
					}
				})
			}
		);
		await page.getByRole('button', { name: 'Delete server', exact: true }).click();
		await vi.waitFor(() => expect(ondeleted).toHaveBeenCalledOnce());
		expect(ondeleted.mock.calls[0][0]).toEqual({
			id: 'srv-1',
			filesDeleted: false,
			retainedDirectory: '/data/servers/srv-1'
		});
		// Only the job is polled; the deleted server is never fetched.
		expect(calls.some((c) => c.method === 'GET' && c.path.startsWith('/api/v1/servers'))).toBe(
			false
		);
		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
	});

	it('sends deleteFiles=true only when the checkbox is ticked', async () => {
		const { ondeleted } = setup();
		await trigger().click();
		await page.getByRole('checkbox', { name: 'Also delete world and server files' }).click();
		await expect.element(page.getByRole('alertdialog')).toHaveTextContent(/Permanently deletes/);
		reply('DELETE', '/api/v1/servers/srv-1?deleteFiles=true', {
			status: 202,
			body: { job: job('queued') }
		});
		reply('GET', '/api/v1/jobs/job-d', {
			status: 200,
			body: job('succeeded', {
				result: { deleted: { id: 'srv-1', filesDeleted: true, retainedDirectory: null } }
			})
		});
		await page.getByRole('button', { name: 'Delete server and files' }).click();
		await vi.waitFor(() => expect(ondeleted).toHaveBeenCalledOnce());
		expect(ondeleted.mock.calls[0][0].filesDeleted).toBe(true);
	});

	it('shows a failed job, keeps the dialog open and does not report deletion', async () => {
		const { ondeleted } = setup();
		await trigger().click();
		reply('DELETE', '/api/v1/servers/srv-1?deleteFiles=false', {
			status: 202,
			body: { job: job('queued') }
		});
		reply('GET', '/api/v1/jobs/job-d', {
			status: 200,
			body: job('failed', { error: { code: 'docker.unavailable', detail: 'No Docker engine.' } })
		});
		await page.getByRole('button', { name: 'Delete server', exact: true }).click();
		const dialog = page.getByRole('alertdialog');
		await expect.element(dialog).toHaveTextContent('Docker unavailable');
		await expect
			.element(dialog)
			.toHaveTextContent('Server files are retained on the manager host.');
		await expect
			.element(page.getByRole('button', { name: 'Delete server', exact: true }))
			.toBeEnabled();
		expect(ondeleted).not.toHaveBeenCalled();
	});

	it('explains a running-server rejection without force-stopping', async () => {
		const { ondeleted } = setup();
		await trigger().click();
		reply('DELETE', '/api/v1/servers/srv-1?deleteFiles=false', {
			status: 409,
			body: { code: 'server.running', detail: 'The server is running.' }
		});
		await page.getByRole('button', { name: 'Delete server', exact: true }).click();
		await expect
			.element(page.getByRole('alertdialog'))
			.toHaveTextContent('Deleting never stops a running server.');
		expect(ondeleted).not.toHaveBeenCalled();
		expect(calls.every((c) => !c.path.endsWith('/stop') && !c.path.endsWith('/kill'))).toBe(true);
	});
});
