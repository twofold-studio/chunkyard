import { describe, expect, it, vi } from 'vitest';
import { resolveAuth } from './auth';

type Route = Record<string, () => Response>;

function backend(routes: Route) {
	return vi.fn(async (path: string) => {
		const handler = routes[path];
		if (!handler) throw new Error(`unexpected ${path}`);
		return handler();
	}) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}
const ok = (body: unknown) => () =>
	new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const problem = (status: number, code: string) => () =>
	new Response(JSON.stringify({ code, detail: code }), {
		status,
		headers: { 'content-type': 'application/problem+json' }
	});

const user = { id: 'u1', email: 'owner@example.com', role: 'owner', createdAt: '2026-01-01' };

describe('resolveAuth', () => {
	it('treats auth-disabled mode as ready without a user', async () => {
		const fetch = backend({
			'/api/v1/setup/status': ok({ required: false, authEnabled: false }),
			'/api/v1/auth/me': ok({
				authEnabled: false,
				user: null,
				principal: { kind: 'auth_disabled' }
			})
		});
		await expect(resolveAuth(fetch)).resolves.toEqual({
			kind: 'ready',
			auth: { mode: 'disabled' }
		});
	});

	it('sends a fresh instance to setup without calling /me', async () => {
		const fetch = backend({ '/api/v1/setup/status': ok({ required: true, authEnabled: true }) });
		await expect(resolveAuth(fetch)).resolves.toEqual({ kind: 'setup' });
		expect(fetch.mock.calls).toHaveLength(1);
	});

	it('sends an unauthenticated browser to login', async () => {
		const fetch = backend({
			'/api/v1/setup/status': ok({ required: false, authEnabled: true }),
			'/api/v1/auth/me': problem(401, 'auth.required')
		});
		await expect(resolveAuth(fetch)).resolves.toEqual({ kind: 'login' });
	});

	it('returns the signed-in owner', async () => {
		const fetch = backend({
			'/api/v1/setup/status': ok({ required: false, authEnabled: true }),
			'/api/v1/auth/me': ok({ authEnabled: true, user, principal: { kind: 'session' } })
		});
		await expect(resolveAuth(fetch)).resolves.toEqual({
			kind: 'ready',
			auth: { mode: 'session', user }
		});
	});

	it('propagates backend unavailability', async () => {
		const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
		await expect(resolveAuth(fetch)).rejects.toMatchObject({ code: 'network.unavailable' });
	});
});
