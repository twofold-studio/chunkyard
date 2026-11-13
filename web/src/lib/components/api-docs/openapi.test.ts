import { describe, expect, it } from 'vitest';
import { fixture } from './openapi.fixture';
import {
	exampleFor,
	filterGroups,
	groupOperations,
	isOpenApiDocument,
	mediaExample,
	pathSegments,
	typeLabel,
	UNTAGGED
} from './openapi';

describe('groupOperations', () => {
	const groups = groupOperations(fixture);

	it('groups by first tag in document order, drops empty tags and collects untagged last', () => {
		expect(groups.map((g) => g.tag)).toEqual(['auth', 'servers', UNTAGGED]);
		expect(groups[1].operations.map((op) => op.path)).toEqual([
			'/api/v1/servers/{id}',
			'/api/v1/servers/{id}/metrics'
		]);
	});

	it('merges path-level parameters and resolves parameter references', () => {
		const [getServer, metrics] = groups[1].operations;
		expect(getServer.parameters.map((p) => p.name)).toEqual(['id']);
		expect(metrics.parameters.map((p) => `${p.in}:${p.name}`)).toEqual(['path:id', 'query:window']);
	});

	it('applies global security unless an operation overrides it', () => {
		expect(groups[0].operations[0].security).toEqual([]);
		expect(groups[1].operations[0].security).toEqual(['cookieAuth']);
	});

	it('resolves response references and sorts responses by status', () => {
		const login = groups[0].operations[0];
		expect(login.responses.map((r) => r.status)).toEqual(['200', '401']);
		expect(login.responses[1].response.description).toBe('Problem details.');
	});

	it('creates unique DOM-safe ids', () => {
		const ids = groups.flatMap((g) => g.operations.map((op) => op.id));
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain('op-getservermetrics');
		expect(ids).toContain('op-get-healthz');
	});
});

describe('filterGroups', () => {
	const groups = groupOperations(fixture);

	it('matches every term across method, path and summary', () => {
		const result = filterGroups(groups, 'get metrics');
		expect(result.flatMap((g) => g.operations.map((op) => op.operationId))).toEqual([
			'getServerMetrics'
		]);
	});

	it('returns all groups for a blank query and none for a miss', () => {
		expect(filterGroups(groups, '  ')).toBe(groups);
		expect(filterGroups(groups, 'nothing-like-this')).toEqual([]);
	});
});

describe('schemas', () => {
	const schemas = fixture.components!.schemas!;

	it('labels types readably', () => {
		expect(typeLabel(schemas.Server.properties!.id)).toBe('string<uuid>');
		expect(typeLabel(schemas.Server.properties!.memoryMb)).toBe('integer | null');
		expect(typeLabel({ type: 'array', items: { $ref: '#/components/schemas/Sample' } })).toBe(
			'Sample[]'
		);
		expect(typeLabel(schemas.Server.properties!.parent)).toBe('Server | null');
	});

	it('builds examples from refs, enums and formats without looping on cycles', () => {
		expect(exampleFor(fixture, { $ref: '#/components/schemas/Server' })).toEqual({
			id: '00000000-0000-0000-0000-000000000000',
			name: 'survival',
			status: 'stopped',
			memoryMb: 512,
			parent: {}
		});
	});

	it('omits write-only fields from examples', () => {
		const media = { schema: { $ref: '#/components/schemas/LoginRequest' } };
		expect(mediaExample(fixture, media)).toEqual({ email: 'owner@example.com' });
	});
});

describe('helpers', () => {
	it('recognises OpenAPI 3 documents only', () => {
		expect(isOpenApiDocument(fixture)).toBe(true);
		expect(isOpenApiDocument({ swagger: '2.0', info: { title: 'x' } })).toBe(false);
		expect(isOpenApiDocument(null)).toBe(false);
	});

	it('splits templated paths', () => {
		expect(pathSegments('/a/{id}/b')).toEqual([
			{ text: '/a/', param: false },
			{ text: '{id}', param: true },
			{ text: '/b', param: false }
		]);
	});
});
