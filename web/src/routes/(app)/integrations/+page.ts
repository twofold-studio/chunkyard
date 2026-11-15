import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Keys are listed client-side so the page can show loading, error and retry states.
export const load: PageLoad = () => ({
	crumbs: [{ label: 'Integrations', href: resolve('integrations') }]
});
