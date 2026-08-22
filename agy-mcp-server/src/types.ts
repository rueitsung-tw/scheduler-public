/**
 * Type definitions for AGY MCP Server
 */

/**
 * Represents a running AGY agent session
 */
export interface AgyRun {
  /** Unique run identifier */
  runId: string;
  /** Task identifier from the manifest */
  taskId: string;
  /** Current status of the run */
  status: AgyRunStatus;
  /** Process ID of the running AGY process */
  pid?: number;
  /** Timestamp when the run was started (ISO 8601) */
  startedAt: string;
  /** Timestamp when the run completed (ISO 8601) */
  completedAt?: string;
  /** Path to the run directory */
  runDir: string;
  /** Path to the manifest file */
  manifestPath: string;
  /** Bounded summary of the result */
  result?: AgyResult;
  /** Error message if failed */
  error?: string;
}

/**
 * Possible statuses for an AGY run
 */
export type AgyRunStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'VALIDATING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'
  | 'BLOCKED';

/**
 * The bounded result returned by AGY
 */
export interface AgyResult {
  /** Run identifier */
  runId: string;
  /** Task identifier */
  taskId: string;
  /** Provider name */
  provider: 'agy';
  /** Final status */
  status: AgyRunStatus;
  /** Short summary of what was done */
  summary: string;
  /** List of files that were changed */
  changedFiles: string[];
  /** Test results */
  tests?: {
    passed: number;
    failed: number;
  };
  /** Acceptance criteria results */
  acceptance?: Record<string, boolean>;
  /** Risks or warnings */
  risks: string[];
  /** Git commit hash if committed */
  commit?: string;
}

/**
 * Parameters for submitting a new AGY task
 */
export interface AgySubmitParams {
  /** Path to the task manifest JSON file */
  manifest: string;
  /** Optional inline task prompt (alternative to manifest file) */
  prompt?: string;
  /** Timeout in seconds (default: 3600 = 1 hour) */
  timeout?: number;
  /** Working directory for the agent */
  cwd?: string;
  /** Environment variables to pass to AGY */
  env?: Record<string, string>;
  /** Git worktree path (optional) */
  worktreePath?: string;
  /** Git branch name (optional) */
  branch?: string;
}

/**
 * Parameters for cancelling a run
 */
export interface AgyCancelParams {
  /** Run ID to cancel */
  runId: string;
}

/**
 * Parameters for waiting on a run
 */
export interface AgyWaitParams {
  /** Run ID to wait for */
  runId: string;
  /** Maximum wait time in seconds (default: 600 = 10 minutes) */
  timeout?: number;
}

/**
 * Parameters for getting run status
 */
export interface AgyStatusParams {
  /** Run ID to check */
  runId: string;
}

/**
 * Parameters for getting run result
 */
export interface AgyResultParams {
  /** Run ID to get result for */
  runId: string;
}

/**
 * Parameters for listing all runs
 */
export interface AgyListParams {
  /** Optional status filter */
  status?: AgyRunStatus;
  /** Limit number of results */
  limit?: number;
}

/**
 * AGY CLI configuration
 */
export interface AgyConfig {
  /** Path to the agy.exe binary */
  exePath: string;
  /** Default timeout in seconds */
  defaultTimeout: number;
  /** Base directory for run state */
  runsDir: string;
  /** Maximum concurrent runs */
  maxConcurrentRuns: number;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Standard AGY MCP Server config (from MCP initialization)
 */
export interface ServerConfig {
  /** Path to agy.exe */
  agyExePath?: string;
  /** Base directory for runs */
  runsDir?: string;
  /** Default timeout */
  defaultTimeout?: number;
  /** Max concurrent runs */
  maxConcurrentRuns?: number;
}