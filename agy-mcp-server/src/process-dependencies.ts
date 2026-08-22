import {
  execFile as nodeExecFile,
  spawn as nodeSpawn,
  type ChildProcess,
  type ExecFileException,
} from 'node:child_process';
import type { ProviderRunResult } from './delegation-runner.js';
import type {
  ExecFileResult,
  NodeDelegationDependencies,
} from './node-delegation-ops.js';

export type ExecFileFunction = (
  file: string,
  args: string[],
  options: { cwd?: string; windowsHide?: boolean; maxBuffer?: number },
  callback: (
    error: (ExecFileException & { exitCode?: number; status?: number }) | null,
    stdout: string | Buffer,
    stderr: string | Buffer
  ) => void
) => ChildProcess | void;

export type SpawnFunction = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    stdio?: any;
    windowsHide?: boolean;
    env?: NodeJS.ProcessEnv;
  }
) => ChildProcess;

export interface ProcessDependenciesOverrides {
  execFile?: typeof nodeExecFile | ExecFileFunction;
  spawn?: typeof nodeSpawn | SpawnFunction;
}

function parseTimeoutFromArgs(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--print-timeout' && i + 1 < args.length) {
      const val = args[i + 1];
      const match = val.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
      if (match) {
        const num = parseFloat(match[1]);
        const unit = (match[2] || 's').toLowerCase();
        if (unit === 'ms') return num;
        if (unit === 's') return num * 1000;
        if (unit === 'm') return num * 60 * 1000;
        if (unit === 'h') return num * 3600 * 1000;
      }
    } else if (arg.startsWith('--print-timeout=')) {
      const val = arg.slice('--print-timeout='.length);
      const match = val.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
      if (match) {
        const num = parseFloat(match[1]);
        const unit = (match[2] || 's').toLowerCase();
        if (unit === 'ms') return num;
        if (unit === 's') return num * 1000;
        if (unit === 'm') return num * 60 * 1000;
        if (unit === 'h') return num * 3600 * 1000;
      }
    }
  }
  return undefined;
}

export function createProcessDependencies(
  overrides: ProcessDependenciesOverrides = {}
): NodeDelegationDependencies {
  const execFileFn = (overrides.execFile ?? nodeExecFile) as ExecFileFunction;
  const spawnFn = (overrides.spawn ?? nodeSpawn) as SpawnFunction;

  return {
    execFile(file: string, args: string[], options: { cwd?: string }): Promise<ExecFileResult> {
      return new Promise((resolve, reject) => {
        execFileFn(
          file,
          args,
          {
            cwd: options?.cwd,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            const stdoutStr = typeof stdout === 'string' ? stdout : stdout ? stdout.toString('utf8') : '';
            const stderrStr = typeof stderr === 'string' ? stderr : stderr ? stderr.toString('utf8') : '';

            if (error) {
              const exitCode = typeof error.code === 'number'
                ? error.code
                : typeof error.status === 'number'
                  ? error.status
                  : typeof (error as any).exitCode === 'number'
                    ? (error as any).exitCode
                    : null;

              if (exitCode !== null) {
                const errStdout = typeof (error as any).stdout === 'string'
                  ? (error as any).stdout
                  : (error as any).stdout?.toString?.('utf8') ?? '';
                const errStderr = typeof (error as any).stderr === 'string'
                  ? (error as any).stderr
                  : (error as any).stderr?.toString?.('utf8') ?? '';

                return resolve({
                  stdout: stdoutStr || errStdout,
                  stderr: stderrStr || errStderr || error.message,
                  exitCode,
                });
              }

              return reject(error);
            }

            return resolve({
              stdout: stdoutStr,
              stderr: stderrStr,
              exitCode: 0,
            });
          }
        );
      });
    },

    spawnProvider(command: string, args: string[], options: { cwd: string }): Promise<ProviderRunResult> {
      return new Promise((resolve) => {
        const timeoutMs = parseTimeoutFromArgs(args);
        let timedOut = false;
        let timeoutTimer: NodeJS.Timeout | undefined;
        let settled = false;

        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];

        const settle = (result: ProviderRunResult) => {
          if (settled) return;
          settled = true;
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }
          resolve(result);
        };

        let child: ChildProcess;
        try {
          child = spawnFn(command, args, {
            cwd: options.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          });
        } catch (err: any) {
          return settle({
            exitCode: null,
            stdout: '',
            stderr: err?.message ?? String(err),
            timedOut: false,
          });
        }

        if (timeoutMs && timeoutMs > 0) {
          timeoutTimer = setTimeout(() => {
            timedOut = true;
            try {
              child.kill('SIGTERM');
            } catch {
              // ignore
            }
          }, timeoutMs);
          if (timeoutTimer.unref) {
            timeoutTimer.unref();
          }
        }

        child.stdout?.on('data', (chunk: Buffer | string) => {
          stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        });

        child.stderr?.on('data', (chunk: Buffer | string) => {
          stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        });

        child.on('error', (err: Error) => {
          settle({
            exitCode: null,
            stdout: stdoutChunks.join(''),
            stderr: stderrChunks.join('') || err.message,
            timedOut,
          });
        });

        child.on('close', (code: number | null) => {
          settle({
            exitCode: code,
            stdout: stdoutChunks.join(''),
            stderr: stderrChunks.join(''),
            timedOut,
          });
        });
      });
    },
  };
}
