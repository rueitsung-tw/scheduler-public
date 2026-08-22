import type { DelegationRunResult } from './delegation-runner.js';
import { parseTaskManifest, type TaskManifest } from './task-manifest.js';

export type RunnerFactory = (manifest: TaskManifest) => {
  run: (manifest: TaskManifest) => Promise<DelegationRunResult>;
};

export type IdGenerator = () => string;
export type CancelProvider = (runId: string) => Promise<void> | void;
export type SleepFn = (ms: number) => Promise<void>;

export interface ManagedDelegationOptions {
  runnerFactory?: RunnerFactory;
  idGenerator?: IdGenerator;
  cancelProvider?: CancelProvider;
  sleep?: SleepFn;
  pollIntervalMs?: number;
}

export interface ManagedRunSubmitResult {
  runId: string;
  status: string;
}

export interface ManagedRunStatus {
  runId: string;
  status: string;
  result?: DelegationRunResult | null;
  error?: string;
}

interface ManagedRunState {
  runId: string;
  manifest: TaskManifest;
  status: string;
  isTerminal: boolean;
  terminalResult: DelegationRunResult | null;
  error: string | null;
}

export class ManagedDelegationService {
  private readonly runs = new Map<string, ManagedRunState>();
  private readonly runnerFactory?: RunnerFactory;
  private readonly idGenerator: IdGenerator;
  private readonly cancelProvider?: CancelProvider;
  private readonly sleep: SleepFn;
  private readonly pollIntervalMs: number;

  constructor(options: ManagedDelegationOptions = {}) {
    this.runnerFactory = options.runnerFactory;
    let defaultCounter = 0;
    this.idGenerator = options.idGenerator ?? (() => `run-${++defaultCounter}`);
    this.cancelProvider = options.cancelProvider;
    this.sleep =
      options.sleep ??
      ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
  }

  /**
   * Submits a new task delegation.
   * Validates rawManifest with parseTaskManifest, generates a unique runId,
   * starts execution asynchronously, and immediately returns { runId, status }.
   *
   * @param rawManifest The unvalidated manifest object
   * @returns Object containing runId and initial status
   */
  submit(rawManifest: unknown): ManagedRunSubmitResult {
    const manifest = parseTaskManifest(rawManifest);
    const runId = this.idGenerator();

    if (this.runs.has(runId)) {
      throw new Error(`Run ID collision: ${runId}`);
    }

    if (!this.runnerFactory) {
      throw new Error('runnerFactory is required to submit tasks');
    }

    const runState: ManagedRunState = {
      runId,
      manifest,
      status: 'RUNNING',
      isTerminal: false,
      terminalResult: null,
      error: null,
    };

    this.runs.set(runId, runState);

    const runner = this.runnerFactory(manifest);

    try {
      const runPromise = Promise.resolve(runner.run(manifest));
      runPromise
        .then(result => {
          if (runState.isTerminal) {
            return;
          }
          runState.terminalResult = Object.freeze({ ...result });
          runState.status = result.status;
          runState.isTerminal = true;
        })
        .catch((err: unknown) => {
          if (runState.isTerminal) {
            return;
          }
          const errorMessage = err instanceof Error ? err.message : String(err);
          const failureResult: DelegationRunResult = {
            status: 'provider_failure',
            reason: 'provider_failure',
            worktreePath: '',
            changedFiles: [],
            acceptanceResults: [],
            acceptance: [],
            stdout: '',
            stderr: errorMessage,
          };
          runState.terminalResult = Object.freeze(failureResult);
          runState.status = 'provider_failure';
          runState.error = errorMessage;
          runState.isTerminal = true;
        });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const failureResult: DelegationRunResult = {
        status: 'provider_failure',
        reason: 'provider_failure',
        worktreePath: '',
        changedFiles: [],
        acceptanceResults: [],
        acceptance: [],
        stdout: '',
        stderr: errorMessage,
      };
      runState.terminalResult = Object.freeze(failureResult);
      runState.status = 'provider_failure';
      runState.error = errorMessage;
      runState.isTerminal = true;
    }

    return {
      runId,
      status: 'RUNNING',
    };
  }

  /**
   * Retrieves the current status of a run.
   *
   * @param runId The run identifier
   * @returns ManagedRunStatus or null if unknown
   */
  status(runId: string): ManagedRunStatus | null {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }
    return {
      runId: run.runId,
      status: run.status,
      ...(run.terminalResult ? { result: run.terminalResult } : {}),
      ...(run.error ? { error: run.error } : {}),
    };
  }

  /**
   * Waits for a run to reach a terminal state or until timeoutSeconds elapses.
   * Polls through the injected sleep function.
   *
   * @param runId The run identifier
   * @param timeoutSeconds Maximum wait duration in seconds
   * @returns ManagedRunStatus or null if unknown
   */
  async wait(runId: string, timeoutSeconds?: number): Promise<ManagedRunStatus | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    if (run.isTerminal) {
      return this.status(runId);
    }

    const timeoutSec = timeoutSeconds ?? 60;
    if (timeoutSec <= 0) {
      return this.status(runId);
    }

    const maxWaitMs = timeoutSec * 1000;
    const pollIntervalMs = this.pollIntervalMs;
    let elapsedMs = 0;
    const startRealTime = Date.now();

    while (!run.isTerminal) {
      if (elapsedMs >= maxWaitMs || Date.now() - startRealTime >= maxWaitMs) {
        break;
      }
      const sleepDuration = Math.min(pollIntervalMs, maxWaitMs - elapsedMs);
      await this.sleep(sleepDuration);
      elapsedMs += sleepDuration;
    }

    return this.status(runId);
  }

  /**
   * Retrieves the immutable terminal result of a completed or cancelled run.
   *
   * @param runId The run identifier
   * @returns DelegationRunResult or null if unfinished or unknown
   */
  result(runId: string): DelegationRunResult | null {
    const run = this.runs.get(runId);
    if (!run || !run.isTerminal) {
      return null;
    }
    return run.terminalResult;
  }

  /**
   * Cancels an unfinished run.
   * Marks the run cancelled, sets its immutable terminal result,
   * and invokes the cancelProvider hook if configured.
   *
   * @param runId The run identifier
   * @returns true if cancelled, false if unknown or already terminal
   */
  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) {
      return false;
    }
    if (run.isTerminal) {
      return false;
    }

    const cancelledResult: DelegationRunResult = {
      status: 'cancelled',
      reason: 'cancelled',
      worktreePath: '',
      changedFiles: [],
      acceptanceResults: [],
      acceptance: [],
      stdout: '',
      stderr: 'Delegation was cancelled',
    };

    run.terminalResult = Object.freeze(cancelledResult);
    run.status = 'cancelled';
    run.isTerminal = true;

    if (this.cancelProvider) {
      try {
        const res = this.cancelProvider(runId);
        if (res && typeof (res as Promise<void>).catch === 'function') {
          (res as Promise<void>).catch(() => {});
        }
      } catch {
        // Safe execution of cancel provider hook
      }
    }

    return true;
  }
}
