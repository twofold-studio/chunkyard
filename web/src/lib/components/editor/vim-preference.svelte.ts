/**
 * Browser-wide opt-in for Vim keybindings in the code editor (Files and Properties), remembered
 * in localStorage. Off unless the user turns it on; blocked storage just means it is not kept.
 */

export const VIM_PREFERENCE_KEY = 'chunkyard.editor.vim';

export function parseVimPreference(raw: string | null): boolean {
	return raw === 'on';
}

function readStored(): boolean {
	try {
		return parseVimPreference(globalThis.localStorage?.getItem(VIM_PREFERENCE_KEY) ?? null);
	} catch {
		return false; // Storage blocked (private mode, sandbox).
	}
}

class VimPreference {
	enabled = $state(readStored());

	set(enabled: boolean) {
		this.enabled = enabled;
		try {
			if (enabled) globalThis.localStorage?.setItem(VIM_PREFERENCE_KEY, 'on');
			else globalThis.localStorage?.removeItem(VIM_PREFERENCE_KEY);
		} catch {
			// Not persisted; still applies until the page is reloaded.
		}
	}

	toggle() {
		this.set(!this.enabled);
	}

	/** Re-reads storage (tests, or another tab changed it). */
	reload() {
		this.enabled = readStored();
	}
}

/** The app is client-rendered only (`ssr = false`), so one browser-wide instance is safe. */
export const vimPreference = new VimPreference();
