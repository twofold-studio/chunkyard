import { resolve } from '$app/paths';
import { getJob, listServers, type Job } from '#lib/api/index.js';
import { jobKindLabel } from '#lib/jobs/jobs.js';
import { loadError } from '#lib/load-error.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent, params }) => {
	const base = { label: 'Activity', href: resolve('activity') };
	const { auth } = await parent();
	if (!auth) return { crumbs: [base], job: null as Job | null, servers: null };
	try {
		const [job, servers] = await Promise.all([
			getJob(params.id, { fetch }),
			listServers({ fetch }).catch(() => null)
		]);
		return {
			crumbs: [base, { label: jobKindLabel(job.kind), href: resolve(`activity/${job.id}`) }],
			job: job as Job | null,
			servers: servers ? servers.items.map((s) => ({ id: s.id, name: s.name })) : null
		};
	} catch (error) {
		loadError(error);
	}
};
