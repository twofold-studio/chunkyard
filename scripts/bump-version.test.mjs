import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateMetadata } from './bump-version.mjs';

const fixtures = () => ({
  'Cargo.toml': '[workspace.package]\nversion = "0.9.0"\nedition = "2024"\n\n[workspace.dependencies]\nexample = "0.9.0"\n',
  'web/package.json': JSON.stringify({ name: 'chunkyard', version: '0.9.0', devDependencies: { plugin: '^0.9.0' } }),
  'crates/mcm-api/src/openapi.json': JSON.stringify({ info: { version: '0.9.0' }, components: { example: '0.9.0' } }),
  'docs/http-api.md': '`GET /api/v1/system/version` returns `{enabled:true, version:"0.9.0"}`.\nOther example 0.9.0.\n'
});

test('a release updates project versions while preserving matching dependency ranges and examples', () => {
  const result = updateMetadata(fixtures(), '0.9.1');
  const pkg = JSON.parse(result['web/package.json']);
  assert.equal(pkg.version, '0.9.1');
  assert.equal(pkg.devDependencies.plugin, '^0.9.0');
  assert.match(result['Cargo.toml'], /version = "0.9.1"/);
  assert.match(result['Cargo.toml'], /example = "0.9.0"/);
  const schema = JSON.parse(result['crates/mcm-api/src/openapi.json']);
  assert.equal(schema.info.version, '0.9.1');
  assert.equal(schema.components.example, '0.9.0');
  assert.match(result['docs/http-api.md'], /version:"0.9.1"/);
  assert.match(result['docs/http-api.md'], /Other example 0.9.0/);
});

test('invalid versions and missing metadata fail before any writes', () => {
  for (const version of ['0.9', '01.9.1', 'latest', '']) assert.throws(() => updateMetadata(fixtures(), version));
  const input = fixtures(); input['Cargo.toml'] = '[workspace.dependencies]\nexample = "0.9.0"\n';
  assert.throws(() => updateMetadata(input, '0.9.1'), /Missing workspace/);
});
