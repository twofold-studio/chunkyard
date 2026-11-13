import { describe, expect, it } from 'vitest';
import { formatEndpoint, isIpAddress, toNetworkRequest, validateNetworkForm } from './network';

describe('network form', () => {
	it('accepts IPv4 and IPv6 bind addresses', () => {
		for (const ip of ['0.0.0.0', '127.0.0.1', '100.64.12.3', '::', '::1', 'fd00::1', '[::1]']) {
			expect(isIpAddress(ip)).toBe(true);
		}
		for (const ip of ['256.0.0.1', '1.2.3', 'localhost', 'example.com', '1.2.3.4:25565', ':::']) {
			expect(isIpAddress(ip)).toBe(false);
		}
	});

	it('validates the port and optional address', () => {
		expect(validateNetworkForm({ port: 25565, publishIp: '' })).toEqual({});
		expect(validateNetworkForm({ port: 0, publishIp: 'nope' })).toEqual({
			port: expect.any(String),
			publishIp: expect.any(String)
		});
		expect(validateNetworkForm({ port: null, publishIp: '' }).port).toBeDefined();
	});

	it('sends null for a blank address to restore the manager default', () => {
		expect(toNetworkRequest({ port: 25566, publishIp: '  ' })).toEqual({
			port: 25566,
			publishIp: null
		});
		expect(toNetworkRequest({ port: 25566, publishIp: '[fd00::1]' })).toEqual({
			port: 25566,
			publishIp: 'fd00::1'
		});
	});

	it('brackets IPv6 endpoints', () => {
		expect(formatEndpoint('0.0.0.0', 25565)).toBe('0.0.0.0:25565');
		expect(formatEndpoint('::', 25565)).toBe('[::]:25565');
	});
});
