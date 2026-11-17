// Prove that regenerating after incompatible contracts makes real caller code fail tsc.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('../web/', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'chunkyard-negative-types-'));
try {
  const api = join(temporary, 'api');
  mkdirSync(api);
  for (const file of ['endpoints.ts', 'client.ts', 'types.ts']) copyFileSync(join(web, 'src/lib/api', file), join(api, file));
  const probe = join(temporary, 'caller.ts');
  writeFileSync(probe, "import { getServer, createServer } from './api/endpoints';\nasync function caller() { const server = await getServer('fixture'); const port: number = server.port; await createServer({ name: 'fixture' }); return port; }\nvoid caller;\n");
  const original = JSON.parse(readFileSync(new URL('../crates/api/src/openapi.json', import.meta.url), 'utf8'));
  for (const mutation of ['baseline', 'response', 'request']) {
    const schema = structuredClone(original);
    if (mutation === 'response') schema.components.schemas.Server.properties.port = { type: 'string' };
    if (mutation === 'request') schema.components.schemas.CreateServer.properties.name = { type: 'number' };
    const input = join(temporary, 'openapi.json');
    writeFileSync(input, JSON.stringify(schema));
    execFileSync('pnpm', ['exec', 'openapi-ts'], { cwd: web, env: { ...process.env, CHUNKYARD_OPENAPI_INPUT: input, CHUNKYARD_SDK_OUTPUT: join(api, 'generated') }, stdio: 'pipe' });
    const result = spawnSync('pnpm', ['exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2022,dom,dom.iterable', probe], { cwd: web, encoding: 'utf8' });
    if (mutation === 'baseline') assert.equal(result.status, 0, result.stdout + result.stderr);
    else {
      assert.notEqual(result.status, 0, mutation + ' unexpectedly compiled');
      assert.match(result.stdout, /caller\.ts.*TS2322/, result.stdout + result.stderr);
    }
    console.log(mutation + ': ' + (mutation === 'baseline' ? 'caller compiles' : 'incompatible regenerated bindings rejected'));
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
