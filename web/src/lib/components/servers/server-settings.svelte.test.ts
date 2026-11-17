import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import ServerSettings from './server-settings.svelte';
import type { ServerView } from '#lib/api/index.js';

const server = {
	archive: null,
	autoJava: false,
	launchOverride: null,
	publishIp: null,
	id: 'srv-1',
	name: 'Survival',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'img',
	port: 25570,
	memoryMinMb: 1024,
	memoryMaxMb: 4096,
	cpus: 2,
	acceptEula: true,
	directory: '/d',
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	software: null,
	launch: null,
	icon: null
} satisfies ServerView;

const danger = createRawSnippet(() => ({ render: () => '<button type="button">Delete</button>' }));
const props = (extra: Record<string, unknown> = {}) => ({
	server,
	busy: false,
	onRequestEula: vi.fn(),
	onRevokeEula: vi.fn(),
	onServerUpdated: vi.fn(),
	onOpenProperties: vi.fn(),
	danger,
	...extra
});

beforeEach(() =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}', { status: 500 }))
	)
);
afterEach(() => vi.unstubAllGlobals());

describe('ServerSettings delete section', () => {
	it('places Delete last in its own section', async () => {
		render(ServerSettings, props());
		const section = page.getByRole('region', { name: 'Delete server' });
		await expect.element(section).toBeVisible();
		await expect.element(section.getByRole('button', { name: 'Delete' })).toBeVisible();
		const regions = [...document.querySelectorAll('section[aria-label], section[aria-labelledby]')];
		expect(regions.at(-1)?.getAttribute('aria-labelledby')).toBe('danger-zone-title');
	});

	it('shows no delete section while archived', async () => {
		render(
			ServerSettings,
			props({
				server: { ...server, archive: { exportId: 'p', archivedAt: '2026-11-13T12:00:00Z' } },
				archived: true
			})
		);
		await expect.element(page.getByRole('region', { name: 'Display' })).toBeVisible();
		expect(page.getByRole('region', { name: 'Delete server' }).elements()).toHaveLength(0);
	});
});
