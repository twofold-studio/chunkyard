import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import CommandPalette from './command-palette.svelte';
import type { ServerView } from '#lib/api/index.js';

const server = (id: string, name: string): ServerView => ({
	id,
	name,
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'img',
	port: 25565,
	memoryMinMb: 1024,
	memoryMaxMb: 2048,
	cpus: 1,
	acceptEula: true,
	directory: '/d',
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	software: { type: 'vanilla', version: '1.21.4' },
	launch: null
});

function setup(load: (signal: AbortSignal) => Promise<ServerView[]>) {
	const navigate = vi.fn();
	const trigger = document.createElement('button');
	trigger.textContent = 'outside';
	document.body.append(trigger);
	trigger.focus();
	const screen = render(CommandPalette, { sessionKey: 's1', load, navigate });
	return { navigate, trigger, screen };
}

describe('CommandPalette', () => {
	it('opens with Ctrl+K, selects with arrows and Enter, and navigates via the callback', async () => {
		const { navigate } = setup(async () => [server('srv-1', 'Survival')]);
		await userEvent.keyboard('{Control>}k{/Control}');
		const input = page.getByRole('combobox', { name: 'Search pages and servers' });
		await expect.element(input).toHaveFocus();
		await input.fill('survival console');
		await expect.element(page.getByRole('option', { name: /Survival — Console/ })).toBeVisible();
		await userEvent.keyboard('{Enter}');
		expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/\/servers\/srv-1\?tab=console$/));
		await expect.element(input).not.toBeInTheDocument();
	});

	it('moves the active option with the arrow keys', async () => {
		const { navigate } = setup(async () => []);
		await userEvent.keyboard('{Control>}k{/Control}');
		const options = page.getByRole('option');
		await expect.element(options.first()).toHaveAttribute('aria-selected', 'true');
		await userEvent.keyboard('{ArrowDown}');
		await expect.element(options.nth(1)).toHaveAttribute('aria-selected', 'true');
		await userEvent.keyboard('{ArrowUp}{ArrowUp}');
		await expect.element(options.last()).toHaveAttribute('aria-selected', 'true');
		await userEvent.keyboard('{Home}{Enter}');
		expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/\/servers$/));
	});

	it('Escape closes without navigating and returns focus', async () => {
		const { navigate, trigger } = setup(async () => []);
		await userEvent.keyboard('{Control>}k{/Control}');
		await expect.element(page.getByRole('combobox')).toHaveFocus();
		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByRole('combobox')).not.toBeInTheDocument();
		await expect.element(trigger).toHaveFocus();
		expect(navigate).not.toHaveBeenCalled();
		trigger.remove();
	});

	it('shows a no-match state and a safe error message', async () => {
		setup(async () => {
			throw new Error('<script>upstream</script>');
		});
		await userEvent.keyboard('{Control>}k{/Control}');
		await expect.element(page.getByRole('alert')).toHaveTextContent(/Servers could not be loaded/);
		expect(document.body.textContent).not.toContain('<script>');
		await page.getByRole('combobox').fill('qqqq');
		await expect.element(page.getByText(/No pages or loaded servers match/)).toBeVisible();
	});

	it('aborts the request when closed before it finishes and ignores the late result', async () => {
		let signal!: AbortSignal;
		let finish!: (items: ServerView[]) => void;
		setup((s) => {
			signal = s;
			return new Promise((r) => (finish = r));
		});
		await userEvent.keyboard('{Control>}k{/Control}');
		await expect.element(page.getByLabelText('Loading servers')).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByRole('combobox')).not.toBeInTheDocument();
		expect(signal.aborted).toBe(true);
		finish([server('late', 'Late')]);
		await userEvent.keyboard('{Control>}k{/Control}');
		await expect.element(page.getByRole('combobox')).toBeVisible();
		expect(page.getByText(/Late/).elements()).toHaveLength(0);
	});
});
