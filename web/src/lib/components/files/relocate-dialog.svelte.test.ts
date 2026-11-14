import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import RelocateDialog, { type RelocateRequest } from './relocate-dialog.svelte';
import type { FileEntry } from '#lib/api/index.js';

type Reply = { status: number; body?: unknown; wait?: Promise<void> };
interface Call {
	url: string;
	method: string;
	body: unknown;
	signal?: AbortSignal | null;
}

let calls: Call[];
let replies: Record<string, Reply[]>;

const key = (method: string, url: string) => `${method} ${url}`;
function reply(method: string, url: string, ...queue: Reply[]) {
	replies[key(method, url)] = [...(replies[key(method, url)] ?? []), ...queue];
}
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const problem = (status: number, code: string): Reply => ({ status, body: { code, detail: code } });

const BASE = '/api/v1/servers/srv-1/files';
const list = (path: string) => `${BASE}?${new URLSearchParams({ path })}`;

const entry = (path: string, extra: Partial<FileEntry> = {}): FileEntry => ({
	name: path.slice(path.lastIndexOf('/') + 1),
	path,
	kind: 'file',
	size: 10,
	modifiedAt: null,
	readOnly: false,
	...extra
});
const dir = (path: string, extra: Partial<FileEntry> = {}) =>
	entry(path, { kind: 'directory', size: 0, ...extra });
const listing = (path: string, entries: FileEntry[], extra: Record<string, unknown> = {}) => ({
	path,
	entries,
	truncated: false,
	canWrite: true,
	...extra
});

const ROOT = [
	dir('world'),
	dir('plugins'),
	dir('world_nether'),
	dir('.secret', { readOnly: true }),
	entry('server.jar'),
	entry('link', { kind: 'symlink' })
];

beforeEach(() => {
	calls = [];
	replies = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const method = init.method ?? 'GET';
			const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
			calls.push({ url, method, body, signal: init.signal });
			const next = replies[key(method, url)]?.shift();
			if (!next) throw new Error(`unexpected request ${method} ${url}`);
			if (next.wait) await next.wait;
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

function setup(request: RelocateRequest, props: Record<string, unknown> = {}) {
	const ondone = vi.fn();
	const view = render(RelocateDialog, {
		serverId: 'srv-1',
		request,
		writable: true,
		ondone,
		...props
	});
	return { ...view, ondone };
}

const dialog = () => page.getByRole('dialog');
const summary = () => page.getByTestId('relocate-summary');
const mutations = () => calls.filter((c) => c.method !== 'GET');

describe('RelocateDialog', () => {
	it('browses real folders lazily with breadcrumbs, up and root', async () => {
		for (let i = 0; i < 3; i++) {
			reply('GET', list(''), ok(listing('', ROOT)));
			reply('GET', list('plugins'), ok(listing('plugins', [dir('plugins/Essentials')])));
		}
		reply('GET', list('plugins/Essentials'), ok(listing('plugins/Essentials', [])));
		setup({ entry: entry('server.jar'), mode: 'move' });

		await expect.element(dialog().getByRole('button', { name: 'Open plugins' })).toBeVisible();
		// Only folders are offered; files and links are summarised, protected folders blocked.
		await expect.element(dialog().getByText('2 files are not shown.')).toBeVisible();
		await expect
			.element(dialog().getByRole('button', { name: '.secret (protected)' }))
			.toHaveAttribute('aria-disabled', 'true');
		expect(calls).toHaveLength(1);

		await dialog().getByRole('button', { name: 'Open plugins' }).click();
		await dialog().getByRole('button', { name: 'Open Essentials' }).click();
		await expect.element(dialog().getByText('No subfolders here.', { exact: false })).toBeVisible();
		await expect.element(summary()).toHaveTextContent('Move to /plugins/Essentials/server.jar');

		await dialog().getByRole('button', { name: 'Up one folder' }).click();
		await expect.element(summary()).toHaveTextContent('Move to /plugins/server.jar');
		await dialog()
			.getByRole('navigation', { name: 'Destination folder path' })
			.getByRole('button', { name: 'Server' })
			.click();
		await expect.element(summary()).toHaveTextContent('Move to /server.jar');
		await dialog().getByRole('button', { name: 'Open plugins' }).click();
		await dialog().getByRole('button', { name: 'Server root', exact: true }).click();
		await expect
			.element(dialog().getByRole('button', { name: 'Open world', exact: true }))
			.toBeVisible();

		expect(calls.map((c) => new URL(c.url, 'http://x').searchParams.get('path'))).toEqual([
			'',
			'plugins',
			'plugins/Essentials',
			'plugins',
			'',
			'plugins',
			''
		]);
		expect(mutations()).toEqual([]);
	});

	it('moves to the chosen folder with the exact {from,to} payload', async () => {
		reply('GET', list(''), ok(listing('', ROOT)));
		reply('GET', list('plugins'), ok(listing('plugins', [])));
		const moved = entry('plugins/server.jar');
		reply('POST', `${BASE}/move`, ok({ entry: moved }));
		const { ondone } = setup({ entry: entry('server.jar'), mode: 'move' });
		await dialog().getByRole('button', { name: 'Open plugins' }).click();
		await expect.element(summary()).toHaveTextContent('/plugins/server.jar');
		await dialog().getByRole('button', { name: 'Move', exact: true }).click();
		await vi.waitFor(() => expect(ondone).toHaveBeenCalledOnce());
		expect(mutations()).toEqual([
			expect.objectContaining({
				url: `${BASE}/move`,
				body: { from: 'server.jar', to: 'plugins/server.jar' }
			})
		]);
		expect(ondone.mock.calls[0][1]).toBe('plugins/server.jar');
		await expect.element(dialog()).not.toBeInTheDocument();
	});

	it('never offers a folder or its own subtree as its destination', async () => {
		reply('GET', list(''), ok(listing('', ROOT)));
		reply('GET', list('world_nether'), ok(listing('world_nether', [])));
		setup({ entry: dir('world'), mode: 'move' });
		const self = dialog().getByRole('button', { name: 'world (item being moved)' });
		await expect.element(self).toHaveAttribute('aria-disabled', 'true');
		await self.click({ force: true });
		// Same-named prefix is still a valid separate folder.
		await dialog().getByRole('button', { name: 'Open world_nether' }).click();
		await expect.element(summary()).toHaveTextContent('/world_nether/world');
		expect(calls.map((c) => c.url)).toEqual([list(''), list('world_nether')]);
	});

	it('rejects a typed path inside the moved folder and traversal before any request', async () => {
		reply('GET', list(''), ok(listing('', ROOT)));
		reply('POST', `${BASE}/copy`, ok({ entry: dir('backup/world') }, 201));
		const { ondone } = setup({ entry: dir('world'), mode: 'copy' });
		await expect.element(summary()).toHaveTextContent('Copy to /world copy');
		await dialog().getByRole('button', { name: 'Type a path' }).click();
		const input = dialog().getByLabelText('Destination path');
		await expect.element(input).toHaveValue('world copy');
		await input.fill('world/region/world');
		await expect
			.element(dialog().getByText('A folder cannot be placed inside itself.'))
			.toBeVisible();
		await input.fill('../outside');
		await expect.element(dialog().getByText('Use a path without “..”.')).toBeVisible();
		await input.fill('/etc\\passwd');
		await expect.element(dialog().getByText('A name cannot contain / or \\.')).toBeVisible();
		await dialog().getByRole('button', { name: 'Copy', exact: true }).click();
		expect(mutations()).toEqual([]);

		await input.fill('/backup/world/');
		await expect.element(summary()).toHaveTextContent('Copy to /backup/world');
		await dialog().getByRole('button', { name: 'Copy', exact: true }).click();
		await vi.waitFor(() => expect(ondone).toHaveBeenCalledOnce());
		expect(mutations()[0].body).toEqual({ from: 'world', to: 'backup/world' });
	});

	it('flags a known name clash locally and keeps the source on a server refusal', async () => {
		reply('GET', list(''), ok(listing('', ROOT)));
		reply('GET', list('plugins'), ok(listing('plugins', [entry('plugins/server.jar')])));
		reply('POST', `${BASE}/copy`, problem(409, 'files.exists'));
		const { ondone } = setup({ entry: entry('server.jar'), mode: 'copy' });
		await expect.element(summary()).toHaveTextContent('/server copy.jar');
		await dialog().getByRole('button', { name: 'Open plugins' }).click();
		await dialog().getByLabelText('Name').fill('server.jar');
		await expect.element(dialog().getByText(/already exists in this folder/)).toBeVisible();
		await dialog().getByRole('button', { name: 'Copy', exact: true }).click();
		expect(mutations()).toEqual([]);

		// The listing may be stale: a refusal from the server keeps the dialog open.
		await dialog().getByLabelText('Name').fill('other.jar');
		await dialog().getByRole('button', { name: 'Copy', exact: true }).click();
		await expect.element(dialog().getByText('Already exists')).toBeVisible();
		expect(mutations()).toHaveLength(1);
		expect(mutations()[0].body).toEqual({ from: 'server.jar', to: 'plugins/other.jar' });
		expect(ondone).not.toHaveBeenCalled();
		await expect.element(dialog()).toBeVisible();
	});

	it('ignores a slow folder answer after navigating elsewhere', async () => {
		let release!: () => void;
		const wait = new Promise<void>((resolve) => (release = resolve));
		reply(
			'GET',
			list('world'),
			ok(listing('world', [dir('world/region')])),
			ok(listing('world', [dir('world/region')]))
		);
		reply('GET', list('world/region'), {
			...ok(listing('world/region', [dir('world/region/STALE')])),
			wait
		});
		setup({ entry: entry('world/level.dat'), mode: 'move' });
		await dialog().getByRole('button', { name: 'Open region' }).click();
		await expect.element(dialog().getByTestId('folder-picker-loading')).toBeInTheDocument();
		await dialog().getByRole('button', { name: 'Up one folder' }).click();
		await expect.element(dialog().getByRole('button', { name: 'Open region' })).toBeVisible();
		const stale = calls.find((c) => c.url === list('world/region'));
		expect(stale?.signal?.aborted).toBe(true);
		release();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await expect.element(dialog().getByText('STALE')).not.toBeInTheDocument();
		await expect.element(summary()).toHaveTextContent('Move to /world/level.dat');
	});

	it('shows truncated, error and read-only states', async () => {
		reply('GET', list(''), ok(listing('', ROOT, { truncated: true, canWrite: false })));
		reply('GET', list('plugins'), problem(404, 'files.not_found'));
		setup({ entry: entry('server.jar'), mode: 'copy' });
		await expect
			.element(dialog().getByText(/Listing stopped after the first 6 entries/))
			.toBeVisible();
		await expect.element(dialog().getByText(/Files are read-only right now/)).toBeVisible();
		await expect
			.element(dialog().getByRole('button', { name: 'Copy', exact: true }))
			.toBeDisabled();

		await dialog().getByRole('button', { name: 'Open plugins' }).click();
		await expect.element(dialog().getByText('File not found')).toBeVisible();
		reply('GET', list(''), ok(listing('', ROOT)));
		await dialog().getByRole('button', { name: 'Go to server root' }).click();
		await expect.element(dialog().getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
	});

	it('requires a stopped server', async () => {
		reply('GET', list(''), ok(listing('', ROOT)));
		setup({ entry: entry('server.jar'), mode: 'move' }, { writable: false });
		await expect.element(dialog().getByText('Stop the server to move files.')).toBeVisible();
		await expect
			.element(dialog().getByRole('button', { name: 'Move', exact: true }))
			.toBeDisabled();
	});
});
