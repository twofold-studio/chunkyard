/**
 * Shared live metrics per server. Every view that wants live CPU/RAM for a server (the server
 * page header and charts, server list cards) subscribes here, so one server never has two
 * streams or pollers, and its session history is shared between views.
 *
 * Transport: one WebSocket per watched server (`metrics/stream`), capped in total; when the
 * cap is reached or streaming keeps failing, REST snapshots at no less than 1 s, with a small
 * global limit on concurrent requests. Hidden pages stop everything; subscriptions resume
 * when visible again. Only measured samples are recorded, in their own `sampledAt` order:
 * duplicates are dropped and nothing is interpolated.
 */
import {
	ApiError,
	errorCode,
	getServerMetrics,
	isAbortError,
	type ServerMetrics
} from '#lib/api/index.js';
import { appendSample, type HistoryPoint } from '#lib/metrics-history.js';
import { MIN_POLL_MS } from '#lib/metrics-interval.svelte.js';
import { poll } from '#lib/polling.js';
import {
	browserSocketFactory,
	RECONNECT_DELAYS_MS,
	type SocketFactory,
	type SocketLike
} from '#lib/console/console-stream.js';
import { metricsStreamUrl, parseMetricsFrame } from './metrics-stream.js';

export type MetricsTransport = 'stream' | 'poll';

export interface MetricsHubOptions {
	createSocket: SocketFactory | null;
	/** WebSockets open at once across all servers (the backend allows 16 servers / 32 sockets). */
	maxStreams: number;
	/** REST snapshot requests in flight at once across all servers. */
	pollConcurrency: number;
	retryDelaysMs: readonly number[];
	/** After streaming gives up for a server, how long to use REST before trying again. */
	streamCooldownMs: number;
	fetchMetrics: (serverId: string, signal: AbortSignal) => Promise<ServerMetrics>;
	isVisible: () => boolean;
	streamUrl: (serverId: string, intervalMs: number) => string;
}

/** Idle channels whose history is kept for a quick return (list ↔ server page). */
const MAX_IDLE_CHANNELS = 32;

const defaults = (): MetricsHubOptions => ({
	createSocket: browserSocketFactory(),
	maxStreams: 8,
	pollConcurrency: 2,
	retryDelaysMs: RECONNECT_DELAYS_MS.slice(0, 3),
	streamCooldownMs: 60_000,
	fetchMetrics: (id, signal) => getServerMetrics(id, { signal }),
	isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
	streamUrl: (id, ms) => metricsStreamUrl(id, ms)
});

/** Counting semaphore for REST requests. */
class Gate {
	#free: number;
	#queue: (() => void)[] = [];
	constructor(size: number) {
		this.#free = size;
	}
	async run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T | undefined> {
		if (signal.aborted) return undefined;
		if (this.#free > 0) this.#free -= 1;
		else {
			const acquired = await new Promise<boolean>((resolve) => {
				const go = () => {
					signal.removeEventListener('abort', cancel);
					resolve(true);
				};
				const cancel = () => {
					this.#queue = this.#queue.filter((entry) => entry !== go);
					resolve(false);
				};
				this.#queue.push(go);
				signal.addEventListener('abort', cancel, { once: true });
			});
			if (!acquired) return undefined;
		}
		try {
			if (signal.aborted) return undefined;
			return await task();
		} finally {
			const next = this.#queue.shift();
			if (next) next();
			else this.#free += 1;
		}
	}
}

export class MetricsChannel {
	readonly serverId: string;
	sample = $state.raw<ServerMetrics | null>(null);
	error = $state.raw<unknown>(null);
	history = $state.raw<HistoryPoint[]>([]);
	transport = $state<MetricsTransport | null>(null);
	/** Delivery interval of the running transport (0 when idle). */
	intervalMs = $state(0);
	/** When the stream last gave up; REST is used until the cooldown passes. */
	streamFailedAt = 0;
	lastUsed = 0;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered state
	readonly subscribers = new Map<symbol, number>();
	stopTransport: (() => void) | null = null;

	constructor(serverId: string) {
		this.serverId = serverId;
	}

	/** Records a measured sample; stale or duplicate measurements are ignored. */
	record(sample: ServerMetrics, now = Date.now()) {
		if (sample.serverId !== this.serverId) return;
		const current = this.sample;
		if (current && Date.parse(sample.sampledAt) <= Date.parse(current.sampledAt)) {
			// Same measurement delivered again (or older): never relabel it as new.
			if (sample.status?.state === current.status?.state) return;
		}
		this.sample = sample;
		this.error = null;
		this.history = appendSample(this.history, sample, now);
	}

	/** A failed sample: busy keeps the last reading, anything else clears it and leaves a gap. */
	fail(error: unknown) {
		this.error = error;
		if (errorCode(error) !== 'metrics.busy') {
			this.sample = null;
			// The gap sits just after the last measurement: sample times come from the server's
			// clock, so a browser timestamp could hide real samples that follow.
			const last = this.history.at(-1);
			this.history = appendSample(this.history, null, last ? last.t + 1 : Date.now());
		}
	}

	/** The container is known to be stopped: no current reading. */
	clearSample() {
		this.sample = null;
		this.error = null;
	}
}

export interface MetricsSubscription {
	readonly channel: MetricsChannel;
	setInterval(intervalMs: number): void;
	release(): void;
}

export class MetricsHub {
	#options: MetricsHubOptions = defaults();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- registry, not rendered state
	#channels = new Map<string, MetricsChannel>();
	#streams = 0;
	#gate = new Gate(this.#options.pollConcurrency);
	#listening = false;
	#pageActive = true;

	/** Replaces options (tests) and drops every channel. */
	configure(options: Partial<MetricsHubOptions>) {
		this.reset();
		this.#options = { ...defaults(), ...options };
		this.#gate = new Gate(this.#options.pollConcurrency);
	}

	reset() {
		for (const channel of this.#channels.values()) this.#stop(channel);
		this.#channels.clear();
		this.#streams = 0;
	}

	/** Open WebSockets right now (for tests and diagnostics). */
	get streams() {
		return this.#streams;
	}

	/** Channel for a server (created idle if missing); does not subscribe. */
	channel(serverId: string): MetricsChannel {
		let channel = this.#channels.get(serverId);
		if (!channel) {
			channel = new MetricsChannel(serverId);
			this.#channels.set(serverId, channel);
			this.#prune();
		}
		channel.lastUsed = Date.now();
		return channel;
	}

	/** Watches a server at a delivery interval (> 0). Several watchers share one transport. */
	watch(serverId: string, intervalMs: number): MetricsSubscription {
		this.#listen();
		const channel = this.channel(serverId);
		const id = Symbol(serverId);
		channel.subscribers.set(id, intervalMs);
		this.#reconcile(channel);
		let released = false;
		return {
			channel,
			setInterval: (ms) => {
				if (released) return;
				channel.subscribers.set(id, ms);
				this.#reconcile(channel);
			},
			release: () => {
				if (released) return;
				released = true;
				channel.subscribers.delete(id);
				channel.lastUsed = Date.now();
				this.#reconcile(channel);
				this.#prune();
			}
		};
	}

	/** One REST snapshot outside the live loop (stopped server, refresh off, manual refresh). */
	async snapshot(serverId: string, signal: AbortSignal): Promise<void> {
		const channel = this.channel(serverId);
		try {
			const sample = await this.#options.fetchMetrics(serverId, signal);
			if (!signal.aborted) channel.record(sample);
		} catch (error) {
			if (isAbortError(error) || signal.aborted) throw error;
			channel.fail(error);
			throw error;
		}
	}

	#listen() {
		if (this.#listening || typeof document === 'undefined') return;
		this.#listening = true;
		document.addEventListener('visibilitychange', () => this.visibilityChanged());
		window.addEventListener('pagehide', () => this.pageHidden());
		window.addEventListener('pageshow', () => this.pageShown());
	}

	/** Full navigation/BFCache must release transports even before visibility updates. */
	pageHidden() {
		this.#pageActive = false;
		this.visibilityChanged();
	}

	pageShown() {
		this.#pageActive = true;
		this.visibilityChanged();
	}

	/** Stops every transport while hidden and resumes subscriptions when visible. */
	visibilityChanged() {
		for (const channel of this.#channels.values()) this.#reconcile(channel);
	}

	#prune() {
		const idle = [...this.#channels.values()].filter((c) => c.subscribers.size === 0);
		if (idle.length <= MAX_IDLE_CHANNELS) return;
		idle.sort((a, b) => a.lastUsed - b.lastUsed);
		for (const channel of idle.slice(0, idle.length - MAX_IDLE_CHANNELS)) {
			this.#channels.delete(channel.serverId);
		}
	}

	#desired(channel: MetricsChannel): number {
		let best = 0;
		for (const ms of channel.subscribers.values())
			if (ms > 0 && (best === 0 || ms < best)) best = ms;
		return best;
	}

	#reconcile(channel: MetricsChannel) {
		const ms = this.#pageActive && this.#options.isVisible() ? this.#desired(channel) : 0;
		if (ms === 0) return this.#stop(channel);
		if (channel.stopTransport && channel.intervalMs === ms) return;
		this.#stop(channel);
		this.#start(channel, ms);
	}

	#stop(channel: MetricsChannel) {
		channel.stopTransport?.();
		channel.stopTransport = null;
		channel.transport = null;
		channel.intervalMs = 0;
	}

	#start(channel: MetricsChannel, ms: number) {
		channel.intervalMs = ms;
		const cooling = Date.now() - channel.streamFailedAt < this.#options.streamCooldownMs;
		if (this.#options.createSocket && !cooling && this.#streams < this.#options.maxStreams) {
			this.#startStream(channel, ms, this.#options.createSocket);
		} else {
			this.#startPoll(channel, ms);
		}
	}

	#startPoll(channel: MetricsChannel, ms: number) {
		const controller = new AbortController();
		channel.transport = 'poll';
		channel.stopTransport = () => controller.abort();
		const signal = controller.signal;
		void poll(
			(tickSignal) =>
				this.#gate
					.run(tickSignal, () => this.#options.fetchMetrics(channel.serverId, tickSignal))
					.then(
						(sample) => {
							if (sample && !tickSignal.aborted) channel.record(sample);
						},
						(error: unknown) => {
							if (!isAbortError(error) && !tickSignal.aborted) channel.fail(error);
						}
					),
			{
				intervalMs: Math.max(ms, MIN_POLL_MS),
				signal,
				isVisible: this.#options.isVisible
			}
		);
	}

	#startStream(channel: MetricsChannel, ms: number, create: SocketFactory) {
		const delays = this.#options.retryDelaysMs;
		let socket: SocketLike | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let attempt = 0;
		let done = false;
		let counted = false;

		const release = () => {
			if (counted) this.#streams -= 1;
			counted = false;
		};
		const close = () => {
			if (timer !== null) clearTimeout(timer);
			timer = null;
			const current = socket;
			socket = null;
			if (current) {
				current.onopen = current.onmessage = current.onclose = current.onerror = null;
				current.close(1000, 'client closed');
			}
			release();
		};
		const stop = () => {
			done = true;
			close();
		};
		const giveUp = () => {
			if (done) return;
			stop();
			channel.streamFailedAt = Date.now();
			// Same channel, same subscribers: continue with REST snapshots.
			if (channel.stopTransport === stop) this.#startPoll(channel, ms);
		};

		const open = () => {
			if (done) return;
			if (this.#streams >= this.#options.maxStreams) return giveUp();
			let ws: SocketLike;
			try {
				ws = create(this.#options.streamUrl(channel.serverId, ms));
			} catch {
				giveUp();
				return;
			}
			socket = ws;
			counted = true;
			this.#streams += 1;
			ws.onmessage = (event) => {
				const frame = parseMetricsFrame(event.data);
				if (!frame) return;
				if (frame.type === 'sample') {
					attempt = 0; // only real data proves the stream works
					channel.record(frame.sample);
				} else if (frame.type === 'error') {
					channel.fail(new ApiError(502, frame.code, frame.detail));
				} else if (frame.type === 'end') {
					ws.close(1000, 'stream ended');
				}
			};
			ws.onclose = () => {
				if (done || socket !== ws) return;
				socket = null;
				release();
				if (attempt >= delays.length) return giveUp();
				timer = setTimeout(() => {
					timer = null;
					open();
				}, delays[attempt]);
				attempt += 1;
			};
			ws.onerror = () => {
				// A close event follows; reconnecting is handled there.
			};
		};

		channel.transport = 'stream';
		channel.stopTransport = stop;
		open();
	}
}

/** One hub for the whole client-rendered app. */
export const metricsHub = new MetricsHub();
