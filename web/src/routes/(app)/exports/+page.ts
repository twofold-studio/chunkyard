import { resolve } from '$app/paths';
import {
	getStorage,
	listExports,
	listServers,
	type ExportRecord,
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
			serverIds: null as string[] | null
		};
	}
	try {
		const [storage, exports, servers] = await Promise.all([
			getStorage({ fetch }),
			listExports({ fetch }),
			// Only used to mark archives of deleted servers; never blocks the page.
			listServers({ fetch }).catch(() => null)
		]);
		return {
			crumbs,
			storage: storage as StorageConnection | null,
			exports: exports.items,
			serverIds: servers ? servers.items.map((s) => s.id) : null
		};
	} catch (error) {
		loadError(error);
	}
};
