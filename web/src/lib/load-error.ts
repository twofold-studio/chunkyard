import { error } from '@sveltejs/kit';
import { describeError, isApiError } from '#lib/api/index.js';

/** Rethrows an API failure from a load function as a SvelteKit error with operator hints. */
export function loadError(cause: unknown): never {
	const message = describeError(cause);
	const status = isApiError(cause) && cause.status >= 400 ? cause.status : 503;
	error(status, {
		message: `${message.title}: ${message.detail}`,
		code: isApiError(cause) ? cause.code : undefined,
		hint: message.hint
	});
}
