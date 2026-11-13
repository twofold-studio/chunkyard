import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import LoginPage from '../routes/(auth)/login/+page.svelte';

afterEach(() => vi.unstubAllGlobals());

describe('login page', () => {
	it('posts email/password with CSRF and shows invalid-credential errors', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					code: 'auth.invalid_credentials',
					detail: 'The email or password is incorrect.'
				}),
				{ status: 401, headers: { 'content-type': 'application/problem+json' } }
			)
		);
		vi.stubGlobal('fetch', fetch);
		render(LoginPage);
		await page.getByLabelText('Email').fill(' owner@example.com ');
		await page.getByLabelText('Password').fill('correct horse battery');
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect.element(page.getByRole('alert')).toHaveTextContent('Sign-in failed');
		await expect.element(page.getByRole('alert')).toHaveTextContent('incorrect');
		await expect.element(page.getByLabelText('Password')).toHaveValue('');
		const [path, init] = fetch.mock.calls[0];
		expect(path).toBe('/api/v1/auth/login');
		expect(init.headers['X-MCM-CSRF']).toBe('1');
		expect(init.credentials).toBe('same-origin');
		expect(JSON.parse(init.body)).toEqual({
			email: 'owner@example.com',
			password: 'correct horse battery'
		});
	});

	it('explains when the backend is unreachable', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		render(LoginPage);
		await page.getByLabelText('Email').fill('owner@example.com');
		await page.getByLabelText('Password').fill('whatever-password');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Backend unreachable');
	});
});
