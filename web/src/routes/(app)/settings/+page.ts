import { resolve } from '$app/paths';
import { getIsolation, getStorage } from '#lib/api/index.js';
import type { PageLoad } from './$types';

// Read-only manager facts; each may fail on its own without blocking the browser preferences.
export const load: PageLoad = async ({ fetch, parent }) => {
	const crumbs = [{ label: 'Settings', href: resolve('settings') }];
	const { auth } = await parent();
	if (!auth) {
		return { crumbs, docker: null, storage: null };
	}
	const [docker, storage] = await Promise.all([
		getIsolation({ fetch }).then(
			(r) => r.docker,
			() => null
		),
		getStorage({ fetch }).then(
			(s) => s,
			() => null
		)
	]);
	return { crumbs, docker, storage };
};
