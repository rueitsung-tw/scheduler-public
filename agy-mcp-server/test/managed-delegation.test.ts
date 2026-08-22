import assert from 'node:assert/strict';
import test from 'node:test';

import type { DelegationRunResult } from '../src/delegation-runner.js';
import {
  ManagedDelegationService,
  type RunnerFactory,
} from '../src/managed-delegation.js';
import type { TaskManifest } from '../src/task-manifest.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

function createValidManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-101',
    prompt: 'Fix authentication token expiry',
    readPaths: ['src/auth.ts'],
    writePaths: ['src/auth.ts'],
    acceptanceCommands: ['npm test'],
    timeoutSeconds: 60,
    maxRetries: 1,
    executor: 'agy',
    ...overrides,
  };
}

function createSuccessResult(overrides: Partial<DelegationRunResult> = {}): DelegationRunResult {
  return {
    status: 'succeeded',
    reason: 'succeeded',
    worktreePath: '/worktrees/task-101',
    changedFiles: ['src/auth.ts'],
    acceptanceResults: [
      {
        command: 'npm test',
        exitCode: 0,
        stdout: 'All tests passed',
        stderr: '',
        passed: true,
      },
    ],
    stdout: 'Task completed successfully',
    stderr: '',
    ...overrides,
  };
}

test('ManagedDelegationService - successful lifecycle', async () => {
  let resolveRunner!: (result: DelegationRunResult) => void;
  const runnerPromise = new Promise<DelegationRunResult>(resolve => {
    resolveRunner = resolve;
  });

  const executedManifests: TaskManifest[] = [];
  const runnerFactory: RunnerFactory = manifest => {
    executedManifests.push(manifest);
    return {
      run: async () => runnerPromise,
    };
  };

  const idGenerator = () => 'test-run-lifecycle-001';
  const service = new ManagedDelegationService({
    runnerFactory,
    idGenerator,
  });

  const rawManifest = createValidManifest();

  // 1. Submit returns immediately with unique runId and RUNNING status
  const submitResult = service.submit(rawManifest);
  assert.deepEqual(submitResult, {
    runId: 'test-run-lifecycle-001',
    status: 'RUNNING',
  });

  // Check that runner was invoked with parsed manifest
  assert.equal(executedManifests.length, 1);
  assert.equal(executedManifests[0].id, 'task-101');

  // 2. Status while running
  const runningStatus = service.status('test-run-lifecycle-001');
  assert.deepEqual(runningStatus, {
    runId: 'test-run-lifecycle-001',
    status: 'RUNNING',
  });

  // 3. Result while running is null
  assert.equal(service.result('test-run-lifecycle-001'), null);

  // 4. Resolve the runner promise
  const expectedResult = createSuccessResult();
  resolveRunner(expectedResult);

  // Allow promise microtasks to process
  await tick();

  // 5. Status after completion is succeeded with result
  const completedStatus = service.status('test-run-lifecycle-001');
  assert.equal(completedStatus?.status, 'succeeded');
  assert.deepEqual(completedStatus?.result, expectedResult);

  // 6. Result after completion
  const completedResult = service.result('test-run-lifecycle-001');
  assert.deepEqual(completedResult, expectedResult);

  // 7. Wait on already completed run returns immediately
  const waitResult = await service.wait('test-run-lifecycle-001', 5);
  assert.equal(waitResult?.status, 'succeeded');
  assert.deepEqual(waitResult?.result, expectedResult);
});

test('ManagedDelegationService - validation rejection', () => {
  let factoryCalled = false;
  const service = new ManagedDelegationService({
    runnerFactory: () => {
      factoryCalled = true;
      return { run: async () => createSuccessResult() };
    },
    idGenerator: () => 'test-run-invalid',
  });

  // Null input
  assert.throws(() => service.submit(null), /Task manifest must be a non-null object/i);

  // Non-object input
  assert.throws(() => service.submit('string-manifest'), /Task manifest must be a non-null object/i);
  assert.throws(() => service.submit([1, 2, 3]), /Task manifest must be a non-null object/i);

  // Missing id
  assert.throws(
    () => service.submit(createValidManifest({ id: '' })),
    /Invalid id/i
  );

  // Missing prompt
  assert.throws(
    () => service.submit(createValidManifest({ prompt: '   ' })),
    /Invalid prompt/i
  );

  // Path traversal in readPaths / writePaths
  assert.throws(
    () => service.submit(createValidManifest({ readPaths: ['../secret.ts'] })),
    /\.\./
  );
  assert.throws(
    () => service.submit(createValidManifest({ writePaths: ['/absolute/path.ts'] })),
    /absolute/i
  );

  // Invalid timeout bounds
  assert.throws(
    () => service.submit(createValidManifest({ timeoutSeconds: 0 })),
    /timeoutSeconds/i
  );
  assert.throws(
    () => service.submit(createValidManifest({ timeoutSeconds: 5000 })),
    /timeoutSeconds/i
  );

  // Invalid maxRetries
  assert.throws(
    () => service.submit(createValidManifest({ maxRetries: 5 })),
    /maxRetries/i
  );

  // Invalid executor
  assert.throws(
    () => service.submit(createValidManifest({ executor: 'unknown-executor' })),
    /executor/i
  );

  // Verify factory was never called for any rejected submission
  assert.equal(factoryCalled, false);
  // Verify no run was registered
  assert.equal(service.status('test-run-invalid'), null);
});

test('ManagedDelegationService - cancellation', async () => {
  const cancelCalls: string[] = [];
  const runnerPromise = new Promise<DelegationRunResult>(() => {
    // Hangs intentionally to simulate long running task
  });

  const service = new ManagedDelegationService({
    runnerFactory: () => ({
      run: async () => runnerPromise,
    }),
    idGenerator: () => 'test-run-cancel-001',
    cancelProvider: async runId => {
      cancelCalls.push(runId);
    },
  });

  const submitResult = service.submit(createValidManifest());
  assert.equal(submitResult.runId, 'test-run-cancel-001');

  // Verify running initially
  assert.equal(service.status('test-run-cancel-001')?.status, 'RUNNING');

  // Cancel the run
  const cancelled = service.cancel('test-run-cancel-001');
  assert.equal(cancelled, true);

  // cancelProvider hook was invoked
  assert.deepEqual(cancelCalls, ['test-run-cancel-001']);

  // Status is cancelled
  const statusAfterCancel = service.status('test-run-cancel-001');
  assert.equal(statusAfterCancel?.status, 'cancelled');

  // Result is cancelled terminal result
  const resultAfterCancel = service.result('test-run-cancel-001');
  assert.notEqual(resultAfterCancel, null);
  assert.equal(resultAfterCancel?.status, 'cancelled');
  assert.equal(resultAfterCancel?.reason, 'cancelled');

  // Wait on cancelled run returns cancelled status immediately
  const waitResult = await service.wait('test-run-cancel-001', 10);
  assert.equal(waitResult?.status, 'cancelled');
});

test('ManagedDelegationService - terminal immutability', async () => {
  // Case A: Cannot cancel an already completed run; terminal result is immutable
  {
    let resolveRunner!: (res: DelegationRunResult) => void;
    const runnerPromise = new Promise<DelegationRunResult>(resolve => {
      resolveRunner = resolve;
    });

    const cancelCalls: string[] = [];
    const service = new ManagedDelegationService({
      runnerFactory: () => ({ run: async () => runnerPromise }),
      idGenerator: () => 'run-immutability-completed',
      cancelProvider: runId => {
        cancelCalls.push(runId);
      },
    });

    service.submit(createValidManifest());
    const originalResult = createSuccessResult({ stdout: 'Original success output' });
    resolveRunner(originalResult);

    await tick();

    assert.equal(service.status('run-immutability-completed')?.status, 'succeeded');

    // Attempting to cancel an already completed run must return false
    const cancelRes = service.cancel('run-immutability-completed');
    assert.equal(cancelRes, false);
    assert.equal(cancelCalls.length, 0);

    // Status and result must remain identical to original result
    assert.equal(service.status('run-immutability-completed')?.status, 'succeeded');
    assert.deepEqual(service.result('run-immutability-completed'), originalResult);
  }

  // Case B: Late completion after cancellation does not overwrite cancelled result
  {
    let resolveRunner!: (res: DelegationRunResult) => void;
    const runnerPromise = new Promise<DelegationRunResult>(resolve => {
      resolveRunner = resolve;
    });

    const service = new ManagedDelegationService({
      runnerFactory: () => ({ run: async () => runnerPromise }),
      idGenerator: () => 'run-immutability-cancelled',
    });

    service.submit(createValidManifest());

    // Cancel while running
    const cancelRes = service.cancel('run-immutability-cancelled');
    assert.equal(cancelRes, true);

    const cancelledResult = service.result('run-immutability-cancelled');
    assert.equal(cancelledResult?.status, 'cancelled');

    // Runner now late-resolves with succeeded result
    resolveRunner(createSuccessResult({ stdout: 'Late success that should be ignored' }));

    await tick();

    // Result must NOT be overwritten
    assert.equal(service.status('run-immutability-cancelled')?.status, 'cancelled');
    assert.deepEqual(service.result('run-immutability-cancelled'), cancelledResult);

    // Second cancel call on already-cancelled run must return false
    assert.equal(service.cancel('run-immutability-cancelled'), false);
  }
});

test('ManagedDelegationService - unknown run', async () => {
  const service = new ManagedDelegationService({
    runnerFactory: () => ({ run: async () => createSuccessResult() }),
  });

  // status of unknown run returns null
  assert.equal(service.status('non-existent-id'), null);

  // result of unknown run returns null
  assert.equal(service.result('non-existent-id'), null);

  // cancel of unknown run returns false
  assert.equal(service.cancel('non-existent-id'), false);

  // wait of unknown run returns null immediately without waiting
  let sleepCalled = false;
  const serviceWithSleepCheck = new ManagedDelegationService({
    runnerFactory: () => ({ run: async () => createSuccessResult() }),
    sleep: async () => {
      sleepCalled = true;
    },
  });

  const waitRes = await serviceWithSleepCheck.wait('non-existent-id', 10);
  assert.equal(waitRes, null);
  assert.equal(sleepCalled, false);
});

test('ManagedDelegationService - wait timeout and polling', async () => {
  // 1. Wait with timeout of 2 seconds (4 poll steps of 500ms)
  const pendingPromise1 = new Promise<DelegationRunResult>(() => {});
  const sleepDurations1: number[] = [];
  const fakeSleep1 = async (ms: number) => {
    sleepDurations1.push(ms);
  };

  const service1 = new ManagedDelegationService({
    runnerFactory: () => ({ run: async () => pendingPromise1 }),
    idGenerator: () => 'run-wait-timeout-001',
    sleep: fakeSleep1,
    pollIntervalMs: 500,
  });

  service1.submit(createValidManifest());

  const timeoutWaitResult = await service1.wait('run-wait-timeout-001', 2);
  assert.deepEqual(timeoutWaitResult, {
    runId: 'run-wait-timeout-001',
    status: 'RUNNING',
  });

  // Verify fake sleep was called to simulate 2 seconds (4 x 500ms)
  assert.deepEqual(sleepDurations1, [500, 500, 500, 500]);
  assert.equal(service1.result('run-wait-timeout-001'), null);

  // 2. Resolve runner during wait
  let resolveRunner2!: (res: DelegationRunResult) => void;
  const runnerPromise2 = new Promise<DelegationRunResult>(resolve => {
    resolveRunner2 = resolve;
  });

  const sleepDurations2: number[] = [];
  let sleepCount = 0;
  const serviceWithMidWaitResolve = new ManagedDelegationService({
    runnerFactory: () => ({ run: async () => runnerPromise2 }),
    idGenerator: () => 'run-wait-resolve-midway',
    sleep: async ms => {
      sleepDurations2.push(ms);
      sleepCount++;
      if (sleepCount === 2) {
        resolveRunner2(createSuccessResult({ stdout: 'Finished during wait' }));
        await tick();
      }
    },
    pollIntervalMs: 250,
  });

  serviceWithMidWaitResolve.submit(createValidManifest());

  const completedWaitResult = await serviceWithMidWaitResolve.wait('run-wait-resolve-midway', 5);
  assert.equal(completedWaitResult?.status, 'succeeded');
  assert.equal(completedWaitResult?.result?.stdout, 'Finished during wait');

  // Should have exited after 2 poll iterations instead of waiting full 5 seconds
  assert.equal(sleepDurations2.length, 2);
  assert.deepEqual(sleepDurations2, [250, 250]);
});

test('ManagedDelegationService - runner failure/rejection handling', async () => {
  const service = new ManagedDelegationService({
    runnerFactory: () => ({
      run: async () => {
        throw new Error('Process spawn failed: binary not found');
      },
    }),
    idGenerator: () => 'run-rejected-001',
  });

  service.submit(createValidManifest());

  // Allow promise rejection to be handled
  await tick();

  const status = service.status('run-rejected-001');
  assert.equal(status?.status, 'provider_failure');
  assert.equal(status?.error, 'Process spawn failed: binary not found');

  const result = service.result('run-rejected-001');
  assert.notEqual(result, null);
  assert.equal(result?.status, 'provider_failure');
  assert.equal(result?.reason, 'provider_failure');
  assert.equal(result?.stderr, 'Process spawn failed: binary not found');

  // Cannot cancel a failed run
  assert.equal(service.cancel('run-rejected-001'), false);
});

test('ManagedDelegationService - multiple concurrent runs do not interfere', async () => {
  let counter = 0;
  const idGenerator = () => `run-concurrent-${++counter}`;

  const resolvers: Array<(res: DelegationRunResult) => void> = [];
  const service = new ManagedDelegationService({
    runnerFactory: () => {
      const p = new Promise<DelegationRunResult>(resolve => {
        resolvers.push(resolve);
      });
      return { run: async () => p };
    },
    idGenerator,
  });

  const run1 = service.submit(createValidManifest({ id: 'task-1' }));
  const run2 = service.submit(createValidManifest({ id: 'task-2' }));

  assert.equal(run1.runId, 'run-concurrent-1');
  assert.equal(run2.runId, 'run-concurrent-2');

  assert.equal(service.status('run-concurrent-1')?.status, 'RUNNING');
  assert.equal(service.status('run-concurrent-2')?.status, 'RUNNING');

  // Cancel run 1 only
  service.cancel('run-concurrent-1');
  assert.equal(service.status('run-concurrent-1')?.status, 'cancelled');
  assert.equal(service.status('run-concurrent-2')?.status, 'RUNNING');

  // Resolve run 2
  resolvers[1](createSuccessResult({ stdout: 'Run 2 succeeded' }));
  await tick();

  assert.equal(service.status('run-concurrent-1')?.status, 'cancelled');
  assert.equal(service.status('run-concurrent-2')?.status, 'succeeded');
  assert.equal(service.result('run-concurrent-2')?.stdout, 'Run 2 succeeded');
});
