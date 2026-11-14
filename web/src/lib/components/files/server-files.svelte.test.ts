import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerFiles from './server-files.svelte';
import { editorDoc, setEditorDoc } from '#lib/components/editor/test-utils.js';
import { exportSelection } from '#lib/exports/export-selection.svelte.js';

type Reply = { status: number; body?: unknown };
interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

let calls: Call[];
let replies: Record<string, Reply[]>;

const key = (method: string, url: string) => `${method} ${url}`;
function reply(method: string, url: string, ...queue: Reply[]) {
	replies[key(method, url)] = [...(replies[key(method, url)] ?? []), ...queue];
}
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const problem = (status: number, code: string): Reply => ({
	status,
	body: { code, detail: code }
});

const BASE = '/api/v1/servers/srv-1/files';
const q = (path: string) => new URLSearchParams({ path }).toString();

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	path: name,
	kind: 'file',
	size: 120,
	modifiedAt: '2026-11-01T10:00:00Z',
	readOnly: false,
	...extra
});

const listing = (path: string, entries: unknown[], canWrite = true) => ({
	path,
	entries,
	truncated: false,
	canWrite
});

const ROOT_ENTRIES = [
	entry('world', { kind: 'directory', size: 0 }),
	entry('plugins', { kind: 'directory', size: 0 }),
	entry('server.properties'),
	entry('eula.txt', { readOnly: true }),
	entry('<img src=x onerror=alert(1)>.txt'),
	entry('link', { kind: 'symlink' })
];

beforeEach(() => {
	calls = [];
	replies = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const method = init.method ?? 'GET';
			const body =
				typeof init.body === 'string'
					? JSON.parse(init.body)
					: init.body instanceof Blob
						? init.body
						: undefined;
			calls.push({ url, method, headers: init.headers as Record<string, string>, body });
			const next = replies[key(method, url)]?.shift();
			if (!next) throw new Error(`unexpected request ${method} ${url}`);
			return new Response(next.status === 204 ? null : JSON.stringify(next.body ?? {}), {
				status: next.status,
				headers: {
					'content-type': next.status >= 400 ? 'application/problem+json' : 'application/json'
				}
			});
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	exportSelection.clear('srv-1');
	exportSelection.clear('srv-2');
});

function setup(props: Record<string, unknown> = {}) {
	return render(ServerFiles, { serverId: 'srv-1', serverState: 'stopped', ...props });
}

const mutations = () => calls.filter((c) => c.method !== 'GET');

describe('ServerFiles', () => {
	it('lists folders first and renders hostile upstream names as plain text', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
		setup();
		await expect.element(page.getByRole('button', { name: 'world', exact: true })).toBeVisible();
		await expect.element(page.getByText('<img src=x onerror=alert(1)>.txt')).toBeVisible();
		expect(document.querySelector('img')).toBeNull();
		const names = [...document.querySelectorAll('tbody tr')].map((row) =>
			row.querySelector('td')?.textContent?.trim()
		);
		expect(names.slice(0, 2)).toEqual(['plugins', 'world']);
		// Symlinks are listed but never opened.
		await expect
			.element(page.getByRole('button', { name: 'link', exact: true }))
			.not.toBeInTheDocument();
	});

	it('navigates into folders and back through the breadcrumbs', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)), ok(listing('', ROOT_ENTRIES)));
		reply(
			'GET',
			`${BASE}?${q('world')}`,
			ok(listing('world', [entry('region', { path: 'world/region', kind: 'directory' })]))
		);
		setup();
		await page.getByRole('button', { name: 'world', exact: true }).click();
		await expect.element(page.getByRole('button', { name: 'region', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Server', exact: true }).click();
		await expect.element(page.getByRole('button', { name: 'plugins', exact: true })).toBeVisible();
		// Every generated path is a plain relative path, never with traversal segments.
		for (const call of calls) {
			const path = new URL(call.url, 'http://x').searchParams.get('path') ?? '';
			expect(path.split('/')).not.toContain('..');
		}
	});

	it('keeps mutations disabled while the server runs', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES, false)));
		setup({ serverState: 'running' });
		await expect.element(page.getByText('Files are read-only while the server runs')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Upload', exact: true })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'Folder', exact: true })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'File', exact: true })).toBeDisabled();
		await page.getByRole('button', { name: 'Actions for server.properties', exact: true }).click();
		await expect
			.element(page.getByRole('menuitem', { name: 'Delete' }))
			.toHaveAttribute('data-disabled');
		await expect
			.element(page.getByRole('menuitem', { name: 'Download' }))
			.toHaveAttribute('href', `${BASE}/download?${q('server.properties')}`);
	});

	it('validates new folder names locally, then posts mkdir inside the current folder', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
		reply('GET', `${BASE}?${q('plugins')}`, ok(listing('plugins', [])), ok(listing('plugins', [])));
		reply('POST', `${BASE}/mkdir`, ok({ entry: entry('new', { kind: 'directory' }) }, 201));
		setup();
		await page.getByRole('button', { name: 'plugins', exact: true }).click();
		await expect.element(page.getByText('This folder is empty')).toBeVisible();
		await page.getByRole('button', { name: 'Folder', exact: true }).click();
		await page.getByLabelText('Folder name').fill('..');
		await page.getByRole('button', { name: 'Create folder', exact: true }).click();
		await expect.element(page.getByText('This name is reserved.')).toBeVisible();
		expect(mutations()).toHaveLength(0);
		await page.getByLabelText('Folder name').fill('new');
		await page.getByRole('button', { name: 'Create folder', exact: true }).click();
		await vi.waitFor(() => expect(mutations()).toHaveLength(1));
		expect(mutations()[0].body).toEqual({ path: 'plugins/new' });
		expect(mutations()[0].headers['X-MCM-CSRF']).toBe('1');
	});

	it('edits a file, saves with its etag, and stops on a conflict instead of overwriting', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
		reply(
			'GET',
			`${BASE}/content?${q('server.properties')}`,
			ok({
				path: 'server.properties',
				content: 'motd=A\n',
				etag: 'e1',
				size: 7,
				readOnly: false,
				canWrite: true
			})
		);
		reply('PUT', `${BASE}/content?${q('server.properties')}`, ok({ etag: 'e2', size: 7 }));
		reply('PUT', `${BASE}/content?${q('server.properties')}`, problem(409, 'files.conflict'));
		setup();
		await page.getByRole('button', { name: 'server.properties', exact: true }).first().click();
		const label = 'Contents of server.properties';
		await vi.waitFor(() => expect(editorDoc(label)).toBe('motd=A\n'));
		await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
		setEditorDoc(label, 'motd=B\n');
		await expect.element(page.getByText('Unsaved')).toBeVisible();
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect.element(page.getByText(/^Saved/)).toBeVisible();
		expect(mutations()[0]).toMatchObject({
			method: 'PUT',
			body: { content: 'motd=B\n', etag: 'e1' }
		});

		setEditorDoc(label, 'motd=C\n');
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect.element(page.getByText('This file changed since you opened it')).toBeVisible();
		expect(mutations()[1].body).toEqual({ content: 'motd=C\n', etag: 'e2' });
		// Further saves are blocked and local edits stay until the owner reloads.
		await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
		expect(editorDoc(label)).toBe('motd=C\n');
	});

	it('opens server.properties on request from Settings', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
		reply(
			'GET',
			`${BASE}/content?${q('server.properties')}`,
			ok({
				path: 'server.properties',
				content: 'pvp=true\n',
				etag: 'e',
				size: 9,
				readOnly: false,
				canWrite: true
			})
		);
		setup({ openRequest: { path: 'server.properties', nonce: 1 } });
		await vi.waitFor(() => expect(editorDoc('Contents of server.properties')).toBe('pvp=true\n'));
	});

	it('asks before opening another file over unsaved edits: stay keeps them, discard opens', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
		const content = (path: string, text: string) =>
			reply(
				'GET',
				`${BASE}/content?${q(path)}`,
				ok({ path, content: text, etag: 'e', size: text.length, readOnly: false, canWrite: true })
			);
		content('server.properties', 'pvp=true\n');
		content('ops.json', '[]\n');
		const view = setup({ openRequest: { path: 'server.properties', nonce: 1 } });
		const label = 'Contents of server.properties';
		await vi.waitFor(() => expect(editorDoc(label)).toBe('pvp=true\n'));
		setEditorDoc(label, 'pvp=false\n');
		await view.rerender({ openRequest: { path: 'ops.json', nonce: 2 } });
		const dialog = page.getByRole('alertdialog', { name: 'Open another file?' });
		await expect.element(dialog).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		expect(editorDoc(label)).toBe('pvp=false\n');

		await view.rerender({ openRequest: { path: 'ops.json', nonce: 3 } });
		await page.getByRole('button', { name: 'Discard and open' }).click();
		await vi.waitFor(() => expect(editorDoc('Contents of ops.json')).toBe('[]\n'));
		await expect.element(page.getByText('Unsaved')).not.toBeInTheDocument();
		expect(mutations()).toHaveLength(0);
	});

	it('sends server.properties to the Properties tab when one is provided', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
		const onOpenProperties = vi.fn();
		setup({ onOpenProperties });
		await page.getByRole('button', { name: 'server.properties', exact: true }).first().click();
		expect(onOpenProperties).toHaveBeenCalledOnce();
		await page.getByRole('button', { name: /Minecraft settings/ }).click();
		expect(onOpenProperties).toHaveBeenCalledTimes(2);
		expect(calls.some((c) => c.url.includes('/content'))).toBe(false);
	});

	it('confirms permanent folder deletion and sends recursive only when ticked', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)), ok(listing('', ROOT_ENTRIES)));
		reply('POST', `${BASE}/delete`, problem(409, 'files.not_empty'), { status: 204 });
		setup();
		await page.getByRole('button', { name: 'Actions for world', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await expect.element(page.getByText(/permanently removed/)).toBeVisible();
		await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
		await expect.element(page.getByText(/Tick “Also delete everything inside/)).toBeVisible();
		await page.getByLabelText('Also delete everything inside this folder').click();
		await page.getByRole('button', { name: 'Delete folder and contents', exact: true }).click();
		await vi.waitFor(() => expect(mutations()).toHaveLength(2));
		expect(mutations().map((c) => c.body)).toEqual([
			{ path: 'world', recursive: false },
			{ path: 'world', recursive: true }
		]);
	});

	it('uploads picked files as raw bytes and asks before replacing', async () => {
		reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)), ok(listing('', ROOT_ENTRIES)));
		const url = `${BASE}/upload?${new URLSearchParams({ path: 'server.jar', overwrite: 'false' })}`;
		const replaceUrl = `${BASE}/upload?${new URLSearchParams({ path: 'server.jar', overwrite: 'true' })}`;
		reply('POST', url, problem(409, 'files.exists'));
		reply('POST', replaceUrl, ok({ entry: entry('server.jar') }, 201));
		setup();
		await expect.element(page.getByRole('button', { name: 'world', exact: true })).toBeVisible();
		const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
		const transfer = new DataTransfer();
		transfer.items.add(new File(['PK'], 'server.jar'));
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await expect.element(page.getByText('Already exists')).toBeVisible();
		const [first] = mutations();
		expect(first.headers['Content-Type']).toBe('application/octet-stream');
		expect(first.headers['X-MCM-CSRF']).toBe('1');
		expect(first.body).toBeInstanceOf(Blob);
		await page.getByRole('button', { name: 'Replace', exact: true }).click();
		await expect.element(page.getByText('Uploaded')).toBeVisible();
		expect(mutations().map((c) => c.url)).toEqual([url, replaceUrl]);
	});

	it('aborts the listing request when unmounted', async () => {
		let signal: AbortSignal | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init: RequestInit) => {
				signal = init.signal ?? undefined;
				return new Promise<never>(() => {});
			})
		);
		const screen = setup();
		await vi.waitFor(() => expect(signal).toBeDefined());
		screen.unmount();
		expect(signal?.aborted).toBe(true);
	});

	describe('export selection', () => {
		it('selects from the real listing, skips links and hands off to Exports', async () => {
			reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
			const onExportSelected = vi.fn();
			setup({ onExportSelected });
			await page.getByRole('checkbox', { name: 'Select world for export' }).click();
			await page.getByRole('checkbox', { name: 'Select eula.txt for export' }).click();
			await expect.element(page.getByTestId('selection-count')).toHaveTextContent('2 selected');
			await expect
				.element(page.getByRole('checkbox', { name: 'Select link for export' }))
				.toBeDisabled();
			await page.getByRole('button', { name: 'Export selected' }).click();
			expect(onExportSelected).toHaveBeenCalledOnce();
			expect(exportSelection.paths('srv-1')).toEqual(['eula.txt', 'world']);
			// Selecting never mutates anything on the server.
			expect(mutations()).toEqual([]);
		});

		it('selects all visible entries (respecting the filter) and clears them', async () => {
			reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
			setup({ onExportSelected: () => {} });
			await page.getByRole('searchbox', { name: 'Filter this folder' }).fill('.txt');
			await page.getByRole('checkbox', { name: 'Select all visible entries for export' }).click();
			expect(exportSelection.paths('srv-1')).toEqual([
				'<img src=x onerror=alert(1)>.txt',
				'eula.txt'
			]);
			await expect
				.element(page.getByRole('checkbox', { name: 'Clear selection of visible entries' }))
				.toHaveAttribute('aria-checked', 'true');
			await page.getByRole('checkbox', { name: 'Clear selection of visible entries' }).click();
			expect(exportSelection.count('srv-1')).toBe(0);
		});

		it('keeps the selection across folders and marks contents of selected folders', async () => {
			reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
			reply(
				'GET',
				`${BASE}?${q('world')}`,
				ok(listing('world', [entry('level.dat', { path: 'world/level.dat' })]))
			);
			setup({ onExportSelected: () => {} });
			await page.getByRole('checkbox', { name: 'Select world for export' }).click();
			await page.getByRole('button', { name: 'world', exact: true }).click();
			const covered = page.getByRole('checkbox', {
				name: 'level.dat is included with folder world'
			});
			await expect.element(covered).toBeDisabled();
			await expect.element(covered).toHaveAttribute('aria-checked', 'true');
			await expect.element(page.getByText('1 in other folders', { exact: false })).toBeVisible();
		});

		it('allows selecting while running but explains the stop requirement', async () => {
			reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES, false)));
			setup({ serverState: 'running', onExportSelected: () => {} });
			await page.getByRole('checkbox', { name: 'Select plugins for export' }).click();
			await expect.element(page.getByText('Exports need a stopped server')).toBeVisible();
		});

		it('drops paths that disappeared from the folder listing', async () => {
			exportSelection.add('srv-1', [
				{ path: 'old.txt', kind: 'file' },
				{ path: 'world', kind: 'directory' }
			]);
			reply('GET', `${BASE}?${q('')}`, ok(listing('', ROOT_ENTRIES)));
			setup({ onExportSelected: () => {} });
			await expect.element(page.getByTestId('selection-count')).toHaveTextContent('1 selected');
			expect(exportSelection.paths('srv-1')).toEqual(['world']);
		});

		it('caps the selection at 100 paths', async () => {
			const many = Array.from({ length: 105 }, (_, i) => entry(`f${String(i).padStart(3, '0')}`));
			reply('GET', `${BASE}?${q('')}`, ok(listing('', many)));
			setup({ onExportSelected: () => {} });
			await page.getByRole('checkbox', { name: 'Select all visible entries for export' }).click();
			await expect.element(page.getByTestId('selection-count')).toHaveTextContent('100 selected');
			expect(exportSelection.count('srv-1')).toBe(100);
		});
	});
});
