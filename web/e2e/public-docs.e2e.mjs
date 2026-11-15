// Real-browser check that the API reference opens without signing in (production build,
// mocked API: setup done, auth enabled, no session) while other app pages still redirect to
// sign-in. Run after `pnpm build`: node e2e/public-docs.e2e.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { problem, serveBuild } from './static-server.mjs';

const { origin, close } = await serveBuild();
const OPENAPI = {
	openapi: '3.1.0',
	info: { title: 'Chunkyard', version: '0.10.0' },
	paths: {
		'/api/v1/servers': {
			get: { summary: 'List servers', tags: ['Servers'], responses: { 200: { description: 'OK' } } }
		}
	}
};
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const requested = [];
try {
	const context = await browser.newContext();
	await context.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		requested.push(url.pathname);
		if (url.pathname === '/api/v1/setup/status')
			return route.fulfill({ json: { required: false, authEnabled: true } });
		if (url.pathname === '/api/v1/openapi.json') return route.fulfill({ json: OPENAPI });
		return problem(route, 401, 'auth.required');
	});
	const page = await context.newPage();

	await page.goto(`${origin}/api-docs`);
	await page.getByRole('heading', { name: 'API reference' }).waitFor();
	await page.getByText('List servers').first().waitFor();
	await page.getByRole('link', { name: 'Sign in' }).waitFor();
	for (const name of ['Servers', 'Activity', 'Integrations'])
		assert.equal(await page.getByRole('link', { name, exact: true }).count(), 0, `no ${name} link`);
	assert.ok(
		!requested.some((p) => p.startsWith('/api/v1/servers') || p.startsWith('/api/v1/jobs')),
		'visitor view loads no private data'
	);
	console.log('  ✓ API reference renders for a signed-out visitor without private requests');

	await page.goto(`${origin}/servers`);
	await page.waitForURL(`${origin}/login`);
	console.log('  ✓ other app pages still redirect to sign-in');

	await page.goto(`${origin}/api-docs`);
	await page.getByRole('link', { name: 'Sign in' }).click();
	await page.waitForURL(`${origin}/login`);
	console.log('  ✓ Sign in link leads to the login page');
	console.log('public docs e2e: 3 passed');
} finally {
	await browser.close();
	close();
}
