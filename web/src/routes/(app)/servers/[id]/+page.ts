import { resolve } from '$app/paths';
import { getServer } from '#lib/api/index.js';
import { loadError } from '#lib/load-error.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent, params }) => {
	const { auth } = await parent();
	if (!auth) return { crumbs: [], server: null };
	try {
		const server = await getServer(params.id, { fetch });
		return {
			crumbs: [
				{ label: 'Servers', href: resolve('servers') },
				{ label: server.name, href: resolve(`servers/${server.id}`) }
			],
			server
		};
	} catch (error) {
		loadError(error);
	}
};
