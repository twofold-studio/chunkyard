import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	copyFile,
	deleteFile,
	fileDownloadUrl,
	listFiles,
	makeDirectory,
	moveFile,
	readFile,
	updateServerNetwork,
	uploadFile,
	writeFile
} from './endpoints';

function json(status: number, body: unknown) {
	return new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function stub(response: Response) {
	const fetch = vi.fn().mockResolvedValue(response);
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('file endpoints', () => {
	it('encodes paths as query values, never as URL path segments', async () => {
		const fetch = stub(json(200, { path: '', entries: [], truncated: false, canWrite: true }));
		await listFiles('srv/1', 'world #1/a&b=c?');
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('/api/v1/servers/srv%2F1/files?path=world+%231%2Fa%26b%3Dc%3F');
		expect(init.method).toBe('GET');
		expect(init.headers['X-MCM-CSRF']).toBeUndefined();
		expect(new URL(url, 'http://x').searchParams.get('path')).toBe('world #1/a&b=c?');
	});

	it('reads content and saves with the last etag via PUT', async () => {
		let fetch = stub(json(200, { path: 'a', content: 'x', etag: 'e1', size: 1 }));
		await readFile('s', 'server.properties');
		expect(fetch.mock.calls[0][0]).toBe('/api/v1/servers/s/files/content?path=server.properties');

		fetch = stub(json(200, { path: 'a', etag: 'e2', size: 2 }));
		await writeFile('s', 'server.properties', { content: 'motd=hi\n', etag: 'e1' });
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('/api/v1/servers/s/files/content?path=server.properties');
		expect(init.method).toBe('PUT');
		expect(init.headers['X-MCM-CSRF']).toBe('1');
		expect(init.headers['Content-Type']).toBe('application/json');
		expect(JSON.parse(init.body)).toEqual({ content: 'motd=hi\n', etag: 'e1' });
	});

	it('uploads raw bytes as application/octet-stream with CSRF and explicit overwrite', async () => {
		const fetch = stub(json(201, { entry: { name: 'a.jar' } }));
		const blob = new Blob(['PK'], { type: 'application/java-archive' });
		await uploadFile('s', 'plugins/a b.jar', blob, false);
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('/api/v1/servers/s/files/upload?path=plugins%2Fa+b.jar&overwrite=false');
		expect(init.method).toBe('POST');
		expect(init.credentials).toBe('same-origin');
		expect(init.headers['Content-Type']).toBe('application/octet-stream');
		expect(init.headers['X-MCM-CSRF']).toBe('1');
		// The file itself is the body: no multipart, JSON or Base64 wrapping.
		expect(init.body).toBe(blob);

		const confirmed = stub(json(201, { entry: {} }));
		await uploadFile('s', 'a.jar', blob, true);
		expect(confirmed.mock.calls[0][0]).toBe(
			'/api/v1/servers/s/files/upload?path=a.jar&overwrite=true'
		);
	});

	it('sends JSON bodies for mkdir, move, copy and delete', async () => {
		const cases: [() => Promise<unknown>, string, unknown][] = [
			[() => makeDirectory('s', 'plugins/new'), '/mkdir', { path: 'plugins/new' }],
			[() => moveFile('s', 'a.txt', 'b/a.txt'), '/move', { from: 'a.txt', to: 'b/a.txt' }],
			[() => copyFile('s', 'world', 'world copy'), '/copy', { from: 'world', to: 'world copy' }],
			[() => deleteFile('s', 'world', true), '/delete', { path: 'world', recursive: true }]
		];
		for (const [call, suffix, body] of cases) {
			const fetch = stub(suffix === '/delete' ? json(204, null) : json(200, { entry: {} }));
			await call();
			const [url, init] = fetch.mock.calls[0];
			expect(url).toBe(`/api/v1/servers/s/files${suffix}`);
			expect(init.method).toBe('POST');
			expect(init.headers['X-MCM-CSRF']).toBe('1');
			expect(JSON.parse(init.body)).toEqual(body);
		}
	});

	it('builds a same-origin download URL', () => {
		expect(fileDownloadUrl('s', 'logs/latest.log')).toBe(
			'/api/v1/servers/s/files/download?path=logs%2Flatest.log'
		);
	});
});

describe('network endpoint', () => {
	it('PATCHes port and bind address', async () => {
		const fetch = stub(json(200, { server: { id: 's' } }));
		await updateServerNetwork('s', { port: 25570, publishIp: null });
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('/api/v1/servers/s/network');
		expect(init.method).toBe('PATCH');
		expect(init.headers['X-MCM-CSRF']).toBe('1');
		expect(JSON.parse(init.body)).toEqual({ port: 25570, publishIp: null });
	});
});
