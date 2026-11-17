import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, onAuthLost, request } from './client';
import { describeError } from './errors';
import { createServer, serverAction, getConsole, logout } from './endpoints';

function json(status: number, body: unknown, type = 'application/json') {
	return new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': type }
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('request', () => {
	it('sends same-origin GETs to relative paths without CSRF header', async () => {
		const fetch = vi.fn().mockResolvedValue(json(200, { items: [] }));
		await request('/api/v1/servers', { fetch });
		const [path, init] = fetch.mock.calls[0];
		expect(path).toBe('/api/v1/servers');
		expect(init.credentials).toBe('same-origin');
		expect(new Headers(init.headers).get('X-MCM-CSRF')).toBeNull();
	});

	it('adds X-MCM-CSRF and JSON body to mutations', async () => {
		const fetch = vi.fn().mockResolvedValue(json(201, { server: { id: 's1' } }));
		vi.stubGlobal('fetch', fetch);
		await createServer({ name: 'Survival', port: 25565, acceptEula: true });
		const [path, init] = fetch.mock.calls[0];
		expect(path).toBe('/api/v1/servers');
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('X-MCM-CSRF')).toBe('1');
		expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
		expect(JSON.parse(init.body)).toEqual({ name: 'Survival', port: 25565, acceptEula: true });
	});

	it('sends CSRF on body-less mutations such as lifecycle actions', async () => {
		const fetch = vi.fn().mockResolvedValue(json(202, { job: { id: 'j' } }));
		vi.stubGlobal('fetch', fetch);
		await serverAction('abc/def', 'kill');
		const [path, init] = fetch.mock.calls[0];
		expect(path).toBe('/api/v1/servers/abc%2Fdef/kill');
		expect(new Headers(init.headers).get('X-MCM-CSRF')).toBe('1');
		expect(init.body).toBeUndefined();
	});

	it('requests a bounded console snapshot', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(json(200, { items: [{ stream: 'stdout', text: 'Done' }] }));
		vi.stubGlobal('fetch', fetch);
		const { items } = await getConsole('s1', 200);
		expect(fetch.mock.calls[0][0]).toBe('/api/v1/servers/s1/console?tail=200');
		expect(items).toHaveLength(1);
	});

	it('returns undefined for 204 from both native and generated callers', async () => {
		const fetch = vi.fn().mockResolvedValue(json(204, null));
		await expect(request('/x', { method: 'POST', fetch })).resolves.toBeUndefined();
		await expect(logout({ fetch })).resolves.toBeUndefined();
	});

	it('parses problem+json into ApiError with stable code', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				json(
					424,
					{ code: 'server.jar_missing', detail: 'Place the configured JAR.', status: 424 },
					'application/problem+json'
				)
			);
		const error = (await request('/x', { fetch }).catch((e: unknown) => e)) as ApiError;
		expect(error).toBeInstanceOf(ApiError);
		expect(error.code).toBe('server.jar_missing');
		expect(error.status).toBe(424);
		expect(describeError(error).title).toBe('Server JAR missing');
	});

	it('explains a same-port start conflict without suggesting the port cannot be shared', () => {
		const message = describeError(
			new ApiError(409, 'server.port_in_use', 'Port 25565 is used by running server Lobby.')
		);
		expect(message.title).toBe('Port already in use');
		expect(message.detail).toContain('Lobby');
		expect(message.hint).toMatch(/Stop that server, or choose another port/);
	});

	it('maps network failures to network.unavailable', async () => {
		const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		const error = (await request('/x', { fetch }).catch((e: unknown) => e)) as ApiError;
		expect(error.code).toBe('network.unavailable');
		expect(error.unreachable).toBe(true);
	});

	it('maps a proxy error without problem body to backend.unavailable', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('', { status: 502 }));
		const error = (await request('/x', { fetch }).catch((e: unknown) => e)) as ApiError;
		expect(error.code).toBe('backend.unavailable');
	});

	it('rethrows aborts untouched', async () => {
		const fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
		const error = (await request('/x', { fetch }).catch((e: unknown) => e)) as ApiError;
		expect(error).toBeInstanceOf(DOMException);
	});

	it('notifies the auth-lost listener for auth.required but not invalid credentials', async () => {
		const listener = vi.fn();
		const off = onAuthLost(listener);
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(json(401, { code: 'auth.required', detail: 'Sign in.' }))
			.mockResolvedValueOnce(json(401, { code: 'auth.invalid_credentials', detail: 'Wrong.' }));
		await request('/a', { fetch }).catch(() => {});
		await request('/b', { method: 'POST', fetch }).catch(() => {});
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0][0].code).toBe('auth.required');
		off();
	});

	it('describes CSRF/origin rejections with the public URL hint', () => {
		const message = describeError(new ApiError(403, 'auth.csrf', 'Same-origin required.'));
		expect(message.hint).toMatch(/CHUNKYARD_HTTP__PUBLIC_URL/);
	});
});
