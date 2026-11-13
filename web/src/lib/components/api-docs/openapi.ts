/**
 * Read-only helpers for rendering the backend's OpenAPI 3.1 document.
 *
 * The page never hardcodes endpoints: everything shown is derived from
 * `GET /api/v1/openapi.json`. Only the subset of OpenAPI needed for readable
 * docs is modelled; unknown keys are ignored.
 */
import { request, type RequestOptions } from '#lib/api/client.js';

export const OPENAPI_PATH = '/api/v1/openapi.json';

export const HTTP_METHODS = [
	'get',
	'put',
	'post',
	'delete',
	'options',
	'head',
	'patch',
	'trace'
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Reference {
	$ref: string;
	summary?: string;
	description?: string;
}

export interface Schema {
	$ref?: string;
	type?: string | string[];
	format?: string;
	title?: string;
	description?: string;
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	additionalProperties?: boolean | Schema;
	enum?: unknown[];
	const?: unknown;
	default?: unknown;
	example?: unknown;
	examples?: unknown[];
	nullable?: boolean;
	deprecated?: boolean;
	readOnly?: boolean;
	writeOnly?: boolean;
	oneOf?: Schema[];
	anyOf?: Schema[];
	allOf?: Schema[];
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
}

export interface MediaType {
	schema?: Schema;
	example?: unknown;
	examples?: Record<string, { summary?: string; value?: unknown } | Reference>;
}

export interface Parameter {
	name: string;
	in: 'query' | 'header' | 'path' | 'cookie';
	description?: string;
	required?: boolean;
	deprecated?: boolean;
	schema?: Schema;
	example?: unknown;
}

export interface RequestBody {
	description?: string;
	required?: boolean;
	content?: Record<string, MediaType>;
}

export interface ResponseObject {
	description?: string;
	content?: Record<string, MediaType>;
	headers?: Record<string, { description?: string; schema?: Schema } | Reference>;
}

export type SecurityRequirement = Record<string, string[]>;

export interface OperationObject {
	operationId?: string;
	summary?: string;
	description?: string;
	tags?: string[];
	deprecated?: boolean;
	parameters?: (Parameter | Reference)[];
	requestBody?: RequestBody | Reference;
	responses?: Record<string, ResponseObject | Reference>;
	security?: SecurityRequirement[];
}

export type PathItem = Partial<Record<HttpMethod, OperationObject>> & {
	summary?: string;
	description?: string;
	parameters?: (Parameter | Reference)[];
};

export interface SecurityScheme {
	type: string;
	description?: string;
	name?: string;
	in?: string;
	scheme?: string;
}

export interface OpenApiDocument {
	openapi: string;
	info: { title: string; version: string; description?: string; summary?: string };
	tags?: { name: string; description?: string }[];
	paths?: Record<string, PathItem>;
	components?: {
		schemas?: Record<string, Schema>;
		parameters?: Record<string, Parameter>;
		requestBodies?: Record<string, RequestBody>;
		responses?: Record<string, ResponseObject>;
		securitySchemes?: Record<string, SecurityScheme>;
	};
	security?: SecurityRequirement[];
}

export interface Operation {
	/** Stable, DOM-safe identifier used for anchors and expansion state. */
	id: string;
	method: HttpMethod;
	path: string;
	operationId?: string;
	summary?: string;
	description?: string;
	tag: string;
	deprecated: boolean;
	parameters: Parameter[];
	requestBody?: RequestBody;
	responses: { status: string; response: ResponseObject }[];
	/** Security scheme names; empty when the operation is public. */
	security: string[];
}

export interface OperationGroup {
	tag: string;
	/** DOM-safe anchor id. */
	id: string;
	description?: string;
	operations: Operation[];
}

export const UNTAGGED = 'Other';

/** Fetches the document through the shared same-origin client (cookies, problem+json errors). */
export function fetchOpenApi(options: Pick<RequestOptions, 'signal' | 'fetch'> = {}) {
	return request<OpenApiDocument>(OPENAPI_PATH, options);
}

/** Rejects payloads that are clearly not an OpenAPI 3.x document. */
export function isOpenApiDocument(value: unknown): value is OpenApiDocument {
	if (typeof value !== 'object' || value === null) return false;
	const doc = value as Partial<OpenApiDocument>;
	return (
		typeof doc.openapi === 'string' &&
		doc.openapi.startsWith('3.') &&
		typeof doc.info === 'object' &&
		doc.info !== null &&
		typeof doc.info.title === 'string'
	);
}

export function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'x'
	);
}

export function isReference(value: unknown): value is Reference {
	return (
		typeof value === 'object' && value !== null && typeof (value as Reference).$ref === 'string'
	);
}

/** Name of a local component reference, e.g. `#/components/schemas/Server` → `Server`. */
export function refName(ref: string): string {
	return decodePointer(ref.split('/').pop() ?? ref);
}

function decodePointer(token: string): string {
	return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolves a local `#/...` JSON pointer. External references resolve to undefined. */
export function resolvePointer(doc: OpenApiDocument, ref: string): unknown {
	if (!ref.startsWith('#/')) return undefined;
	let node: unknown = doc;
	for (const raw of ref.slice(2).split('/')) {
		if (typeof node !== 'object' || node === null) return undefined;
		node = (node as Record<string, unknown>)[decodePointer(raw)];
	}
	return node;
}

/** Follows reference chains (bounded) and returns the target object, if any. */
export function deref<T>(doc: OpenApiDocument, value: T | Reference | undefined): T | undefined {
	let current: unknown = value;
	for (let hops = 0; hops < 16 && isReference(current); hops++) {
		current = resolvePointer(doc, current.$ref);
	}
	return isReference(current) ? undefined : (current as T | undefined);
}

function securityNames(requirements: SecurityRequirement[] | undefined): string[] {
	if (!requirements) return [];
	const names = new Set<string>();
	for (const requirement of requirements)
		for (const name of Object.keys(requirement)) names.add(name);
	return [...names];
}

/** Flattens `paths` into operations grouped by their first tag, in the document's tag order. */
export function groupOperations(doc: OpenApiDocument): OperationGroup[] {
	const groups = new Map<string, OperationGroup>();
	const usedIds = new Set<string>();
	for (const tag of doc.tags ?? []) {
		groups.set(tag.name, {
			tag: tag.name,
			id: `tag-${slug(tag.name)}`,
			description: tag.description,
			operations: []
		});
	}

	for (const [path, rawItem] of Object.entries(doc.paths ?? {})) {
		const item = deref<PathItem>(doc, rawItem as PathItem | Reference);
		if (!item) continue;
		const shared = (item.parameters ?? [])
			.map((p) => deref<Parameter>(doc, p))
			.filter((p): p is Parameter => !!p);

		for (const method of HTTP_METHODS) {
			const op = item[method];
			if (!op) continue;
			const tag = op.tags?.[0] ?? UNTAGGED;
			let group = groups.get(tag);
			if (!group) {
				group = { tag, id: `tag-${slug(tag)}`, operations: [] };
				groups.set(tag, group);
			}

			// Operation-level parameters override path-level ones with the same name+location.
			const own = (op.parameters ?? [])
				.map((p) => deref<Parameter>(doc, p))
				.filter((p): p is Parameter => !!p);
			const parameters = [
				...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)),
				...own
			];

			const responses = Object.entries(op.responses ?? {})
				.map(([status, r]) => ({ status, response: deref<ResponseObject>(doc, r) ?? {} }))
				.sort((a, b) => statusRank(a.status) - statusRank(b.status));

			let id = `op-${slug(op.operationId ?? `${method}-${path}`)}`;
			while (usedIds.has(id)) id += '-x';
			usedIds.add(id);

			group.operations.push({
				id,
				method,
				path,
				operationId: op.operationId,
				summary: op.summary ?? item.summary,
				description: op.description ?? item.description,
				tag,
				deprecated: op.deprecated === true,
				parameters,
				requestBody: deref<RequestBody>(doc, op.requestBody),
				responses,
				security: securityNames(op.security ?? doc.security)
			});
		}
	}

	return [...groups.values()].filter((g) => g.operations.length > 0);
}

function statusRank(status: string): number {
	if (status === 'default') return 1000;
	const n = Number.parseInt(status.replace(/x/gi, '0'), 10);
	return Number.isNaN(n) ? 999 : n;
}

/** Case-insensitive filter over method, path, summary, operationId, tag and description. */
export function filterGroups(groups: OperationGroup[], query: string): OperationGroup[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return groups;
	return groups
		.map((group) => ({
			...group,
			operations: group.operations.filter((op) => {
				const haystack = [op.method, op.path, op.summary, op.operationId, op.tag, op.description]
					.filter(Boolean)
					.join(' ')
					.toLowerCase();
				return terms.every((term) => haystack.includes(term));
			})
		}))
		.filter((group) => group.operations.length > 0);
}

export function countOperations(groups: OperationGroup[]): number {
	return groups.reduce((total, group) => total + group.operations.length, 0);
}

function typesOf(schema: Schema): string[] {
	const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
	return schema.nullable && !types.includes('null') ? [...types, 'null'] : types;
}

/** Short human-readable type, e.g. `string<uuid>`, `Server[]`, `string | null`. */
export function typeLabel(schema: Schema | undefined): string {
	if (!schema) return 'any';
	if (schema.$ref) return refName(schema.$ref);
	if (schema.const !== undefined) return JSON.stringify(schema.const);
	const variants = schema.oneOf ?? schema.anyOf;
	if (variants?.length) return variants.map(typeLabel).join(' | ');
	if (schema.allOf?.length === 1) return typeLabel(schema.allOf[0]);
	if (schema.allOf?.length) return schema.allOf.map(typeLabel).join(' & ');

	const types = typesOf(schema);
	if (types.length === 0) {
		if (schema.properties) return 'object';
		if (schema.enum) return 'enum';
		return 'any';
	}
	return types
		.map((type) => {
			if (type === 'array') return `${typeLabel(schema.items)}[]`;
			if (type === 'object' && !schema.properties && isSchema(schema.additionalProperties)) {
				return `map<string, ${typeLabel(schema.additionalProperties)}>`;
			}
			if (schema.format && type !== 'null') return `${type}<${schema.format}>`;
			return type;
		})
		.join(' | ');
}

function isSchema(value: unknown): value is Schema {
	return typeof value === 'object' && value !== null;
}

/** Property schemas after merging `allOf` members (refs resolved). */
export function objectShape(
	doc: OpenApiDocument,
	schema: Schema
): { properties: Record<string, Schema>; required: Set<string> } {
	const properties: Record<string, Schema> = {};
	const required = new Set<string>();
	const visit = (node: Schema | undefined, depth: number) => {
		if (!node || depth > 8) return;
		const target = node.$ref ? deref<Schema>(doc, node) : node;
		if (!target) return;
		Object.assign(properties, target.properties ?? {});
		for (const name of target.required ?? []) required.add(name);
		for (const part of target.allOf ?? []) visit(part, depth + 1);
	};
	visit(schema, 0);
	return { properties, required };
}

/**
 * Builds a representative example from a schema. Prefers explicit
 * `example`/`examples`/`default`/`enum`; falls back to type-based placeholders.
 * Cycles and very deep schemas are cut off.
 */
export function exampleFor(doc: OpenApiDocument, schema: Schema | undefined): unknown {
	return build(schema, new Set(), 0);

	function build(node: Schema | undefined, seen: Set<string>, depth: number): unknown {
		if (!node || depth > 6) return undefined;
		if (node.$ref) {
			if (seen.has(node.$ref)) return {};
			const target = deref<Schema>(doc, node);
			return build(target, new Set([...seen, node.$ref]), depth + 1);
		}
		if (node.example !== undefined) return node.example;
		if (node.examples?.length) return node.examples[0];
		if (node.const !== undefined) return node.const;
		if (node.default !== undefined) return node.default;
		if (node.enum?.length) return node.enum[0];
		const variant = node.oneOf?.[0] ?? node.anyOf?.find((s) => !typesOf(s).includes('null'));
		if (variant) return build(variant, seen, depth + 1);

		const types = typesOf(node).filter((t) => t !== 'null');
		const type = types[0] ?? (node.properties || node.allOf ? 'object' : undefined);
		switch (type) {
			case 'object': {
				const { properties } = objectShape(doc, node);
				const out: Record<string, unknown> = {};
				for (const [name, prop] of Object.entries(properties)) {
					if (prop.writeOnly) continue;
					out[name] = build(prop, seen, depth + 1);
				}
				if (Object.keys(out).length === 0 && isSchema(node.additionalProperties)) {
					out.key = build(node.additionalProperties, seen, depth + 1);
				}
				return out;
			}
			case 'array': {
				const item = build(node.items, seen, depth + 1);
				return item === undefined ? [] : [item];
			}
			case 'string':
				return stringExample(node.format);
			case 'integer':
				return node.minimum ?? 0;
			case 'number':
				return node.minimum ?? 0;
			case 'boolean':
				return true;
			default:
				return types.length === 0 && typesOf(node).includes('null') ? null : undefined;
		}
	}
}

function stringExample(format: string | undefined): string {
	switch (format) {
		case 'date-time':
			return '2026-01-01T00:00:00Z';
		case 'date':
			return '2026-01-01';
		case 'uuid':
			return '00000000-0000-0000-0000-000000000000';
		case 'email':
			return 'owner@example.com';
		case 'uri':
		case 'url':
			return 'https://example.com';
		case 'password':
			return '********';
		default:
			return 'string';
	}
}

/** Example for a media type: explicit example(s) first, then one generated from its schema. */
export function mediaExample(doc: OpenApiDocument, media: MediaType): unknown {
	if (media.example !== undefined) return media.example;
	const first = Object.values(media.examples ?? {})[0];
	if (first) {
		const resolved = deref<{ value?: unknown }>(doc, first);
		if (resolved?.value !== undefined) return resolved.value;
	}
	return exampleFor(doc, media.schema);
}

/** Validation keywords worth showing next to a field, e.g. `min 1`. */
export function schemaConstraints(s: Schema): string[] {
	const out: string[] = [];
	if (s.minimum !== undefined) out.push(`min ${s.minimum}`);
	if (s.maximum !== undefined) out.push(`max ${s.maximum}`);
	if (s.minLength !== undefined) out.push(`min length ${s.minLength}`);
	if (s.maxLength !== undefined) out.push(`max length ${s.maxLength}`);
	if (s.pattern) out.push(`pattern ${s.pattern}`);
	return out;
}

export function formatJson(value: unknown): string {
	return value === undefined ? '' : JSON.stringify(value, null, 2);
}

/** Splits a templated path into literal and `{param}` segments for highlighting. */
export function pathSegments(path: string): { text: string; param: boolean }[] {
	return path
		.split(/(\{[^}]+\})/)
		.filter(Boolean)
		.map((text) => ({ text, param: text.startsWith('{') && text.endsWith('}') }));
}
