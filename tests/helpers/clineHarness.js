import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

export const repoRoot = resolve(import.meta.dirname, '..', '..')

export function loadHookFixture(name) {
  return JSON.parse(
    readFileSync(resolve(repoRoot, 'tests', 'fixtures', 'cline-hooks', `${name}.json`), 'utf8'),
  )
}

export function createHarnessStateRoot() {
  return mkdtempSync(resolve(tmpdir(), 'cline-harness-test-'))
}

export function removeHarnessStateRoot(path) {
  rmSync(path, { recursive: true, force: true })
}

export function runHookScript(relativePath, payload, options = {}) {
  const executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
  const stateRoot = options.stateRoot
  const startedAt = performance.now()
  const result = spawnSync(
    executable,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(repoRoot, relativePath),
    ],
    {
      cwd: repoRoot,
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLINE_HARNESS_MODE: options.mode ?? 'shadow',
        ...(stateRoot ? { CLINE_HARNESS_STATE_ROOT: stateRoot } : {}),
        ...options.env,
      },
    },
  )
  const stdout = result.stdout.trim()
  return {
    status: result.status,
    stdout,
    stderr: result.stderr.trim(),
    json: stdout ? JSON.parse(stdout.split(/\r?\n/).at(-1)) : null,
    elapsedMs: performance.now() - startedAt,
    stateRoot: stateRoot ?? null,
  }
}
