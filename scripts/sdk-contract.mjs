// Compare a fresh SDK in a throwaway directory, including added/removed files.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('../web/', import.meta.url));
function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
}
const temporary = mkdtempSync(join(tmpdir(), 'chunkyard-sdk-'));
try {
  execFileSync('pnpm', ['exec', 'openapi-ts'], { cwd: web, env: { ...process.env, CHUNKYARD_SDK_OUTPUT: temporary }, stdio: 'inherit' });
  const committed = join(web, 'src/lib/api/generated');
  const expected = files(committed), actual = files(temporary);
  if (JSON.stringify(expected) !== JSON.stringify(actual) || expected.some(path => !readFileSync(join(committed, path)).equals(readFileSync(join(temporary, path))))) {
    throw new Error('SDK drift: run pnpm --dir web api:generate');
  }
  console.log('Generated SDK is current.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
