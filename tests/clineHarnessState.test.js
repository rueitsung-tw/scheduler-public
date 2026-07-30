import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createHarnessStateRoot,
  loadHookFixture,
  removeHarnessStateRoot,
  runHookScript,
} from './helpers/clineHarness.js'

function findStatePath(stateRoot, taskId) {
  const relativePath = readdirSync(stateRoot, { recursive: true })
    .map(String)
    .find((name) => {
      if (!name.endsWith('.json')) return false
      return JSON.parse(readFileSync(`${stateRoot}\\${name}`, 'utf8')).taskId === taskId
    })
  return relativePath ? `${stateRoot}\\${relativePath}` : ''
}

function runHookProcess(relativePath, payload, stateRoot) {
  const child = spawn(
    process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve('.', relativePath),
    ],
    {
      env: {
        ...process.env,
        CLINE_HARNESS_MODE: 'shadow',
        CLINE_HARNESS_STATE_ROOT: stateRoot,
      },
    },
  )
  child.stdin.end(JSON.stringify(payload))
  return new Promise((resolveProcess, rejectProcess) => {
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', rejectProcess)
    child.on('close', (status) => resolveProcess({ status, stderr }))
  })
}

describe('Cline harness state', () => {
  it('isolates state by task id without touching the repository', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const first = { ...loadHookFixture('pre-tool-use'), taskId: 'task-a' }
      const second = { ...loadHookFixture('pre-tool-use'), taskId: 'task-b' }

      runHookScript('.clinerules/hooks/TaskStart.ps1', first, { stateRoot })
      runHookScript('.clinerules/hooks/TaskStart.ps1', second, { stateRoot })

      const files = readdirSync(stateRoot, { recursive: true }).filter((name) =>
        String(name).endsWith('.json'),
      )
      expect(files).toHaveLength(2)
      expect(files.join('\\n')).toContain('task-a')
      expect(files.join('\\n')).toContain('task-b')
      expect(existsSync('.clinerules/hooks/task-a.json')).toBe(false)
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('uses collision-resistant state identities for distinct raw task ids', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      for (const taskId of ['a/b', 'a?b']) {
        runHookScript(
          '.clinerules/hooks/TaskStart.ps1',
          { ...loadHookFixture('pre-tool-use'), taskId },
          { stateRoot },
        )
      }

      const files = readdirSync(stateRoot, { recursive: true }).filter((name) =>
        String(name).endsWith('.json'),
      )
      expect(files).toHaveLength(2)
      const taskIds = files.map((file) => JSON.parse(readFileSync(`${stateRoot}\\${file}`, 'utf8')).taskId)
      expect(taskIds).toEqual(expect.arrayContaining(['a/b', 'a?b']))
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('marks state closed on TaskCancel', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const event = { ...loadHookFixture('pre-tool-use'), taskId: 'cancel-task' }
      runHookScript('.clinerules/hooks/TaskStart.ps1', event, { stateRoot })
      runHookScript('.clinerules/hooks/TaskCancel.ps1', event, { stateRoot })

      const state = JSON.parse(readFileSync(findStatePath(stateRoot, 'cancel-task'), 'utf8'))
      expect(state.status).toBe('closed')
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('removes closed state older than the configured TTL', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const staleEvent = { ...loadHookFixture('pre-tool-use'), taskId: 'stale-task' }
      runHookScript('.clinerules/hooks/TaskStart.ps1', staleEvent, { stateRoot })
      runHookScript('.clinerules/hooks/TaskCancel.ps1', staleEvent, { stateRoot })
      const fullPath = findStatePath(stateRoot, 'stale-task')
      const staleState = JSON.parse(readFileSync(fullPath, 'utf8'))
      staleState.updatedAt = '2020-01-01T00:00:00.000Z'
      writeFileSync(fullPath, JSON.stringify(staleState), 'utf8')

      const trigger = { ...loadHookFixture('pre-tool-use'), taskId: 'cleanup-trigger' }
      runHookScript('.clinerules/hooks/TaskStart.ps1', trigger, { stateRoot })

      expect(existsSync(fullPath)).toBe(false)
      expect(existsSync(`${fullPath}.lock`)).toBe(false)
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('removes active state older than the configured active TTL', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const staleEvent = { ...loadHookFixture('pre-tool-use'), taskId: 'stale-active-task' }
      runHookScript('.clinerules/hooks/TaskStart.ps1', staleEvent, { stateRoot })
      const fullPath = findStatePath(stateRoot, 'stale-active-task')
      const staleState = JSON.parse(readFileSync(fullPath, 'utf8'))
      staleState.updatedAt = '2020-01-01T00:00:00.000Z'
      writeFileSync(fullPath, JSON.stringify(staleState), 'utf8')

      runHookScript(
        '.clinerules/hooks/TaskStart.ps1',
        { ...loadHookFixture('pre-tool-use'), taskId: 'active-cleanup-trigger' },
        { stateRoot },
      )

      expect(existsSync(fullPath)).toBe(false)
      expect(existsSync(`${fullPath}.lock`)).toBe(false)
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('recovers from malformed persisted state by closing a fresh state', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const event = { ...loadHookFixture('pre-tool-use'), taskId: 'recovery-task' }
      runHookScript('.clinerules/hooks/TaskStart.ps1', event, { stateRoot })
      const fullPath = findStatePath(stateRoot, 'recovery-task')
      writeFileSync(fullPath, '{not-json', 'utf8')

      runHookScript('.clinerules/hooks/TaskCancel.ps1', event, { stateRoot })

      expect(JSON.parse(readFileSync(fullPath, 'utf8')).status).toBe('closed')
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('preserves a closed state when task start and cancellation race in separate processes', async () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const event = { ...loadHookFixture('pre-tool-use'), taskId: 'concurrent-task' }
      runHookScript('.clinerules/hooks/TaskStart.ps1', event, { stateRoot })

      const results = await Promise.all([
        runHookProcess('.clinerules/hooks/TaskStart.ps1', event, stateRoot),
        runHookProcess('.clinerules/hooks/TaskCancel.ps1', event, stateRoot),
      ])

      expect(results.every((result) => result.status === 0 && result.stderr === '')).toBe(true)
      const state = JSON.parse(readFileSync(findStatePath(stateRoot, 'concurrent-task'), 'utf8'))
      expect(state.status).toBe('closed')
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  }, 20_000)

  it('times out a held lock and releases it for the next writer', async () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
      const statePath = `${stateRoot}\\lock-test.json`
      const protocol = resolve('.clinerules/hooks/lib/HookProtocol.ps1').replaceAll("'", "''")
      const stateModule = resolve('.clinerules/hooks/lib/HarnessState.ps1').replaceAll("'", "''")
      const escapedStatePath = statePath.replaceAll("'", "''")
      const prelude = `. '${protocol}'; . '${stateModule}'; `
      const holder = spawn(executable, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `${prelude}Invoke-WithHarnessStateLock -StatePath '${escapedStatePath}' -Action { Write-Output locked; Start-Sleep -Milliseconds 3500 }`,
      ])
      await new Promise((resolveLocked, rejectLocked) => {
        holder.stdout.on('data', (chunk) => {
          if (String(chunk).includes('locked')) resolveLocked()
        })
        holder.on('error', rejectLocked)
        holder.on('exit', (status) => rejectLocked(new Error(`lock holder exited ${status}`)))
      })

      const timedOut = spawnSync(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `${prelude}try { Invoke-WithHarnessStateLock -StatePath '${escapedStatePath}' -TimeoutMilliseconds 50 -Action {}; exit 1 } catch { Write-Output $_.Exception.Message; exit 0 }`,
        ],
        { encoding: 'utf8' },
      )
      expect(timedOut.status, timedOut.stderr).toBe(0)
      expect(timedOut.stdout).toContain('lock timed out')

      await new Promise((resolveClosed, rejectClosed) => {
        holder.on('error', rejectClosed)
        holder.on('close', (status) => (status === 0 ? resolveClosed() : rejectClosed(new Error(`lock holder exited ${status}`))))
      })
      const released = spawnSync(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `${prelude}Invoke-WithHarnessStateLock -StatePath '${escapedStatePath}' -TimeoutMilliseconds 500 -Action {}; exit 0`,
        ],
        { encoding: 'utf8' },
      )
      expect(released.status).toBe(0)
      expect(existsSync(`${statePath}.lock`)).toBe(false)
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  }, 15_000)

  it('rejects a test state root that escapes through a junction', () => {
    if (process.platform !== 'win32') return

    const stateRoot = createHarnessStateRoot()
    const outsideRoot = createHarnessStateRoot()
    const junction = `${stateRoot}\\junction`
    try {
      try {
        symlinkSync(outsideRoot, junction, 'junction')
      } catch {
        return
      }

      runHookScript(
        '.clinerules/hooks/TaskStart.ps1',
        { ...loadHookFixture('pre-tool-use'), taskId: 'junction-task' },
        { stateRoot: junction },
      )

      expect(readdirSync(outsideRoot)).toEqual([])
    } finally {
      removeHarnessStateRoot(stateRoot)
      removeHarnessStateRoot(outsideRoot)
    }
  })

  it('works under PowerShell 7 when it is available', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const executable = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh'
      const availability = spawnSync(executable, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'])
      if (availability.error) return

      const result = spawnSync(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          resolve('.clinerules/hooks/TaskStart.ps1'),
        ],
        {
          input: JSON.stringify({ ...loadHookFixture('pre-tool-use'), taskId: 'pwsh-task' }),
          encoding: 'utf8',
          env: { ...process.env, CLINE_HARNESS_MODE: 'shadow', CLINE_HARNESS_STATE_ROOT: stateRoot },
        },
      )
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout).cancel).toBe(false)
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })
})
