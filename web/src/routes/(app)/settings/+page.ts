import { resolve } from '$app/paths';
import {
	getIsolation,
	getStorage,
	type DockerInfo,
	type StorageConnection
} from '#lib/api/index.js';
import type { PageLoad } from './$types';

// Read-only manager facts; each may fail on its own without blocking the browser preferences.
export const load: PageLoad = async ({ fetch, parent }) => {
	const crumbs = [{ label: 'Settings', href: resolve('settings') }];
	const { auth } = await parent();
	if (!auth) {
		return { crumbs, docker: null as DockerInfo | null, storage: null as StorageConnection | null };
	}
	const [docker, storage] = await Promise.all([
		getIsolation({ fetch }).then(
			(r) => r.docker as DockerInfo | null,
			() => null
		),
		getStorage({ fetch }).then(
			(s) => s as StorageConnection | null,
			() => null
		)
	]);
	return { crumbs, docker, storage };
};
