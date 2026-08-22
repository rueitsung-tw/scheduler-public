import { spawn } from 'node:child_process';

export interface ClaudeSubmitParams {
  prompt: string;
  cwd: string;
  timeout?: number;
}

export interface ClaudeRunResult {
  text: string;
  provider: 'claude-code';
  cwd: string;
}

export type ClaudeRunner = (request: ClaudeSubmitParams) => Promise<string>;

const DEFAULT_CLAUDE_ENTRYPOINT = 'C:\\Users\\rueit\\.local\\bin\\claude.exe';

export class ClaudeClient {
  constructor(private readonly runner: ClaudeRunner = runClaudeCli) {}

  async submit(params: ClaudeSubmitParams): Promise<ClaudeRunResult> {
    const text = await this.runner(params);
    return { text, provider: 'claude-code', cwd: params.cwd };
  }
}

async function runClaudeCli(request: ClaudeSubmitParams): Promise<string> {
  const entrypoint = process.env.CLAUDE_CLI_ENTRYPOINT || DEFAULT_CLAUDE_ENTRYPOINT;
  const timeout = (request.timeout || 2700) * 1000;

  return new Promise((resolve, reject) => {
    const child = spawn(entrypoint, ['-p', request.prompt, '--output-format', 'text', '--no-session-persistence'], {
      cwd: request.cwd,
      windowsHide: true,
      env: process.env,
      // Claude receives its prompt as an argument.  Leaving a writable stdin
      // pipe open makes its headless mode emit a misleading timeout warning.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude Code timeout after ${request.timeout || 2700}s`));
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Claude Code exited with code ${code}`).trim()));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
