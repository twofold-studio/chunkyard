import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PackLogo from './pack-logo.svelte';

describe('PackLogo', () => {
	it('falls back to the monogram when a same-origin logo fails to load', async () => {
		const { container } = render(PackLogo, {
			src: '/api/v1/modpacks/curseforge/999999/logo',
			name: 'All the Mods 10'
		});
		const slot = container.querySelector('[data-slot="pack-logo"]')!;
		// The image request has no backend in tests, so it errors and the monogram replaces it.
		await expect.poll(() => slot.querySelector('img')).toBeNull();
		expect(slot.textContent?.trim()).toBe('AT');
	});

	it('never renders remote or scripted image URLs', async () => {
		for (const src of ['https://media.forgecdn.net/a.png', 'javascript:alert(1)', '//evil/x.png']) {
			const { container, unmount } = render(PackLogo, { src, name: 'Pack' });
			expect(container.querySelector('img')).toBeNull();
			expect(container.textContent?.trim()).toBe('P');
			unmount();
		}
	});
});
