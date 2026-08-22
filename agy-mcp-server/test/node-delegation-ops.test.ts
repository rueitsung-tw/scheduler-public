import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_CLINE_ENTRYPOINT,
  createNodeDelegationOps,
  type ExecFileResult,
  type NodeDelegationDependencies,
  type NodeDelegationOpsConfig,
} from '../src/node-delegation-ops.js';
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

test('createWorktree: calls git worktree add --detach <worktreePath> HEAD from repositoryRoot through createIsolatedWorktree', async () => {
  const execFileCalls: Array<{ file: string; args: string[]; cwd?: string }> = [];
  const repoRoot = path.resolve('repo-root');
  const worktreeRoot = path.resolve('worktrees-dir');

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: repoRoot,
    worktreeRoot: worktreeRoot,
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async (file, args, options) => {
      execFileCalls.push({ file, args, cwd: options?.cwd });
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    spawnProvider: async () => {
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const manifest = createSampleManifest({ id: 'task-abc' });

  const resultPath = await ops.createWorktree(manifest);
  const expectedPath = path.resolve(worktreeRoot, 'task-abc');

  assert.equal(resultPath, expectedPath);
  assert.equal(execFileCalls.length, 1);
  assert.deepEqual(execFileCalls[0], {
    file: 'git',
    args: ['worktree', 'add', '--detach', expectedPath, 'HEAD'],
    cwd: repoRoot,
  });
});

test('createWorktree: throws an Error containing stderr when git worktree add returns nonzero exitCode', async () => {
  const repoRoot = path.resolve('repo-root');
  const worktreeRoot = path.resolve('worktrees-dir');

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: repoRoot,
    worktreeRoot: worktreeRoot,
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async () => ({
      stdout: '',
      stderr: 'fatal: destination path already exists and is not an empty directory.',
      exitCode: 128,
    }),
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const manifest = createSampleManifest({ id: 'task-fail' });

  await assert.rejects(
    () => ops.createWorktree(manifest),
    /fatal: destination path already exists and is not an empty directory/
  );
});

test('createWorktree: throws an Error containing stdout when git worktree add returns nonzero exitCode with empty stderr', async () => {
  const repoRoot = path.resolve('repo-root');
  const worktreeRoot = path.resolve('worktrees-dir');

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: repoRoot,
    worktreeRoot: worktreeRoot,
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async () => ({
      stdout: 'error: worktree already exists in stdout',
      stderr: '',
      exitCode: 1,
    }),
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const manifest = createSampleManifest({ id: 'task-fail-stdout' });

  await assert.rejects(
    () => ops.createWorktree(manifest),
    /error: worktree already exists in stdout/
  );
});

test('runProvider: builds exact AGY args and forwards exitCode, stdout, stderr, timedOut, cancelled from spawnProvider', async () => {
  const spawnCalls: Array<{ command: string; args: string[]; options: { cwd: string } }> = [];

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: '/repo',
    worktreeRoot: '/worktrees',
    agyExecutable: 'C:\\bin\\agy.exe',
  };

  const expectedProviderResult = {
    exitCode: 0,
    stdout: '{"type":"output","result":"success"}',
    stderr: '',
    timedOut: false,
    cancelled: false,
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    spawnProvider: async (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return expectedProviderResult;
    },
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const manifest = createSampleManifest({
    prompt: 'Implement auth module with OAuth2',
    timeoutSeconds: 300,
  });

  const cwd = '/worktrees/task-001';
  const result = await ops.runProvider({ manifest, cwd });

  assert.deepEqual(result, expectedProviderResult);
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(spawnCalls[0], {
    command: 'C:\\bin\\agy.exe',
    args: [
      '--print',
      'Implement auth module with OAuth2',
      '--print-timeout',
      '300s',
      '--output-format',
      'json',
      '--add-dir',
      '/worktrees/task-001',
      '--sandbox',
      '--dangerously-skip-permissions',
    ],
    options: { cwd: '/worktrees/task-001' },
  });
});

test('runProvider: executes Cline CLI via Node with JSON output, auto approval, isolated cwd, manifest timeout, and prompt when executor is cline', async () => {
  const spawnCalls: Array<{ command: string; args: string[]; options: { cwd: string } }> = [];

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: '/repo',
    worktreeRoot: '/worktrees',
    agyExecutable: 'C:\\bin\\agy.exe',
    clineEntrypoint: 'C:\\custom\\cline\\bin\\cline.js',
  };

  const expectedProviderResult = {
    exitCode: 0,
    stdout: '{"type":"output","result":"success"}',
    stderr: '',
    timedOut: false,
    cancelled: false,
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    spawnProvider: async (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return expectedProviderResult;
    },
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const manifest = createSampleManifest({
    prompt: 'Refactor solver pipeline',
    timeoutSeconds: 180,
    executor: 'cline',
  });

  const cwd = '/worktrees/task-002';
  const result = await ops.runProvider({ manifest, cwd });

  assert.deepEqual(result, expectedProviderResult);
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(spawnCalls[0], {
    command: process.execPath,
    args: [
      'C:\\custom\\cline\\bin\\cline.js',
      '--json',
      '--auto-approve',
      'true',
      '-c',
      '/worktrees/task-002',
      '-t',
      '180',
      'Refactor solver pipeline',
    ],
    options: { cwd: '/worktrees/task-002' },
  });
});

test('runProvider: falls back to CLINE_CLI_ENTRYPOINT env var when config.clineEntrypoint is not set', async () => {
  const originalEnv = process.env.CLINE_CLI_ENTRYPOINT;
  process.env.CLINE_CLI_ENTRYPOINT = 'C:\\env\\cline\\bin\\cline.js';

  try {
    const spawnCalls: Array<{ command: string; args: string[]; options: { cwd: string } }> = [];
    const config: NodeDelegationOpsConfig = {
      repositoryRoot: '/repo',
      worktreeRoot: '/worktrees',
      agyExecutable: 'agy',
    };

    const dependencies: NodeDelegationDependencies = {
      execFile: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      spawnProvider: async (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    };

    const ops = createNodeDelegationOps(config, dependencies);
    const manifest = createSampleManifest({ executor: 'cline' });
    await ops.runProvider({ manifest, cwd: '/worktrees/task-env' });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, process.execPath);
    assert.equal(spawnCalls[0].args[0], 'C:\\env\\cline\\bin\\cline.js');
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CLINE_CLI_ENTRYPOINT;
    } else {
      process.env.CLINE_CLI_ENTRYPOINT = originalEnv;
    }
  }
});

test('runProvider: falls back to DEFAULT_CLINE_ENTRYPOINT when neither config nor env var is set', async () => {
  const originalEnv = process.env.CLINE_CLI_ENTRYPOINT;
  delete process.env.CLINE_CLI_ENTRYPOINT;

  try {
    const spawnCalls: Array<{ command: string; args: string[]; options: { cwd: string } }> = [];
    const config: NodeDelegationOpsConfig = {
      repositoryRoot: '/repo',
      worktreeRoot: '/worktrees',
      agyExecutable: 'agy',
    };

    const dependencies: NodeDelegationDependencies = {
      execFile: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      spawnProvider: async (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    };

    const ops = createNodeDelegationOps(config, dependencies);
    const manifest = createSampleManifest({ executor: 'cline' });
    await ops.runProvider({ manifest, cwd: '/worktrees/task-default' });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, process.execPath);
    assert.equal(spawnCalls[0].args[0], DEFAULT_CLINE_ENTRYPOINT);
  } finally {
    if (originalEnv !== undefined) {
      process.env.CLINE_CLI_ENTRYPOINT = originalEnv;
    }
  }
});

test('listChangedFiles: invokes git diff --name-only in worktree and returns nonblank trimmed lines', async () => {
  const execCalls: Array<{ file: string; args: string[]; options?: { cwd?: string } }> = [];

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: '/repo',
    worktreeRoot: '/worktrees',
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async (file, args, options) => {
      execCalls.push({ file, args, options });
      return {
        stdout: `
          src/index.ts

          src/utils/math.ts

          tests/math.test.ts
        `,
        stderr: '',
        exitCode: 0,
      };
    },
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const changedFiles = await ops.listChangedFiles('/worktrees/task-001');

  assert.deepEqual(changedFiles, [
    'src/index.ts',
    'src/utils/math.ts',
    'tests/math.test.ts',
  ]);
  assert.equal(execCalls.length, 1);
  assert.deepEqual(execCalls[0], {
    file: 'git',
    args: ['diff', '--name-only'],
    options: { cwd: '/worktrees/task-001' },
  });
});

test('runAcceptance: invokes powershell.exe with -NoProfile, -NonInteractive, -Command and maps successful execution', async () => {
  const execCalls: Array<{ file: string; args: string[]; options?: { cwd?: string } }> = [];

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: '/repo',
    worktreeRoot: '/worktrees',
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async (file, args, options) => {
      execCalls.push({ file, args, options });
      return {
        stdout: 'Tests passed: 5/5',
        stderr: '',
        exitCode: 0,
      };
    },
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const result = await ops.runAcceptance('npm test -- --reporter=dot', '/worktrees/task-001');

  assert.deepEqual(result, {
    command: 'npm test -- --reporter=dot',
    exitCode: 0,
    stdout: 'Tests passed: 5/5',
    stderr: '',
    passed: true,
  });

  assert.equal(execCalls.length, 1);
  assert.deepEqual(execCalls[0], {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', 'npm test -- --reporter=dot'],
    options: { cwd: '/worktrees/task-001' },
  });
});

test('runAcceptance: maps non-zero exit code and failure output to AcceptanceResult', async () => {
  const config: NodeDelegationOpsConfig = {
    repositoryRoot: '/repo',
    worktreeRoot: '/worktrees',
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async () => {
      return {
        stdout: 'AssertionError: expected true to be false',
        stderr: 'Process failed with exit code 1',
        exitCode: 1,
      };
    },
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const result = await ops.runAcceptance('npm test', '/worktrees/task-001');

  assert.deepEqual(result, {
    command: 'npm test',
    exitCode: 1,
    stdout: 'AssertionError: expected true to be false',
    stderr: 'Process failed with exit code 1',
    passed: false,
  });
});

test('runAcceptance: handles execFile thrown error and maps into failed AcceptanceResult', async () => {
  const config: NodeDelegationOpsConfig = {
    repositoryRoot: '/repo',
    worktreeRoot: '/worktrees',
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async () => {
      const err: any = new Error('Command failed: powershell.exe -NoProfile ...');
      err.code = 127;
      err.stdout = 'partially run';
      err.stderr = 'command not found';
      throw err;
    },
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const result = await ops.runAcceptance('invalid-command', '/worktrees/task-001');

    assert.deepEqual(result, {
    command: 'invalid-command',
    exitCode: 127,
    stdout: 'partially run',
    stderr: 'command not found',
    passed: false,
  });
});

test('removeWorktree: invokes git worktree remove --force <cwd> from repositoryRoot', async () => {
  const execCalls: Array<{ file: string; args: string[]; options?: { cwd?: string } }> = [];
  const repoRoot = path.resolve('my-repo-root');

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: repoRoot,
    worktreeRoot: path.resolve('worktrees'),
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async (file, args, options) => {
      execCalls.push({ file, args, options });
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const targetWorktree = path.resolve('worktrees/task-123');

  await ops.removeWorktree(targetWorktree);

  assert.equal(execCalls.length, 1);
  assert.deepEqual(execCalls[0], {
    file: 'git',
    args: ['worktree', 'remove', '--force', targetWorktree],
    options: { cwd: repoRoot },
  });
});

test('removeWorktree: throws an Error containing stderr when git worktree remove returns nonzero exitCode', async () => {
  const repoRoot = path.resolve('my-repo-root');

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: repoRoot,
    worktreeRoot: path.resolve('worktrees'),
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async () => ({
      stdout: '',
      stderr: "fatal: 'worktrees/task-123' is not a working tree",
      exitCode: 128,
    }),
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const targetWorktree = path.resolve('worktrees/task-123');

  await assert.rejects(
    () => ops.removeWorktree(targetWorktree),
    /fatal: 'worktrees\/task-123' is not a working tree/
  );
});

test('removeWorktree: throws an Error containing stdout when git worktree remove returns nonzero exitCode with empty stderr', async () => {
  const repoRoot = path.resolve('my-repo-root');

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: repoRoot,
    worktreeRoot: path.resolve('worktrees'),
    agyExecutable: 'agy',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async () => ({
      stdout: 'error: failed to remove worktree output on stdout',
      stderr: '',
      exitCode: 1,
    }),
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const targetWorktree = path.resolve('worktrees/task-123');

  await assert.rejects(
    () => ops.removeWorktree(targetWorktree),
    /error: failed to remove worktree output on stdout/
  );
});

test('createNodeDelegationOps: validates config parameters', () => {
  const validDependencies: NodeDelegationDependencies = {
    execFile: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };

  assert.throws(
    () => createNodeDelegationOps(null as any, validDependencies),
    /config/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(
        {
          repositoryRoot: '',
          worktreeRoot: '/worktrees',
          agyExecutable: 'agy',
        },
        validDependencies
      ),
    /repositoryRoot/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(
        {
          repositoryRoot: '   ',
          worktreeRoot: '/worktrees',
          agyExecutable: 'agy',
        },
        validDependencies
      ),
    /repositoryRoot/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(
        {
          repositoryRoot: '/repo',
          worktreeRoot: '',
          agyExecutable: 'agy',
        },
        validDependencies
      ),
    /worktreeRoot/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(
        {
          repositoryRoot: '/repo',
          worktreeRoot: '   ',
          agyExecutable: 'agy',
        },
        validDependencies
      ),
    /worktreeRoot/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(
        {
          repositoryRoot: '/repo',
          worktreeRoot: '/worktrees',
          agyExecutable: '',
        },
        validDependencies
      ),
    /agyExecutable/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(
        {
          repositoryRoot: '/repo',
          worktreeRoot: '/worktrees',
          agyExecutable: '   ',
        },
        validDependencies
      ),
    /agyExecutable/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(
        {
          repositoryRoot: '/repo',
          worktreeRoot: '/worktrees',
          agyExecutable: 'agy',
          clineEntrypoint: '',
        },
        validDependencies
      ),
    /clineEntrypoint/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(
        {
          repositoryRoot: '/repo',
          worktreeRoot: '/worktrees',
          agyExecutable: 'agy',
          clineEntrypoint: '   ',
        },
        validDependencies
      ),
    /clineEntrypoint/i
  );
});

test('createNodeDelegationOps: validates dependencies parameter', () => {
  const validConfig: NodeDelegationOpsConfig = {
    repositoryRoot: '/repo',
    worktreeRoot: '/worktrees',
    agyExecutable: 'agy',
  };

  assert.throws(
    () => createNodeDelegationOps(validConfig, null as any),
    /dependencies/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(validConfig, {
        execFile: null as any,
        spawnProvider: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      }),
    /execFile/i
  );

  assert.throws(
    () =>
      createNodeDelegationOps(validConfig, {
        execFile: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        spawnProvider: 'not-a-function' as any,
      }),
    /spawnProvider/i
  );
});

test('Integration with DelegationRunner: complete successful flow with NodeDelegationOps', async () => {
  const recordedExecCalls: Array<{ file: string; args: string[]; options?: { cwd?: string } }> = [];
  const repoRoot = path.resolve('repo');
  const worktreeRoot = path.resolve('worktrees');
  const expectedWorktree = path.resolve(worktreeRoot, 'task-e2e');

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: repoRoot,
    worktreeRoot: worktreeRoot,
    agyExecutable: 'agy.cmd',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async (file, args, options) => {
      recordedExecCalls.push({ file, args, options });
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (file === 'git' && args[0] === 'diff') {
        return { stdout: 'src/app.ts\n', stderr: '', exitCode: 0 };
      }
      if (file === 'powershell.exe') {
        return { stdout: 'All 10 tests passed', stderr: '', exitCode: 0 };
      }
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      throw new Error(`Unexpected execFile: ${file} ${args.join(' ')}`);
    },
    spawnProvider: async (_cmd, _args, _opts) => {
      return {
        exitCode: 0,
        stdout: 'AGY generated modifications',
        stderr: '',
      };
    },
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const { DelegationRunner } = await import('../src/delegation-runner.js');
  const runner = new DelegationRunner(ops);

  const manifest = createSampleManifest({
    id: 'task-e2e',
    writePaths: ['src/app.ts'],
    acceptanceCommands: ['npm test'],
  });

  const result = await runner.run(manifest);

  assert.equal(result.status, 'succeeded');
  assert.equal(result.worktreePath, expectedWorktree);
  assert.deepEqual(result.changedFiles, ['src/app.ts']);
  assert.equal(result.acceptanceResults.length, 1);
  assert.equal(result.acceptanceResults[0].passed, true);

  // Verify full call sequence:
  // 1. git worktree add
  // 2. git diff --name-only
  // 3. powershell.exe acceptance
  // 4. git worktree remove --force
  assert.equal(recordedExecCalls.length, 4);
  assert.deepEqual(recordedExecCalls[0], {
    file: 'git',
    args: ['worktree', 'add', '--detach', expectedWorktree, 'HEAD'],
    options: { cwd: repoRoot },
  });
  assert.deepEqual(recordedExecCalls[1], {
    file: 'git',
    args: ['diff', '--name-only'],
    options: { cwd: expectedWorktree },
  });
  assert.deepEqual(recordedExecCalls[2], {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', 'npm test'],
    options: { cwd: expectedWorktree },
  });
  assert.deepEqual(recordedExecCalls[3], {
    file: 'git',
    args: ['worktree', 'remove', '--force', expectedWorktree],
    options: { cwd: repoRoot },
  });
});

test('Integration with DelegationRunner: complete successful flow with Cline executor', async () => {
  const recordedExecCalls: Array<{ file: string; args: string[]; options?: { cwd?: string } }> = [];
  const recordedSpawnCalls: Array<{ command: string; args: string[]; options: { cwd: string } }> = [];
  const repoRoot = path.resolve('repo');
  const worktreeRoot = path.resolve('worktrees');
  const expectedWorktree = path.resolve(worktreeRoot, 'task-cline-e2e');

  const config: NodeDelegationOpsConfig = {
    repositoryRoot: repoRoot,
    worktreeRoot: worktreeRoot,
    agyExecutable: 'agy.cmd',
    clineEntrypoint: 'C:\\tools\\cline\\bin\\cline',
  };

  const dependencies: NodeDelegationDependencies = {
    execFile: async (file, args, options) => {
      recordedExecCalls.push({ file, args, options });
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (file === 'git' && args[0] === 'diff') {
        return { stdout: 'src/cline-patch.ts\n', stderr: '', exitCode: 0 };
      }
      if (file === 'powershell.exe') {
        return { stdout: 'All tests passed', stderr: '', exitCode: 0 };
      }
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      throw new Error(`Unexpected execFile: ${file} ${args.join(' ')}`);
    },
    spawnProvider: async (cmd, args, opts) => {
      recordedSpawnCalls.push({ command: cmd, args, options: opts });
      return {
        exitCode: 0,
        stdout: 'Cline execution completed successfully',
        stderr: '',
      };
    },
  };

  const ops = createNodeDelegationOps(config, dependencies);
  const { DelegationRunner } = await import('../src/delegation-runner.js');
  const runner = new DelegationRunner(ops);

  const manifest = createSampleManifest({
    id: 'task-cline-e2e',
    prompt: 'Implement cline bridge integration',
    writePaths: ['src/cline-patch.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 240,
    executor: 'cline',
  });

  const result = await runner.run(manifest);

  assert.equal(result.status, 'succeeded');
  assert.equal(result.worktreePath, expectedWorktree);
  assert.deepEqual(result.changedFiles, ['src/cline-patch.ts']);
  assert.equal(result.acceptanceResults.length, 1);
  assert.equal(result.acceptanceResults[0].passed, true);

  assert.equal(recordedSpawnCalls.length, 1);
  assert.deepEqual(recordedSpawnCalls[0], {
    command: process.execPath,
    args: [
      'C:\\tools\\cline\\bin\\cline',
      '--json',
      '--auto-approve',
      'true',
      '-c',
      expectedWorktree,
      '-t',
      '240',
      'Implement cline bridge integration',
    ],
    options: { cwd: expectedWorktree },
  });

  assert.equal(recordedExecCalls.length, 4);
  assert.deepEqual(recordedExecCalls[0], {
    file: 'git',
    args: ['worktree', 'add', '--detach', expectedWorktree, 'HEAD'],
    options: { cwd: repoRoot },
  });
  assert.deepEqual(recordedExecCalls[1], {
    file: 'git',
    args: ['diff', '--name-only'],
    options: { cwd: expectedWorktree },
  });
  assert.deepEqual(recordedExecCalls[2], {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', 'npm test'],
    options: { cwd: expectedWorktree },
  });
  assert.deepEqual(recordedExecCalls[3], {
    file: 'git',
    args: ['worktree', 'remove', '--force', expectedWorktree],
    options: { cwd: repoRoot },
  });
});
