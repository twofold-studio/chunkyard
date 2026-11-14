import { describe, expect, it, vi } from 'vitest';
import { LeaveGuard, type GuardedNavigation } from './leave-guard.svelte.js';

function nav(href: string, extra: Partial<GuardedNavigation> = {}) {
	const cancel = vi.fn();
	return {
		navigation: {
			to: { url: new URL(href, 'http://app.test') },
			type: 'link',
			willUnload: false,
			cancel,
			...extra
		} satisfies GuardedNavigation,
		cancel
	};
}

describe('LeaveGuard', () => {
	it('lets navigation through while nothing is dirty', () => {
		const guard = new LeaveGuard({ isDirty: () => false, proceed: vi.fn() });
		const { navigation, cancel } = nav('/servers');
		expect(guard.intercept(navigation)).toBe(false);
		expect(cancel).not.toHaveBeenCalled();
		expect(guard.pending).toBeNull();
	});

	it('cancels and remembers the destination while dirty; stay keeps the page', () => {
		const proceed = vi.fn();
		const guard = new LeaveGuard({ isDirty: () => true, proceed });
		const { navigation, cancel } = nav('/servers');
		expect(guard.intercept(navigation)).toBe(true);
		expect(cancel).toHaveBeenCalledOnce();
		expect(guard.pending?.href).toBe('http://app.test/servers');
		guard.stay();
		expect(guard.pending).toBeNull();
		expect(proceed).not.toHaveBeenCalled();
	});

	it('discard resumes the same navigation without prompting again', () => {
		const proceed = vi.fn();
		const guard = new LeaveGuard({ isDirty: () => true, proceed });
		guard.intercept(nav('/activity').navigation);
		guard.discard();
		expect(proceed).toHaveBeenCalledWith({
			href: 'http://app.test/activity',
			type: 'link',
			delta: undefined
		});
		// The resumed navigation (and a retry after e.g. an autosave flush) passes.
		const again = nav('/activity');
		expect(guard.intercept(again.navigation)).toBe(false);
		expect(guard.intercept(nav('/activity').navigation)).toBe(false);
		expect(again.cancel).not.toHaveBeenCalled();
		guard.settled();
		expect(guard.intercept(nav('/activity').navigation)).toBe(true);
	});

	it('a different destination after discard is guarded again', () => {
		const guard = new LeaveGuard({ isDirty: () => true, proceed: vi.fn() });
		guard.intercept(nav('/activity').navigation);
		guard.discard();
		expect(guard.intercept(nav('/exports').navigation)).toBe(true);
	});

	it('keeps back/forward deltas and ignores full unloads', () => {
		const proceed = vi.fn();
		const guard = new LeaveGuard({ isDirty: () => true, proceed });
		const unload = nav('/x', { willUnload: true });
		expect(guard.intercept(unload.navigation)).toBe(false);
		expect(guard.intercept(nav('/servers', { type: 'popstate', delta: -1 }).navigation)).toBe(true);
		guard.discard();
		expect(proceed).toHaveBeenCalledWith(expect.objectContaining({ type: 'popstate', delta: -1 }));
	});

	it('discard and stay are harmless without a pending navigation', () => {
		const proceed = vi.fn();
		const guard = new LeaveGuard({ isDirty: () => true, proceed });
		guard.discard();
		guard.stay();
		expect(proceed).not.toHaveBeenCalled();
	});

	it('only the latest destination is kept while a prompt is open', () => {
		const guard = new LeaveGuard({ isDirty: () => true, proceed: vi.fn() });
		guard.intercept(nav('/a').navigation);
		guard.intercept(nav('/b').navigation);
		expect(guard.pending?.href).toBe('http://app.test/b');
	});
});
