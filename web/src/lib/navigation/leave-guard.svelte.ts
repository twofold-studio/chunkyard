/**
 * Guards in-app navigation while something holds unsaved changes. A guarded navigation is
 * cancelled and remembered; the page shows a confirmation and either stays or resumes the
 * same navigation after discarding. Full page unloads are left to `beforeunload`.
 */

/** The parts of SvelteKit's `BeforeNavigate` the guard needs. */
export interface GuardedNavigation {
	to: { url: URL } | null;
	type: string;
	/** History steps for `popstate` navigations (back/forward). */
	delta?: number;
	willUnload: boolean;
	cancel(): void;
}

export interface LeaveTarget {
	href: string;
	type: string;
	delta?: number;
}

export interface LeaveGuardOptions {
	/** True while leaving would lose changes. */
	isDirty: () => boolean;
	/** Resumes a confirmed navigation (e.g. `goto(href)` or `history.go(delta)`). */
	proceed: (target: LeaveTarget) => unknown;
}

export class LeaveGuard {
	/** Navigation waiting for the user's decision; `null` when no prompt is open. */
	pending = $state<LeaveTarget | null>(null);
	/** Destination the user agreed to discard changes for. */
	#allowed: string | null = null;
	#options: LeaveGuardOptions;

	constructor(options: LeaveGuardOptions) {
		this.#options = options;
	}

	/** Call from `beforeNavigate`. Returns true when the navigation was cancelled. */
	intercept(navigation: GuardedNavigation): boolean {
		if (navigation.willUnload || !navigation.to) return false;
		const href = navigation.to.url.href;
		// The confirmed destination may be re-requested (e.g. after an autosave flush).
		if (this.#allowed === href) return false;
		this.#allowed = null;
		if (!this.#options.isDirty()) return false;
		navigation.cancel();
		// One prompt at a time; a newer attempt replaces the remembered destination.
		this.pending = { href, type: navigation.type, delta: navigation.delta };
		return true;
	}

	stay() {
		this.pending = null;
	}

	discard() {
		const target = this.pending;
		this.pending = null;
		if (!target) return;
		this.#allowed = target.href;
		this.#options.proceed(target);
	}

	/** Call from `afterNavigate`: the confirmed destination was reached. */
	settled() {
		this.#allowed = null;
	}
}
