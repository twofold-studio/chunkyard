import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Harness from './sidebar-harness.svelte';

beforeEach(async () => {
	await page.viewport(1280, 800);
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ docker: { available: true, version: '27.3.1', reason: null } }),
				{
					headers: { 'content-type': 'application/json' }
				}
			)
		)
	);
});
afterEach(() => vi.unstubAllGlobals());

describe('app sidebar', () => {
	it('shows the owner email and sign-out in session mode', async () => {
		const onSignOut = vi.fn();
		render(Harness, {
			auth: {
				mode: 'session',
				user: { id: 'u', email: 'owner@example.com', role: 'owner', createdAt: '' }
			},
			onSignOut
		});
		await expect.element(page.getByText('owner@example.com')).toBeVisible();
		await page.getByRole('button', { name: 'Sign out' }).click();
		expect(onSignOut).toHaveBeenCalledOnce();
	});

	it('shows auth-disabled mode without inventing a user or sign-out', async () => {
		render(Harness, { auth: { mode: 'disabled' }, onSignOut: vi.fn() });
		await expect.element(page.getByText('Authentication disabled')).toBeVisible();
		expect(page.getByRole('button', { name: 'Sign out' }).query()).toBeNull();
		expect(page.getByText('@').query()).toBeNull();
	});

	it('reports real Docker status and only real navigation', async () => {
		render(Harness, { auth: { mode: 'disabled' }, onSignOut: vi.fn() });
		await expect.element(page.getByText('Docker 27.3.1')).toBeVisible();
		const links = page
			.getByRole('link')
			.all()
			.map((l) => l.element().textContent?.trim());
		expect(links).toEqual([
			'Chunkyard',
			'Servers',
			'Activity',
			'Storage & exports',
			'Java runtimes',
			'API reference'
		]);
	});

	it('shows a discreet active-job count only when jobs are in progress', async () => {
		const screen = render(Harness, {
			auth: { mode: 'disabled' },
			onSignOut: vi.fn(),
			activeJobs: 2
		});
		await expect
			.element(page.getByRole('link', { name: /Activity/ }))
			.toHaveTextContent('2 jobs in progress');
		await screen.rerender({ activeJobs: 0 });
		await expect
			.element(page.getByRole('link', { name: /Activity/ }))
			.not.toHaveTextContent('in progress');
	});
});
