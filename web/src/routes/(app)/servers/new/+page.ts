import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

export const load: PageLoad = () => ({
	crumbs: [
		{ label: 'Servers', href: resolve('servers') },
		{ label: 'New server', href: resolve('servers/new') }
	]
});
