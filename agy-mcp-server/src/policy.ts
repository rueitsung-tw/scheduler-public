export type DelegationFailureReason =
  | 'provider_failure'
  | 'timeout'
  | 'cancelled'
  | 'no_changes'
  | 'write_allowlist_violation'
  | 'acceptance_failure'
  | 'succeeded';

export interface DelegationClassificationInput {
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  changedFiles: string[];
  writePaths: string[];
  acceptancePassed: boolean;
}

function normalizePath(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function isAllowedPath(changedFile: string, writePath: string): boolean {
  const normChanged = normalizePath(changedFile);
  const normWrite = normalizePath(writePath);

  if (normChanged === normWrite) {
    return true;
  }

  const prefix = normWrite.endsWith('/') ? normWrite : `${normWrite}/`;
  return normChanged.startsWith(prefix);
}

/**
 * Return the changed file paths that are not equal to, or descendants of,
 * a listed repository-relative write path.
 * Normalizes backslashes to forward slashes and ignores repeated changed paths.
 */
export function findDisallowedWrites(
  changedFiles: string[],
  writePaths: string[]
): string[] {
  const disallowed: string[] = [];
  const seen = new Set<string>();

  for (const rawChanged of changedFiles) {
    const normChanged = normalizePath(rawChanged);
    if (seen.has(normChanged)) {
      continue;
    }
    seen.add(normChanged);

    const allowed = writePaths.some(wp => isAllowedPath(normChanged, wp));
    if (!allowed) {
      disallowed.push(normChanged);
    }
  }

  return disallowed;
}

/**
 * Classifies delegation execution outcome based on strict precedence rules:
 * 1. timeout
 * 2. cancelled
 * 3. nonzero exit (provider_failure)
 * 4. disallowed writes (write_allowlist_violation)
 * 5. no changed files when writePaths is nonempty (no_changes)
 * 6. failed acceptance (acceptance_failure)
 * 7. succeeded
 */
export function classifyDelegationFailure(
  input: DelegationClassificationInput
): DelegationFailureReason {
  if (input.timedOut) {
    return 'timeout';
  }

  if (input.cancelled) {
    return 'cancelled';
  }

  if (input.exitCode !== 0) {
    return 'provider_failure';
  }

  const disallowedWrites = findDisallowedWrites(
    input.changedFiles,
    input.writePaths
  );
  if (disallowedWrites.length > 0) {
    return 'write_allowlist_violation';
  }

  if (input.writePaths.length > 0 && input.changedFiles.length === 0) {
    return 'no_changes';
  }

  if (!input.acceptancePassed) {
    return 'acceptance_failure';
  }

  return 'succeeded';
}
