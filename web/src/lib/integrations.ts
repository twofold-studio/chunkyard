/** MCP endpoint on this manager's origin. */
export function mcpEndpoint(origin: string): string {
	return `${origin.replace(/\/+$/, '')}/mcp`;
}

/**
 * Claude Code setup command with a placeholder key. A real key is never interpolated, so the
 * command can be shown, copied and kept without leaking a credential.
 */
export function claudeCodeCommand(endpoint: string): string {
	return `claude mcp add --transport http chunkyard ${endpoint} --header "Authorization: Bearer YOUR_API_KEY"`;
}
