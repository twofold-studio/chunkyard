import { resolve } from '$app/paths';

/** App pages readable without signing in; their data comes from public endpoints only. */
export function isPublicPath(pathname: string): boolean {
	return pathname === resolve('api-docs');
}
