import type { UpdateNetworkRequest } from '#lib/api/index.js';

export interface NetworkFormValues {
	port: number | null | undefined;
	/** Blank restores the manager default bind address. */
	publishIp: string;
}

export type NetworkFormErrors = Partial<Record<keyof NetworkFormValues, string>>;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Accepts IPv4 dotted quads and IPv6 literals (optionally bracketed). Backend is authoritative. */
export function isIpAddress(value: string): boolean {
	if (IPV4.test(value)) return true;
	const v6 = value.replace(/^\[(.*)\]$/, '$1');
	if (!v6.includes(':') || !/^[0-9A-Fa-f:.]+$/.test(v6)) return false;
	try {
		// The URL parser validates IPv6 literals without a network request.
		new URL(`http://[${v6}]/`);
		return true;
	} catch {
		return false;
	}
}

export function validateNetworkForm(values: NetworkFormValues): NetworkFormErrors {
	const errors: NetworkFormErrors = {};
	const { port } = values;
	if (port == null || !Number.isInteger(port) || port < 1 || port > 65535) {
		errors.port = 'Enter a port between 1 and 65535.';
	}
	const ip = values.publishIp.trim();
	if (ip && !isIpAddress(ip)) {
		errors.publishIp = 'Enter an IPv4 or IPv6 address, e.g. 0.0.0.0, or leave it blank.';
	}
	return errors;
}

export function toNetworkRequest(values: NetworkFormValues): UpdateNetworkRequest {
	const ip = values.publishIp.trim().replace(/^\[(.*)\]$/, '$1');
	return { port: values.port ?? 0, publishIp: ip ? ip : null };
}

/** `host:port`, bracketing IPv6 literals. */
export function formatEndpoint(ip: string, port: number): string {
	return ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`;
}

export const BIND_PRESETS = [
	{ value: '0.0.0.0', label: 'All IPv4 interfaces', hint: 'LAN, VPN (e.g. NetBird) and public' },
	{ value: '127.0.0.1', label: 'This host only', hint: 'Loopback; use with a reverse proxy' }
] as const;
