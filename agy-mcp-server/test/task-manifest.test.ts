import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTaskManifest, type TaskManifest } from '../src/task-manifest.js';

test('parses a valid task manifest and defaults executor to agy', () => {
  const input = {
    id: 'task-001',
    prompt: 'Implement feature X',
    readPaths: ['src/index.ts', 'docs/spec.md'],
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 120,
    maxRetries: 2,
  };

  const manifest: TaskManifest = parseTaskManifest(input);

  assert.deepEqual(manifest, {
    id: 'task-001',
    prompt: 'Implement feature X',
    readPaths: ['src/index.ts', 'docs/spec.md'],
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 120,
    maxRetries: 2,
    executor: 'agy',
  });
});

test('accepts explicit executor agy or cline', () => {
  const base = {
    id: 'task-002',
    prompt: 'Fix bug Y',
    readPaths: [],
    writePaths: ['src/app.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 60,
    maxRetries: 0,
  };

  const agyManifest = parseTaskManifest({ ...base, executor: 'agy' });
  assert.equal(agyManifest.executor, 'agy');

  const clineManifest = parseTaskManifest({ ...base, executor: 'cline' });
  assert.equal(clineManifest.executor, 'cline');
});

test('rejects absolute paths with leading slash or backslash', () => {
  const base = {
    id: 'task-003',
    prompt: 'Test path rejection',
    readPaths: ['/etc/passwd'],
    writePaths: ['src/file.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 60,
    maxRetries: 1,
  };

  assert.throws(() => parseTaskManifest(base), /absolute/i);

  assert.throws(
    () =>
      parseTaskManifest({
        ...base,
        readPaths: [],
        writePaths: ['\\windows\\system32\\cmd.exe'],
      }),
    /absolute/i
  );
});

test('rejects drive-qualified paths', () => {
  const base = {
    id: 'task-004',
    prompt: 'Test drive rejection',
    readPaths: ['C:\\project\\file.ts'],
    writePaths: ['src/file.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 60,
    maxRetries: 1,
  };

  assert.throws(() => parseTaskManifest(base), /drive/i);

  assert.throws(
    () =>
      parseTaskManifest({
        ...base,
        readPaths: ['D:/project/file.ts'],
      }),
    /drive/i
  );

  assert.throws(
    () =>
      parseTaskManifest({
        ...base,
        readPaths: [],
        writePaths: ['c:relative-on-c.ts'],
      }),
    /drive/i
  );
});

test('rejects paths containing ..', () => {
  const base = {
    id: 'task-005',
    prompt: 'Test traversal rejection',
    readPaths: ['../parent.ts'],
    writePaths: ['src/file.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 60,
    maxRetries: 1,
  };

  assert.throws(() => parseTaskManifest(base), /\.\./);

  assert.throws(
    () =>
      parseTaskManifest({
        ...base,
        readPaths: ['src/../../secret.ts'],
      }),
    /\.\./
  );

  assert.throws(
    () =>
      parseTaskManifest({
        ...base,
        readPaths: [],
        writePaths: ['..'],
      }),
    /\.\./
  );
});

test('rejects invalid required fields and types', () => {
  // Non-object or null
  assert.throws(() => parseTaskManifest(null), /object/i);
  assert.throws(() => parseTaskManifest('string'), /object/i);
  assert.throws(() => parseTaskManifest([]), /object/i);

  const valid = {
    id: 'task-valid',
    prompt: 'Valid prompt',
    readPaths: ['src/a.ts'],
    writePaths: ['src/b.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 300,
    maxRetries: 1,
  };

  // Blank id
  assert.throws(() => parseTaskManifest({ ...valid, id: '' }));
  assert.throws(() => parseTaskManifest({ ...valid, id: '   ' }));
  assert.throws(() => parseTaskManifest({ ...valid, id: 123 }));

  // Blank prompt
  assert.throws(() => parseTaskManifest({ ...valid, prompt: '' }));
  assert.throws(() => parseTaskManifest({ ...valid, prompt: '  \t\n ' }));

  // Non-array paths
  assert.throws(() => parseTaskManifest({ ...valid, readPaths: 'src/a.ts' }));
  assert.throws(() => parseTaskManifest({ ...valid, writePaths: null }));

  // Empty or blank path items
  assert.throws(() => parseTaskManifest({ ...valid, readPaths: [''] }));
  assert.throws(() => parseTaskManifest({ ...valid, writePaths: ['   '] }));

  // Acceptance commands validation
  assert.throws(() => parseTaskManifest({ ...valid, acceptanceCommands: 'npm test' }));
  assert.throws(() => parseTaskManifest({ ...valid, acceptanceCommands: [''] }));
  assert.throws(() => parseTaskManifest({ ...valid, acceptanceCommands: ['  '] }));

  // Timeout bounds (1..3600 integer)
  assert.throws(() => parseTaskManifest({ ...valid, timeoutSeconds: 0 }));
  assert.throws(() => parseTaskManifest({ ...valid, timeoutSeconds: 3601 }));
  assert.throws(() => parseTaskManifest({ ...valid, timeoutSeconds: 10.5 }));
  assert.throws(() => parseTaskManifest({ ...valid, timeoutSeconds: '100' }));

  // MaxRetries bounds (0..3 integer)
  assert.throws(() => parseTaskManifest({ ...valid, maxRetries: -1 }));
  assert.throws(() => parseTaskManifest({ ...valid, maxRetries: 4 }));
  assert.throws(() => parseTaskManifest({ ...valid, maxRetries: 1.5 }));
  assert.throws(() => parseTaskManifest({ ...valid, maxRetries: '2' }));

  // Executor validation
  assert.throws(() => parseTaskManifest({ ...valid, executor: 'invalid' }));
  assert.throws(() => parseTaskManifest({ ...valid, executor: 123 }));
});
