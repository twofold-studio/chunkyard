import type { OpenApiDocument } from './openapi';

/** Small, self-contained OpenAPI 3.1 document used by the API docs tests. */
export const fixture: OpenApiDocument = {
	openapi: '3.1.0',
	info: { title: 'Chunkyard API', version: '0.1.0', description: 'Fixture document.' },
	tags: [
		{ name: 'auth', description: 'Sessions and setup.' },
		{ name: 'servers', description: 'Server lifecycle.' },
		{ name: 'unused' }
	],
	security: [{ cookieAuth: [] }],
	paths: {
		'/api/v1/auth/login': {
			post: {
				operationId: 'login',
				summary: 'Sign in',
				tags: ['auth'],
				security: [],
				requestBody: {
					required: true,
					content: {
						'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } }
					}
				},
				responses: {
					'401': { $ref: '#/components/responses/Problem' },
					'200': {
						description: 'Signed in.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } }
					}
				}
			}
		},
		'/api/v1/servers/{id}': {
			parameters: [
				{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
			],
			get: {
				operationId: 'getServer',
				summary: 'Get a server',
				tags: ['servers'],
				responses: {
					'200': {
						description: 'The server.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Server' } } }
					}
				}
			}
		},
		'/api/v1/servers/{id}/metrics': {
			get: {
				operationId: 'getServerMetrics',
				summary: 'Resource usage',
				description: 'CPU and memory samples for a running server.',
				tags: ['servers'],
				parameters: [
					{ $ref: '#/components/parameters/ServerId' },
					{ name: 'window', in: 'query', schema: { type: 'integer', minimum: 1 } }
				],
				responses: {
					'200': {
						description: 'Samples.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									required: ['items'],
									properties: {
										items: { type: 'array', items: { $ref: '#/components/schemas/Sample' } }
									}
								}
							}
						}
					}
				}
			}
		},
		'/healthz': {
			get: { summary: 'Liveness probe', security: [], responses: { '204': { description: 'OK' } } }
		}
	},
	components: {
		parameters: {
			ServerId: { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
		},
		responses: {
			Problem: {
				description: 'Problem details.',
				content: {
					'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } }
				}
			}
		},
		securitySchemes: {
			cookieAuth: { type: 'apiKey', in: 'cookie', name: 'mcm_session' }
		},
		schemas: {
			LoginRequest: {
				type: 'object',
				required: ['email', 'password'],
				properties: {
					email: { type: 'string', format: 'email' },
					password: { type: 'string', format: 'password', writeOnly: true }
				}
			},
			Me: {
				type: 'object',
				properties: { kind: { type: 'string', enum: ['session', 'auth_disabled'] } }
			},
			Server: {
				type: 'object',
				description: 'A managed Minecraft server.',
				required: ['id', 'name', 'status'],
				properties: {
					id: { type: 'string', format: 'uuid' },
					name: { type: 'string', example: 'survival' },
					status: { $ref: '#/components/schemas/Status' },
					memoryMb: { type: ['integer', 'null'], minimum: 512 },
					parent: { anyOf: [{ $ref: '#/components/schemas/Server' }, { type: 'null' }] }
				}
			},
			Status: { type: 'string', enum: ['stopped', 'running'] },
			Sample: {
				type: 'object',
				properties: {
					at: { type: 'string', format: 'date-time' },
					cpuPercent: { type: 'number' }
				}
			},
			Problem: {
				type: 'object',
				properties: { code: { type: 'string' }, detail: { type: 'string' } }
			}
		}
	}
};
