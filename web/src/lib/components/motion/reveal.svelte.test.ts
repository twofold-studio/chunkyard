import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Swap from './swap.svelte';
import { REDUCED_MOTION_QUERY } from '#lib/motion/index.js';

function preferReducedMotion(reduce: boolean) {
	const original = window.matchMedia.bind(window);
	vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
		query === REDUCED_MOTION_QUERY
			? ({ matches: reduce, media: query } as MediaQueryList)
			: original(query)
	);
}

const content = (text: string) => createRawSnippet(() => ({ render: () => `<p>${text}</p>` }));

afterEach(() => vi.restoreAllMocks());

describe('motion primitives', () => {
	it('animate content in when motion is allowed', async () => {
		preferReducedMotion(false);
		render(Swap, { key: 1, preset: 'rise', children: content('Hello') });
		await expect.element(page.getByText('Hello')).toBeVisible();
		expect(document.getAnimations().length).toBeGreaterThan(0);
	});

	it('render instantly without any animation when reduced motion is preferred', async () => {
		preferReducedMotion(true);
		const screen = render(Swap, { key: 1, preset: 'step', children: content('First') });
		await expect.element(page.getByText('First')).toBeVisible();
		expect(document.getAnimations()).toHaveLength(0);
		await screen.rerender({ key: 2, preset: 'step', children: content('Second') });
		await expect.element(page.getByText('Second')).toBeVisible();
		// Enter-only: the outgoing content is gone at once, so nothing overlaps or shifts.
		await expect.element(page.getByText('First')).not.toBeInTheDocument();
		expect(document.getAnimations()).toHaveLength(0);
	});
});
