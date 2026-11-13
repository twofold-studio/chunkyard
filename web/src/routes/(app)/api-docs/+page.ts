import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// The document itself is fetched client-side so the page can show loading and retry states.
export const load: PageLoad = () => ({
	crumbs: [{ label: 'API reference', href: resolve('api-docs') }]
});
