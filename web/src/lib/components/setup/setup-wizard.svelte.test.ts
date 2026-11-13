import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import SetupWizard from './setup-wizard.svelte';

const TOKEN = 'local-fixture-token-123';
const VERIFY = '/api/v1/setup/verify-token';
const SETUP = '/api/v1/setup';

type Reply = { status: number; body?: unknown };
interface Call {
	path: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

const problem = (status: number, code: string, detail = code): Reply => ({
	status,
	body: { code, detail }
});

let calls: Call[];
let replies: Record<string, Reply[]>;

function reply(path: string, ...queue: Reply[]) {
	replies[path] = queue;
}

beforeEach(() => {
	calls = [];
	replies = {};
	localStorage.clear();
	sessionStorage.clear();
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init: RequestInit) => {
			calls.push({
				path,
				method: init.method ?? 'GET',
				headers: init.headers as Record<string, string>,
				body: init.body ? JSON.parse(init.body as string) : undefined
			});
			const next = replies[path]?.shift();
			if (!next) throw new Error(`unexpected request ${path}`);
			if (next.status === 204) return new Response(null, { status: 204 });
			return new Response(JSON.stringify(next.body ?? {}), {
				status: next.status,
				headers: {
					'content-type': next.status >= 400 ? 'application/problem+json' : 'application/json'
				}
			});
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function setup(oncomplete = vi.fn()) {
	render(SetupWizard, { oncomplete });
	return { oncomplete };
}

const tokenField = () => page.getByLabelText('Setup token', { exact: true });
const continueButton = () => page.getByRole('button', { name: 'Continue', exact: true });
const createButton = () => page.getByRole('button', { name: 'Create owner', exact: true });
const step1Heading = () =>
	page.getByRole('heading', { name: 'Verify the setup token', exact: true });
const step2Heading = () =>
	page.getByRole('heading', { name: 'Create the owner account', exact: true });

async function verify(token = TOKEN) {
	reply(VERIFY, { status: 204 });
	await tokenField().fill(token);
	await continueButton().click();
	await expect.element(step2Heading()).toBeVisible();
}

async function fillAccount(password = 'correct horse battery', confirm = password) {
	await page.getByLabelText('Email', { exact: true }).fill(' owner@example.test ');
	await page.getByLabelText('Password', { exact: true }).fill(password);
	await page.getByLabelText('Confirm password', { exact: true }).fill(confirm);
}

describe('SetupWizard', () => {
	it('starts with only the token field and a two-step progress indicator', async () => {
		setup();
		await expect.element(step1Heading()).toBeVisible();
		await expect.element(tokenField()).toBeVisible();
		await expect.element(page.getByLabelText('Email', { exact: true })).not.toBeInTheDocument();
		await expect.element(page.getByLabelText('Password', { exact: true })).not.toBeInTheDocument();
		await expect
			.element(page.getByLabelText('Confirm password', { exact: true }))
			.not.toBeInTheDocument();
		await expect.element(continueButton()).toBeDisabled();

		const progress = page.getByRole('list', { name: 'Setup progress' });
		await expect.element(progress).toBeVisible();
		const current = document.querySelector('[aria-current="step"]');
		expect(current?.textContent).toMatch(/Setup token.*step 1 of 2, current/s);
	});

	it('lists labelled token sources as separate monospace blocks', async () => {
		setup();
		await expect.element(tokenField()).toHaveAttribute('aria-describedby', 'token-help');
		const help = document.getElementById('token-help');
		const entries = [...(help?.querySelectorAll('dl > div') ?? [])].map((entry) => [
			entry.querySelector('dt')?.textContent?.trim(),
			entry.querySelector('dd code')?.textContent
		]);
		expect(entries).toEqual([
			['Docker host', 'docker exec <container> cat /data/setup-token'],
			['Inside a container terminal (e.g. Dokploy)', 'cat /data/setup-token'],
			['Without Docker, read the file', '<data-dir>/setup-token']
		]);
		await expect
			.element(page.getByText('docker exec <container> cat /data/setup-token', { exact: true }))
			.toBeVisible();
	});

	it('verifies the token with the backend before showing account fields', async () => {
		setup();
		await verify(`  ${TOKEN}  `);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			path: VERIFY,
			method: 'POST',
			body: { setupToken: TOKEN }
		});
		expect(calls[0].headers['X-MCM-CSRF']).toBe('1');

		await expect.element(tokenField()).not.toBeInTheDocument();
		await expect.element(page.getByText(TOKEN)).not.toBeInTheDocument();
		await expect.element(page.getByLabelText('Email', { exact: true })).toHaveFocus();
		expect(document.querySelector('[data-state="complete"]')?.textContent).toMatch(
			/Setup token.*completed/s
		);
		expect(document.querySelector('[aria-current="step"]')?.textContent).toMatch(/Owner account/);
		// Verification alone never creates the account.
		expect(calls.some((call) => call.path === SETUP)).toBe(false);
	});

	it('stays on step one when the backend rejects the token', async () => {
		setup();
		reply(VERIFY, problem(401, 'setup.invalid_token', 'The setup token is invalid.'));
		await tokenField().fill('wrong-token');
		await continueButton().click();

		await expect.element(page.getByRole('alert')).toHaveTextContent(/Invalid setup token/);
		await expect.element(step1Heading()).toBeVisible();
		await expect.element(tokenField()).toHaveAttribute('aria-invalid', 'true');
		await expect.element(tokenField()).toHaveFocus();
		await expect.element(page.getByLabelText('Email', { exact: true })).not.toBeInTheDocument();
	});

	it('offers sign in when setup was already completed elsewhere', async () => {
		setup();
		reply(VERIFY, problem(409, 'setup.already_done'));
		await tokenField().fill(TOKEN);
		await continueButton().click();
		await expect.element(page.getByRole('alert')).toHaveTextContent(/Setup already completed/);
		await expect
			.element(page.getByRole('link', { name: 'Go to sign in' }))
			.toHaveAttribute('href', expect.stringMatching(/\/login$/));
	});

	it('creates the owner with the originally verified token', async () => {
		const { oncomplete } = setup();
		await verify();
		await fillAccount();
		reply(SETUP, { status: 201, body: { user: { email: 'owner@example.test' } } });
		await createButton().click();

		await vi.waitFor(() => expect(oncomplete).toHaveBeenCalledOnce());
		const final = calls.find((call) => call.path === SETUP);
		expect(final).toMatchObject({
			method: 'POST',
			body: { setupToken: TOKEN, email: 'owner@example.test', password: 'correct horse battery' }
		});
		expect(final?.headers['X-MCM-CSRF']).toBe('1');
		// Token stays in memory only.
		expect(localStorage.length + sessionStorage.length).toBe(0);
		expect(location.href).not.toContain(TOKEN);
	});

	it('keeps step two for local password validation and mismatches', async () => {
		setup();
		await verify();

		await fillAccount('short', 'short');
		await expect
			.element(page.getByText('Use at least 10 characters.', { exact: true }))
			.toBeVisible();
		await createButton().click();
		await fillAccount('correct horse battery', 'different horse battery');
		await createButton().click();
		await expect.element(page.getByText('Passwords do not match.', { exact: true })).toBeVisible();

		await expect.element(step2Heading()).toBeVisible();
		expect(calls.filter((call) => call.path === SETUP)).toHaveLength(0);
	});

	it('stays on step two when the backend rejects the password', async () => {
		setup();
		await verify();
		await fillAccount();
		reply(SETUP, problem(422, 'auth.weak_password', 'This password is too common.'));
		await createButton().click();

		await expect.element(page.getByRole('alert')).toHaveTextContent(/Password rejected/);
		await expect.element(step2Heading()).toBeVisible();
		await expect
			.element(page.getByLabelText('Email', { exact: true }))
			.toHaveValue('owner@example.test');
	});

	it('returns to step one when the final request rejects the original token', async () => {
		setup();
		await verify();
		await fillAccount();
		reply(SETUP, problem(401, 'setup.invalid_token', 'The setup token is invalid.'));
		await createButton().click();

		await expect.element(step1Heading()).toBeVisible();
		await expect.element(page.getByRole('alert')).toHaveTextContent(/Invalid setup token/);
		await expect.element(tokenField()).toHaveFocus();

		// A new verification is required before account fields return, with passwords cleared.
		reply(VERIFY, { status: 204 });
		await tokenField().fill('replacement-token');
		await continueButton().click();
		await expect.element(step2Heading()).toBeVisible();
		await expect.element(page.getByLabelText('Password', { exact: true })).toHaveValue('');
		await expect.element(page.getByLabelText('Confirm password', { exact: true })).toHaveValue('');
		expect(calls.filter((call) => call.path === VERIFY)).toHaveLength(2);
	});

	it('lets the operator go back to change the token and re-verify', async () => {
		setup();
		await verify();
		await fillAccount();
		await page.getByRole('button', { name: 'Change token' }).click();

		await expect.element(step1Heading()).toBeVisible();
		await expect.element(tokenField()).toHaveFocus();
		await expect.element(tokenField()).toHaveValue(TOKEN);

		reply(VERIFY, { status: 204 });
		await tokenField().fill('second-token');
		await continueButton().click();
		await expect.element(step2Heading()).toBeVisible();
		await expect
			.element(page.getByLabelText('Email', { exact: true }))
			.toHaveValue('owner@example.test');
		await expect.element(page.getByLabelText('Password', { exact: true })).toHaveValue('');

		reply(SETUP, { status: 201, body: {} });
		await page.getByLabelText('Password', { exact: true }).fill('correct horse battery');
		await page.getByLabelText('Confirm password', { exact: true }).fill('correct horse battery');
		await createButton().click();
		await vi.waitFor(() =>
			expect(calls.find((call) => call.path === SETUP)?.body).toMatchObject({
				setupToken: 'second-token'
			})
		);
	});

	it('disables the form while verification is pending', async () => {
		setup();
		let release!: () => void;
		vi.mocked(fetch).mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					release = () => resolve(new Response(null, { status: 204 }));
				})
		);
		await tokenField().fill(TOKEN);
		await continueButton().click();
		// The spinner adds "Loading" to the accessible name while pending.
		await expect
			.element(page.getByRole('button', { name: 'Loading Continue', exact: true }))
			.toBeDisabled();
		await expect.element(tokenField()).toBeDisabled();
		release();
		await expect.element(step2Heading()).toBeVisible();
	});
});
