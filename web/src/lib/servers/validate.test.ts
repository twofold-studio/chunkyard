import { describe, expect, it } from 'vitest';
import { defaultServerForm, toCreateRequest, validateServerForm } from './validate';

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
