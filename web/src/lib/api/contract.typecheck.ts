// Compile-only regression cases. Never imported or executed by the application.
import { createServer, getServer, sendCommand, updateServerResources } from './endpoints';

async function contractChecks() {
	const server = await getServer('fixture');
	const port: number = server.port;
	// @ts-expect-error Backend responses cannot be asserted to have arbitrary fields.
	void server.fieldRemovedFromBackend;
	// @ts-expect-error Concrete numeric response fields cannot become strings unnoticed.
	const invalidPort: string = server.port;
	// @ts-expect-error Requests require the backend's name field.
	createServer({ port: 25565 });
	// @ts-expect-error Resource limits are numbers.
	updateServerResources('fixture', { cpus: '2', memoryMinMb: 512, memoryMaxMb: 1024 });
	// @ts-expect-error Commands accept strings.
	sendCommand('fixture', 42);
	return [port, invalidPort];
}
void contractChecks;
