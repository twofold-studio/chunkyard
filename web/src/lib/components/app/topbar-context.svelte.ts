import { createContext, type Snippet } from 'svelte';

/**
 * Lets the current page render contextual content (title, status, lifecycle controls)
 * into the app shell's top bar. Created per app-layout instance and shared through
 * component context, so nothing lives in module state (no cross-request leakage).
 *
 * Every claim gets an ownership token: when one page replaces another, the outgoing
 * page's cleanup cannot clear the content the incoming page just registered.
 */
export class TopbarSlot {
	content = $state.raw<Snippet | null>(null);
	#owner: symbol | null = null;

	claim(content: Snippet): () => void {
		const token = Symbol('topbar-claim');
		this.#owner = token;
		this.content = content;
		return () => {
			if (this.#owner !== token) return;
			this.#owner = null;
			this.content = null;
		};
	}
}

const [getSlot, setSlot, hasSlot] = createContext<TopbarSlot>();

/** Creates the slot for an app shell. Call during component initialisation. */
export function provideTopbarSlot(): TopbarSlot {
	return setSlot(new TopbarSlot());
}

/**
 * Renders `content` in the top bar while the calling component is mounted. Call during
 * component initialisation; the content is removed when the component is destroyed.
 * Without an app shell (isolated component tests) this is a no-op.
 */
export function useTopbarContent(content: Snippet): void {
	if (!hasSlot()) return;
	const slot = getSlot();
	$effect(() => slot.claim(content));
}
