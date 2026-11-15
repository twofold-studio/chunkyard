// Real-browser check of Files Back/Forward against the production build (`pnpm build` first).
// Serves `build/` with the SPA fallback and answers `/api/*` with fixed mock data in the page:
// SvelteKit routing, shallow history entries and the browser's own history are real; the
// backend is not. Run: node e2e/files-history.e2e.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveBuild } from './static-server.mjs';

const { origin, close } = await serveBuild();

const server = (id, name) => ({
	id,
	name,
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 2048,
	cpus: 2,
	acceptEula: true,
	directory: `/data/servers/${id}`,
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	software: null,
	launch: null,
	icon: null
});
const SERVERS = [server('srv-1', 'Alpha'), server('srv-2', 'Beta')];
const dir = (name, path) => ({
	name,
	path,
	kind: 'directory',
	size: 0,
	modifiedAt: '2026-11-01T10:00:00Z',
	readOnly: false
});
const LISTINGS = {
	'': [dir('world', 'world'), dir('plugins', 'plugins')],
	world: [dir('region', 'world/region')],
	'world/region': [],
	plugins: []
};

function api(url) {
	const path = url.pathname;
	if (path === '/api/v1/setup/status') return { required: false, authEnabled: false };
	if (path === '/api/v1/auth/me') return { principal: { kind: 'auth_disabled' }, user: null };
	if (path === '/api/v1/servers') return { items: SERVERS };
	const one = path.match(/^\/api\/v1\/servers\/([^/]+)$/);
	if (one) return SERVERS.find((s) => s.id === one[1]);
	if (/^\/api\/v1\/servers\/[^/]+\/files$/.test(path)) {
		const p = url.searchParams.get('path') ?? '';
		return { path: p, entries: LISTINGS[p] ?? [], truncated: false, canWrite: true };
	}
	if (path.endsWith('/jobs') || path === '/api/v1/jobs' || path === '/api/v1/exports')
		return { items: [] };
	return undefined;
}

const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const results = [];
async function step(name, fn) {
	await fn();
	results.push(name);
	console.log(`  ✓ ${name}`);
}

try {
	const context = await browser.newContext();
	await context.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		const body = route.request().method() === 'GET' ? api(url) : undefined;
		if (body === undefined)
			return route.fulfill({
				status: 404,
				contentType: 'application/problem+json',
				body: JSON.stringify({ code: 'not_found', detail: 'mock' })
			});
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(body)
		});
	});
	await context.routeWebSocket(/\/api\//, (ws) => ws.close());
	const page = await context.newPage();
	const crumb = () => page.locator('[data-slot="breadcrumb-page"]').first();
	const folder = (name) => page.getByRole('button', { name, exact: true });
	const expectFolder = (name) => assert.doesNotReject(crumb().filter({ hasText: name }).waitFor());

	await page.goto(`${origin}/servers`);
	await page.getByRole('link', { name: /Alpha/ }).first().click();
	await page.waitForURL(/\/servers\/srv-1/);
	await page.getByRole('tab', { name: 'Files' }).click();
	await folder('world').waitFor();
	const start = await page.evaluate(() => history.length);

	await step('folder navigation adds one browser entry per folder', async () => {
		await folder('world').click();
		await folder('region').click();
		await expectFolder('region');
		assert.equal(await page.evaluate(() => history.length), start + 2);
	});

	await step('browser Back/Forward traverse folders on the same URL', async () => {
		await page.goBack();
		await expectFolder('world');
		await page.goBack();
		await folder('plugins').waitFor();
		await page.goForward();
		await expectFolder('world');
		assert.match(page.url(), /\/servers\/srv-1\?tab=files$/);
	});

	await step('mouse side buttons (CDP back/forward button events) traverse folders', async () => {
		const cdp = await context.newCDPSession(page);
		const click = async (button) => {
			for (const type of ['mousePressed', 'mouseReleased'])
				await cdp.send('Input.dispatchMouseEvent', { type, x: 400, y: 400, button, clickCount: 1 });
		};
		await click('back');
		await folder('plugins').waitFor();
		await click('forward');
		await expectFolder('world');
	});

	await step('navigating after Back drops the forward branch', async () => {
		await page.goBack();
		await folder('plugins').click();
		await expectFolder('plugins');
		const length = await page.evaluate(() => history.length);
		await page.goForward().catch(() => {});
		await expectFolder('plugins');
		assert.equal(await page.evaluate(() => history.length), length);
	});

	await step('Back from the first folder is a normal Back to the previous page', async () => {
		await page.goBack();
		await folder('world').waitFor();
		await page.goBack();
		await page.waitForURL(`${origin}/servers`);
		await page.getByRole('link', { name: /Alpha/ }).first().waitFor();
	});

	await step('Forward into the server page restores its Files folder', async () => {
		await page.goForward();
		await page.waitForURL(/\/servers\/srv-1\?tab=files$/);
		await folder('world').waitFor();
		await page.goForward();
		await expectFolder('plugins');
	});

	await step('tab switches stay out of history; Back still restores the folder', async () => {
		await page.getByRole('tab', { name: 'Overview' }).click();
		await page.waitForURL(/\/servers\/srv-1$/);
		await page.goBack();
		await page.waitForURL(/\/servers\/srv-1\?tab=files$/);
		await folder('world').waitFor();
	});

	await step('another server starts at its root (no state carried across servers)', async () => {
		await folder('world').click();
		await expectFolder('world');
		await page.goto(`${origin}/servers`);
		await page.getByRole('link', { name: /Beta/ }).first().click();
		await page.waitForURL(/\/servers\/srv-2/);
		await page.getByRole('tab', { name: 'Files' }).click();
		await folder('world').waitFor();
		assert.equal(
			await crumb()
				.textContent()
				.then((t) => t?.trim()),
			'Server'
		);
	});

	console.log(`files history e2e: ${results.length} passed`);
} finally {
	await browser.close();
	close();
}
