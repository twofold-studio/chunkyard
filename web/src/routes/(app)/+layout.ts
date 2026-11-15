import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { describeError, type ErrorMessage } from '#lib/api/index.js';
import { resolveAuth, type AuthContext } from '#lib/auth.js';
import { isPublicPath } from '#lib/navigation/public-pages.js';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, depends, url, untrack }) => {
	depends('app:auth');
	// Untracked: the auth check must not rerun on every navigation.
	const publicPage = untrack(() => isPublicPath(url.pathname));
	let resolution;
	try {
		resolution = await resolveAuth(fetch);
	} catch (error) {
		return {
			auth: null as AuthContext | null,
			unavailable: describeError(error) as ErrorMessage | null,
			visitor: false
		};
	}
	if (resolution.kind !== 'ready' && publicPage) {
		// Signed-out visitor on a public page: render it without the app shell.
		return {
			auth: null as AuthContext | null,
			unavailable: null as ErrorMessage | null,
			visitor: true
		};
	}
	if (resolution.kind === 'setup') redirect(307, resolve('setup'));
	if (resolution.kind === 'login') redirect(307, resolve('login'));
	return {
		auth: resolution.auth as AuthContext | null,
		unavailable: null as ErrorMessage | null,
		visitor: false
	};
};
