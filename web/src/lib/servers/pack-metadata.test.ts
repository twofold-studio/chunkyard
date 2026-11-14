import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPackCache, loadCurseForgePack } from './pack-metadata.svelte';

const PACK = { id: 7, name: 'Pack', summary: '', websiteUrl: null, logoUrl: null, downloads: 0 };

afterEach(() => {
	vi.unstubAllGlobals();
	clearPackCache();
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' }
	});

describe('loadCurseForgePack', () => {
	it('fetches each pack once by project ID', async () => {
		const fetch = vi.fn(async () => json(PACK));
		vi.stubGlobal('fetch', fetch);
		await Promise.all([loadCurseForgePack(7), loadCurseForgePack(7)]);
		await loadCurseForgePack(7);
		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0]).toEqual([
			'/api/v1/modpacks/curseforge/7',
			expect.objectContaining({ credentials: 'same-origin' })
		]);
	});

	it('does not cache failures', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(json({ code: 'software.upstream', detail: 'x' }, 502))
			.mockResolvedValueOnce(json(PACK));
		vi.stubGlobal('fetch', fetch);
		await expect(loadCurseForgePack(7)).rejects.toThrow();
		await expect(loadCurseForgePack(7)).resolves.toEqual(PACK);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
