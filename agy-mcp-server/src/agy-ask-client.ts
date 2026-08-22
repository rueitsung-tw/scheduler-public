import { spawn } from 'node:child_process';

export interface AgyAskParams {
  prompt: string;
  workspace?: 'auto' | 'none';
  timeout?: number;
  add_dir?: string[];
}

export interface AgyAskRequest {
  prompt: string;
  workspace: 'auto' | 'none';
  timeout: number;
  addDirs: string[];
}

export type AgyAskRunner = (request: AgyAskRequest) => Promise<string>;

export function buildUtf8PythonEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
}

const PYTHON = 'C:\\Users\\rueit\\AppData\\Local\\agy-headless-bridge\\venv\\Scripts\\python.exe';
const BRIDGE_PROGRAM = [
  'import json, os, sys',
  'from agy_headless_bridge.bridge import run',
  'prompt, workspace, add_dirs_json, timeout = sys.argv[1:5]',
  'add_dirs = json.loads(add_dirs_json)',
  'add_dirs = add_dirs or ([os.getcwd()] if workspace == "auto" else [])',
  'print(run(prompt, timeout=float(timeout), add_dirs=add_dirs))',
].join('; ');

export class AgyAskClient {
  constructor(private readonly runner: AgyAskRunner = runFreshAgyBridge) {}

  async ask(params: AgyAskParams): Promise<string> {
    if (!params.prompt.trim()) throw new Error('prompt is required');
    const timeout = params.timeout ?? 600;
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 3600) {
      throw new Error('timeout must be an integer between 1 and 3600');
    }
    return this.runner({
      prompt: params.prompt,
      workspace: params.workspace ?? 'auto',
      timeout,
      addDirs: params.add_dir ?? [],
    });
  }
}

async function runFreshAgyBridge(request: AgyAskRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [
      '-c', BRIDGE_PROGRAM,
      request.prompt,
      request.workspace,
      JSON.stringify(request.addDirs),
      String(request.timeout),
    ], {
      cwd: process.cwd(),
      env: buildUtf8PythonEnv(process.env),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `AGY bridge exited with code ${code}`).trim()));
        return;
      }
      const text = stdout.trim();
      if (!text) reject(new Error('AGY bridge returned no output'));
      else resolve(text);
    });
  });
}
