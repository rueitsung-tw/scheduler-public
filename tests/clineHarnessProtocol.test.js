import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createHarnessStateRoot,
  loadHookFixture,
  removeHarnessStateRoot,
  runHookScript,
} from './helpers/clineHarness.js'

describe('Cline hook protocol compatibility', () => {
  it('normalizes task, workspace, and nested tool_call fields', () => {
    const stateRoot = createHarnessStateRoot()
    const probeDir = resolve(stateRoot, 'probe')

    try {
      const result = runHookScript(
        'scripts/hooks/probe-cline-hook-contract.ps1',
        loadHookFixture('pre-tool-use'),
        { stateRoot, mode: 'test', env: { CLINE_HARNESS_PROBE_DIR: probeDir } },
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.json).toMatchObject({
        cancel: false,
        review: false,
        context: '',
        contextModification: '',
        errorMessage: '',
      })
      expect(
        JSON.parse(
          readFileSync(resolve(probeDir, 'contract-probe-task.json'), 'utf8').replace(/^\uFEFF/, ''),
        ),
      ).toMatchObject({
        taskIdPresent: true,
        taskIdSafe: 'contract-probe-task',
        workspaceRootPresent: true,
        workspaceRootSafe: 'scheduler-frontend',
        toolCallPresent: true,
        toolName: 'write_to_file',
      })
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('returns legal JSON for malformed stdin', () => {
    const result = runHookScript('scripts/hooks/probe-cline-hook-contract.ps1', '{not-json')

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.json).toMatchObject({
      cancel: false,
      review: false,
    })
  })

  it('does not allocate harness state for a probe that does not use it', () => {
    const result = runHookScript('scripts/hooks/probe-cline-hook-contract.ps1', '{not-json')

    expect(result.stateRoot).toBeNull()
  })

  it('keeps UserPromptSubmit a no-op when probing is not enabled', () => {
    const result = runHookScript('.clinerules/hooks/UserPromptSubmit.ps1', 'ordinary prompt')

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.json).toMatchObject({
      cancel: false,
      review: false,
      context: '',
      contextModification: '',
      errorMessage: '',
    })
  })

  it('recognizes nested userPromptSubmit.prompt text', () => {
    const stateRoot = createHarnessStateRoot()
    const probeDir = resolve(stateRoot, 'probe')

    try {
      const result = runHookScript(
        'scripts/hooks/probe-cline-hook-contract.ps1',
        loadHookFixture('user-prompt-submit'),
        { stateRoot, mode: 'test', env: { CLINE_HARNESS_PROBE_DIR: probeDir } },
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(
        JSON.parse(
          readFileSync(resolve(probeDir, 'lifecycle-task.json'), 'utf8').replace(/^\uFEFF/, ''),
        ),
      ).toMatchObject({ userTextPresent: true })
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('rejects a test probe directory outside its harness state root', () => {
    const stateRoot = createHarnessStateRoot()
    const outsideProbeDir = `${stateRoot}-sibling-probe`

    try {
      const result = runHookScript(
        '.clinerules/hooks/UserPromptSubmit.ps1',
        loadHookFixture('pre-tool-use'),
        {
          stateRoot,
          mode: 'test',
          env: { CLINE_HARNESS_PROBE_DIR: outsideProbeDir },
        },
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(existsSync(outsideProbeDir)).toBe(false)
    } finally {
      removeHarnessStateRoot(stateRoot)
      removeHarnessStateRoot(outsideProbeDir)
    }
  })
})
