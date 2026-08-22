import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export interface ClineSubmitParams {
  prompt: string;
  cwd: string;
  timeout?: number;
}

export interface ClineRunResult {
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
  timeoutType?: 'OUTER_TIMEOUT' | 'INNER_TIMEOUT';
  summary: string;
  changedFiles: string[];
}

export interface ClineRunRequest {
  prompt: string;
  cwd: string;
  timeout: number;
}

export type ClineRunner = (request: ClineRunRequest) => Promise<{ text: string; changedFiles: string[] }>;

const DEFAULT_CLINE_ENTRYPOINT = 'C:\\Users\\rueit\\AppData\\Roaming\\npm\\node_modules\\cline\\bin\\cline';

export class ClineClient {
  constructor(private readonly runner: ClineRunner = runClineCli) {}

  async submit(params: ClineSubmitParams): Promise<ClineRunResult> {
    if (!params.prompt.trim()) throw new Error('prompt is required');
    if (!isAbsolute(params.cwd)) throw new Error('cwd must be an absolute path');

    const timeout = params.timeout ?? 2700;
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2700) {
      throw new Error('timeout must be an integer between 1 and 2700');
    }

    try {
      const result = await this.runner({ prompt: params.prompt, cwd: params.cwd, timeout });
      return { status: 'SUCCEEDED', summary: extractFinalText(result.text), changedFiles: result.changedFiles };
    } catch (error) {
      if (error instanceof ClineTimeoutError) {
        return { status: 'TIMED_OUT', timeoutType: error.timeoutType, summary: error.message, changedFiles: [] };
      }
      return { status: 'FAILED', summary: error instanceof Error ? error.message : String(error), changedFiles: [] };
    }
  }
}

export class ClineTimeoutError extends Error {
  constructor(public readonly timeoutType: 'OUTER_TIMEOUT' | 'INNER_TIMEOUT', message: string) {
    super(message);
    this.name = 'ClineTimeoutError';
  }
}

function extractFinalText(output: string): string {
  for (const line of output.split(/\r?\n/).reverse()) {
    try {
      const event = JSON.parse(line) as { type?: string; text?: unknown };
      if (event.type === 'run_result' && typeof event.text === 'string') return event.text;
    } catch {
      // Non-JSON output is retained as a fallback below.
    }
  }
  return output;
}

async function runClineCli(request: ClineRunRequest): Promise<{ text: string; changedFiles: string[] }> {
  const entrypoint = process.env.CLINE_CLI_ENTRYPOINT || DEFAULT_CLINE_ENTRYPOINT;
  if (!existsSync(entrypoint)) {
    throw new Error(`Cline CLI entry point is unavailable to the MCP host: ${entrypoint}`);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [
      entrypoint,
      '--json',
      '--auto-approve', 'true',
      '-c', request.cwd,
      '-t', String(request.timeout),
      request.prompt,
    ], { cwd: request.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new ClineTimeoutError('OUTER_TIMEOUT', `Cline outer timeout after ${request.timeout}s`));
    }, request.timeout * 1000);
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const message = (stderr || stdout || `Cline exited with code ${code}`).trim();
        if (/timeout|timed out/i.test(message)) {
          reject(new ClineTimeoutError('INNER_TIMEOUT', message));
        } else {
          reject(new Error(message));
        }
        return;
      }
      resolve({ text: stdout.trim().slice(-12000), changedFiles: [] });
    });
  });
}
