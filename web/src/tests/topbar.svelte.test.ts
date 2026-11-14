import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import TopbarHarness from './topbar-harness.svelte';
import { TopbarSlot } from '#lib/components/app/topbar-context.svelte.js';

// The shell header sits inside <main> (Sidebar.Inset), so it has no banner role.
const header = () => page.elementLocator(document.querySelector('header')!);

describe('contextual top bar', () => {
	it('shows the selected server in place of the last crumb and default actions', async () => {
		render(TopbarHarness, { server: { id: 'a', name: 'Survival' } });
		await expect.element(header().getByRole('heading', { name: 'Survival' })).toBeVisible();
		await expect.element(header().getByRole('link', { name: 'Servers' })).toBeVisible();
		await expect.element(header().getByRole('button', { name: 'Start Survival' })).toBeEnabled();
		await expect
			.element(header().getByRole('link', { name: 'New server' }))
			.not.toBeInTheDocument();
		// Exactly one heading: no duplicate page header.
		expect(page.getByRole('heading', { name: 'Survival' }).all()).toHaveLength(1);
	});

	it('follows runtime state and server switches without stale controls', async () => {
		const screen = render(TopbarHarness, { server: { id: 'a', name: 'Survival' } });
		await screen.rerender({ server: { id: 'a', name: 'Survival', busy: true } });
		await expect.element(header().getByRole('button', { name: 'Start Survival' })).toBeDisabled();

		await screen.rerender({ server: { id: 'b', name: 'Creative' } });
		await expect.element(header().getByRole('heading', { name: 'Creative' })).toBeVisible();
		await expect.element(header().getByRole('button', { name: 'Start Creative' })).toBeEnabled();
		await expect.element(header().getByText('Survival')).not.toBeInTheDocument();
	});

	it('restores the plain breadcrumb header after leaving the server page', async () => {
		const screen = render(TopbarHarness, { server: { id: 'a', name: 'Survival' } });
		await expect.element(header().getByRole('heading', { name: 'Survival' })).toBeVisible();
		await screen.rerender({ server: null });
		await expect.element(header().getByRole('heading')).not.toBeInTheDocument();
		await expect.element(header().getByRole('button', { name: /Start/ })).not.toBeInTheDocument();
		await expect.element(header().getByText('Servers')).toBeVisible();
		await expect.element(header().getByRole('link', { name: 'New server' })).toBeVisible();
	});
});

describe('TopbarSlot', () => {
	it('ignores a stale cleanup from a page that was already replaced', () => {
		const slot = new TopbarSlot();
		const first = (() => {}) as never;
		const second = (() => {}) as never;
		const releaseFirst = slot.claim(first);
		const releaseSecond = slot.claim(second);
		releaseFirst();
		expect(slot.content).toBe(second);
		releaseSecond();
		expect(slot.content).toBeNull();
	});
});
