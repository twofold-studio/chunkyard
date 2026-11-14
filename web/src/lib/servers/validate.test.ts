import { describe, expect, it } from 'vitest';
import {
	defaultServerForm,
	toCreateRequest,
	validateResources,
	validateServerForm
} from './validate';

describe('validateServerForm', () => {
	it('accepts defaults once named and uses the documented Docker image', () => {
		const form = { ...defaultServerForm(), name: 'Survival' };
		expect(validateServerForm(form)).toEqual({});
		expect(toCreateRequest(form)).toMatchObject({
			runtime: 'docker',
			dockerImage: 'eclipse-temurin:21-jre',
			jar: 'server.jar',
			acceptEula: false
		});
	});

	it('mirrors backend limits', () => {
		const errors = validateServerForm({
			...defaultServerForm(),
			name: ' ',
			port: 0,
			memoryMinMb: 64,
			memoryMaxMb: 32,
			cpus: 0,
			dockerImage: '-bad image',
			jar: '../server.jar'
		});
		expect(Object.keys(errors).sort()).toEqual(
			['cpus', 'dockerImage', 'jar', 'memoryMinMb', 'memoryMaxMb', 'name', 'port'].sort()
		);
	});

	it('rejects max heap below min heap', () => {
		const errors = validateServerForm({
			...defaultServerForm(),
			name: 'a',
			memoryMinMb: 4096,
			memoryMaxMb: 2048
		});
		expect(errors.memoryMaxMb).toMatch(/at least the minimum/);
	});

	it('allows nested relative JAR paths but not absolute ones', () => {
		const base = { ...defaultServerForm(), name: 'a' };
		expect(validateServerForm({ ...base, jar: 'libs/paper.jar' }).jar).toBeUndefined();
		expect(validateServerForm({ ...base, jar: '/srv/server.jar' }).jar).toBeDefined();
		expect(validateServerForm({ ...base, jar: 'server.zip' }).jar).toBeDefined();
	});
});

describe('managed installs', () => {
	it('skips the JAR, allows an automatic image and sends software', () => {
		const form = { ...defaultServerForm(), name: 'Paper', dockerImage: '', jar: '' };
		expect(validateServerForm(form, { managed: true })).toEqual({});
		const body = toCreateRequest(form, { type: 'paper', version: '1.21.1' });
		expect(body).toMatchObject({ software: { type: 'paper', version: '1.21.1' } });
		expect(body).not.toHaveProperty('jar');
		expect(body).not.toHaveProperty('dockerImage');
	});

	it('still validates and sends an explicit image override', () => {
		const form = { ...defaultServerForm(), name: 'Paper', dockerImage: '-bad' };
		expect(validateServerForm(form, { managed: true }).dockerImage).toBeDefined();
		const ok = { ...form, dockerImage: 'eclipse-temurin:17-jre' };
		expect(toCreateRequest(ok, { type: 'vanilla', version: '1.20.1' }).dockerImage).toBe(
			'eclipse-temurin:17-jre'
		);
	});
});

describe('game port', () => {
	const base = { ...defaultServerForm(), name: 'Survival' };

	it('defaults to automatic and omits the port from the request', () => {
		expect(base.port).toBeNull();
		expect(validateServerForm(base)).toEqual({});
		expect(toCreateRequest(base)).not.toHaveProperty('port');
		expect(toCreateRequest(base, { type: 'vanilla', version: '1.21.1' })).not.toHaveProperty(
			'port'
		);
		// An emptied number input can bind as undefined.
		expect(toCreateRequest({ ...base, port: undefined })).not.toHaveProperty('port');
	});

	it('sends an explicit override unchanged', () => {
		const form = { ...base, port: 25570 };
		expect(validateServerForm(form)).toEqual({});
		expect(toCreateRequest(form).port).toBe(25570);
		expect(toCreateRequest({ ...base, port: 25565 }).port).toBe(25565);
	});

	it('rejects zero, out-of-range and fractional explicit ports', () => {
		for (const port of [0, -1, 65536, 25565.5]) {
			expect(validateServerForm({ ...base, port }).port).toBeDefined();
		}
	});
});

describe('validateResources', () => {
	it('accepts the creation limits at their bounds', () => {
		expect(validateResources({ memoryMinMb: 128, memoryMaxMb: 262144, cpus: 0.1 })).toEqual({});
		expect(validateResources({ memoryMinMb: 1024, memoryMaxMb: 1024, cpus: 256 })).toEqual({});
	});

	it('rejects out-of-range, inverted and non-finite values', () => {
		expect(validateResources({ memoryMinMb: 127, memoryMaxMb: 1024, cpus: 1 })).toHaveProperty(
			'memoryMinMb'
		);
		expect(validateResources({ memoryMinMb: 2048, memoryMaxMb: 1024, cpus: 1 })).toHaveProperty(
			'memoryMaxMb'
		);
		expect(validateResources({ memoryMinMb: 512, memoryMaxMb: 262145, cpus: 1 })).toHaveProperty(
			'memoryMaxMb'
		);
		expect(validateResources({ memoryMinMb: 512.5, memoryMaxMb: 1024, cpus: 1 })).toHaveProperty(
			'memoryMinMb'
		);
		for (const cpus of [0.09, 256.1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
			expect(validateResources({ memoryMinMb: 512, memoryMaxMb: 1024, cpus })).toHaveProperty(
				'cpus'
			);
		}
	});
});
