import { defineConfig } from '@hey-api/openapi-ts';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	input: process.env.CHUNKYARD_OPENAPI_INPUT ?? '../crates/api/src/openapi.json',
	output: {
		path: process.env.CHUNKYARD_SDK_OUTPUT ?? 'src/lib/api/generated',
		postProcess: [
			{
				name: 'Prettier',
				command: 'prettier',
				args: [
					'--config',
					fileURLToPath(new URL('./prettier.config.js', import.meta.url)),
					'--write',
					'{{path}}'
				]
			}
		]
	},
	plugins: [
		'@hey-api/typescript',
		'@hey-api/client-fetch',
		{ name: '@hey-api/sdk', responseStyle: 'data' }
	]
});
