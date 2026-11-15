import { vi } from 'vitest';
import { documentAttention } from '#lib/attention.svelte.js';

/**
 * Controllable IntersectionObserver for tests. Like the real one it reports the initial state
 * shortly after `observe` (intersecting unless `FakeIntersectionObserver.initial` is false).
 * Headless browsers cannot reliably scroll or focus the test frame, so tests simulate both.
 */
export class FakeIntersectionObserver {
	static instances: FakeIntersectionObserver[] = [];
	static initial = true;

	readonly elements = new Set<Element>();
	disconnected = false;
	readonly root = null;
	readonly rootMargin = '0px';
	readonly thresholds = [0];

	constructor(readonly callback: IntersectionObserverCallback) {
		FakeIntersectionObserver.instances.push(this);
	}

	observe(element: Element) {
		this.elements.add(element);
		const initial = FakeIntersectionObserver.initial;
		queueMicrotask(() => {
			if (!this.disconnected && this.elements.has(element)) this.emit(element, initial);
		});
	}

	unobserve(element: Element) {
		this.elements.delete(element);
	}

	disconnect() {
		this.disconnected = true;
		this.elements.clear();
	}

	takeRecords() {
		return [];
	}

	/** Delivers an entry, even after disconnect (to test late callbacks). */
	emit(target: Element, isIntersecting: boolean) {
		this.callback(
			[{ target, isIntersecting } as IntersectionObserverEntry],
			this as unknown as IntersectionObserver
		);
	}
}

/** Changes viewport intersection for every observed element matching `target` (or all). */
export function setIntersecting(isIntersecting: boolean, target?: Element) {
	for (const observer of FakeIntersectionObserver.instances) {
		if (observer.disconnected) continue;
		for (const element of observer.elements) {
			if (!target || element === target) observer.emit(element, isIntersecting);
		}
	}
}

export function installFakeIntersectionObserver(initial = true) {
	FakeIntersectionObserver.instances = [];
	FakeIntersectionObserver.initial = initial;
	vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
}

/** Simulates the window gaining or losing focus. */
export function setWindowFocus(focused: boolean) {
	window.dispatchEvent(new Event(focused ? 'focus' : 'blur'));
}

/** Visible, focused window (headless test frames often report no focus). */
export function focusWindow() {
	documentAttention.visible = true;
	setWindowFocus(true);
}
