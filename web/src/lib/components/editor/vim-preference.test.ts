import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIM_PREFERENCE_KEY, parseVimPreference, vimPreference } from './vim-preference.svelte';

function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key) => data.get(key) ?? null,
		key: (index) => [...data.keys()][index] ?? null,
		removeItem: (key) => void data.delete(key),
		setItem: (key, value) => void data.set(key, String(value))
	};
}

describe('vim preference', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vimPreference.reload();
	});

	it('is off unless explicitly stored as on', () => {
		expect(parseVimPreference(null)).toBe(false);
		expect(parseVimPreference('')).toBe(false);
		expect(parseVimPreference('true')).toBe(false);
		expect(parseVimPreference('on')).toBe(true);
	});

	it('remembers the choice and forgets it when turned off', () => {
		const storage = memoryStorage();
		vi.stubGlobal('localStorage', storage);
		vimPreference.reload();
		expect(vimPreference.enabled).toBe(false);
		vimPreference.toggle();
		expect(vimPreference.enabled).toBe(true);
		expect(storage.getItem(VIM_PREFERENCE_KEY)).toBe('on');
		vimPreference.set(false);
		expect(storage.getItem(VIM_PREFERENCE_KEY)).toBeNull();
	});

	it('still toggles for the page when storage is blocked', () => {
		const blocked = {
			getItem: () => {
				throw new DOMException('denied', 'SecurityError');
			},
			setItem: () => {
				throw new DOMException('denied', 'SecurityError');
			},
			removeItem: () => {
				throw new DOMException('denied', 'SecurityError');
			}
		};
		vi.stubGlobal('localStorage', blocked);
		expect(() => vimPreference.reload()).not.toThrow();
		expect(vimPreference.enabled).toBe(false);
		expect(() => vimPreference.set(true)).not.toThrow();
		expect(vimPreference.enabled).toBe(true);
		expect(() => vimPreference.set(false)).not.toThrow();
		expect(vimPreference.enabled).toBe(false);
	});
});
