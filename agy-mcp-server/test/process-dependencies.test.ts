import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  createProcessDependencies,
  type ExecFileFunction,
  type SpawnFunction,
} from '../src/process-dependencies.js';

class MockChildProcess extends EventEmitter {
  public stdout = new PassThrough();
  public stderr = new PassThrough();
  public pid = 9999;
  public killed = false;
  public killSignal?: string;

  kill(signal: NodeJS.Signals | string = 'SIGTERM') {
    this.killed = true;
    this.killSignal = signal;
    setImmediate(() => {
      this.emit('close', null, signal);
    });
    return true;
  }
}

test('execFile: passes arguments, cwd, and windowsHide, resolving zero exit code', async () => {
  const recordedCalls: Array<{ file: string; args: string[]; options: any }> = [];

  const mockExecFile: ExecFileFunction = (file, args, options, callback) => {
    recordedCalls.push({ file, args, options });
    setImmediate(() => {
      callback(null, 'hello stdout', 'warning stderr');
    });
  };

  const deps = createProcessDependencies({ execFile: mockExecFile });
  const result = await deps.execFile('git', ['status'], { cwd: '/my/repo' });

  assert.equal(recordedCalls.length, 1);
  assert.equal(recordedCalls[0].file, 'git');
  assert.deepEqual(recordedCalls[0].args, ['status']);
  assert.equal(recordedCalls[0].options.cwd, '/my/repo');
  assert.equal(recordedCalls[0].options.windowsHide, true);

  assert.deepEqual(result, {
    stdout: 'hello stdout',
    stderr: 'warning stderr',
    exitCode: 0,
  });
});

test('execFile: resolves nonzero exit codes rather than rejecting', async () => {
  const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
    const error: any = new Error('Command failed');
    error.code = 1;
    setImmediate(() => {
      callback(error, 'failed stdout', 'error stderr');
    });
  };

  const deps = createProcessDependencies({ execFile: mockExecFile });
  const result = await deps.execFile('powershell.exe', ['-Command', 'exit 1'], { cwd: '/worktree' });

  assert.deepEqual(result, {
    stdout: 'failed stdout',
    stderr: 'error stderr',
    exitCode: 1,
  });
});

test('execFile: resolves error object containing status or exitCode and attached buffers', async () => {
  const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
    const error: any = new Error('Command failed');
    error.status = 127;
    error.stdout = Buffer.from('buffer stdout');
    error.stderr = Buffer.from('buffer stderr');
    setImmediate(() => {
      callback(error, '', '');
    });
  };

  const deps = createProcessDependencies({ execFile: mockExecFile });
  const result = await deps.execFile('test-cmd', [], {});

  assert.deepEqual(result, {
    stdout: 'buffer stdout',
    stderr: 'buffer stderr',
    exitCode: 127,
  });
});

test('execFile: rejects system errors without numeric exit code', async () => {
  const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
    const error: any = new Error('spawn ENOENT');
    error.code = 'ENOENT';
    setImmediate(() => {
      callback(error, '', '');
    });
  };

  const deps = createProcessDependencies({ execFile: mockExecFile });
  await assert.rejects(
    async () => {
      await deps.execFile('nonexistent-binary', [], {});
    },
    /spawn ENOENT/
  );
});

test('spawnProvider: passes command, args, cwd, stdio ignore/pipe/pipe, and windowsHide', async () => {
  const recordedSpawnCalls: Array<{ command: string; args: string[]; options: any }> = [];
  let childInstance!: MockChildProcess;

  const mockSpawn: SpawnFunction = (command, args, options) => {
    recordedSpawnCalls.push({ command, args, options });
    childInstance = new MockChildProcess();
    setImmediate(() => {
      childInstance.stdout.write('provider output chunk 1\n');
      childInstance.stdout.write('provider output chunk 2\n');
      childInstance.stdout.end();
      childInstance.stderr.write('provider stderr warning\n');
      childInstance.stderr.end();
      childInstance.emit('close', 0, null);
    });
    return childInstance as any;
  };

  const deps = createProcessDependencies({ spawn: mockSpawn });
  const result = await deps.spawnProvider(
    'C:\\bin\\agy.exe',
    ['--print', 'test prompt', '--print-timeout', '120s', '--output-format', 'json'],
    { cwd: '/worktree/run-1' }
  );

  assert.equal(recordedSpawnCalls.length, 1);
  assert.equal(recordedSpawnCalls[0].command, 'C:\\bin\\agy.exe');
  assert.deepEqual(recordedSpawnCalls[0].args, [
    '--print',
    'test prompt',
    '--print-timeout',
    '120s',
    '--output-format',
    'json',
  ]);
  assert.equal(recordedSpawnCalls[0].options.cwd, '/worktree/run-1');
  assert.deepEqual(recordedSpawnCalls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(recordedSpawnCalls[0].options.windowsHide, true);

  assert.deepEqual(result, {
    exitCode: 0,
    stdout: 'provider output chunk 1\nprovider output chunk 2\n',
    stderr: 'provider stderr warning\n',
    timedOut: false,
  });
});

test('spawnProvider: reports nonzero exit code without timing out', async () => {
  const mockSpawn: SpawnFunction = () => {
    const child = new MockChildProcess();
    setImmediate(() => {
      child.stderr.write('AGY fatal error');
      child.stderr.end();
      child.stdout.end();
      child.emit('close', 1, null);
    });
    return child as any;
  };

  const deps = createProcessDependencies({ spawn: mockSpawn });
  const result = await deps.spawnProvider('agy', ['--print', 'task'], { cwd: '/cwd' });

  assert.deepEqual(result, {
    exitCode: 1,
    stdout: '',
    stderr: 'AGY fatal error',
    timedOut: false,
  });
});

test('spawnProvider: honors manifest timeout encoded in AGY args and kills process', async () => {
  let childInstance!: MockChildProcess;

  const mockSpawn: SpawnFunction = () => {
    childInstance = new MockChildProcess();
    // Do not emit close immediately; let timeout trigger kill
    return childInstance as any;
  };

  const deps = createProcessDependencies({ spawn: mockSpawn });
  const resultPromise = deps.spawnProvider(
    'agy',
    ['--print', 'long task', '--print-timeout', '50ms'],
    { cwd: '/cwd' }
  );

  const result = await resultPromise;

  assert.equal(childInstance.killed, true);
  assert.equal(childInstance.killSignal, 'SIGTERM');
  assert.equal(result.timedOut, true);
});

test('spawnProvider: handles child process error event gracefully', async () => {
  const mockSpawn: SpawnFunction = () => {
    const child = new MockChildProcess();
    setImmediate(() => {
      child.emit('error', new Error('Failed to launch AGY binary'));
    });
    return child as any;
  };

  const deps = createProcessDependencies({ spawn: mockSpawn });
  const result = await deps.spawnProvider('agy', ['--print', 'task'], { cwd: '/cwd' });

  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /Failed to launch AGY binary/);
  assert.equal(result.timedOut, false);
});

test('spawnProvider: handles synchronous spawn exception gracefully', async () => {
  const mockSpawn: SpawnFunction = () => {
    throw new Error('EPERM: operation not permitted');
  };

  const deps = createProcessDependencies({ spawn: mockSpawn });
  const result = await deps.spawnProvider('agy', ['--print', 'task'], { cwd: '/cwd' });

  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /EPERM/);
  assert.equal(result.timedOut, false);
});
