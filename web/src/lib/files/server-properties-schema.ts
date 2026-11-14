/**
 * Common vanilla `server.properties` keys shown in the structured editor. Defaults are
 * Minecraft's own (shown when the file omits a key); the editor never writes them on
 * its own. Keys not listed here appear under "Other" and stay editable as text.
 */

export type PropertyKind = 'boolean' | 'enum' | 'integer' | 'text' | 'secret' | 'managed';

export interface PropertyOption {
	value: string;
	label: string;
}

export interface PropertyField {
	key: string;
	label: string;
	help: string;
	kind: PropertyKind;
	/** Minecraft's default when the key is absent. */
	defaultValue: string;
	options?: readonly PropertyOption[];
	min?: number;
	max?: number;
}

export interface PropertyGroup {
	id: string;
	title: string;
	/** Collapsed until opened (or while searching). */
	advanced?: boolean;
	fields: readonly PropertyField[];
}

/** Minecraft listens on this port inside the container; the host port lives in Network. */
export const MANAGED_GAME_PORT = '25565';

const bool = (key: string, label: string, help: string, defaultValue: boolean): PropertyField => ({
	key,
	label,
	help,
	kind: 'boolean',
	defaultValue: String(defaultValue)
});

const int = (
	key: string,
	label: string,
	help: string,
	defaultValue: number,
	min?: number,
	max?: number
): PropertyField => ({
	key,
	label,
	help,
	kind: 'integer',
	defaultValue: String(defaultValue),
	min,
	max
});

export const PROPERTY_GROUPS: readonly PropertyGroup[] = [
	{
		id: 'general',
		title: 'General',
		fields: [
			{
				key: 'motd',
				label: 'Message of the day',
				help: 'Shown under the server name in the multiplayer list. § codes set colours.',
				kind: 'text',
				defaultValue: 'A Minecraft Server'
			},
			int('max-players', 'Max players', 'Players allowed online at once.', 20, 0, 2147483647),
			{
				key: 'gamemode',
				label: 'Game mode',
				help: 'Mode for new players.',
				kind: 'enum',
				defaultValue: 'survival',
				options: [
					{ value: 'survival', label: 'Survival' },
					{ value: 'creative', label: 'Creative' },
					{ value: 'adventure', label: 'Adventure' },
					{ value: 'spectator', label: 'Spectator' }
				]
			},
			{
				key: 'difficulty',
				label: 'Difficulty',
				help: 'World difficulty.',
				kind: 'enum',
				defaultValue: 'easy',
				options: [
					{ value: 'peaceful', label: 'Peaceful' },
					{ value: 'easy', label: 'Easy' },
					{ value: 'normal', label: 'Normal' },
					{ value: 'hard', label: 'Hard' }
				]
			},
			bool('hardcore', 'Hardcore', 'Hard difficulty; players become spectators on death.', false),
			bool('pvp', 'PvP', 'Players can damage each other.', true),
			bool('force-gamemode', 'Force game mode', 'Reset players to the game mode on join.', false),
			bool(
				'allow-flight',
				'Allow flight',
				'Do not kick players for flying (needed by some mods).',
				false
			)
		]
	},
	{
		id: 'access',
		title: 'Players & access',
		fields: [
			{
				key: 'online-mode',
				label: 'Verify player accounts',
				help: 'Players must sign in with a real Minecraft account. Turn off only behind a proxy that verifies accounts: otherwise anyone can join under any name, including yours.',
				kind: 'boolean',
				defaultValue: 'true'
			},
			bool('white-list', 'Whitelist', 'Only players on whitelist.json can join.', false),
			bool(
				'enforce-whitelist',
				'Enforce whitelist',
				'Kick online players who are not whitelisted when it reloads.',
				false
			),
			bool(
				'enforce-secure-profile',
				'Require signed chat',
				'Players must have a Mojang-signed public key to join.',
				true
			),
			{
				key: 'op-permission-level',
				label: 'Operator level',
				help: 'Default permission level for /op.',
				kind: 'enum',
				defaultValue: '4',
				options: [
					{ value: '1', label: '1 · Bypass spawn protection' },
					{ value: '2', label: '2 · Cheat commands' },
					{ value: '3', label: '3 · Player management' },
					{ value: '4', label: '4 · All commands' }
				]
			},
			int(
				'spawn-protection',
				'Spawn protection',
				'Radius around spawn non-ops cannot edit; 0 disables.',
				16,
				0
			),
			int(
				'player-idle-timeout',
				'Idle kick (minutes)',
				'Kick idle players after this long; 0 never kicks.',
				0,
				0
			),
			bool(
				'hide-online-players',
				'Hide player list',
				'Do not show online players in the server list.',
				false
			)
		]
	},
	{
		id: 'world',
		title: 'World',
		fields: [
			{
				key: 'level-name',
				label: 'World folder',
				help: 'Folder loaded (or created) at start.',
				kind: 'text',
				defaultValue: 'world'
			},
			{
				key: 'level-seed',
				label: 'Seed',
				help: 'Used only when a new world is generated. Blank picks a random seed.',
				kind: 'text',
				defaultValue: ''
			},
			{
				key: 'level-type',
				label: 'World type',
				help: 'Used only when a new world is generated.',
				kind: 'enum',
				defaultValue: 'minecraft:normal',
				options: [
					{ value: 'minecraft:normal', label: 'Normal' },
					{ value: 'minecraft:flat', label: 'Superflat' },
					{ value: 'minecraft:large_biomes', label: 'Large biomes' },
					{ value: 'minecraft:amplified', label: 'Amplified' },
					{ value: 'minecraft:single_biome_surface', label: 'Single biome' }
				]
			},
			bool(
				'generate-structures',
				'Generate structures',
				'Villages, temples and other structures.',
				true
			),
			bool('allow-nether', 'Allow the Nether', 'Players can travel to the Nether.', true),
			bool('spawn-monsters', 'Spawn monsters', 'Hostile mobs spawn.', true),
			int(
				'max-world-size',
				'World border radius',
				'Maximum radius of the world border in blocks.',
				29999984,
				1,
				29999984
			)
		]
	},
	{
		id: 'performance',
		title: 'Performance',
		advanced: true,
		fields: [
			int('view-distance', 'View distance', 'Chunks sent to clients (3–32).', 10, 3, 32),
			int(
				'simulation-distance',
				'Simulation distance',
				'Chunks around players that tick (3–32).',
				10,
				3,
				32
			),
			int(
				'entity-broadcast-range-percentage',
				'Entity range (%)',
				'How far entities are sent to clients (10–1000).',
				100,
				10,
				1000
			),
			int(
				'max-tick-time',
				'Watchdog (ms)',
				'Stop the server after a tick takes this long; -1 disables.',
				60000,
				-1
			),
			int(
				'network-compression-threshold',
				'Compression threshold',
				'Compress packets at least this many bytes; -1 disables.',
				256,
				-1
			),
			bool(
				'sync-chunk-writes',
				'Synchronous chunk writes',
				'Safer saves at some performance cost.',
				true
			)
		]
	},
	{
		id: 'network',
		title: 'Network & remote access',
		advanced: true,
		fields: [
			{
				key: 'server-port',
				label: 'Game port',
				help: 'Managed by Chunkyard: Minecraft always listens on 25565 inside the container.',
				kind: 'managed',
				defaultValue: MANAGED_GAME_PORT
			},
			{
				key: 'server-ip',
				label: 'Listen address',
				help: 'Keep blank so Minecraft listens on all container interfaces. The host bind address is set in Network.',
				kind: 'text',
				defaultValue: ''
			},
			bool('enable-status', 'Show in server list', 'Answer server list pings.', true),
			bool(
				'prevent-proxy-connections',
				'Block VPN/proxy players',
				'Kick players whose IP differs from the one Mojang sees.',
				false
			),
			bool('enable-query', 'GameSpy query', 'Chunkyard does not publish the query port.', false),
			bool('enable-rcon', 'RCON', 'Chunkyard does not publish the RCON port.', false),
			{
				key: 'rcon.password',
				label: 'RCON password',
				help: 'Stored in plain text in server.properties.',
				kind: 'secret',
				defaultValue: ''
			}
		]
	}
];

export const KNOWN_PROPERTY_KEYS: ReadonlySet<string> = new Set(
	PROPERTY_GROUPS.flatMap((group) => group.fields.map((field) => field.key))
);

/** Minecraft reads booleans with `Boolean.parseBoolean`: only "true" (any case) is true. */
export function parseBooleanProperty(value: string): boolean {
	return value.trim().toLowerCase() === 'true';
}

/** Validation message for a field value, or `null` when Minecraft will accept it. */
export function validatePropertyValue(field: PropertyField, value: string): string | null {
	if (field.kind === 'boolean') {
		const normal = value.trim().toLowerCase();
		return normal === 'true' || normal === 'false'
			? null
			: `“${value}” is not true/false; Minecraft reads it as false.`;
	}
	if (field.kind === 'integer') {
		if (value.trim() === '') return `Empty: Minecraft uses ${field.defaultValue}.`;
		if (!/^-?\d+$/.test(value.trim())) return 'Enter a whole number.';
		const number = Number(value.trim());
		if (field.min !== undefined && number < field.min) return `Use at least ${field.min}.`;
		if (field.max !== undefined && number > field.max) return `Use at most ${field.max}.`;
	}
	return null;
}

/** Case-insensitive match on key, label, help and the current value. */
export function matchesQuery(
	field: Pick<PropertyField, 'key' | 'label' | 'help'>,
	query: string,
	value = ''
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [field.key, field.label, field.help, value].some((text) =>
		text.toLowerCase().includes(needle)
	);
}
