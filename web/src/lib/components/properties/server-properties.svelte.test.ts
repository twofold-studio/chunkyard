import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { editorDoc, setEditorDoc } from '#lib/components/editor/test-utils.js';
import ServerProperties from './server-properties.svelte';
import { ApiError, type PropertiesDocument, type ServerState } from '#lib/api/index.js';
import type { PropertiesApi } from '#lib/properties/properties-store.svelte.js';

/** CRLF, comments, unknown keys, a duplicate and a continuation that must all survive. */
const FILE = [
	'#Minecraft server properties',
	'motd=Hello\\u00A7a world',
	'pvp=true',
	'',
	'max-players=10',
	'online-mode=true',
	'custom-plugin.flag=on',
	'description=multi \\',
	'    line',
	'max-players=20',
	'server-port=25565',
	''
].join('\r\n');

const status = (state: ServerState) => ({
	state,
	containerId: null,
	exitCode: null,
	oomKilled: false
});

function doc(content: string, version: number, extra: Partial<PropertiesDocument> = {}) {
	return {
		content,
		etag: `e${version}`,
		version,
		appliedVersion: 1,
		restartRequired: version > 1,
		status: status('running'),
		updatedAt: '2026-11-14T10:00:00Z',
		...extra
	} satisfies PropertiesDocument;
}

function setup(
	options: {
		content?: string;
		serverState?: ServerState;
		initial?: Partial<PropertiesDocument>;
		api?: Partial<{ [K in keyof PropertiesApi]: ReturnType<typeof vi.fn> }>;
		onEditNetwork?: () => void;
	} = {}
) {
	let version = 1;
	const api = {
		getProperties: vi.fn(async () => doc(options.content ?? FILE, 1, options.initial)),
		saveProperties: vi.fn(async (_id: string, body: { content: string }) => {
			version += 1;
			return doc(body.content, version);
		}),
		listPropertiesVersions: vi.fn(async () => ({
			items: [
				{ version: 2, etag: 'e2', createdAt: '2026-11-14T10:00:00Z', source: 'edit' },
				{ version: 1, etag: 'e1', createdAt: '2026-11-13T10:00:00Z', source: 'import' }
			],
			nextBefore: null
		})),
		getPropertiesVersion: vi.fn(),
		restoreProperties: vi.fn(),
		...options.api
	};
	render(ServerProperties, {
		serverId: 'srv-1',
		serverState: options.serverState ?? 'running',
		onEditNetwork: options.onEditNetwork,
		options: { api: api as unknown as PropertiesApi, delayMs: 300, retryDelaysMs: [] }
	});
	return api;
}

const lastSaved = (api: ReturnType<typeof setup>) =>
	(api.saveProperties.mock.calls.at(-1)?.[1] as { content: string; etag: string }) ?? null;

describe('Properties tab', () => {
	it('keeps absent settings unset instead of claiming version-specific defaults', async () => {
		const api = setup({ content: 'motd=Only an explicit value\n' });
		const whitelist = page.getByRole('combobox', { name: 'Whitelist', exact: true });
		await expect.element(whitelist).toHaveTextContent('Not set');
		await whitelist.click();
		await page.getByRole('option', { name: 'Off', exact: true }).click();
		await vi.waitFor(() => expect(api.saveProperties).toHaveBeenCalledOnce());
		expect(lastSaved(api)?.content).toContain('white-list=false');
		await expect
			.element(page.getByRole('switch', { name: 'Whitelist', exact: true }))
			.not.toBeChecked();
	});
	it('autosaves a switch right away while the server runs; no save button', async () => {
		const api = setup();
		const pvp = page.getByRole('switch', { name: 'PvP' });
		await expect.element(pvp).toBeEnabled();
		await expect.element(page.getByRole('button', { name: 'Save' })).not.toBeInTheDocument();
		await pvp.click();
		await vi.waitFor(() => expect(api.saveProperties).toHaveBeenCalledOnce());
		expect(lastSaved(api)).toEqual({ content: FILE.replace('pvp=true', 'pvp=false'), etag: 'e1' });
		await expect.element(page.getByText('Saved · v2')).toBeVisible();
		await expect
			.element(page.getByTestId('applied-version'))
			.toHaveTextContent('Running v1 · restart to apply v2');
		await expect.element(page.getByText('Restart to apply', { exact: true })).toBeVisible();
	});

	it('waits for a typing pause, and Enter saves immediately', async () => {
		const api = setup();
		const input = page.getByLabelText('Max players');
		await expect.element(input).toHaveValue('20');
		await input.fill('30');
		await expect.element(page.getByText('Unsaved · saves automatically')).toBeVisible();
		expect(api.saveProperties).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(api.saveProperties).toHaveBeenCalledOnce());
		// The effective duplicate changed; everything else is byte-identical.
		expect(lastSaved(api).content).toBe(FILE.replace('max-players=20', 'max-players=30'));

		await input.fill('40');
		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() => expect(api.saveProperties).toHaveBeenCalledTimes(2), { timeout: 200 });
		expect(lastSaved(api).content).toContain('max-players=10\r\n');
	});

	it('says the running version is unknown for a legacy container', async () => {
		setup({ initial: { appliedVersion: null, restartRequired: false } });
		await expect
			.element(page.getByTestId('applied-version'))
			.toHaveTextContent('Running version unknown until a restart from Chunkyard');
	});

	it('stops on a conflict and loads the latest only on request', async () => {
		const api = setup({
			api: {
				saveProperties: vi.fn().mockRejectedValue(new ApiError(409, 'properties.conflict', 'x'))
			}
		});
		await page.getByRole('switch', { name: 'PvP' }).click();
		await expect.element(page.getByText('Properties changed elsewhere')).toBeVisible();
		await expect.element(page.getByRole('switch', { name: 'PvP' })).toBeDisabled();
		expect(api.saveProperties).toHaveBeenCalledOnce();
		await page.getByRole('button', { name: 'Load latest' }).click();
		await expect.element(page.getByRole('switch', { name: 'PvP' })).toBeChecked();
		expect(api.getProperties).toHaveBeenCalledTimes(2);
	});

	it('keeps form edits in raw view and preserves CRLF when editing raw text', async () => {
		const api = setup();
		await page.getByRole('combobox', { name: 'Hardcore', exact: true }).click();
		await page.getByRole('option', { name: 'On', exact: true }).click();
		await vi.waitFor(() => expect(api.saveProperties).toHaveBeenCalledOnce());
		await page.getByRole('button', { name: 'Raw text' }).click();
		const label = 'Contents of server.properties';
		const lf = `${FILE}hardcore=true\r\n`.replace(/\r\n/g, '\n');
		await vi.waitFor(() => expect(editorDoc(label)).toBe(lf));
		setEditorDoc(label, `${lf}difficulty=hard\n`);
		await vi.waitFor(() => expect(api.saveProperties).toHaveBeenCalledTimes(2));
		expect(lastSaved(api).content).toBe(`${FILE}hardcore=true\r\ndifficulty=hard\r\n`);
		await page.getByRole('button', { name: 'Form' }).click();
		await expect.element(page.getByRole('switch', { name: 'Hardcore' })).toBeChecked();
	});

	it('browses an old version read-only and restores it as a new version without restarting', async () => {
		const api = setup({
			initial: { version: 2, etag: 'e2' },
			api: {
				getPropertiesVersion: vi.fn(async () => ({
					version: 1,
					etag: 'e1',
					createdAt: '2026-11-13T10:00:00Z',
					source: 'import',
					content: 'pvp=false\r\n'
				})),
				restoreProperties: vi.fn(async () => doc('pvp=false\r\n', 3))
			}
		});
		await page.getByRole('button', { name: 'History' }).click();
		await page.getByRole('button', { name: /^v1/ }).click();
		await expect.element(page.getByText(/Viewing/)).toBeVisible();
		await expect.element(page.getByRole('switch', { name: 'PvP' })).toBeDisabled();
		await expect.element(page.getByRole('switch', { name: 'PvP' })).not.toBeChecked();
		await page.getByRole('button', { name: 'Restore as new version' }).click();
		await vi.waitFor(() =>
			expect(api.restoreProperties).toHaveBeenCalledWith('srv-1', { version: 1, etag: 'e2' })
		);
		await expect.element(page.getByText('Saved · v3')).toBeVisible();
		await expect.element(page.getByRole('switch', { name: 'PvP' })).toBeEnabled();
		expect(api.saveProperties).not.toHaveBeenCalled();
	});

	it('searches by key, label or value and lists unknown keys under Other', async () => {
		setup();
		const search = page.getByLabelText('Search settings');
		await search.fill('whitelist');
		await expect
			.element(page.getByRole('combobox', { name: 'Whitelist', exact: true }))
			.toBeVisible();
		await expect.element(page.getByLabelText('Difficulty')).not.toBeInTheDocument();
		await search.fill('Hello');
		await expect.element(page.getByLabelText('Message of the day')).toBeVisible();
		await search.fill('custom-plugin');
		await expect.element(page.getByLabelText('custom-plugin.flag')).toHaveValue('on');
	});

	it('explains the managed game port and links to Network', async () => {
		const onEditNetwork = vi.fn();
		setup({ onEditNetwork });
		await page.getByRole('button', { name: /Network & remote access/ }).click();
		await expect
			.element(page.getByText(/always listens on 25565 inside the container/))
			.toBeVisible();
		await page.getByRole('button', { name: 'Host port' }).click();
		expect(onEditNetwork).toHaveBeenCalledOnce();
	});

	it('locks malformed entries and offers the raw editor instead', async () => {
		setup({ content: 'motd=bad \\uZZZZ\r\npvp=true\r\n' });
		await expect.element(page.getByLabelText('Message of the day')).toBeDisabled();
		await page.getByRole('button', { name: 'Edit as raw text' }).click();
		await vi.waitFor(() =>
			expect(editorDoc('Contents of server.properties')).toBe('motd=bad \\uZZZZ\npvp=true\n')
		);
	});
});
