/**
 * Presentation of `GET /api/v1/servers/{id}/status` (Server List Ping readiness). Unknown
 * values stay unknown: missing counts are never shown as zero, the player sample is never
 * presented as a complete roster, and an old or failed observation is labelled as such.
 */
import type { GameState, GameStatus } from '#lib/api/index.js';
import { UNAVAILABLE } from '#lib/metrics.js';

/** One shared poll per server page. */
export const STATUS_POLL_MS = 5000;
/** An observation older than this is no longer presented as current. */
export const STATUS_STALE_MS = 15_000;

export type ReadinessTone = 'success' | 'warning' | 'danger' | 'muted';

export const GAME_STATE_LABELS: Record<GameState, string> = {
	starting: 'Starting',
	ready: 'Ready',
	unreachable: 'Unreachable',
	stopped: 'Stopped',
	failed: 'Failed',
	archived: 'Archived',
	paused: 'Paused',
	unknown: 'Unknown'
};

const TONES: Record<GameState, ReadinessTone> = {
	starting: 'warning',
	ready: 'success',
	unreachable: 'danger',
	stopped: 'muted',
	failed: 'danger',
	archived: 'muted',
	paused: 'warning',
	unknown: 'warning'
};

function count(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: null;
}

/** `3/20`, `3` when the maximum is unknown, or `—` when the count is unknown. */
export function formatPlayerCount(status: Pick<GameStatus, 'onlinePlayers' | 'maxPlayers'>) {
	const online = count(status.onlinePlayers);
	const max = count(status.maxPlayers);
	if (online === null) return UNAVAILABLE;
	return max === null ? String(online) : `${online}/${max}`;
}

/** Note shown with the advertised names, so a partial sample never reads as the full roster. */
export function sampleNote(status: Pick<GameStatus, 'onlinePlayers' | 'playerSample'>): string {
	const shown = status.playerSample.length;
	const online = count(status.onlinePlayers);
	if (shown === 0) {
		return online !== null && online > 0
			? 'The server advertises no player names.'
			: 'No advertised player names.';
	}
	if (online !== null && online > shown) {
		return `Advertised sample: ${shown} of ${online} online. Not a complete roster.`;
	}
	return 'Advertised sample from the server. Not guaranteed to be a complete roster.';
}

export interface Readiness {
	state: GameState | null;
	label: string;
	tone: ReadinessTone;
	/** The observation is old (unattended page or failing requests); values are not current. */
	stale: boolean;
	/** Players text, or `null` when it should not be shown (unknown or not current). */
	players: string | null;
}

/**
 * Compact readiness for the header and Overview. `receivedAt`/`now` are ms since the epoch.
 * Without a current observation the state reads as unchecked rather than repeating an old one.
 */
export function readiness(
	status: GameStatus | null,
	receivedAt: number | null,
	now: number,
	failed: boolean
): Readiness {
	if (!status || receivedAt === null) {
		return {
			state: null,
			label: failed ? 'Status unavailable' : 'Checking',
			tone: 'muted',
			stale: false,
			players: null
		};
	}
	const stale = failed || now - receivedAt > STATUS_STALE_MS;
	const players = stale ? null : formatPlayerCount(status);
	return {
		state: status.state,
		label: stale
			? `Last seen ${GAME_STATE_LABELS[status.state].toLowerCase()}`
			: GAME_STATE_LABELS[status.state],
		tone: stale ? 'muted' : TONES[status.state],
		stale,
		players: players === UNAVAILABLE ? null : players
	};
}
