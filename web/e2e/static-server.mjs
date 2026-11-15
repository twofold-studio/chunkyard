// Serves the production build (`build/`) with the SPA fallback, for real-browser checks.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../build/', import.meta.url));
const TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2'
};

export async function serveBuild() {
	const http = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://x');
		let file = normalize(join(BUILD, decodeURIComponent(url.pathname)));
		if (!file.startsWith(BUILD)) file = join(BUILD, '200.html');
		try {
			if (!(await stat(file)).isFile()) throw new Error('dir');
		} catch {
			file = join(BUILD, '200.html');
		}
		res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
		res.end(await readFile(file));
	});
	await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
	return { origin: `http://127.0.0.1:${http.address().port}`, close: () => http.close() };
}

export const problem = (route, status, code) =>
	route.fulfill({
		status,
		contentType: 'application/problem+json',
		body: JSON.stringify({ code, detail: code })
	});
