import { resolve } from '$app/paths';
import {
	getStorage,
	listExports,
	listServers,
	type ExportRecord,
	type ServerView,
	type StorageConnection
} from '#lib/api/index.js';
import { loadError } from '#lib/load-error.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
	const crumbs = [{ label: 'Storage & exports', href: resolve('exports') }];
	const { auth } = await parent();
	if (!auth) {
		return {
			crumbs,
			storage: null as StorageConnection | null,
			exports: [] as ExportRecord[],
			servers: null as ServerView[] | null
		};
	}
	try {
		const [storage, exports, servers] = await Promise.all([
			getStorage({ fetch }),
			listExports({ fetch }),
			// Local/archived/removed state of each backed-up server; never blocks the page.
			listServers({ fetch }).catch(() => null)
		]);
		return {
			crumbs,
			storage: storage as StorageConnection | null,
			exports: exports.items,
			servers: servers ? servers.items : null
		};
	} catch (error) {
		loadError(error);
	}
};
