import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { describeError, type ErrorMessage } from '#lib/api/index.js';
import { resolveAuth, type AuthResolution } from '#lib/auth.js';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, url }) => {
	let resolution: AuthResolution;
	try {
		resolution = await resolveAuth(fetch);
	} catch (error) {
		return { unavailable: describeError(error) as ErrorMessage | null };
	}
	// Signed in or authentication disabled: setup/login do not apply.
	if (resolution.kind === 'ready') redirect(307, resolve('servers'));
	if (resolution.kind === 'setup' && url.pathname !== resolve('setup'))
		redirect(307, resolve('setup'));
	if (resolution.kind === 'login' && url.pathname !== resolve('login'))
		redirect(307, resolve('login'));
	return { unavailable: null as ErrorMessage | null };
};
