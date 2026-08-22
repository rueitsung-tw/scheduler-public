import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DelegationRunner,
  type AcceptanceResult,
  type DelegationRunnerOps,
  type ProviderRunInput,
  type ProviderRunResult,
} from '../src/delegation-runner.js';
import type { TaskManifest } from '../src/task-manifest.js';

function createSampleManifest(overrides: Partial<TaskManifest> = {}): TaskManifest {
  return {
    id: 'task-001',
    prompt: 'Implement sample task',
    readPaths: ['src/index.ts'],
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 120,
    maxRetries: 1,
    executor: 'agy',
    ...overrides,
  };
}

test('DelegationRunner: success removes worktree', async () => {
  const removedWorktrees: string[] = [];
  const acceptanceCalls: Array<{ command: string; cwd: string }> = [];
  const providerCalls: ProviderRunInput[] = [];

  const manifest = createSampleManifest({
    id: 'task-success',
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test'],
  });

  const ops: DelegationRunnerOps = {
    createWorktree: async (m: TaskManifest) => `/worktrees/${m.id}`,
    runProvider: async (input: ProviderRunInput): Promise<ProviderRunResult> => {
      providerCalls.push(input);
      return {
        exitCode: 0,
        stdout: 'Provider generated code successfully',
        stderr: '',
      };
    },
    listChangedFiles: async (_cwd: string) => ['src/index.ts'],
    runAcceptance: async (command: string, cwd: string): Promise<AcceptanceResult> => {
      acceptanceCalls.push({ command, cwd });
      return {
        command,
        exitCode: 0,
        stdout: 'All tests passed',
        stderr: '',
        passed: true,
      };
    },
    removeWorktree: async (cwd: string) => {
      removedWorktrees.push(cwd);
    },
  };

  const runner = new DelegationRunner(ops);
  const result = await runner.run(manifest);

  assert.equal(result.status, 'succeeded');
  assert.equal(result.reason, 'succeeded');
  assert.equal(result.worktreePath, '/worktrees/task-success');
  assert.deepEqual(result.changedFiles, ['src/index.ts']);
  assert.equal(result.stdout, 'Provider generated code successfully');
  assert.equal(result.stderr, '');
  assert.equal(result.acceptanceResults.length, 1);
  assert.equal(result.acceptanceResults[0].command, 'npm test');
  assert.equal(result.acceptanceResults[0].exitCode, 0);
  assert.equal(result.acceptanceResults[0].passed, true);

  assert.deepEqual(providerCalls, [{ manifest, cwd: '/worktrees/task-success' }]);
  assert.deepEqual(acceptanceCalls, [{ command: 'npm test', cwd: '/worktrees/task-success' }]);
  assert.deepEqual(removedWorktrees, ['/worktrees/task-success']);
});

test('DelegationRunner: provider nonzero skips acceptance and preserves worktree', async () => {
  const removedWorktrees: string[] = [];
  const acceptanceCalls: Array<{ command: string; cwd: string }> = [];

  const manifest = createSampleManifest({
    id: 'task-nonzero',
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test'],
  });

  const ops: DelegationRunnerOps = {
    createWorktree: async (m: TaskManifest) => `/worktrees/${m.id}`,
    runProvider: async (_input: ProviderRunInput): Promise<ProviderRunResult> => {
      return {
        exitCode: 1,
        stdout: 'Syntax error during execution',
        stderr: 'SyntaxError: Unexpected token',
      };
    },
    listChangedFiles: async (_cwd: string) => ['src/index.ts'],
    runAcceptance: async (command: string, cwd: string): Promise<AcceptanceResult> => {
      acceptanceCalls.push({ command, cwd });
      return {
        command,
        exitCode: 0,
        stdout: 'Should not run',
        stderr: '',
      };
    },
    removeWorktree: async (cwd: string) => {
      removedWorktrees.push(cwd);
    },
  };

  const runner = new DelegationRunner(ops);
  const result = await runner.run(manifest);

  assert.equal(result.status, 'provider_failure');
  assert.equal(result.reason, 'provider_failure');
  assert.equal(result.worktreePath, '/worktrees/task-nonzero');
  assert.deepEqual(result.changedFiles, ['src/index.ts']);
  assert.equal(result.stdout, 'Syntax error during execution');
  assert.equal(result.stderr, 'SyntaxError: Unexpected token');
  assert.deepEqual(result.acceptanceResults, []);
  assert.equal(acceptanceCalls.length, 0);
  assert.equal(removedWorktrees.length, 0);
});

test('DelegationRunner: disallowed write skips acceptance and preserves', async () => {
  const removedWorktrees: string[] = [];
  const acceptanceCalls: Array<{ command: string; cwd: string }> = [];

  const manifest = createSampleManifest({
    id: 'task-disallowed',
    writePaths: ['src/allowed.ts'],
    acceptanceCommands: ['npm test'],
  });

  const ops: DelegationRunnerOps = {
    createWorktree: async (m: TaskManifest) => `/worktrees/${m.id}`,
    runProvider: async (_input: ProviderRunInput): Promise<ProviderRunResult> => {
      return {
        exitCode: 0,
        stdout: 'Modified files',
        stderr: '',
      };
    },
    listChangedFiles: async (_cwd: string) => ['src/allowed.ts', 'forbidden/secret.env'],
    runAcceptance: async (command: string, cwd: string): Promise<AcceptanceResult> => {
      acceptanceCalls.push({ command, cwd });
      return {
        command,
        exitCode: 0,
        stdout: 'Should not run',
        stderr: '',
      };
    },
    removeWorktree: async (cwd: string) => {
      removedWorktrees.push(cwd);
    },
  };

  const runner = new DelegationRunner(ops);
  const result = await runner.run(manifest);

  assert.equal(result.status, 'write_allowlist_violation');
  assert.equal(result.reason, 'write_allowlist_violation');
  assert.equal(result.worktreePath, '/worktrees/task-disallowed');
  assert.deepEqual(result.changedFiles, ['src/allowed.ts', 'forbidden/secret.env']);
  assert.deepEqual(result.acceptanceResults, []);
  assert.equal(acceptanceCalls.length, 0);
  assert.equal(removedWorktrees.length, 0);
});

test('DelegationRunner: acceptance failure preserves', async () => {
  const removedWorktrees: string[] = [];
  const acceptanceCalls: Array<{ command: string; cwd: string }> = [];

  const manifest = createSampleManifest({
    id: 'task-acceptance-fail',
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test', 'npm run lint'],
  });

  const ops: DelegationRunnerOps = {
    createWorktree: async (m: TaskManifest) => `/worktrees/${m.id}`,
    runProvider: async (_input: ProviderRunInput): Promise<ProviderRunResult> => {
      return {
        exitCode: 0,
        stdout: 'Provider ok',
        stderr: '',
      };
    },
    listChangedFiles: async (_cwd: string) => ['src/index.ts'],
    runAcceptance: async (command: string, cwd: string): Promise<AcceptanceResult> => {
      acceptanceCalls.push({ command, cwd });
      if (command === 'npm test') {
        return {
          command,
          exitCode: 1,
          stdout: '1 test failed',
          stderr: 'AssertionError',
          passed: false,
        };
      }
      return {
        command,
        exitCode: 0,
        stdout: 'Lint clean',
        stderr: '',
        passed: true,
      };
    },
    removeWorktree: async (cwd: string) => {
      removedWorktrees.push(cwd);
    },
  };

  const runner = new DelegationRunner(ops);
  const result = await runner.run(manifest);

  assert.equal(result.status, 'acceptance_failure');
  assert.equal(result.reason, 'acceptance_failure');
  assert.equal(result.worktreePath, '/worktrees/task-acceptance-fail');
  assert.deepEqual(result.changedFiles, ['src/index.ts']);
  assert.equal(result.acceptanceResults.length, 2);
  assert.equal(result.acceptanceResults[0].passed, false);
  assert.equal(result.acceptanceResults[1].passed, true);
  assert.equal(acceptanceCalls.length, 2);
  assert.equal(removedWorktrees.length, 0);
});

test('DelegationRunner: empty write result is no_changes and preserves', async () => {
  const removedWorktrees: string[] = [];
  const acceptanceCalls: Array<{ command: string; cwd: string }> = [];

  const manifest = createSampleManifest({
    id: 'task-no-changes',
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test'],
  });

  const ops: DelegationRunnerOps = {
    createWorktree: async (m: TaskManifest) => `/worktrees/${m.id}`,
    runProvider: async (_input: ProviderRunInput): Promise<ProviderRunResult> => {
      return {
        exitCode: 0,
        stdout: 'No modifications made',
        stderr: '',
      };
    },
    listChangedFiles: async (_cwd: string) => [],
    runAcceptance: async (command: string, cwd: string): Promise<AcceptanceResult> => {
      acceptanceCalls.push({ command, cwd });
      return {
        command,
        exitCode: 0,
        stdout: 'Tests passed',
        stderr: '',
        passed: true,
      };
    },
    removeWorktree: async (cwd: string) => {
      removedWorktrees.push(cwd);
    },
  };

  const runner = new DelegationRunner(ops);
  const result = await runner.run(manifest);

  assert.equal(result.status, 'no_changes');
  assert.equal(result.reason, 'no_changes');
  assert.equal(result.worktreePath, '/worktrees/task-no-changes');
  assert.deepEqual(result.changedFiles, []);
  assert.equal(removedWorktrees.length, 0);
});

test('DelegationRunner: provider timeout skips acceptance and preserves worktree', async () => {
  const removedWorktrees: string[] = [];
  const acceptanceCalls: Array<{ command: string; cwd: string }> = [];

  const manifest = createSampleManifest({
    id: 'task-timeout',
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test'],
  });

  const ops: DelegationRunnerOps = {
    createWorktree: async (m: TaskManifest) => `/worktrees/${m.id}`,
    runProvider: async (_input: ProviderRunInput): Promise<ProviderRunResult> => {
      return {
        exitCode: null,
        stdout: '',
        stderr: 'Timed out',
        timedOut: true,
      };
    },
    listChangedFiles: async (_cwd: string) => ['src/index.ts'],
    runAcceptance: async (command: string, cwd: string): Promise<AcceptanceResult> => {
      acceptanceCalls.push({ command, cwd });
      return { command, exitCode: 0, stdout: '', stderr: '' };
    },
    removeWorktree: async (cwd: string) => {
      removedWorktrees.push(cwd);
    },
  };

  const runner = new DelegationRunner(ops);
  const result = await runner.run(manifest);

  assert.equal(result.status, 'timeout');
  assert.equal(result.reason, 'timeout');
  assert.equal(acceptanceCalls.length, 0);
  assert.equal(removedWorktrees.length, 0);
});

test('DelegationRunner: provider cancelled skips acceptance and preserves worktree', async () => {
  const removedWorktrees: string[] = [];
  const acceptanceCalls: Array<{ command: string; cwd: string }> = [];

  const manifest = createSampleManifest({
    id: 'task-cancelled',
    writePaths: ['src/index.ts'],
    acceptanceCommands: ['npm test'],
  });

  const ops: DelegationRunnerOps = {
    createWorktree: async (m: TaskManifest) => `/worktrees/${m.id}`,
    runProvider: async (_input: ProviderRunInput): Promise<ProviderRunResult> => {
      return {
        exitCode: 130,
        stdout: '',
        stderr: 'Process cancelled by signal',
        cancelled: true,
      };
    },
    listChangedFiles: async (_cwd: string) => ['src/index.ts'],
    runAcceptance: async (command: string, cwd: string): Promise<AcceptanceResult> => {
      acceptanceCalls.push({ command, cwd });
      return { command, exitCode: 0, stdout: '', stderr: '' };
    },
    removeWorktree: async (cwd: string) => {
      removedWorktrees.push(cwd);
    },
  };

  const runner = new DelegationRunner(ops);
  const result = await runner.run(manifest);

  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'cancelled');
  assert.equal(acceptanceCalls.length, 0);
  assert.equal(removedWorktrees.length, 0);
});
