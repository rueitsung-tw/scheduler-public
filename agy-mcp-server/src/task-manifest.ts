export type TaskExecutor = 'agy' | 'cline';

export interface TaskManifest {
  id: string;
  prompt: string;
  readPaths: string[];
  writePaths: string[];
  acceptanceCommands: string[];
  timeoutSeconds: number;
  maxRetries: number;
  executor: TaskExecutor;
}

function validateSafeRelativePath(path: unknown, fieldName: string): string {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error(`Invalid ${fieldName}: path must be a non-empty string`);
  }

  const trimmed = path.trim();

  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new Error(`Invalid ${fieldName}: absolute paths are not allowed (${trimmed})`);
  }

  if (/^[a-zA-Z]:/.test(trimmed)) {
    throw new Error(`Invalid ${fieldName}: drive-qualified paths are not allowed (${trimmed})`);
  }

  if (trimmed.includes('..')) {
    throw new Error(`Invalid ${fieldName}: path must not contain '..' (${trimmed})`);
  }

  return path;
}

function validatePathArray(paths: unknown, fieldName: string): string[] {
  if (!Array.isArray(paths)) {
    throw new Error(`Invalid ${fieldName}: must be an array of paths`);
  }
  return paths.map(p => validateSafeRelativePath(p, fieldName));
}

function validateAcceptanceCommands(commands: unknown): string[] {
  if (!Array.isArray(commands)) {
    throw new Error('Invalid acceptanceCommands: must be an array of strings');
  }
  return commands.map(cmd => {
    if (typeof cmd !== 'string' || cmd.trim().length === 0) {
      throw new Error('Invalid acceptanceCommands: each command must be a non-empty string');
    }
    return cmd;
  });
}

/**
 * Validates and parses a JSON-like value into a typed TaskManifest.
 *
 * @param value The value to validate
 * @returns Validated TaskManifest with default executor 'agy' if omitted
 * @throws Error if validation fails
 */
export function parseTaskManifest(value: unknown): TaskManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Task manifest must be a non-null object');
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string' || record.id.trim().length === 0) {
    throw new Error('Invalid id: must be a non-blank string');
  }

  if (typeof record.prompt !== 'string' || record.prompt.trim().length === 0) {
    throw new Error('Invalid prompt: must be a non-blank string');
  }

  const readPaths = validatePathArray(record.readPaths, 'readPaths');
  const writePaths = validatePathArray(record.writePaths, 'writePaths');
  const acceptanceCommands = validateAcceptanceCommands(record.acceptanceCommands);

  if (
    typeof record.timeoutSeconds !== 'number' ||
    !Number.isInteger(record.timeoutSeconds) ||
    record.timeoutSeconds < 1 ||
    record.timeoutSeconds > 3600
  ) {
    throw new Error('Invalid timeoutSeconds: must be an integer between 1 and 3600');
  }

  if (
    typeof record.maxRetries !== 'number' ||
    !Number.isInteger(record.maxRetries) ||
    record.maxRetries < 0 ||
    record.maxRetries > 3
  ) {
    throw new Error('Invalid maxRetries: must be an integer between 0 and 3');
  }

  let executor: TaskExecutor = 'agy';
  if (record.executor !== undefined) {
    if (record.executor !== 'agy' && record.executor !== 'cline') {
      throw new Error(`Invalid executor: must be 'agy' or 'cline', got '${String(record.executor)}'`);
    }
    executor = record.executor;
  }

  return {
    id: record.id,
    prompt: record.prompt,
    readPaths,
    writePaths,
    acceptanceCommands,
    timeoutSeconds: record.timeoutSeconds,
    maxRetries: record.maxRetries,
    executor,
  };
}
