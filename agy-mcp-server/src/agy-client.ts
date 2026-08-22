/**
 * AGY Client - Core logic for invoking and managing agy.exe processes
 */

import { spawn, ChildProcess } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import {
  AgyRun,
  AgyRunStatus,
  AgyResult,
  AgyConfig,
  AgySubmitParams,
} from './types';

/**
 * Manages AGY agent runs
 */
export class AgyClient {
  private config: AgyConfig;
  private runs: Map<string, AgyRun> = new Map();
  private processes: Map<string, ChildProcess> = new Map();

  constructor(config: AgyConfig) {
    this.config = config;
    this.ensureRunsDir();
    this.restoreRunsFromDisk();
  }

  /**
   * Ensure the runs directory exists
   */
  private ensureRunsDir(): void {
    if (!existsSync(this.config.runsDir)) {
      mkdirSync(this.config.runsDir, { recursive: true });
    }
  }

  /**
   * Restore existing runs from disk state
   */
  private restoreRunsFromDisk(): void {
    try {
      const indexFile = join(this.config.runsDir, 'runs.index.json');
      if (existsSync(indexFile)) {
        const index = JSON.parse(readFileSync(indexFile, 'utf-8'));
        for (const run of index.runs || []) {
          this.runs.set(run.runId, run);
        }
      }
    } catch {
      // Ignore restore errors - start fresh
    }
  }

  /**
   * Persist runs index to disk
   */
  private persistRunsIndex(): void {
    const indexFile = join(this.config.runsDir, 'runs.index.json');
    const index = {
      updatedAt: new Date().toISOString(),
      runs: Array.from(this.runs.values()),
    };
    writeFileSync(indexFile, JSON.stringify(index, null, 2));
  }

  /**
   * Generate a unique run ID
   */
  private generateRunId(taskId?: string): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    const taskPrefix = taskId ? `-${taskId.toUpperCase().slice(0, 8)}` : '';
    return `AGY-${timestamp}${taskPrefix}-${random}`;
  }

  /**
   * Save run state to disk
   */
  private saveRunState(run: AgyRun): void {
    const runDir = run.runDir;
    if (!existsSync(runDir)) {
      mkdirSync(runDir, { recursive: true });
    }

    const stateFile = join(runDir, 'state.json');
    writeFileSync(stateFile, JSON.stringify(run, null, 2));
    this.persistRunsIndex();
  }

  /**
   * Load run state from disk
   */
  private loadRunState(runId: string): AgyRun | null {
    const run = this.runs.get(runId);
    if (!run) return null;

    const stateFile = join(run.runDir, 'state.json');
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      this.runs.set(runId, state);
      return state;
    }
    return run;
  }

  /**
   * Submit a new task to AGY
   */
  async submit(params: AgySubmitParams): Promise<AgyRun> {
    // Check concurrent run limit
    const runningCount = Array.from(this.runs.values()).filter(
      r => r.status === 'RUNNING'
    ).length;
    if (runningCount >= this.config.maxConcurrentRuns) {
      throw new Error(
        `Maximum concurrent runs (${this.config.maxConcurrentRuns}) reached. ` +
        `Currently running: ${runningCount}`
      );
    }

    // Parse manifest if provided
    let taskId: string | undefined;
    let prompt: string | undefined = params.prompt;
    let acceptanceCommands: string[] | undefined;
    let readPaths: string[] | undefined;
    let writePaths: string[] | undefined;

    if (params.manifest) {
      const manifestPath = resolve(params.manifest);
      if (!existsSync(manifestPath)) {
        throw new Error(`Manifest file not found: ${manifestPath}`);
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      taskId = manifest.taskId || manifest.id;
      prompt = prompt || manifest.prompt || manifest.task;
      acceptanceCommands = manifest.acceptanceCommands;
      readPaths = manifest.readPaths;
      writePaths = manifest.writePaths;
    }

    if (!prompt) {
      throw new Error('Either manifest with prompt/task, or inline prompt is required');
    }

    // Create run
    const runId = this.generateRunId(taskId);
    const runDir = join(this.config.runsDir, runId);
    if (!existsSync(runDir)) {
      mkdirSync(runDir, { recursive: true });
    }

    // Write prompt to file
    const promptFile = join(runDir, 'prompt.txt');
    writeFileSync(promptFile, prompt);

    // Write manifest reference
    const manifestRef = join(runDir, 'manifest.json');
    writeFileSync(
      manifestRef,
      JSON.stringify({
        taskId: taskId || runId,
        prompt,
        acceptanceCommands,
        readPaths,
        writePaths,
        submittedAt: new Date().toISOString(),
        timeout: params.timeout || this.config.defaultTimeout,
        cwd: params.cwd,
        worktreePath: params.worktreePath,
        branch: params.branch,
      }, null, 2)
    );

    // Create run record
    const run: AgyRun = {
      runId,
      taskId: taskId || runId,
      status: 'PENDING',
      startedAt: new Date().toISOString(),
      runDir,
      manifestPath: params.manifest || manifestRef,
      result: undefined,
      error: undefined,
    };

    this.runs.set(runId, run);
    this.saveRunState(run);

    // Launch AGY process
    this.launchAgyProcess(run, prompt, params);

    return run;
  }

  /**
   * Launch the AGY process for a run
   */
  private launchAgyProcess(
    run: AgyRun,
    prompt: string,
    params: AgySubmitParams
  ): void {
    const runDir = run.runDir;
    const stdoutFile = join(runDir, 'stdout.log');
    const stderrFile = join(runDir, 'stderr.log');

    // Update status to RUNNING
    run.status = 'RUNNING';
    this.saveRunState(run);

    // AGY's non-interactive interface takes the prompt as --print and uses
    // Go duration syntax for --print-timeout (for example, "600s").
    const timeout = params.timeout || this.config.defaultTimeout;
    const resultFile = join(runDir, 'result.json');
    const cwd = params.worktreePath || params.cwd || process.cwd();
    const args = [
      '--print', prompt,
      '--print-timeout', `${timeout}s`,
      '--output-format', 'json',
      '--add-dir', cwd,
      '--dangerously-skip-permissions',
    ];
    const env = {
      ...process.env,
      ...(params.env || {}),
      AGY_RUN_ID: run.runId,
      AGY_RUN_DIR: runDir,
    };

    const child = spawn(this.config.exePath, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Capture stdout and stderr
    writeFileSync(stdoutFile, '');
    writeFileSync(stderrFile, '');

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        appendFileSync(stdoutFile, data);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        appendFileSync(stderrFile, data);
      });
    }

    // Track the process
    this.processes.set(run.runId, child);
    run.pid = child.pid;
    this.saveRunState(run);

    // Handle process exit
    child.on('close', (code) => {
      this.processes.delete(run.runId);
      this.handleProcessExit(run, code, resultFile);
    });

    child.on('error', (error) => {
      this.processes.delete(run.runId);
      run.status = 'FAILED';
      run.error = error.message;
      run.completedAt = new Date().toISOString();
      this.saveRunState(run);
    });

    // Set timeout
    setTimeout(() => {
      if (run.status === 'RUNNING') {
        this.cancel(run.runId);
        run.status = 'TIMED_OUT';
        run.error = `Timeout after ${timeout} seconds`;
        run.completedAt = new Date().toISOString();
        this.saveRunState(run);
      }
    }, timeout * 1000);
  }

  /**
   * Handle process exit and generate result
   */
  private handleProcessExit(
    run: AgyRun,
    exitCode: number | null,
    resultFile: string
  ): void {
    run.completedAt = new Date().toISOString();

    // Try to load AGY's result file
    let result: AgyResult | undefined;
    if (existsSync(resultFile)) {
      try {
        const raw = JSON.parse(readFileSync(resultFile, 'utf-8'));
        result = {
          runId: run.runId,
          taskId: run.taskId,
          provider: 'agy',
          status: exitCode === 0 ? 'SUCCEEDED' : 'FAILED',
          summary: raw.summary || raw.message || '',
          changedFiles: raw.changedFiles || [],
          tests: raw.tests,
          acceptance: raw.acceptance,
          risks: raw.risks || [],
          commit: raw.commit,
        };
      } catch {
        // Fall back to stdout parsing
      }
    }

    // If no result file, parse stdout for basic info
    if (!result) {
      const stdoutFile = join(run.runDir, 'stdout.log');
      let stdout = '';
      if (existsSync(stdoutFile)) {
        stdout = readFileSync(stdoutFile, 'utf-8');
      }

      const agyOutput = parseAgyOutput(stdout);
      result = {
        runId: run.runId,
        taskId: run.taskId,
        provider: 'agy',
        status: exitCode === 0 && (!agyOutput.status || agyOutput.status === 'SUCCESS') ? 'SUCCEEDED' : 'FAILED',
        summary: truncate(agyOutput.summary || stdout, 500),
        changedFiles: extractChangedFiles(stdout),
        risks: agyOutput.error ? [agyOutput.error] : [],
      };
    }

    run.result = result;
    run.status = result.status;

    // Save result
    const resultOutput = join(run.runDir, 'result.json');
    writeFileSync(resultOutput, JSON.stringify(result, null, 2));
    this.saveRunState(run);
  }

  /**
   * Get the status of a run
   */
  getStatus(runId: string): AgyRun | null {
    const run = this.loadRunState(runId);
    if (!run) return null;

    // Check if process is still running
    if (run.status === 'RUNNING') {
      const proc = this.processes.get(runId);
      if (!proc) {
        // Process may have exited without triggering close event
        run.status = 'FAILED';
        run.error = 'Process disappeared';
        run.completedAt = new Date().toISOString();
        this.saveRunState(run);
      }
    }

    return run;
  }

  /**
   * Wait for a run to complete
   */
  async wait(runId: string, timeoutSeconds: number = 600): Promise<AgyRun | null> {
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      const run = this.getStatus(runId);
      if (!run) return null;

      if (run.status === 'SUCCEEDED' || run.status === 'FAILED' ||
          run.status === 'TIMED_OUT' || run.status === 'CANCELLED') {
        return run;
      }

      // Sleep 1 second
      await sleep(1000);
    }

    return this.getStatus(runId);
  }

  /**
   * Get the result of a completed run
   */
  getResult(runId: string): AgyResult | null {
    const run = this.getStatus(runId);
    if (!run) return null;
    return run.result || null;
  }

  /**
   * Cancel a running run
   */
  cancel(runId: string): boolean {
    const proc = this.processes.get(runId);
    if (!proc) {
      // Already finished or not found
      const run = this.runs.get(runId);
      if (run) {
        run.status = 'CANCELLED';
        run.completedAt = new Date().toISOString();
        this.saveRunState(run);
      }
      return false;
    }

    // Kill the process
    try {
      proc.kill('SIGTERM');
      // Force kill after 5 seconds
      setTimeout(() => {
        if (!proc.killed) {
          try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }, 5000);
    } catch {
      // Ignore kill errors
    }

    const run = this.runs.get(runId);
    if (run) {
      run.status = 'CANCELLED';
      run.completedAt = new Date().toISOString();
      this.saveRunState(run);
    }

    return true;
  }

  /**
   * List all runs
   */
  list(status?: AgyRunStatus, limit: number = 50): AgyRun[] {
    let runs = Array.from(this.runs.values());

    if (status) {
      runs = runs.filter(r => r.status === status);
    }

    // Sort by startedAt descending
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    return runs.slice(0, limit);
  }

  /**
   * Get config
   */
  getConfig(): AgyConfig {
    return { ...this.config };
  }
}

// ── Helpers ──

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Truncate a string to max length
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '... [truncated]';
}

/**
 * Extract changed files from stdout output
 */
function extractChangedFiles(stdout: string): string[] {
  const files: string[] = [];
  const patterns = [
    /(?:modified|created|deleted|written):\s*([\w./-]+)/gi,
    /file:\s*([\w./-]+)/gi,
    /changed\s+"([^"]+)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(stdout)) !== null) {
      const file = match[1];
      if (!files.includes(file)) {
        files.push(file);
      }
    }
  }

  return files;
}

function parseAgyOutput(stdout: string): { status?: string; summary?: string; error?: string } {
  try {
    const output = JSON.parse(stdout);
    return {
      status: typeof output.status === 'string' ? output.status : undefined,
      summary: typeof output.response === 'string' ? output.response : undefined,
      error: typeof output.error === 'string' ? output.error : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Default AGY configuration
 */
export function getDefaultConfig(override?: Partial<AgyConfig>): AgyConfig {
  return {
    exePath: override?.exePath || process.env.AGY_EXE_PATH || 'C:\\Users\\rueit\\AppData\\Local\\agy\\bin\\agy.exe',
    defaultTimeout: override?.defaultTimeout || 3600,
    runsDir: override?.runsDir || join(process.cwd(), '.agy-runs'),
    maxConcurrentRuns: override?.maxConcurrentRuns || 3,
    logLevel: override?.logLevel || 'info',
  };
}
