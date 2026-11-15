/**
 * Whether the admin is plausibly looking at something: the browser window is visible and
 * focused (`DocumentAttention`) and an element intersects the viewport (`viewportVisibility`).
 * Used to keep costly live sampling to what is actually on screen. Pointer hover or keyboard
 * focus on the element itself is not required.
 */
import type { Attachment } from 'svelte/attachments';

export class DocumentAttention {
	/** `document.visibilityState === 'visible'`. */
	visible = $state(true);
	/** The window has focus (`focus`/`blur` events, `document.hasFocus()` on visibility change). */
	focused = $state(true);

	constructor() {
		if (typeof window === 'undefined' || typeof document === 'undefined') return;
		this.sync();
		// App-lifetime listeners on a single instance (the app is client-rendered only).
		window.addEventListener('focus', () => {
			this.focused = true;
		});
		window.addEventListener('blur', () => {
			this.focused = false;
		});
		document.addEventListener('visibilitychange', () => this.sync());
	}

	/** Window visible and focused. */
	get attentive() {
		return this.visible && this.focused;
	}

	/** Re-reads the document state (visibility changes, tests). */
	sync() {
		if (typeof document === 'undefined') return;
		this.visible = document.visibilityState === 'visible';
		this.focused = this.visible && document.hasFocus();
	}
}

/** One browser-wide instance. */
export const documentAttention = new DocumentAttention();

/**
 * Attachment reporting whether the element intersects the viewport. Reports `false` when it is
 * removed, and ignores observer callbacks that arrive after disposal. Without
 * IntersectionObserver it reports `fallback` once, so callers choose a conservative default.
 */
export function viewportVisibility(
	onChange: (visible: boolean) => void,
	fallback = false
): Attachment<Element> {
	return (element) => {
		const Observer = globalThis.IntersectionObserver;
		if (typeof Observer !== 'function') {
			onChange(fallback);
			return () => onChange(false);
		}
		let disposed = false;
		const observer = new Observer((entries) => {
			if (disposed) return;
			const entry = entries.at(-1);
			if (entry) onChange(entry.isIntersecting);
		});
		observer.observe(element);
		return () => {
			disposed = true;
			observer.disconnect();
			onChange(false);
		};
	};
}
