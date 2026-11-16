import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function lineCount(content) {
  return (content.match(/\n/g)?.length ?? 0) + (content && !content.endsWith('\n') ? 1 : 0);
}

export function checkArchitecture(packages, files, policy) {
  const errors = [];
  if (!Number.isInteger(policy.maxRustFileLines) || policy.maxRustFileLines < 1) {
    return ['policy: maxRustFileLines must be a positive integer'];
  }
  const names = new Set(packages.map(pkg => pkg.name));
  for (const pkg of packages) {
    const allowed = policy.allowedDependencies[pkg.name];
    if (!Array.isArray(allowed)) {
      errors.push(`${pkg.name}: add an explicit dependency policy`);
      continue;
    }
    for (const dependency of pkg.dependencies) {
      if (dependency.kind === 'dev') continue;
      const name = dependency.name;
      if (names.has(name) && !allowed.includes(name)) {
        errors.push(`${pkg.name}: disallowed production dependency on ${name}`);
      }
      if (policy.testOnlyPackages.includes(name)) {
        errors.push(`${pkg.name}: test-only package ${name} cannot be a production dependency`);
      }
      if (name === 'sqlx' && pkg.name !== 'chunkyard-db') {
        errors.push(`${pkg.name}: SQLx belongs in chunkyard-db`);
      }
      if (['axum', 'tower'].includes(name) && !['chunkyard-api', 'chunkyard-server'].includes(pkg.name)) {
        errors.push(`${pkg.name}: HTTP transport belongs in chunkyard-api/server`);
      }
    }
  }
  for (const name of Object.keys(policy.allowedDependencies)) {
    if (!names.has(name)) errors.push(`${name}: stale package policy`);
    for (const dependency of policy.allowedDependencies[name]) {
      if (!names.has(dependency)) errors.push(`${name}: unknown allowed package ${dependency}`);
    }
  }
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.rs')) continue;
    const lines = lineCount(content);
    const exception = policy.fileSizeExceptions[path];
    if (exception && (!exception.reason?.trim() || !Number.isInteger(exception.maxLines)
      || exception.maxLines <= policy.maxRustFileLines)) {
      errors.push(`${path}: size exception needs a reason and explicit larger budget`);
      continue;
    }
    if (exception && lines <= policy.maxRustFileLines) errors.push(`${path}: remove stale size exception`);
    if (lines > (exception?.maxLines ?? policy.maxRustFileLines)) {
      errors.push(`${path}: ${lines} lines exceeds ${exception?.maxLines ?? policy.maxRustFileLines}`);
    }
  }
  for (const path of Object.keys(policy.fileSizeExceptions)) {
    if (!(path in files)) errors.push(`${path}: size exception refers to a missing file`);
  }
  return errors;
}

async function rustFiles(directory, root, result = {}) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await rustFiles(path, root, result);
    else if (entry.isFile() && entry.name.endsWith('.rs')) {
      result[relative(root, path).split(sep).join('/')] = await readFile(path, 'utf8');
    }
  }
  return result;
}

export async function checkRepository(root) {
  const policy = JSON.parse(await readFile(resolve(root, 'scripts/architecture-policy.json'), 'utf8'));
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata', '--locked', '--no-deps', '--format-version', '1',
    '--manifest-path', resolve(root, 'Cargo.toml')
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
  const members = new Set(metadata.workspace_members);
  const packages = metadata.packages.filter(pkg => members.has(pkg.id));
  const files = await rustFiles(resolve(root, 'crates'), root);
  return { errors: checkArchitecture(packages, files, policy), packages: packages.length, files: Object.keys(files).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await checkRepository(root);
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Architecture checks passed: ${result.packages} packages, ${result.files} Rust files.`);
}
