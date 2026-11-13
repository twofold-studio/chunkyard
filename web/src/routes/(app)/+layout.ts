import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { describeError, type ErrorMessage } from '#lib/api/index.js';
import { resolveAuth, type AuthContext } from '#lib/auth.js';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, depends }) => {
	depends('app:auth');
	let resolution;
	try {
		resolution = await resolveAuth(fetch);
	} catch (error) {
		return {
			auth: null as AuthContext | null,
			unavailable: describeError(error) as ErrorMessage | null
		};
	}
	if (resolution.kind === 'setup') redirect(307, resolve('setup'));
	if (resolution.kind === 'login') redirect(307, resolve('login'));
	return { auth: resolution.auth as AuthContext | null, unavailable: null as ErrorMessage | null };
};
