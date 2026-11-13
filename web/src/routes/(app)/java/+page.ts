import { resolve } from '$app/paths';
import { listJavaRuntimes, type JavaRuntime } from '#lib/api/index.js';
import { loadError } from '#lib/load-error.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
	const crumbs = [{ label: 'Java runtimes', href: resolve('java') }];
	const { auth } = await parent();
	if (!auth) return { crumbs, runtimes: [] as JavaRuntime[] };
	try {
		const { items } = await listJavaRuntimes({ fetch });
		return { crumbs, runtimes: items };
	} catch (error) {
		loadError(error);
	}
};
