import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createIsolatedWorktree, type WorktreeCommand } from '../src/worktree.js';

test('createIsolatedWorktree: calls git worktree add with exact arguments and repoRoot cwd', async () => {
  const recordedCalls: Array<{ args: string[]; cwd: string }> = [];
  const recordingCommand: WorktreeCommand = async (args, cwd) => {
    recordedCalls.push({ args, cwd });
  };

  const repoRoot = path.resolve('repo');
  const runRoot = path.resolve('worktrees');
  const taskId = 'task-001';

  const resultPath = await createIsolatedWorktree(
    recordingCommand,
    repoRoot,
    runRoot,
    taskId
  );

  const expectedWorktreePath = path.resolve(runRoot, 'task-001');

  assert.equal(resultPath, expectedWorktreePath);
  assert.equal(path.isAbsolute(resultPath), true);
  assert.equal(recordedCalls.length, 1);
  assert.deepEqual(recordedCalls[0], {
    args: ['worktree', 'add', '--detach', expectedWorktreePath, 'HEAD'],
    cwd: repoRoot,
  });
});

test('createIsolatedWorktree: produces deterministic unique absolute paths for distinct task IDs', async () => {
  const noopCommand: WorktreeCommand = async () => {};
  const repoRoot = path.resolve('repo');
  const runRoot = path.resolve('runs');

  const path1 = await createIsolatedWorktree(noopCommand, repoRoot, runRoot, 'task-alpha');
  const path2 = await createIsolatedWorktree(noopCommand, repoRoot, runRoot, 'task-beta');
  const path1Repeat = await createIsolatedWorktree(noopCommand, repoRoot, runRoot, 'task-alpha');

  assert.equal(path1, path.resolve(runRoot, 'task-alpha'));
  assert.equal(path2, path.resolve(runRoot, 'task-beta'));
  assert.equal(path1, path1Repeat);
  assert.notEqual(path1, path2);
});

test('createIsolatedWorktree: resolves relative runRoot to an absolute worktree path', async () => {
  const recordedCalls: Array<{ args: string[]; cwd: string }> = [];
  const recordingCommand: WorktreeCommand = async (args, cwd) => {
    recordedCalls.push({ args, cwd });
  };

  const repoRoot = 'relative/repo';
  const runRoot = 'relative/runs';
  const taskId = 'task-rel-1';

  const resultPath = await createIsolatedWorktree(
    recordingCommand,
    repoRoot,
    runRoot,
    taskId
  );

  const expectedWorktreePath = path.resolve(runRoot, 'task-rel-1');
  assert.equal(resultPath, expectedWorktreePath);
  assert.equal(path.isAbsolute(resultPath), true);
  assert.deepEqual(recordedCalls[0].args, [
    'worktree',
    'add',
    '--detach',
    expectedWorktreePath,
    'HEAD',
  ]);
});

test('createIsolatedWorktree: rejects blank task IDs', async () => {
  const noopCommand: WorktreeCommand = async () => {};
  const repoRoot = path.resolve('repo');
  const runRoot = path.resolve('runs');

  await assert.rejects(
    () => createIsolatedWorktree(noopCommand, repoRoot, runRoot, ''),
    /blank/i
  );

  await assert.rejects(
    () => createIsolatedWorktree(noopCommand, repoRoot, runRoot, '   '),
    /blank/i
  );

  await assert.rejects(
    () => createIsolatedWorktree(noopCommand, repoRoot, runRoot, '\t\r\n'),
    /blank/i
  );

  await assert.rejects(
    () => createIsolatedWorktree(noopCommand, repoRoot, runRoot, null as unknown as string),
    /blank/i
  );

  await assert.rejects(
    () => createIsolatedWorktree(noopCommand, repoRoot, runRoot, undefined as unknown as string),
    /blank/i
  );
});

test('createIsolatedWorktree: rejects unsafe task IDs containing directory traversal or path separators', async () => {
  const noopCommand: WorktreeCommand = async () => {};
  const repoRoot = path.resolve('repo');
  const runRoot = path.resolve('runs');

  const unsafeIds = [
    '..',
    '.',
    '../escaped',
    'nested/task',
    'nested\\task',
    '/root-task',
    '\\win-root',
    'foo/../bar',
    'task/sub',
  ];

  for (const taskId of unsafeIds) {
    await assert.rejects(
      () => createIsolatedWorktree(noopCommand, repoRoot, runRoot, taskId),
      /unsafe/i,
      `Expected taskId '${taskId}' to be rejected as unsafe`
    );
  }
});

test('createIsolatedWorktree: rejects unsafe task IDs with invalid filesystem characters or reserved names', async () => {
  const noopCommand: WorktreeCommand = async () => {};
  const repoRoot = path.resolve('repo');
  const runRoot = path.resolve('runs');

  const invalidIds = [
    'task:1',
    'task*1',
    'task?1',
    'task<1>',
    'task|1',
    'task"1"',
    'task 1',
    'task\0name',
    'CON',
    'prn',
    'AUX',
    'NUL',
    'COM1',
    'LPT2',
    'con.txt',
    'task.',
    '.task',
  ];

  for (const taskId of invalidIds) {
    await assert.rejects(
      () => createIsolatedWorktree(noopCommand, repoRoot, runRoot, taskId),
      /unsafe/i,
      `Expected taskId '${taskId}' to be rejected as unsafe`
    );
  }
});

test('createIsolatedWorktree: propagates command execution errors', async () => {
  const failingCommand: WorktreeCommand = async () => {
    throw new Error('git worktree add failed: fatal error');
  };

  await assert.rejects(
    () =>
      createIsolatedWorktree(
        failingCommand,
        path.resolve('repo'),
        path.resolve('runs'),
        'task-fail'
      ),
    /git worktree add failed: fatal error/
  );
});

test('createIsolatedWorktree: rejects invalid repoRoot, runRoot, or command', async () => {
  const noopCommand: WorktreeCommand = async () => {};

  await assert.rejects(
    () => createIsolatedWorktree(null as unknown as WorktreeCommand, 'repo', 'runs', 'task-1'),
    /command/i
  );

  await assert.rejects(
    () => createIsolatedWorktree(noopCommand, '', 'runs', 'task-1'),
    /repoRoot/i
  );

  await assert.rejects(
    () => createIsolatedWorktree(noopCommand, 'repo', '', 'task-1'),
    /runRoot/i
  );
});
