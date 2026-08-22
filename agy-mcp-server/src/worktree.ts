import path from 'node:path';

export type WorktreeCommand = (args: string[], cwd: string) => Promise<void>;

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const SAFE_TASK_ID_PATTERN = /^[a-zA-Z0-9_-]+([.][a-zA-Z0-9_-]+)*$/;

function deriveSafeDirectoryName(taskId: string): string {
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new Error('Invalid taskId: must be a non-blank string');
  }

  const trimmed = taskId.trim();

  if (
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    !SAFE_TASK_ID_PATTERN.test(trimmed) ||
    WINDOWS_RESERVED_NAMES.test(trimmed)
  ) {
    throw new Error(`Invalid taskId: unsafe directory name (${taskId})`);
  }

  return trimmed;
}

/**
 * Creates an isolated Git worktree for a task by calling `git worktree add --detach <worktreePath> HEAD`.
 *
 * @param command Injected Git command executor
 * @param repoRoot Root directory of the source Git repository
 * @param runRoot Directory under which isolated worktrees are created
 * @param taskId Unique task identifier used to derive the worktree directory name
 * @returns Absolute path to the created worktree directory
 */
export async function createIsolatedWorktree(
  command: WorktreeCommand,
  repoRoot: string,
  runRoot: string,
  taskId: string
): Promise<string> {
  if (typeof command !== 'function') {
    throw new Error('Invalid command: must be a function');
  }

  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) {
    throw new Error('Invalid repoRoot: must be a non-blank string');
  }

  if (typeof runRoot !== 'string' || runRoot.trim().length === 0) {
    throw new Error('Invalid runRoot: must be a non-blank string');
  }

  const safeDirName = deriveSafeDirectoryName(taskId);
  const worktreePath = path.resolve(runRoot, safeDirName);

  await command(['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoRoot);

  return worktreePath;
}
