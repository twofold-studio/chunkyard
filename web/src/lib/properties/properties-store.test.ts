import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type PropertiesDocument } from '#lib/api/index.js';
import { PropertiesStore, type PropertiesApi } from './properties-store.svelte';

const status = { state: 'running' as const, containerId: 'c1', exitCode: null, oomKilled: false };

function doc(content: string, version: number, extra: Partial<PropertiesDocument> = {}) {
	return {
		content,
		etag: `e${version}`,
		version,
		appliedVersion: 1,
		restartRequired: version !== 1,
		status,
		updatedAt: '2026-11-14T10:00:00Z',
		...extra
	} satisfies PropertiesDocument;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

let version: number;
let api: { [K in keyof PropertiesApi]: ReturnType<typeof vi.fn> };

function makeStore() {
	return new PropertiesStore('srv-1', {
		api: api as unknown as PropertiesApi,
		delayMs: 900,
		retryDelaysMs: [100, 200]
	});
}

/** Default PUT: stores the body as the next version. */
function acceptSaves() {
	api.saveProperties.mockImplementation(async (_id: string, body: { content: string }) => {
		version += 1;
		return doc(body.content, version);
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	version = 1;
	api = {
		getProperties: vi.fn(async () => doc('pvp=true\n', version)),
		saveProperties: vi.fn(),
		listPropertiesVersions: vi.fn(),
		getPropertiesVersion: vi.fn(),
		restoreProperties: vi.fn()
	};
	acceptSaves();
});
afterEach(() => vi.useRealTimers());

describe('PropertiesStore autosave', () => {
	it('saves after inactivity with the latest etag, not on every keystroke', async () => {
		const store = makeStore();
		await store.load();
		store.edit('pvp=f\n');
		await vi.advanceTimersByTimeAsync(500);
		store.edit('pvp=false\n');
		expect(store.state).toBe('pending');
		await vi.advanceTimersByTimeAsync(899);
		expect(api.saveProperties).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(api.saveProperties).toHaveBeenCalledOnce();
		expect(api.saveProperties.mock.calls[0][1]).toEqual({ content: 'pvp=false\n', etag: 'e1' });
		expect(store.state).toBe('saved');
		expect(store.doc?.version).toBe(2);
		expect(store.doc?.restartRequired).toBe(true);
	});

	it('saves immediately for Enter, switches and selects', async () => {
		const store = makeStore();
		await store.load();
		store.edit('pvp=false\n', true);
		await vi.advanceTimersByTimeAsync(0);
		expect(api.saveProperties).toHaveBeenCalledOnce();
	});

	it('keeps edits made during an in-flight save and saves them next', async () => {
		const store = makeStore();
		await store.load();
		const first = deferred<PropertiesDocument>();
		api.saveProperties.mockImplementationOnce(() => first.promise);
		store.edit('a=1\n', true);
		await vi.advanceTimersByTimeAsync(0);
		expect(store.state).toBe('saving');
		store.edit('a=12\n', true); // Joins the running save loop.
		first.resolve(doc('a=1\n', 2));
		await vi.advanceTimersByTimeAsync(0);
		expect(api.saveProperties).toHaveBeenCalledTimes(2);
		expect(api.saveProperties.mock.calls[1][1]).toEqual({ content: 'a=12\n', etag: 'e2' });
		expect(store.content).toBe('a=12\n');
		expect(store.state).toBe('saved');
	});

	it('stops on a conflict without retrying; keep-mine saves on top of the latest', async () => {
		const store = makeStore();
		await store.load();
		api.saveProperties.mockRejectedValueOnce(new ApiError(409, 'properties.conflict', 'changed'));
		store.edit('mine=1\n', true);
		await vi.advanceTimersByTimeAsync(5000);
		expect(api.saveProperties).toHaveBeenCalledOnce();
		expect(store.state).toBe('conflict');
		expect(store.content).toBe('mine=1\n');
		store.edit('ignored=1\n');
		expect(store.content).toBe('mine=1\n');

		version = 5;
		await store.keepMine();
		expect(api.saveProperties).toHaveBeenCalledTimes(2);
		expect(api.saveProperties.mock.calls[1][1]).toEqual({ content: 'mine=1\n', etag: 'e5' });
		expect(store.state).toBe('saved');
	});

	it('reload-latest discards local edits after a conflict', async () => {
		const store = makeStore();
		await store.load();
		api.saveProperties.mockRejectedValueOnce(new ApiError(409, 'properties.conflict', 'changed'));
		store.edit('mine=1\n', true);
		await vi.advanceTimersByTimeAsync(0);
		version = 3;
		await store.reloadLatest();
		expect(store.content).toBe('pvp=true\n');
		expect(store.state).toBe('saved');
		expect(store.doc?.version).toBe(3);
	});

	it('retries server.busy with backoff, then reports an error and retries on demand', async () => {
		const store = makeStore();
		await store.load();
		const busy = new ApiError(409, 'server.busy', 'busy');
		api.saveProperties.mockRejectedValueOnce(busy).mockRejectedValueOnce(busy);
		store.edit('a=1\n', true);
		await vi.advanceTimersByTimeAsync(0);
		expect(store.state).toBe('retrying');
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(200);
		expect(api.saveProperties).toHaveBeenCalledTimes(3);
		expect(store.state).toBe('saved');

		api.saveProperties.mockRejectedValue(busy);
		store.edit('a=2\n', true);
		await vi.advanceTimersByTimeAsync(1000);
		expect(store.state).toBe('error');
		expect(store.content).toBe('a=2\n');
		acceptSaves();
		await store.flush();
		expect(store.state).toBe('saved');
	});

	it('flushes pending text on destroy instead of discarding it', async () => {
		const store = makeStore();
		await store.load();
		store.edit('late=1\n');
		store.destroy();
		await vi.advanceTimersByTimeAsync(0);
		expect(api.saveProperties).toHaveBeenCalledOnce();
		expect(api.saveProperties.mock.calls[0][0]).toBe('srv-1');
		expect(api.saveProperties.mock.calls[0][1]).toEqual({ content: 'late=1\n', etag: 'e1' });
	});

	it('refresh keeps unsaved local text but adopts new metadata', async () => {
		const store = makeStore();
		await store.load();
		store.edit('typing=1\n');
		api.getProperties.mockResolvedValueOnce(doc('pvp=true\n', 1, { appliedVersion: null }));
		await store.refresh();
		expect(store.content).toBe('typing=1\n');
		expect(store.doc?.appliedVersion).toBeNull();
	});
});

describe('PropertiesStore restore', () => {
	it('creates a new version from an old one and refuses while edits are unsaved', async () => {
		const store = makeStore();
		await store.load();
		api.restoreProperties.mockResolvedValue(doc('old=1\n', 9));
		store.edit('typing=1\n');
		expect(await store.restore(1)).toBe(false);
		expect(api.restoreProperties).not.toHaveBeenCalled();

		await store.flush();
		expect(await store.restore(1)).toBe(true);
		expect(api.restoreProperties).toHaveBeenCalledWith('srv-1', { version: 1, etag: 'e2' });
		expect(store.content).toBe('old=1\n');
		expect(store.doc?.version).toBe(9);
	});
});
