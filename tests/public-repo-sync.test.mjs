import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const scriptSourcePath = path.join(repoRoot, 'scripts', 'public-repo-sync.mjs');

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

function runNode(commandArgs, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, commandArgs, { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function createPublicHarness() {
  const publicRoot = await makeTempDir('public-repo-');
  const sourceRoot = await makeTempDir('private-source-');
  await fs.mkdir(path.join(publicRoot, 'scripts'), { recursive: true });
  await fs.copyFile(scriptSourcePath, path.join(publicRoot, 'scripts', 'public-repo-sync.mjs'));

  const manifest = {
    version: 1,
    targetDir: publicRoot,
    includeRoots: ['src'],
    includeFiles: ['README.md'],
    includeDocFiles: [],
    targetOnlyFiles: ['public-repo.manifest.json', 'scripts/public-repo-sync.mjs'],
    ignoredRoots: ['node_modules', '.git'],
    ignoredPatterns: ['*.tmp'],
    ignoredPaths: [],
  };

  await writeJson(path.join(publicRoot, 'public-repo.manifest.json'), manifest);

  return { publicRoot, sourceRoot };
}

test('sync requires an explicit --source path', async () => {
  const { publicRoot } = await createPublicHarness();

  const result = await runNode(['scripts/public-repo-sync.mjs', 'sync'], publicRoot);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /--source/i);
});

test('sync rejects using the public repo itself as --source', async () => {
  const { publicRoot } = await createPublicHarness();

  const result = await runNode(
    ['scripts/public-repo-sync.mjs', 'sync', '--source', publicRoot],
    publicRoot,
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /same directory|public repo itself/i);
});

test('sync --dry-run reports copy and prune work without mutating target files', async () => {
  const { publicRoot, sourceRoot } = await createPublicHarness();
  const sourceReadme = path.join(sourceRoot, 'README.md');
  const publicReadme = path.join(publicRoot, 'README.md');
  const staleFile = path.join(publicRoot, 'obsolete.txt');

  await writeText(sourceReadme, 'source version');
  await writeText(publicReadme, 'public version');
  await writeText(staleFile, 'remove me');

  const result = await runNode(
    ['scripts/public-repo-sync.mjs', 'sync', '--source', sourceRoot, '--dry-run'],
    publicRoot,
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /dry-run/i);
  assert.match(result.stdout, /Copied files: 1/i);
  assert.match(result.stdout, /Removed stale files: 1/i);
  assert.equal(await fs.readFile(publicReadme, 'utf8'), 'public version');
  assert.equal(await fs.readFile(staleFile, 'utf8'), 'remove me');
});

test('check --source classifies source files against the manifest', async () => {
  const { publicRoot, sourceRoot } = await createPublicHarness();

  await writeText(path.join(sourceRoot, 'README.md'), 'allowed');
  await writeText(path.join(sourceRoot, 'notes.txt'), 'unclassified');

  const result = await runNode(
    ['scripts/public-repo-sync.mjs', 'check', '--source', sourceRoot],
    publicRoot,
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Allowed files: 1/i);
  assert.match(result.stdout, /Unclassified files: 1/i);
  assert.match(result.stdout, /Source:/i);
  assert.match(result.stdout, /Target:/i);
});
