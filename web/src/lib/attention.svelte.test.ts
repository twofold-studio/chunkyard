import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentAttention, viewportVisibility } from './attention.svelte';
import {
	FakeIntersectionObserver,
	installFakeIntersectionObserver,
	setIntersecting
} from '../tests/fake-intersection-observer';

afterEach(() => vi.unstubAllGlobals());

describe('viewportVisibility', () => {
	it('reports intersection changes and false on removal, ignoring late callbacks', async () => {
		installFakeIntersectionObserver(false);
		const seen: boolean[] = [];
		const element = document.createElement('div');
		const dispose = viewportVisibility((v) => seen.push(v))(element) as () => void;
		await Promise.resolve();
		expect(seen).toEqual([false]);
		setIntersecting(true);
		setIntersecting(false);
		setIntersecting(true);
		expect(seen).toEqual([false, true, false, true]);

		const [observer] = FakeIntersectionObserver.instances;
		dispose();
		expect(observer.disconnected).toBe(true);
		expect(seen.at(-1)).toBe(false);
		// A queued entry delivered after disposal must not resurrect visibility.
		observer.emit(element, true);
		expect(seen.at(-1)).toBe(false);
	});

	it('falls back to the caller default when IntersectionObserver is missing', () => {
		vi.stubGlobal('IntersectionObserver', undefined);
		const strict: boolean[] = [];
		const lenient: boolean[] = [];
		const element = document.createElement('div');
		const disposeStrict = viewportVisibility((v) => strict.push(v))(element) as () => void;
		viewportVisibility((v) => lenient.push(v), true)(element);
		expect(strict).toEqual([false]);
		expect(lenient).toEqual([true]);
		disposeStrict();
		expect(strict).toEqual([false, false]);
	});
});

describe('DocumentAttention', () => {
	it('follows window focus and blur, and page visibility', () => {
		const attention = new DocumentAttention();
		window.dispatchEvent(new Event('focus'));
		expect(attention.attentive).toBe(true);
		window.dispatchEvent(new Event('blur'));
		expect(attention.attentive).toBe(false);
		window.dispatchEvent(new Event('focus'));
		expect(attention.attentive).toBe(true);

		const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(attention.visible).toBe(false);
		expect(attention.attentive).toBe(false);
		hidden.mockRestore();
		const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
		document.dispatchEvent(new Event('visibilitychange'));
		expect(attention.attentive).toBe(true);
		focus.mockRestore();
	});
});
