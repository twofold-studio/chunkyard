import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerGrid from './server-grid.svelte';
import type { ServerView } from '#lib/api/index.js';

const server = (extra: Partial<ServerView>): ServerView => ({
	id: 'srv-1',
	name: 'Survival',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 1024,
	memoryMaxMb: 4096,
	cpus: 2,
	acceptEula: true,
	directory: '/data/servers/srv-1',
	status: { state: 'running', containerId: 'abc', exitCode: null, oomKilled: false },
	software: null,
	launch: null,
	...extra
});

const props = (servers: ServerView[]) => ({
	servers,
	createHref: '/servers/new'
});

describe('ServerGrid', () => {
	it('shows only the create tile when there are no servers', async () => {
		render(ServerGrid, props([]));
		const items = page.getByRole('listitem');
		await expect.element(items.first()).toHaveTextContent('Create server');
		expect(items.elements()).toHaveLength(1);
		await expect
			.element(page.getByRole('link', { name: /Create server/ }))
			.toHaveAttribute('href', '/servers/new');
	});

	it('keeps the create tile in the first slot and summarizes each server', async () => {
		render(
			ServerGrid,
			props([
				server({
					id: 'paper',
					name: 'Paper box',
					port: 25566,
					software: { type: 'paper', version: '1.21.1' },
					launch: {
						path: 'paper.jar',
						version: '1.21.4',
						build: '232',
						javaMajor: 21,
						checksum: 'ab'
					}
				}),
				server({
					id: 'vanilla',
					name: 'Fresh vanilla',
					port: 25567,
					cpus: 1,
					memoryMaxMb: 2048,
					status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
					software: { type: 'vanilla', version: '1.20.1' },
					launch: null,
					acceptEula: false
				}),
				server({ id: 'manual', name: 'Manual JAR', port: 25570 })
			])
		);
		const items = page.getByRole('listitem');
		expect(items.elements()).toHaveLength(4);
		await expect.element(items.first()).toHaveTextContent('Create server');
		await expect.element(items.nth(0).getByRole('link')).toHaveAttribute('href', '/servers/new');

		const paper = items.nth(1);
		await expect.element(paper.getByRole('link')).toHaveAttribute('href', '/servers/paper');
		await expect.element(paper).toHaveTextContent('Paper box');
		await expect.element(paper).toHaveTextContent('Container running');
		await expect.element(paper).toHaveTextContent('Paper');
		// Persisted launch version wins over the requested one.
		await expect.element(paper).toHaveTextContent('1.21.4');
		await expect.element(paper).not.toHaveTextContent('1.21.1');
		await expect.element(paper).toHaveTextContent('4 GiB');
		await expect.element(paper).toHaveTextContent('2 CPUs');
		await expect.element(paper).toHaveTextContent('Port 25566');

		const vanilla = items.nth(2);
		await expect.element(vanilla).toHaveTextContent('Stopped');
		await expect.element(vanilla).toHaveTextContent('Vanilla');
		await expect.element(vanilla).toHaveTextContent('1.20.1');
		await expect.element(vanilla).toHaveTextContent('Not installed');
		await expect.element(vanilla).toHaveTextContent('1 CPU');
		await expect.element(vanilla).toHaveTextContent('Port 25567');

		const manual = items.nth(3);
		await expect.element(manual).toHaveTextContent('Custom');
		await expect.element(manual).toHaveTextContent('Unknown version');
		await expect.element(manual).toHaveTextContent('Port 25570');
	});
});
