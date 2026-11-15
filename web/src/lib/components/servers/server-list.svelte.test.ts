import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerList from './server-list.svelte';
import type { ServerView } from '#lib/api/index.js';
import { metricsHub } from '#lib/servers/metrics-hub.svelte.js';

// Running servers show live usage; keep it off the network here (covered by card-usage tests).
beforeAll(() =>
	metricsHub.configure({
		createSocket: () => ({
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
			close() {}
		})
	})
);
afterAll(() => metricsHub.configure({}));

const server = (id: string, extra: Partial<ServerView> = {}): ServerView => ({
	id,
	name: id,
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'img',
	port: 25565,
	memoryMinMb: 1024,
	memoryMaxMb: 2048,
	cpus: 1,
	acceptEula: true,
	directory: '/d',
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	software: null,
	launch: null,
	...extra
});

function memoryStorage() {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		key: () => null,
		get length() {
			return map.size;
		}
	} as Storage;
}

const servers = [
	server('alpha', {
		name: 'Alpha <b>',
		port: 25570,
		software: { type: 'paper', version: '1.21.1' }
	}),
	server('beta', { name: 'Beta', port: 25566 })
];

describe('ServerList', () => {
	it('shows only the create tile and no toolbar when there are genuinely no servers', async () => {
		render(ServerList, { servers: [], createHref: '/servers/new', storage: memoryStorage() });
		await expect.element(page.getByRole('link', { name: /Create server/ })).toBeVisible();
		expect(page.getByRole('searchbox').elements()).toHaveLength(0);
		expect(page.getByText(/No loaded servers match/).elements()).toHaveLength(0);
	});

	it('filters by search, keeps the create tile and offers Clear filters on no match', async () => {
		render(ServerList, { servers, createHref: '/servers/new', storage: memoryStorage() });
		await expect.element(page.getByTestId('list-count')).toHaveTextContent('2 servers');
		const search = page.getByRole('searchbox', { name: 'Search loaded servers' });
		await search.fill('paper');
		await expect.element(page.getByTestId('list-count')).toHaveTextContent('1 of 2 loaded servers');
		await expect.element(page.getByText('Alpha <b>')).toBeVisible();
		expect(page.getByText('Beta').elements()).toHaveLength(0);

		await search.fill('nothing-here');
		await expect.element(page.getByText('No loaded servers match these filters.')).toBeVisible();
		await expect.element(page.getByRole('link', { name: /Create server/ })).toBeVisible();
		await page.getByRole('button', { name: 'Clear filters' }).click();
		await expect.element(search).toHaveValue('');
		await expect.element(page.getByTestId('list-count')).toHaveTextContent('2 servers');
	});

	it('Escape clears the search query', async () => {
		render(ServerList, { servers, createHref: '/servers/new', storage: memoryStorage() });
		const search = page.getByRole('searchbox', { name: 'Search loaded servers' });
		await search.fill('beta');
		await userEvent.keyboard('{Escape}');
		await expect.element(search).toHaveValue('');
	});

	it('filters by state and persists the sort preference', async () => {
		const storage = memoryStorage();
		render(ServerList, { servers, createHref: '/servers/new', storage });
		await page.getByRole('combobox', { name: 'Filter by state' }).selectOptions('running');
		await expect.element(page.getByText('No loaded servers match these filters.')).toBeVisible();
		await page.getByRole('combobox', { name: 'Sort servers' }).selectOptions('port');
		expect(storage.getItem('chunkyard.servers.view')).toBe('port');
	});

	it('orders cards by the chosen sort', async () => {
		const storage = memoryStorage();
		storage.setItem('chunkyard.servers.view', 'port');
		render(ServerList, { servers, createHref: '/servers/new', storage });
		const items = page.getByRole('listitem').elements();
		expect(items[1].textContent).toContain('Beta');
		expect(items[2].textContent).toContain('Alpha');
	});
	it('adds a location filter only when archived servers exist and keeps the create tile', async () => {
		const first = render(ServerList, {
			servers,
			createHref: '/servers/new',
			storage: memoryStorage()
		});
		await expect.element(page.getByTestId('list-count')).toBeVisible();
		expect(page.getByRole('combobox', { name: 'Filter by location' }).elements()).toHaveLength(0);
		first.unmount();
		const withArchived = [
			...servers,
			server('gamma', {
				name: 'Gamma',
				archive: { exportId: 'e', archivedAt: '2026-11-14T00:00:00Z' }
			})
		];
		render(ServerList, {
			servers: withArchived,
			createHref: '/servers/new',
			storage: memoryStorage()
		});
		await page.getByRole('combobox', { name: 'Filter by location' }).selectOptions('archived');
		await expect.element(page.getByTestId('list-count')).toHaveTextContent('1 of 3 loaded servers');
		await expect.element(page.getByText('Gamma')).toBeVisible();
		await expect.element(page.getByRole('link', { name: /Create server/ })).toBeVisible();
		await page.getByRole('button', { name: 'Clear' }).click();
		await expect.element(page.getByTestId('list-count')).toHaveTextContent('3 servers');
		// Search also finds archived instances.
		await page.getByRole('searchbox', { name: 'Search loaded servers' }).fill('archived');
		await expect.element(page.getByTestId('list-count')).toHaveTextContent('1 of 3 loaded servers');
	});
});
