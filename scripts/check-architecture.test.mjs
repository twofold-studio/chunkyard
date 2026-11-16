import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkArchitecture, lineCount } from './check-architecture.mjs';

const policy = {
  maxRustFileLines: 4,
  allowedDependencies: { domain: [], app: ['domain'], tests: [] },
  testOnlyPackages: ['tests'],
  fileSizeExceptions: {}
};
const packages = [
  { name: 'domain', dependencies: [] },
  { name: 'app', dependencies: [{ name: 'domain', kind: null }] },
  { name: 'tests', dependencies: [{ name: 'app', kind: 'dev' }, { name: 'sqlx', kind: 'dev' }] }
];

test('allows declared runtime edges and isolated integration-test dependencies', () => {
  assert.deepEqual(checkArchitecture(packages, { 'lib.rs': 'line\n' }, policy), []);
});
test('rejects reversed edges, test-only runtime edges and storage/transport leakage', () => {
  const changed = structuredClone(packages);
  changed[0].dependencies = ['app', 'tests', 'sqlx', 'axum'].map(name => ({ name, kind: null }));
  const errors = checkArchitecture(changed, {}, policy);
  assert(errors.some(error => error.includes('disallowed production dependency on app')));
  assert(errors.some(error => error.includes('test-only package tests')));
  assert(errors.some(error => error.includes('SQLx belongs')));
  assert(errors.some(error => error.includes('HTTP transport belongs')));
});
test('requires policies for new packages and rejects stale policy entries', () => {
  assert(checkArchitecture([...packages, { name: 'new', dependencies: [] }], {}, policy)
    .some(error => error.includes('explicit dependency policy')));
  assert(checkArchitecture(packages.slice(1), {}, policy).some(error => error.includes('stale package policy')));
});
test('counts physical lines including CRLF and missing final newline; exempts schemas', () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('a\r\nb\r\n'), 2);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(checkArchitecture(packages, { 'schema.json': '\n'.repeat(100) }, policy).length, 0);
  assert(checkArchitecture(packages, { 'big.rs': '\n'.repeat(5) }, policy).some(error => error.includes('exceeds 4')));
});
test('size exceptions are justified, bounded, and removed when stale', () => {
  const bounded = { ...policy, fileSizeExceptions: { 'big.rs': { maxLines: 6, reason: 'Reviewed fixture' } } };
  assert.deepEqual(checkArchitecture(packages, { 'big.rs': '\n'.repeat(6) }, bounded), []);
  assert(checkArchitecture(packages, { 'big.rs': '\n'.repeat(7) }, bounded).some(error => error.includes('exceeds 6')));
  assert(checkArchitecture(packages, { 'big.rs': '\n' }, bounded).some(error => error.includes('stale size exception')));
  assert(checkArchitecture(packages, {}, bounded).some(error => error.includes('missing file')));
  const invalid = { ...policy, fileSizeExceptions: { 'big.rs': { maxLines: 20, reason: '' } } };
  assert(checkArchitecture(packages, { 'big.rs': '\n'.repeat(5) }, invalid).some(error => error.includes('needs a reason')));
});
test('a missing or invalid budget cannot silently disable the size check', () => {
  for (const maxRustFileLines of [undefined, 0, -1, '400', Number.NaN]) {
    assert(checkArchitecture(packages, {}, { ...policy, maxRustFileLines })
      .some(error => error.includes('positive integer')));
  }
});
