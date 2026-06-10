import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, 'public-repo.manifest.json');

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function normalizeAbsDir(dirPath) {
  return path.resolve(dirPath).replace(/[\\/]+$/, '').toLowerCase();
}

function isSameDirectory(left, right) {
  return normalizeAbsDir(left) === normalizeAbsDir(right);
}

function escapeRegexChar(char) {
  return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(globPattern) {
  let regex = '^';
  for (let i = 0; i < globPattern.length; i += 1) {
    const char = globPattern[i];
    if (char === '*') {
      if (globPattern[i + 1] === '*') {
        regex += '.*';
        i += 1;
      } else {
        regex += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      regex += '[^/]';
      continue;
    }
    regex += escapeRegexChar(char);
  }
  regex += '$';
  return new RegExp(regex);
}

function buildMatcher(patterns = []) {
  const compiled = patterns.map((pattern) => globToRegExp(pattern.toLowerCase()));
  return (relPath) => compiled.some((regex) => regex.test(relPath.toLowerCase()));
}

function isUnderRoot(relPath, rootName) {
  return relPath === rootName || relPath.startsWith(`${rootName}/`);
}

async function loadManifest() {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('public-repo.manifest.json did not contain an object.');
  }
  return manifest;
}

async function walkFiles(rootDir, manifest) {
  const ignoredRootNames = new Set(manifest.ignoredRoots ?? []);
  const files = [];

  async function visit(currentAbs, currentRel = '') {
    const entries = await fs.readdir(currentAbs, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relPath = currentRel ? path.posix.join(currentRel, entry.name) : entry.name;
      const absPath = path.join(currentAbs, entry.name);

      if (entry.isDirectory()) {
        if (ignoredRootNames.has(entry.name)) {
          continue;
        }
        if (currentRel === '' && ignoredRootNames.has(relPath)) {
          continue;
        }
        if (relPath === '.git' || relPath.startsWith('.git/')) {
          continue;
        }
        await visit(absPath, relPath);
        continue;
      }

      if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(toPosix(relPath));
      }
    }
  }

  await visit(rootDir);
  return files;
}

function buildAllowlist(manifest) {
  const includeRootSet = new Set((manifest.includeRoots ?? []).map((value) => value.toLowerCase()));
  const includeFileSet = new Set(
    [...(manifest.includeFiles ?? []), ...(manifest.includeDocFiles ?? [])].map((value) =>
      value.toLowerCase(),
    ),
  );
  const ignoredRootNames = new Set((manifest.ignoredRoots ?? []).map((value) => value.toLowerCase()));
  const ignoredPatternMatcher = buildMatcher(manifest.ignoredPatterns ?? []);
  const ignoredPathMatcher = buildMatcher(manifest.ignoredPaths ?? []);

  function isExplicitlyIncluded(relPath) {
    const lowered = relPath.toLowerCase();
    if (includeFileSet.has(lowered)) {
      return true;
    }
    for (const root of includeRootSet) {
      if (isUnderRoot(lowered, root)) {
        return true;
      }
    }
    return false;
  }

  function isIgnored(relPath) {
    const lowered = relPath.toLowerCase();
    if (ignoredPathMatcher(lowered)) {
      return true;
    }
    if (ignoredPatternMatcher(lowered)) {
      return true;
    }
    for (const root of ignoredRootNames) {
      if (isUnderRoot(lowered, root)) {
        return true;
      }
    }
    return false;
  }

  function isAllowed(relPath) {
    return isExplicitlyIncluded(relPath) || (includeRootSet.size > 0 && !isIgnored(relPath) && [...includeRootSet].some((root) => isUnderRoot(relPath.toLowerCase(), root)));
  }

  return { isAllowed, isIgnored, isExplicitlyIncluded };
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyAllowedFiles(sourceRoot, targetRoot, allowedFiles) {
  for (const relPath of allowedFiles) {
    const sourcePath = path.join(sourceRoot, ...relPath.split('/'));
    const targetPath = path.join(targetRoot, ...relPath.split('/'));
    await ensureParentDir(targetPath);
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function listFiles(rootDir) {
  const output = [];

  async function visit(currentAbs, currentRel = '') {
    const entries = await fs.readdir(currentAbs, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name === '.git') {
        continue;
      }

      const relPath = currentRel ? path.posix.join(currentRel, entry.name) : entry.name;
      const absPath = path.join(currentAbs, entry.name);

      if (entry.isDirectory()) {
        await visit(absPath, relPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        output.push(toPosix(relPath));
      }
    }
  }

  await visit(rootDir);
  return output;
}

async function pruneTarget(targetRoot, allowedSet) {
  const targetFiles = await listFiles(targetRoot);
  const staleFiles = targetFiles.filter((relPath) => !allowedSet.has(relPath.toLowerCase()));

  for (const relPath of staleFiles) {
    const absPath = path.join(targetRoot, ...relPath.split('/'));
    await fs.rm(absPath, { force: true });
  }

  const directoriesToCheck = [];

  async function collectDirs(currentAbs, currentRel = '') {
    const entries = await fs.readdir(currentAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') {
        continue;
      }
      const relPath = currentRel ? path.posix.join(currentRel, entry.name) : entry.name;
      const absPath = path.join(currentAbs, entry.name);
      if (entry.isDirectory()) {
        await collectDirs(absPath, relPath);
        directoriesToCheck.push(absPath);
      }
    }
  }

  await collectDirs(targetRoot);

  directoriesToCheck.sort((left, right) => right.length - left.length);
  for (const absPath of directoriesToCheck) {
    const entries = await fs.readdir(absPath);
    if (entries.length === 0) {
      await fs.rm(absPath, { recursive: true, force: true });
    }
  }

  return staleFiles;
}

function printSummary(title, lines) {
  console.log(title);
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}

async function main() {
  const command = (process.argv[2] ?? 'check').toLowerCase();
  const manifest = await loadManifest();
  const sourceRoot = repoRoot;
  const targetRoot = path.resolve(manifest.targetDir ?? 'F:/scheduler-public');
  const sourceMatchesTarget = isSameDirectory(sourceRoot, targetRoot);
  const { isAllowed, isIgnored } = buildAllowlist(manifest);

  const sourceFiles = await walkFiles(sourceRoot, manifest);
  const allowedFiles = sourceFiles.filter((relPath) => isAllowed(relPath));
  const ignoredFiles = sourceFiles.filter((relPath) => !isAllowed(relPath) && isIgnored(relPath));
  const unclassifiedFiles = sourceFiles.filter((relPath) => !isAllowed(relPath) && !isIgnored(relPath));

  if (command === 'check') {
    printSummary('Public allowlist check', [
      `Allowed files: ${allowedFiles.length}`,
      `Ignored files: ${ignoredFiles.length}`,
      `Unclassified files: ${unclassifiedFiles.length}`,
      sourceMatchesTarget
        ? 'Mode: auditing the checked-in public copy only; sync is disabled when source and target are the same directory.'
        : `Target: ${targetRoot}`,
    ]);

    if (unclassifiedFiles.length > 0) {
      console.log('');
      console.log('Unclassified files need review:');
      for (const relPath of unclassifiedFiles) {
        console.log(relPath);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (command !== 'sync') {
    throw new Error(`Unknown command "${command}". Use "check" or "sync".`);
  }

  if (sourceMatchesTarget) {
    throw new Error(
      'Refusing to sync when source and target are the same directory. Run this command from the private source workspace that copies into the public repo.',
    );
  }

  await fs.mkdir(targetRoot, { recursive: true });
  await copyAllowedFiles(sourceRoot, targetRoot, allowedFiles);

  const staleFiles = await pruneTarget(targetRoot, new Set(allowedFiles.map((value) => value.toLowerCase())));

  printSummary('Public sync complete', [
    `Target: ${targetRoot}`,
    `Copied files: ${allowedFiles.length}`,
    `Removed stale files: ${staleFiles.length}`,
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
