import { resolve } from '$app/paths';
import { getIsolation, listServers, type DockerInfo, type ServerView } from '#lib/api/index.js';
import { loadError } from '#lib/load-error.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
	const crumbs = [{ label: 'Servers', href: resolve('servers') }];
	const { auth } = await parent();
	if (!auth) return { crumbs, servers: [] as ServerView[], docker: null as DockerInfo | null };
	try {
		const [{ items }, docker] = await Promise.all([
			listServers({ fetch }),
			// Docker status is advisory here; never fail the list because of it.
			getIsolation({ fetch }).then(
				(isolation) => isolation.docker as DockerInfo | null,
				() => null
			)
		]);
		return { crumbs, servers: items, docker };
	} catch (error) {
		loadError(error);
	}
};
