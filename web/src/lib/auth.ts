import { getMe, getSetupStatus, isApiError, type Fetch, type User } from '#lib/api/index.js';

/** How the current browser is authorised. Auth-disabled mode has no user at all. */
export type AuthContext = { mode: 'disabled' } | { mode: 'session'; user: User };

export type AuthResolution =
	{ kind: 'ready'; auth: AuthContext } | { kind: 'setup' } | { kind: 'login' };

/**
 * Decides where the browser belongs: setup, login, or the app.
 * Throws ApiError for anything other than "not signed in" (e.g. backend unreachable).
 */
export async function resolveAuth(fetch?: Fetch): Promise<AuthResolution> {
	const status = await getSetupStatus({ fetch });
	if (!status.authEnabled) {
		// Confirm the backend agrees; the principal carries no user in this mode.
		const me = await getMe({ fetch });
		if (me.principal.kind === 'auth_disabled') return { kind: 'ready', auth: { mode: 'disabled' } };
	}
	if (status.required) return { kind: 'setup' };
	try {
		const me = await getMe({ fetch });
		if (me.principal.kind === 'session' && me.user) {
			return { kind: 'ready', auth: { mode: 'session', user: me.user } };
		}
		return { kind: 'login' };
	} catch (error) {
		if (isApiError(error)) {
			if (error.code === 'auth.required') return { kind: 'login' };
			if (error.code === 'setup_required') return { kind: 'setup' };
		}
		throw error;
	}
}
