import {
  classifyDelegationFailure,
  findDisallowedWrites,
  type DelegationClassificationInput,
  type DelegationFailureReason,
} from './policy.js';
import type { TaskManifest } from './task-manifest.js';

export interface ProviderRunInput {
  manifest: TaskManifest;
  cwd: string;
}

export interface ProviderRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  cancelled?: boolean;
}

export interface AcceptanceResult {
  command?: string;
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
  passed?: boolean;
}

export interface DelegationRunnerOps {
  createWorktree: (manifest: TaskManifest) => Promise<string>;
  runProvider: (input: ProviderRunInput) => Promise<ProviderRunResult>;
  listChangedFiles: (cwd: string) => Promise<string[]>;
  runAcceptance: (command: string, cwd: string) => Promise<AcceptanceResult>;
  removeWorktree: (cwd: string) => Promise<void>;
}

export type DelegationRunnerOperations = DelegationRunnerOps;

export interface DelegationRunResult {
  status: DelegationFailureReason;
  reason: DelegationFailureReason;
  worktreePath: string;
  changedFiles: string[];
  acceptanceResults: AcceptanceResult[];
  acceptance?: AcceptanceResult[];
  stdout: string;
  stderr: string;
  providerStdout?: string;
  providerStderr?: string;
}

export class DelegationRunner {
  constructor(private readonly ops: DelegationRunnerOps) {
    if (!ops || typeof ops !== 'object') {
      throw new Error('Invalid operations: must provide DelegationRunnerOps');
    }
  }

  /**
   * Executes a delegated task manifest in an isolated worktree environment.
   *
   * Flow:
   * 1. Creates a worktree via injected `createWorktree(manifest)`.
   * 2. Runs the provider via injected `runProvider({ manifest, cwd })`.
   * 3. Collects changed files via injected `listChangedFiles(cwd)`.
   * 4. Runs all acceptance commands only when provider exitCode is 0, not timed out/cancelled, and writes are allowlisted.
   * 5. Classifies outcome using `classifyDelegationFailure`.
   * 6. Preserves worktree on non-succeeded result; removes worktree only after succeeded result.
   *
   * @param manifest The validated task manifest to run
   * @returns Run outcome including status/reason, worktreePath, changedFiles, acceptanceResults, and stdout/stderr
   */
  async run(manifest: TaskManifest): Promise<DelegationRunResult> {
    const worktreePath = await this.ops.createWorktree(manifest);

    const providerResult = await this.ops.runProvider({
      manifest,
      cwd: worktreePath,
    });

    const stdout = providerResult?.stdout ?? '';
    const stderr = providerResult?.stderr ?? '';
    const exitCode = providerResult?.exitCode ?? null;
    const timedOut = Boolean(providerResult?.timedOut);
    const cancelled = Boolean(providerResult?.cancelled);

    const changedFiles = await this.ops.listChangedFiles(worktreePath);

    const disallowedWrites = findDisallowedWrites(
      changedFiles,
      manifest.writePaths
    );

    const shouldRunAcceptance =
      exitCode === 0 && !timedOut && !cancelled && disallowedWrites.length === 0;

    const acceptanceResults: AcceptanceResult[] = [];
    let acceptancePassed = shouldRunAcceptance;

    if (shouldRunAcceptance) {
      for (const command of manifest.acceptanceCommands) {
        const rawResult = await this.ops.runAcceptance(command, worktreePath);
        const passed = rawResult.passed ?? (rawResult.exitCode === 0);
        const recordedResult: AcceptanceResult = {
          command: rawResult.command ?? command,
          exitCode: rawResult.exitCode ?? (passed ? 0 : 1),
          stdout: rawResult.stdout ?? '',
          stderr: rawResult.stderr ?? '',
          passed,
        };
        acceptanceResults.push(recordedResult);
        if (!passed) {
          acceptancePassed = false;
        }
      }
    }

    const classificationInput: DelegationClassificationInput = {
      exitCode,
      timedOut,
      cancelled,
      changedFiles,
      writePaths: manifest.writePaths,
      acceptancePassed,
    };

    const status = classifyDelegationFailure(classificationInput);

    if (status === 'succeeded') {
      await this.ops.removeWorktree(worktreePath);
    }

    return {
      status,
      reason: status,
      worktreePath,
      changedFiles,
      acceptanceResults,
      acceptance: acceptanceResults,
      stdout,
      stderr,
      providerStdout: stdout,
      providerStderr: stderr,
    };
  }
}
