import { resolve } from '$app/paths';
import { listJobs, listServers, type JobPage } from '#lib/api/index.js';
import { JOBS_PAGE_SIZE } from '#lib/jobs/jobs-feed.svelte.js';
import { loadError } from '#lib/load-error.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
	const crumbs = [{ label: 'Activity', href: resolve('activity') }];
	const { auth } = await parent();
	if (!auth) return { crumbs, jobs: null as JobPage | null, servers: null };
	try {
		const [jobs, servers] = await Promise.all([
			listJobs({ fetch, limit: JOBS_PAGE_SIZE }),
			// Names and links only; jobs remain readable when this fails.
			listServers({ fetch }).catch(() => null)
		]);
		return {
			crumbs,
			jobs: jobs as JobPage | null,
			servers: servers ? servers.items.map((s) => ({ id: s.id, name: s.name })) : null
		};
	} catch (error) {
		loadError(error);
	}
};
