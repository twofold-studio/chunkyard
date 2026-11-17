import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerPlayers, { type PlayersApi } from './server-players.svelte';
import { ApiError, type Job, type PlayerChange, type PlayerLists } from '#lib/api/index.js';

const lists = (extra: Partial<PlayerLists> = {}): PlayerLists => ({
	whitelist: [{ uuid: 'aaaa', name: 'Alex' }],
	operators: [{ uuid: 'ssss', name: 'Steve', level: 4, bypassesPlayerLimit: false }],
	bans: [],
	knownPlayers: [
		{ name: 'Alex', uuid: 'aaaa' },
		{ name: 'Notch', uuid: 'nnnn' }
	],
	running: false,
	onlineMode: true,
	whitelistEnabled: false,
	...extra
});

const job = (state: Job['state'], extra: Partial<Job> = {}): Job => ({
	work: null,
	id: 'pj1',
	kind: 'server.players',
	serverId: 's1',
	state,
	progress: null,
	message: null,
	error: null,
	result: null,
	createdBy: null,
	createdAt: '',
	startedAt: null,
	finishedAt: null,
	...extra
});

function api(initial = lists(), final: (change: PlayerChange) => Job = () => job('succeeded')) {
	const submitted: PlayerChange[] = [];
	const stub: PlayersApi & { submitted: PlayerChange[] } = {
		submitted,
		load: vi.fn(async () => initial),
		submit: vi.fn(async (_id, change) => {
			submitted.push(change);
			return { job: job('queued') };
		}),
		wait: vi.fn(async () => final(submitted.at(-1)!))
	};
	return stub;
}

// Known-player suggestions make the name field a combobox (input with a datalist).
const nameInput = () => page.getByRole('combobox', { name: 'Player name' });

describe('ServerPlayers', () => {
	it('shows the lists and desired flags, and never submits on load', async () => {
		const stub = api();
		render(ServerPlayers, { serverId: 's1', serverState: 'stopped', api: stub });
		await expect.element(page.getByText('Alex', { exact: true })).toBeVisible();
		await expect
			.element(page.getByTestId('players-flags'))
			.toHaveTextContent(/Whitelist enforcement\s*Off.*Saved in Properties/);
		await expect.element(page.getByTestId('players-mode')).toHaveTextContent(/Stopped/);
		expect(stub.submit).not.toHaveBeenCalled();
	});

	it('adds to the whitelist with the exact payload and applies the job result', async () => {
		const updated = lists({ whitelist: [...lists().whitelist, { uuid: 'nnnn', name: 'Notch' }] });
		const stub = api(lists(), () => job('succeeded', { result: { players: updated } }));
		render(ServerPlayers, { serverId: 's1', serverState: 'stopped', api: stub });
		await nameInput().fill('Notch');
		await page.getByRole('button', { name: 'Add to whitelist' }).click();
		await expect.element(page.getByText('Notch', { exact: true })).toBeVisible();
		expect(stub.submitted).toEqual([{ list: 'whitelist', action: 'add', name: 'Notch' }]);
		await expect.element(nameInput()).toHaveValue('');
	});

	it('validates names locally before any request', async () => {
		const stub = api();
		render(ServerPlayers, { serverId: 's1', serverState: 'stopped', api: stub });
		await nameInput().fill('no spaces');
		await page.getByRole('button', { name: 'Add to whitelist' }).click();
		await expect
			.element(page.getByTestId('players-form-hint'))
			.toHaveTextContent('Use 3–16 letters, digits or underscores.');
		expect(stub.submit).not.toHaveBeenCalled();
	});

	it('omits the operator level while running, after confirmation', async () => {
		const stub = api(lists({ running: true }));
		render(ServerPlayers, { serverId: 's1', serverState: 'running', api: stub });
		await page.getByRole('tab', { name: /Operators/ }).click();
		await expect.element(page.getByText('Server default (live op)')).toBeVisible();
		await nameInput().fill('Notch');
		await page.getByRole('button', { name: 'Make operator' }).click();
		const dialog = page.getByRole('alertdialog');
		await expect.element(dialog).toHaveTextContent(/console command.*configured operator level/);
		expect(stub.submit).not.toHaveBeenCalled();
		await page.getByTestId('players-confirm').click();
		await vi.waitFor(() => expect(stub.submitted).toHaveLength(1));
		expect(stub.submitted[0]).toEqual({ list: 'operators', action: 'add', name: 'Notch' });
		expect('level' in stub.submitted[0]).toBe(false);
	});

	it('requires confirmation to remove, and cancelling sends nothing', async () => {
		const stub = api();
		render(ServerPlayers, { serverId: 's1', serverState: 'stopped', api: stub });
		await page.getByRole('button', { name: 'Remove Alex' }).click();
		await expect
			.element(page.getByRole('alertdialog'))
			.toHaveTextContent('Remove Alex from the whitelist?');
		await page.getByRole('button', { name: 'Cancel' }).click();
		expect(stub.submit).not.toHaveBeenCalled();

		await page.getByRole('button', { name: 'Remove Alex' }).click();
		await page.getByTestId('players-confirm').click();
		await vi.waitFor(() =>
			expect(stub.submitted).toEqual([{ list: 'whitelist', action: 'remove', name: 'Alex' }])
		);
	});

	it('reports a failed job with its Activity link and a Files link for malformed lists', async () => {
		const onOpenFiles = vi.fn();
		const stub = api(lists(), () =>
			job('failed', {
				error: { code: 'players.invalid_file', detail: 'A player list contains invalid JSON.' }
			})
		);
		render(ServerPlayers, { serverId: 's1', serverState: 'stopped', api: stub, onOpenFiles });
		await nameInput().fill('Notch');
		await page.getByRole('button', { name: 'Add to whitelist' }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Player list is malformed');
		await expect
			.element(page.getByTestId('players-job-link'))
			.toHaveAttribute('href', expect.stringContaining('activity/pj1'));
		await page.getByRole('button', { name: 'Open whitelist.json in Files' }).click();
		expect(onOpenFiles).toHaveBeenCalledOnce();
		// The lists are re-read after a failure; nothing is retried.
		expect(stub.submit).toHaveBeenCalledTimes(1);
		expect(stub.load).toHaveBeenCalledTimes(2);
	});

	it('shows a rejected request and keeps actions disabled while busy', async () => {
		const stub = api();
		stub.submit = vi.fn(async () => {
			throw new ApiError(422, 'players.identity', 'Unknown player.');
		});
		const { rerender } = render(ServerPlayers, {
			serverId: 's1',
			serverState: 'stopped',
			api: stub
		});
		await nameInput().fill('Nobody_x');
		await page.getByRole('button', { name: 'Add to whitelist' }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Player identity unknown');
		await rerender({ busy: true });
		await expect.element(page.getByRole('button', { name: 'Add to whitelist' })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'Remove Alex' })).toBeDisabled();
	});
});
