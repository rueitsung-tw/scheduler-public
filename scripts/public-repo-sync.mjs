import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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

function parseArgs(argv) {
  const args = [...argv];
  const command = (args.shift() ?? 'check').toLowerCase();
  let sourceRoot = null;
  let dryRun = false;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--source') {
      const value = args.shift();
      if (!value) {
        throw new Error('Missing value for --source.');
      }
      sourceRoot = path.resolve(value);
      continue;
    }

    throw new Error(`Unknown argument "${arg}". Supported options: --source <path>, --dry-run.`);
  }

  return { command, sourceRoot, dryRun };
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

function buildTargetOnlyMatcher(manifest) {
  const targetOnlyRootSet = new Set((manifest.targetOnlyRoots ?? []).map((value) => value.toLowerCase()));
  const targetOnlyFileSet = new Set(
    [...(manifest.targetOnlyFiles ?? []), ...(manifest.targetOnlyDocFiles ?? [])].map((value) =>
      value.toLowerCase(),
    ),
  );

  return (relPath) => {
    const lowered = relPath.toLowerCase();
    if (targetOnlyFileSet.has(lowered)) {
      return true;
    }

    for (const root of targetOnlyRootSet) {
      if (isUnderRoot(lowered, root)) {
        return true;
      }
    }

    return false;
  };
}

function assertDirectoryExists(dirPath, label) {
  if (!fsSync.existsSync(dirPath)) {
    throw new Error(`${label} does not exist: ${dirPath}`);
  }

  const stat = fsSync.statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${dirPath}`);
  }
}

function resolveTargetRoot(manifest) {
  const manifestTargetRoot = path.resolve(manifest.targetDir ?? repoRoot);
  if (!isSameDirectory(manifestTargetRoot, repoRoot)) {
    throw new Error(
      `This script only mutates the current public repository. Expected target ${repoRoot}, got ${manifestTargetRoot}.`,
    );
  }

  return manifestTargetRoot;
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

async function findStaleFiles(targetRoot, allowedSet) {
  const targetFiles = await listFiles(targetRoot);
  return targetFiles.filter((relPath) => !allowedSet.has(relPath.toLowerCase()));
}

async function pruneTarget(targetRoot, staleFiles) {

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

function printPaths(title, paths) {
  if (paths.length === 0) {
    return;
  }

  console.log('');
  console.log(title);
  for (const relPath of paths) {
    console.log(relPath);
  }
}

async function main() {
  const { command, sourceRoot, dryRun } = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest();
  const targetRoot = resolveTargetRoot(manifest);
  const { isAllowed, isIgnored } = buildAllowlist(manifest);
  const isTargetOnly = buildTargetOnlyMatcher(manifest);

  if (command === 'check') {
    if (sourceRoot) {
      assertDirectoryExists(sourceRoot, 'Source directory');
      const sourceFiles = await walkFiles(sourceRoot, manifest);
      const allowedFiles = sourceFiles.filter((relPath) => isAllowed(relPath));
      const ignoredFiles = sourceFiles.filter((relPath) => !isAllowed(relPath) && isIgnored(relPath));
      const unclassifiedFiles = sourceFiles.filter((relPath) => !isAllowed(relPath) && !isIgnored(relPath));

      printSummary('Public allowlist check', [
        `Source: ${sourceRoot}`,
        `Target: ${targetRoot}`,
        `Allowed files: ${allowedFiles.length}`,
        `Ignored files: ${ignoredFiles.length}`,
        `Unclassified files: ${unclassifiedFiles.length}`,
      ]);
      printPaths('Unclassified files need review:', unclassifiedFiles);

      if (unclassifiedFiles.length > 0) {
        process.exitCode = 1;
      }
      return;
    }

    const targetFiles = await listFiles(targetRoot);
    const allowedTargetFiles = targetFiles.filter((relPath) => isAllowed(relPath) || isTargetOnly(relPath));
    const ignoredTargetFiles = targetFiles.filter(
      (relPath) => !isAllowed(relPath) && !isTargetOnly(relPath) && isIgnored(relPath),
    );
    const unclassifiedTargetFiles = targetFiles.filter(
      (relPath) => !isAllowed(relPath) && !isTargetOnly(relPath) && !isIgnored(relPath),
    );

    printSummary('Public allowlist check', [
      `Source: (audit current public repo only)`,
      `Target: ${targetRoot}`,
      `Allowed files: ${allowedTargetFiles.length}`,
      `Ignored files: ${ignoredTargetFiles.length}`,
      `Unclassified files: ${unclassifiedTargetFiles.length}`,
      'Mode: auditing the checked-in public copy only; sync requires --source.',
    ]);
    printPaths('Unclassified files need review:', unclassifiedTargetFiles);

    if (unclassifiedTargetFiles.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (command !== 'sync') {
    throw new Error(`Unknown command "${command}". Use "check" or "sync".`);
  }

  if (!sourceRoot) {
    throw new Error('Public sync requires --source <private-dir>.');
  }

  assertDirectoryExists(sourceRoot, 'Source directory');

  if (isSameDirectory(sourceRoot, targetRoot)) {
    throw new Error(
      'Refusing to sync when source and target are the same directory. Do not use the public repo itself as --source.',
    );
  }

  const sourceFiles = await walkFiles(sourceRoot, manifest);
  const allowedFiles = sourceFiles.filter((relPath) => isAllowed(relPath));
  const ignoredFiles = sourceFiles.filter((relPath) => !isAllowed(relPath) && isIgnored(relPath));
  const unclassifiedFiles = sourceFiles.filter((relPath) => !isAllowed(relPath) && !isIgnored(relPath));
  const allowedTargetSet = new Set(allowedFiles.map((value) => value.toLowerCase()));
  const targetFiles = await listFiles(targetRoot);
  for (const relPath of targetFiles) {
    if (isTargetOnly(relPath)) {
      allowedTargetSet.add(relPath.toLowerCase());
    }
  }
  const staleFiles = await findStaleFiles(targetRoot, allowedTargetSet);

  printSummary(dryRun ? 'Public sync dry-run' : 'Public sync complete', [
    `Source: ${sourceRoot}`,
    `Target: ${targetRoot}`,
    `Allowed files: ${allowedFiles.length}`,
    `Ignored files: ${ignoredFiles.length}`,
    `Unclassified files: ${unclassifiedFiles.length}`,
    `Copied files: ${allowedFiles.length}`,
    `Removed stale files: ${staleFiles.length}`,
    `Dry run: ${dryRun ? 'yes' : 'no'}`,
  ]);
  printPaths('Unclassified files need review:', unclassifiedFiles);
  printPaths(dryRun ? 'Would remove stale files:' : 'Removed stale files:', staleFiles);

  if (unclassifiedFiles.length > 0) {
    throw new Error('Refusing to sync because the source tree contains unclassified files.');
  }

  if (dryRun) {
    return;
  }

  await fs.mkdir(targetRoot, { recursive: true });
  await copyAllowedFiles(sourceRoot, targetRoot, allowedFiles);
  await pruneTarget(targetRoot, staleFiles);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
