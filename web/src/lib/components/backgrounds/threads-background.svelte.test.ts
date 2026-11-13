import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ThreadsBackground from './threads-background.svelte';
import { createThreads } from './threads';

function stubReducedMotion(matches: boolean) {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const query = {
		matches,
		media: '(prefers-reduced-motion: reduce)',
		addEventListener: vi.fn((_: string, fn: (event: MediaQueryListEvent) => void) =>
			listeners.add(fn)
		),
		removeEventListener: vi.fn((_: string, fn: (event: MediaQueryListEvent) => void) =>
			listeners.delete(fn)
		)
	};
	vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
	return {
		query,
		listeners,
		set(next: boolean) {
			query.matches = next;
			for (const fn of [...listeners]) fn({ matches: next } as MediaQueryListEvent);
		}
	};
}

function mount() {
	const container = document.createElement('div');
	container.style.cssText = 'position:fixed;inset:0;width:320px;height:240px';
	const canvas = document.createElement('canvas');
	container.append(canvas);
	document.body.append(container);
	return { container, canvas };
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe('ThreadsBackground', () => {
	it('is decorative, non-interactive, and sized to the viewport', async () => {
		const { container } = render(ThreadsBackground, { class: '-z-10' });
		const root = container.querySelector<HTMLElement>('[data-slot="threads-background"]')!;
		expect(root.getAttribute('aria-hidden')).toBe('true');
		const style = getComputedStyle(root);
		expect(style.pointerEvents).toBe('none');
		expect(style.position).toBe('fixed');
		expect(root.classList.contains('-z-10')).toBe(true);
		expect(root.getBoundingClientRect().width).toBe(window.innerWidth);
		await vi.waitFor(() => expect(root.dataset.status).toBe('webgl'));
		expect(root.querySelector('canvas')).not.toBeNull();
	});

	it('shows a static fallback when WebGL2 is unavailable', async () => {
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
		const { container } = render(ThreadsBackground);
		const root = container.querySelector<HTMLElement>('[data-slot="threads-background"]')!;
		await vi.waitFor(() => expect(root.dataset.status).toBe('fallback'));
		expect(root.querySelector('canvas')).toBeNull();
		expect(root.querySelector('.threads-fallback')).not.toBeNull();
	});
});

describe('createThreads', () => {
	it('animates, then stops and releases its resources on destroy', () => {
		stubReducedMotion(false);
		const cancel = vi.spyOn(window, 'cancelAnimationFrame');
		const removeDoc = vi.spyOn(document, 'removeEventListener');
		const { container, canvas } = mount();
		const handle = createThreads(container, canvas)!;
		expect(handle).not.toBeNull();
		expect(handle.running).toBe(true);
		expect(canvas.width).toBeGreaterThan(1);

		const gl = canvas.getContext('webgl2')!;
		const deleteProgram = vi.spyOn(gl, 'deleteProgram');
		const deleteTexture = vi.spyOn(gl, 'deleteTexture');
		handle.destroy();
		expect(handle.running).toBe(false);
		expect(cancel).toHaveBeenCalled();
		expect(deleteProgram).toHaveBeenCalledTimes(2);
		expect(deleteTexture).toHaveBeenCalledOnce();
		expect(removeDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
	});

	it('draws a single still frame with reduced motion and follows preference changes', () => {
		const motion = stubReducedMotion(true);
		const raf = vi.spyOn(window, 'requestAnimationFrame');
		const { container, canvas } = mount();
		const handle = createThreads(container, canvas)!;
		expect(handle.running).toBe(false);
		expect(raf).not.toHaveBeenCalled();

		motion.set(false);
		expect(handle.running).toBe(true);
		motion.set(true);
		expect(handle.running).toBe(false);

		handle.destroy();
		expect(motion.listeners.size).toBe(0);
	});

	it('pauses while the document is hidden', () => {
		stubReducedMotion(false);
		const { container, canvas } = mount();
		const handle = createThreads(container, canvas)!;
		const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
		document.dispatchEvent(new Event('visibilitychange'));
		expect(handle.running).toBe(false);
		hidden.mockReturnValue(false);
		document.dispatchEvent(new Event('visibilitychange'));
		expect(handle.running).toBe(true);
		handle.destroy();
	});
});
