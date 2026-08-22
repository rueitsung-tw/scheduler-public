import type {
  AcceptanceResult,
  DelegationRunnerOps,
  ProviderRunInput,
  ProviderRunResult,
} from './delegation-runner.js';
import type { TaskManifest } from './task-manifest.js';
import { createIsolatedWorktree } from './worktree.js';

export const DEFAULT_CLINE_ENTRYPOINT =
  'C:\\Users\\rueit\\AppData\\Roaming\\npm\\node_modules\\cline\\bin\\cline';

export interface NodeDelegationOpsConfig {
  repositoryRoot: string;
  worktreeRoot: string;
  agyExecutable: string;
  clineEntrypoint?: string;
}

export interface ExecFileResult {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
}

export interface NodeDelegationDependencies {
  execFile: (
    file: string,
    args: string[],
    options: { cwd?: string }
  ) => Promise<ExecFileResult>;
  spawnProvider: (
    command: string,
    args: string[],
    options: { cwd: string }
  ) => Promise<ProviderRunResult>;
}

export function createNodeDelegationOps(
  config: NodeDelegationOpsConfig,
  dependencies: NodeDelegationDependencies
): DelegationRunnerOps {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid config: must provide NodeDelegationOpsConfig');
  }
  if (typeof config.repositoryRoot !== 'string' || config.repositoryRoot.trim().length === 0) {
    throw new Error('Invalid repositoryRoot: must be a non-empty string');
  }
  if (typeof config.worktreeRoot !== 'string' || config.worktreeRoot.trim().length === 0) {
    throw new Error('Invalid worktreeRoot: must be a non-empty string');
  }
  if (typeof config.agyExecutable !== 'string' || config.agyExecutable.trim().length === 0) {
    throw new Error('Invalid agyExecutable: must be a non-empty string');
  }
  if (
    config.clineEntrypoint !== undefined &&
    (typeof config.clineEntrypoint !== 'string' || config.clineEntrypoint.trim().length === 0)
  ) {
    throw new Error('Invalid clineEntrypoint: must be a non-empty string');
  }
  if (!dependencies || typeof dependencies !== 'object') {
    throw new Error('Invalid dependencies: must provide NodeDelegationDependencies');
  }
  if (typeof dependencies.execFile !== 'function') {
    throw new Error('Invalid execFile: must be a function');
  }
  if (typeof dependencies.spawnProvider !== 'function') {
    throw new Error('Invalid spawnProvider: must be a function');
  }

  return {
    async createWorktree(manifest: TaskManifest): Promise<string> {
      return createIsolatedWorktree(
        async (args, repoRoot) => {
          const result = await dependencies.execFile('git', args, { cwd: repoRoot });
          if (result && typeof result.exitCode === 'number' && result.exitCode !== 0) {
            const message =
              result.stderr && result.stderr.trim().length > 0
                ? result.stderr.trim()
                : result.stdout && result.stdout.trim().length > 0
                  ? result.stdout.trim()
                  : `git ${args.join(' ')} failed with exit code ${result.exitCode}`;
            throw new Error(message);
          }
        },
        config.repositoryRoot,
        config.worktreeRoot,
        manifest.id
      );
    },
    async runProvider(input: ProviderRunInput): Promise<ProviderRunResult> {
      if (input.manifest.executor === 'cline') {
        const entrypoint =
          config.clineEntrypoint ||
          process.env.CLINE_CLI_ENTRYPOINT ||
          DEFAULT_CLINE_ENTRYPOINT;
        const args = [
          entrypoint,
          '--json',
          '--auto-approve',
          'true',
          '-c',
          input.cwd,
          '-t',
          String(input.manifest.timeoutSeconds),
          input.manifest.prompt,
        ];

        return dependencies.spawnProvider(process.execPath, args, {
          cwd: input.cwd,
        });
      }

      const args = [
        '--print',
        input.manifest.prompt,
        '--print-timeout',
        `${input.manifest.timeoutSeconds}s`,
        '--output-format',
        'json',
        '--add-dir',
        input.cwd,
        '--sandbox',
        '--dangerously-skip-permissions',
      ];

      return dependencies.spawnProvider(config.agyExecutable, args, {
        cwd: input.cwd,
      });
    },
    async listChangedFiles(cwd: string): Promise<string[]> {
      const result = await dependencies.execFile('git', ['diff', '--name-only'], {
        cwd,
      });
      const rawStdout = result?.stdout ?? '';
      return rawStdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    },
    async runAcceptance(command: string, cwd: string): Promise<AcceptanceResult> {
      try {
        const result = await dependencies.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', command],
          { cwd }
        );
        const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : 0;
        const stdout = result?.stdout ?? '';
        const stderr = result?.stderr ?? '';
        return {
          command,
          exitCode,
          stdout,
          stderr,
          passed: exitCode === 0,
        };
      } catch (error: any) {
        const exitCode =
          typeof error?.exitCode === 'number'
            ? error.exitCode
            : typeof error?.code === 'number'
              ? error.code
              : 1;
        const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
        const stderr =
          typeof error?.stderr === 'string'
            ? error.stderr
            : error?.message ?? String(error);
        return {
          command,
          exitCode,
          stdout,
          stderr,
          passed: exitCode === 0,
        };
      }
    },
    async removeWorktree(cwd: string): Promise<void> {
      const result = await dependencies.execFile(
        'git',
        ['worktree', 'remove', '--force', cwd],
        { cwd: config.repositoryRoot }
      );
      if (result && typeof result.exitCode === 'number' && result.exitCode !== 0) {
        const message =
          result.stderr && result.stderr.trim().length > 0
            ? result.stderr.trim()
            : result.stdout && result.stdout.trim().length > 0
              ? result.stdout.trim()
              : `git worktree remove failed with exit code ${result.exitCode}`;
        throw new Error(message);
      }
    },
  };
}
