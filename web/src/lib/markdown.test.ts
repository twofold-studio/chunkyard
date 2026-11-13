import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
	it('reads the Changie changelog shape', () => {
		const blocks = parseMarkdown(
			[
				'# Changelog',
				'',
				'Generated from `.changes/` using [Changie](https://changie.dev/).',
				'',
				'## Unreleased',
				'',
				'',
				'### Added',
				'',
				'- REST API: add `GET /api/v1/system/version`.',
				'- Wrapped item',
				'  continues here.',
				'',
				'```sh',
				'changie merge',
				'```'
			].join('\n')
		);
		expect(blocks.map((b) => b.type)).toEqual([
			'heading',
			'paragraph',
			'heading',
			'heading',
			'list',
			'code'
		]);
		expect(blocks[2]).toEqual({
			type: 'heading',
			level: 2,
			inlines: [{ type: 'text', text: 'Unreleased' }]
		});
		const list = blocks[4] as Extract<(typeof blocks)[number], { type: 'list' }>;
		expect(list.items[0]).toContainEqual({ type: 'code', text: 'GET /api/v1/system/version' });
		expect(list.items[1]).toEqual([{ type: 'text', text: 'Wrapped item continues here.' }]);
		expect(blocks[5]).toEqual({ type: 'code', text: 'changie merge' });
	});

	it('keeps raw HTML as plain text and only links http(s) URLs', () => {
		expect(parseInline('<img src=x onerror=alert(1)> **bold**')).toEqual([
			{ type: 'text', text: '<img src=x onerror=alert(1)> ' },
			{ type: 'strong', text: 'bold' }
		]);
		expect(parseInline('[evil](javascript:alert(1)) [docs](../CHANGELOG.md)')).toEqual([
			{ type: 'text', text: 'evil docs' }
		]);
		expect(parseInline('[site](https://example.com)')).toEqual([
			{ type: 'link', text: 'site', href: 'https://example.com' }
		]);
	});

	it('does not treat identifiers with underscores as emphasis', () => {
		expect(parseInline('CHUNKYARD_HTTP__SHOW_VERSION=false')).toEqual([
			{ type: 'text', text: 'CHUNKYARD_HTTP__SHOW_VERSION=false' }
		]);
	});
});
