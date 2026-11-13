// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Crumb } from '#lib/components/app/types.js';

declare global {
	namespace App {
		interface Error {
			message: string;
			/** Stable backend error code, when the failure came from the API. */
			code?: string;
			hint?: string;
		}
		// interface Locals {}
		interface PageData {
			crumbs?: Crumb[];
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
