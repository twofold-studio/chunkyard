import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, mcpEndpoint } from './integrations';

describe('integration snippets', () => {
	it('builds the MCP endpoint from the origin and never includes a real key', () => {
		expect(mcpEndpoint('https://mc.example.com/')).toBe('https://mc.example.com/mcp');
		const command = claudeCodeCommand('https://mc.example.com/mcp');
		expect(command).toBe(
			'claude mcp add --transport http chunkyard https://mc.example.com/mcp --header "Authorization: Bearer YOUR_API_KEY"'
		);
		expect(command).not.toMatch(/cyk_/);
	});
});
