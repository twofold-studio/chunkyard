// Update project metadata only. Dependency ranges must never follow a release bump.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = ['Cargo.toml', 'web/package.json', 'crates/mcm-api/src/openapi.json', 'docs/http-api.md'];

export function updateMetadata(contents, version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Expected a numeric semantic version, e.g. 0.9.1');
  const next = { ...contents };
  const cargo = /(\[workspace\.package\][\s\S]*?)(?=\n\[|$)/;
  const section = contents['Cargo.toml'].match(cargo)?.[0];
  if (!section || !/^version = "[^"]+"$/m.test(section)) throw new Error('Missing workspace package version');
  next['Cargo.toml'] = contents['Cargo.toml'].replace(cargo, section.replace(/^version = "[^"]+"$/m, `version = "${version}"`));
  const pkg = JSON.parse(contents['web/package.json']);
  if (typeof pkg.version !== 'string') throw new Error('Missing frontend project version');
  pkg.version = version;
  next['web/package.json'] = JSON.stringify(pkg, null, '\t') + '\n';
  const schema = JSON.parse(contents['crates/mcm-api/src/openapi.json']);
  if (typeof schema.info?.version !== 'string') throw new Error('Missing OpenAPI version');
  schema.info.version = version;
  next['crates/mcm-api/src/openapi.json'] = JSON.stringify(schema, null, 2) + '\n';
  const example = /(^`GET \/api\/v1\/system\/version`[^\n]*?version:")[^"]+("[^\n]*)/m;
  if (!example.test(contents['docs/http-api.md'])) throw new Error('Missing version response example');
  next['docs/http-api.md'] = contents['docs/http-api.md'].replace(example, (_, before, after) => before + version + after);
  return next;
}

export async function bumpVersion(root, version, check = false) {
  const contents = Object.fromEntries(await Promise.all(files.map(async path => [path, await readFile(resolve(root, path), 'utf8')])));
  const updated = updateMetadata(contents, version);
  if (check) {
    for (const path of files) if (contents[path] !== updated[path]) throw new Error(`Version metadata differs: ${path}`);
  } else {
    for (const path of files) await writeFile(resolve(root, path), updated[path]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , version, flag] = process.argv;
  if (flag && flag !== '--check') throw new Error('Usage: node scripts/bump-version.mjs VERSION [--check]');
  await bumpVersion(resolve(dirname(fileURLToPath(import.meta.url)), '..'), version, flag === '--check');
}
