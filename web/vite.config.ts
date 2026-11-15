import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

const BACKEND = process.env.CHUNKYARD_DEV_BACKEND ?? 'http://127.0.0.1:8420';
// Optional system Chromium/Chrome for component tests (e.g. on NixOS).
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
	optimizeDeps: {
		include: [
			'@lucide/svelte/icons/calendar-clock',
			'@lucide/svelte/icons/ban',
			'@lucide/svelte/icons/shield',
			'@lucide/svelte/icons/trash-2',
			'@lucide/svelte/icons/users',
			'@lucide/svelte/icons/radio-tower',
			'@lucide/svelte/icons/chart-line'
		]
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// SPA build: every route is client-rendered from 200.html.
			adapter: adapter({ fallback: '200.html' })
		})
	],
	server: {
		// Fixed origin so it can match CHUNKYARD_HTTP__PUBLIC_URL on the backend.
		host: 'localhost',
		port: 5173,
		strictPort: true,
		proxy: {
			// Keep the browser's Host header (changeOrigin: false): the backend checks Host and
			// Origin against CHUNKYARD_HTTP__PUBLIC_URL and has no CORS support.
			// `ws` forwards the live console WebSocket (same Host/Origin rules apply).
			'/api': { target: BACKEND, changeOrigin: false, ws: true },
			'/healthz': { target: BACKEND, changeOrigin: false }
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(
							chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : undefined
						),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
