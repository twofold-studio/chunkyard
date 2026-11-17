// Offline Rust contract export. No state, listener, database or network is initialized.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = new URL('../crates/api/src/openapi.json', import.meta.url);
const generated = execFileSync('cargo', ['run', '--offline', '--locked', '--quiet', '-p', 'chunkyard-api', '--example', 'export-openapi'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== generated) throw new Error('OpenAPI drift: run pnpm --dir web api:generate');
} else writeFileSync(destination, generated);
console.log('Rust OpenAPI contract is current.');
