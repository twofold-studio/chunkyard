/**
 * Local console completion: common vanilla Minecraft commands and their fixed subcommands, plus
 * commands sent earlier from this tab. Nothing here asks the server: the console transport is
 * plain stdin, so plugin commands, player names and Brigadier argument completion are not known.
 */

export interface CommandNode {
	name: string;
	/** Fixed words that may follow. */
	children?: readonly CommandNode[];
	/** Free-form arguments expected after this word (shown as a hint only). */
	args?: string;
}

export interface Suggestion {
	/** Full command text after accepting. */
	value: string;
	/** Word shown in the menu. */
	label: string;
	source: 'built-in' | 'history';
	/** Argument hint for built-ins, e.g. `<player>`. */
	hint?: string;
}

export const MAX_SUGGESTIONS = 8;

const words = (names: string, args?: string): CommandNode[] =>
	names.split(' ').map((name) => ({ name, ...(args ? { args } : {}) }));

const GAMEMODES = words('survival creative adventure spectator', '[player]');

/** Vanilla Java Edition commands commonly used from a server console. */
export const BUILT_IN_COMMANDS: readonly CommandNode[] = [
	{ name: 'advancement', children: words('grant revoke', '<player> …') },
	{ name: 'ban', args: '<player> [reason]' },
	{ name: 'ban-ip', args: '<address|player> [reason]' },
	{ name: 'banlist', children: words('ips players') },
	{ name: 'clear', args: '[player] [item] [count]' },
	{ name: 'debug', children: words('start stop') },
	{ name: 'defaultgamemode', children: words('survival creative adventure spectator') },
	{ name: 'deop', args: '<player>' },
	{ name: 'difficulty', children: words('peaceful easy normal hard') },
	{ name: 'effect', children: words('give clear', '<targets> …') },
	{ name: 'enchant', args: '<targets> <enchantment> [level]' },
	{ name: 'execute', args: '<subcommand> …' },
	{
		name: 'experience',
		children: words('add set query', '<targets> …')
	},
	{ name: 'fill', args: '<from> <to> <block>' },
	{ name: 'gamemode', children: GAMEMODES },
	{
		name: 'gamerule',
		children: words(
			'keepInventory doDaylightCycle doWeatherCycle doMobSpawning doFireTick mobGriefing doImmediateRespawn naturalRegeneration playersSleepingPercentage randomTickSpeed showDeathMessages spawnRadius announceAdvancements commandBlockOutput sendCommandFeedback',
			'<value>'
		)
	},
	{ name: 'give', args: '<player> <item> [count]' },
	{ name: 'help', args: '[command]' },
	{ name: 'kick', args: '<player> [reason]' },
	{ name: 'kill', args: '[targets]' },
	{ name: 'list', children: words('uuids') },
	{ name: 'locate', children: words('structure biome poi', '<id>') },
	{ name: 'me', args: '<action>' },
	{ name: 'msg', args: '<player> <message>' },
	{ name: 'op', args: '<player>' },
	{ name: 'pardon', args: '<player>' },
	{ name: 'pardon-ip', args: '<address>' },
	{ name: 'particle', args: '<name> …' },
	{ name: 'playsound', args: '<sound> <source> <targets> …' },
	{ name: 'reload' },
	{ name: 'save-all', children: words('flush') },
	{ name: 'save-off' },
	{ name: 'save-on' },
	{ name: 'say', args: '<message>' },
	{ name: 'scoreboard', children: words('objectives players', '…') },
	{ name: 'seed' },
	{ name: 'setblock', args: '<pos> <block>' },
	{ name: 'setidletimeout', args: '<minutes>' },
	{ name: 'setworldspawn', args: '[pos]' },
	{ name: 'spawnpoint', args: '[targets] [pos]' },
	{ name: 'spreadplayers', args: '<center> <distance> <range> …' },
	{ name: 'stop' },
	{ name: 'summon', args: '<entity> [pos]' },
	{ name: 'tag', args: '<targets> add|remove|list …' },
	{ name: 'team', children: words('add remove list join leave empty modify', '…') },
	{ name: 'teleport', args: '<targets> <destination>' },
	{ name: 'tell', args: '<player> <message>' },
	{ name: 'tellraw', args: '<targets> <json>' },
	{
		name: 'time',
		children: [
			{ name: 'set', children: words('day noon night midnight'), args: '<time>' },
			{ name: 'add', args: '<time>' },
			{ name: 'query', children: words('daytime gametime day') }
		]
	},
	{ name: 'title', args: '<targets> title|subtitle|actionbar|clear|reset|times …' },
	{ name: 'tp', args: '<targets> <destination>' },
	{ name: 'weather', children: words('clear rain thunder', '[duration]') },
	{
		name: 'whitelist',
		children: [...words('add remove', '<player>'), ...words('list on off reload')]
	},
	{
		name: 'worldborder',
		children: words('add center damage get set warning', '…')
	},
	{ name: 'xp', children: words('add set query', '<targets> …') }
];

function matches(candidate: string, partial: string) {
	return candidate.toLowerCase().startsWith(partial.toLowerCase()) && candidate !== partial;
}

/**
 * Suggestions for `input` with the caret at `cursor`. Only completes at the end of the text,
 * so editing in the middle never rewrites what follows the caret.
 */
export function suggestCommands(
	input: string,
	cursor: number,
	history: readonly string[] = [],
	commands: readonly CommandNode[] = BUILT_IN_COMMANDS
): Suggestion[] {
	if (cursor !== input.length || !input.trim()) return [];
	const results: Suggestion[] = [];
	const seen = new Set<string>();
	const add = (suggestion: Suggestion) => {
		if (results.length >= MAX_SUGGESTIONS || seen.has(suggestion.value)) return;
		seen.add(suggestion.value);
		results.push(suggestion);
	};

	// Earlier commands that extend what is typed, newest first.
	const typed = input.trimStart();
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i];
		if (matches(item, typed)) add({ value: item, label: item, source: 'history' });
	}

	// A leading slash is accepted (players type it in chat) and kept.
	const leading = input.length - typed.length;
	const slash = typed.startsWith('/') ? '/' : '';
	const body = typed.slice(slash.length);
	const tokens = body.split(' ');
	const partial = tokens.pop() ?? '';
	// Repeated spaces are left alone: there is no fixed word to complete after them.
	if (tokens.some((token) => token === '')) return results;

	let level: readonly CommandNode[] | undefined = commands;
	for (const token of tokens) {
		const node: CommandNode | undefined = level?.find(
			(n) => n.name.toLowerCase() === token.toLowerCase()
		);
		level = node?.children;
		if (!level) break;
	}
	if (level) {
		const prefix = input.slice(0, leading) + slash + tokens.map((t) => `${t} `).join('');
		for (const node of level) {
			if (!matches(node.name, partial)) continue;
			const more = Boolean(node.children?.length || node.args);
			add({
				value: `${prefix}${node.name}${more ? ' ' : ''}`,
				label: node.name,
				source: 'built-in',
				hint: node.args
			});
		}
	}
	return results;
}
