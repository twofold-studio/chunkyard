import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerOverview from './server-overview.svelte';
import ServerDiagnostics from './server-diagnostics.svelte';
import { MetricsSource } from '#lib/servers/metrics-source.svelte.js';
import type { ServerView } from '#lib/api/index.js';

const server = (extra: Partial<ServerView> = {}): ServerView => ({
	id: 'srv-1',
	name: 'ATM',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 8048,
	cpus: 2,
	acceptEula: true,
	directory: '/var/lib/chunkyard/servers/srv-1',
	status: { state: 'stopped', containerId: 'abcdef1234567890', exitCode: 0, oomKilled: false },
	software: { type: 'curseforge', projectId: 925200, fileId: 555 },
	launch: {
		path: 'run.sh',
		version: '1.21.1',
		build: null,
		javaMajor: 21,
		checksum: 'deadbeef',
		loader: { type: 'neoforge', version: '21.1.77' }
	},
	icon: null,
	...extra
});

const PACK = {
	id: 925200,
	name: 'All the Mods 10 - ATM10',
	summary: 'Kitchen sink.',
	websiteUrl: 'https://www.curseforge.com/minecraft/modpacks/all-the-mods-10',
	logoUrl: '/api/v1/modpacks/curseforge/925200/logo',
	downloads: 1
};

afterEach(() => vi.unstubAllGlobals());

function renderOverview(props: Partial<{ server: ServerView; pack: typeof PACK | null }> = {}) {
	const handlers = { onRequestEula: vi.fn(), onOpenConsole: vi.fn(), onOpenResources: vi.fn() };
	const screen = render(ServerOverview, {
		server: props.server ?? server(),
		metrics: new MetricsSource(),
		pack: props.pack === undefined ? PACK : props.pack,
		...handlers
	});
	return { ...screen, ...handlers };
}

describe('ServerOverview', () => {
	it('summarises the pack by name with a safe link, hiding IDs and routine details', async () => {
		renderOverview();
		const software = page.getByRole('region', { name: 'Software' });
		await expect.element(software).toHaveTextContent('All the Mods 10 - ATM10');
		await expect
			.element(software.getByRole('link', { name: /CurseForge/ }))
			.toHaveAttribute('href', PACK.websiteUrl);
		await expect.element(software).toHaveTextContent(/Minecraft\s*1\.21\.1/);
		await expect.element(software).toHaveTextContent('NeoForge 21.1.77');
		await expect.element(software).toHaveTextContent('Java 21');
		await expect.element(software).toHaveTextContent('Installed');
		const text = page.getByTestId('server-overview').element().textContent ?? '';
		// Diagnostics and duplicated settings blocks are not on the Overview.
		for (const hidden of [
			'925200',
			'555',
			'deadbeef',
			'run.sh',
			'abcdef123456',
			'/var/lib',
			'exit code 0',
			'Port',
			'eclipse-temurin',
			'Max heap'
		]) {
			expect(text).not.toContain(hidden);
		}
		// The two usage charts remain.
		await expect.element(page.getByRole('region', { name: 'Usage' })).toBeVisible();
	});

	it('falls back without a link when pack metadata is unavailable or unsafe', async () => {
		const { unmount } = renderOverview({ pack: null });
		await expect
			.element(page.getByRole('region', { name: 'Software' }))
			.toHaveTextContent('CurseForge modpack');
		expect(document.querySelector('a[href*="curseforge"]')).toBeNull();
		unmount();
		renderOverview({ pack: { ...PACK, websiteUrl: 'javascript:alert(1)' } });
		await expect.element(page.getByText('All the Mods 10 - ATM10')).toBeVisible();
		expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
	});

	it('keeps critical caveats visible: failed exit, OOM, EULA, unknown state', async () => {
		const { onOpenConsole, onOpenResources, onRequestEula } = renderOverview({
			server: server({
				acceptEula: false,
				status: { state: 'stopped', containerId: null, exitCode: 137, oomKilled: true }
			})
		});
		await expect.element(page.getByText(/exited with code 137/)).toBeVisible();
		await expect.element(page.getByText(/killed for running out of memory/)).toBeVisible();
		await expect.element(page.getByText(/until the Minecraft EULA is accepted/)).toBeVisible();
		await page.getByRole('button', { name: 'Open console' }).click();
		await page.getByRole('button', { name: 'Resources' }).click();
		await page.getByRole('button', { name: 'Review EULA' }).click();
		expect(onOpenConsole).toHaveBeenCalledOnce();
		expect(onOpenResources).toHaveBeenCalledOnce();
		expect(onRequestEula).toHaveBeenCalledOnce();
	});

	it('notes readiness while running and flags an unknown container state', async () => {
		const { unmount } = renderOverview({
			server: server({
				status: { state: 'running', containerId: 'c', exitCode: null, oomKilled: false }
			})
		});
		await expect.element(page.getByText(/Minecraft may still be loading/)).toBeVisible();
		unmount();
		renderOverview({
			server: server({
				status: { state: 'unknown', containerId: null, exitCode: null, oomKilled: false }
			})
		});
		await expect.element(page.getByText(/Container state unknown/)).toBeVisible();
	});

	it('shows requested selections for uninstalled managed servers and the JAR for custom ones', async () => {
		const { unmount } = renderOverview({
			server: server({ software: { type: 'paper', version: '1.21.4' }, launch: null })
		});
		await expect.element(page.getByText('Not installed')).toBeVisible();
		await expect.element(page.getByText('1.21.4 latest build')).toBeVisible();
		unmount();
		renderOverview({ server: server({ software: null, launch: null }), pack: null });
		await expect.element(page.getByRole('heading', { name: 'Custom JAR' })).toBeVisible();
		await expect.element(page.getByText('server.jar')).toBeVisible();
	});
});

describe('ServerDiagnostics', () => {
	it('keeps IDs, paths, checksum and exit code behind a toggle with copy controls', async () => {
		render(ServerDiagnostics, { server: server() });
		await expect.element(page.getByText('deadbeef')).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Show' }).click();
		for (const label of [
			'server ID',
			'manager directory',
			'curseforge project ID',
			'curseforge file ID',
			'launch file',
			'server pack SHA-256',
			'container ID'
		]) {
			await expect
				.element(page.getByRole('button', { name: `Copy ${label.toLowerCase()}` }))
				.toBeVisible();
		}
		await expect.element(page.getByText('925200', { exact: true })).toBeVisible();
		await expect.element(page.getByText('/var/lib/chunkyard/servers/srv-1')).toBeVisible();
		await expect.element(page.getByText('Last exit code')).toBeVisible();
	});
});
