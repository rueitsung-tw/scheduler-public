import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadHookFixture, repoRoot, runHookScript } from './helpers/clineHarness.js'

function probe(text, tool_call = null, env = {}) {
  const event = {
    ...loadHookFixture('pre-tool-use'),
    prompt: text,
    tool_call,
  }
  return runHookScript('scripts/hooks/probe-cline-hook-contract.ps1', event, {
    env: { CLINE_HARNESS_PROBE_POLICY: '1', ...env },
  }).json
}

function probeWithShell(shell, text, tool_call = null) {
  const event = { ...loadHookFixture('pre-tool-use'), prompt: text, tool_call }
  const result = spawnSync(
    shell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(repoRoot, 'scripts', 'hooks', 'probe-cline-hook-contract.ps1'),
    ],
    {
      cwd: repoRoot,
      input: JSON.stringify(event),
      encoding: 'utf8',
      env: { ...process.env, CLINE_HARNESS_PROBE_POLICY: '1' },
    },
  )
  expect(result.status, result.stderr).toBe(0)
  expect(result.stderr).toBe('')
  return JSON.parse(result.stdout.trim())
}

function operationMapWithShell(shell) {
  const policyPath = resolve(repoRoot, '.clinerules', 'hooks', 'lib', 'HarnessPolicy.ps1').replace(
    /'/g,
    "''",
  )
  const command = [
    `. '${policyPath}'`,
    "[ordered]@{ read = Get-HarnessOperationKind ([pscustomobject]@{ name = 'read_file' }); write = Get-HarnessOperationKind ([pscustomobject]@{ name = 'write_to_file' }); destructiveWrite = Get-HarnessOperationKind ([pscustomobject]@{ name = 'delete_file' }); execute = Get-HarnessOperationKind ([pscustomobject]@{ name = 'run_command' }); complete = Get-HarnessOperationKind ([pscustomobject]@{ name = 'attempt_completion' }); external = Get-HarnessOperationKind ([pscustomobject]@{ name = 'deploy_site' }); remoteDelete = Get-HarnessOperationKind ([pscustomobject]@{ name = 'delete_remote' }); unknown = Get-HarnessOperationKind ([pscustomobject]@{ name = 'mystery_tool' }) } | ConvertTo-Json -Compress",
  ].join('; ')
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim())
}

describe('risk-tier policy', () => {
  it('keeps a documentation-only request light', () => {
    expect(probe('修正文檔中的錯字，不改程式行為').harnessAssessment.mode).toBe('light')
  })

  it('classifies a single-module behavior change as guarded', () => {
    expect(probe('修正單一 Vue 元件的儲存行為並執行 targeted test').harnessAssessment.mode).toBe(
      'guarded',
    )
  })

  it('forces solver and formal acceptance work to strict', () => {
    const result = probe('修改 solver constraint，完成後宣稱 READY')
    expect(result.harnessAssessment.mode).toBe('strict')
    expect(result.harnessAssessment.hardTriggers).toContain('solver-semantics')
    expect(result.harnessAssessment.hardTriggers).toContain('formal-claim')
  })

  it('does not let LIGHT bypass a hard trigger', () => {
    expect(probe('[LIGHT] 修改正式 constraint').harnessAssessment.mode).toBe('strict')
  })

  it('treats attempt_completion as a formal claim even with empty input', () => {
    const assessment = probe('', { name: 'attempt_completion', input: {} }).harnessAssessment
    expect(assessment.mode).toBe('strict')
    expect(assessment.hardTriggers).toContain('formal-claim')
  })

  it('treats a commit tool as a high-risk operation with empty input', () => {
    const assessment = probe('', { name: 'git_commit', input: {} }).harnessAssessment
    expect(assessment.mode).toBe('strict')
    expect(assessment.score).toBe(3)
    expect(assessment.hardTriggers).toContain('external-operation')
  })

  it('forces a multi-layer behavior change to strict', () => {
    const assessment = probe(
      '修改 Vue frontend、payload 與 server adapter 的資料流',
    ).harnessAssessment
    expect(assessment.mode).toBe('strict')
    expect(assessment.hardTriggers).toContain('cross-subsystem')
  })

  it('does not let a docs keyword erase a frontend behavior change', () => {
    expect(probe('修正文檔並修改 Vue 元件的儲存行為').harnessAssessment.mode).toBe('guarded')
  })

  it('does not treat explanatory PASS and READY labels as completion claims', () => {
    const assessment = probe('Explain what PASS and READY mean').harnessAssessment
    expect(assessment.mode).toBe('light')
    expect(assessment.hardTriggers).not.toContain('formal-claim')
  })

  it('recognizes an asserted READY result as a formal claim', () => {
    const assessment = probe('The validation result is READY').harnessAssessment
    expect(assessment.mode).toBe('strict')
    expect(assessment.hardTriggers).toContain('formal-claim')
  })

  it('does not treat a constraint documentation path as solver semantics', () => {
    const assessment = probe('Read docs/constraint-notes.md').harnessAssessment
    expect(assessment.mode).toBe('light')
    expect(assessment.hardTriggers).not.toContain('solver-semantics')
  })

  it('forces a previous English validation failure to strict', () => {
    const assessment = probe(
      'The previous validation failed; diagnose the frontend',
    ).harnessAssessment
    expect(assessment.mode).toBe('strict')
    expect(assessment.hardTriggers).toContain('failed-validation')
  })

  it('forces two unresolved hypotheses to strict', () => {
    const assessment = probe('Two unresolved hypotheses remain for the payload').harnessAssessment
    expect(assessment.mode).toBe('strict')
    expect(assessment.hardTriggers).toContain('multiple-hypotheses')
  })

  it('forces contradictory evidence to strict', () => {
    const assessment = probe('The test result contradicts the validation report').harnessAssessment
    expect(assessment.mode).toBe('strict')
    expect(assessment.hardTriggers).toContain('contradictory-evidence')
  })

  it('recognizes English diagnosis language', () => {
    const assessment = probe('Diagnose the frontend failure').harnessAssessment
    expect(assessment.mode).toBe('guarded')
    expect(assessment.reasons).toContain('diagnosis')
  })

  it('forces a database migration to strict', () => {
    const assessment = probe('Migrate the database schema').harnessAssessment
    expect(assessment.mode).toBe('strict')
    expect(assessment.hardTriggers).toContain('high-impact-semantics')
  })

  it('requires change context for security-sensitive hard triggers', () => {
    const change = probe('Modify authentication permissions').harnessAssessment
    expect(change.mode).toBe('strict')
    expect(change.hardTriggers).toContain('high-impact-semantics')

    const documentation = probe('Explain database security documentation').harnessAssessment
    expect(documentation.mode).toBe('light')
    expect(documentation.hardTriggers).not.toContain('high-impact-semantics')
  })

  it.each([
    'Read docs/deploy-guide.md',
    'Fix a typo in docs/constraint-notes.md',
    'Fix a typo in the database migration guide',
    'Fix a typo in docs/authentication.md',
    'Document that the status field READY means successful',
  ])('keeps documentation or explanatory intent light: %s', (text) => {
    const assessment = probe(text).harnessAssessment
    expect(assessment.mode).toBe('light')
    expect(assessment.hardTriggers).not.toContain('high-impact-semantics')
    expect(assessment.hardTriggers).not.toContain('solver-semantics')
    expect(assessment.hardTriggers).not.toContain('formal-claim')
  })

  it('keeps paired high-risk actions strict while high-risk tools override docs intent', () => {
    for (const text of [
      'Deploy the application',
      'Migrate the database schema',
      'Modify authentication permissions',
      'The validation result is READY',
    ]) {
      expect(probe(text).harnessAssessment.mode).toBe('strict')
    }
    expect(
      probe('Read docs/deploy-guide.md', { name: 'deploy_site', input: {} }).harnessAssessment.mode,
    ).toBe('strict')
  })

  it('accepts non-default pure classification thresholds', () => {
    const assessment = probe('inspect the frontend', null, {
      CLINE_HARNESS_PROBE_THRESHOLDS: JSON.stringify({ lightMax: 0, guardedMax: 10 }),
    }).harnessAssessment
    expect(assessment.mode).toBe('guarded')
  })

  it('classifies empty text and an absent tool without errors', () => {
    const assessment = probe('').harnessAssessment
    expect(assessment.mode).toBe('light')
    expect(assessment.subsystems).toEqual([])
    expect(assessment.hardTriggers).toEqual([])
  })

  it('returns a legal no-op response for malformed policy-probe input', () => {
    const result = runHookScript('scripts/hooks/probe-cline-hook-contract.ps1', '{not-json', {
      env: { CLINE_HARNESS_PROBE_POLICY: '1' },
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.json).toMatchObject({ cancel: false, review: false })
    expect(result.json).not.toHaveProperty('harnessAssessment')
  })

  it.each(['push_changes', 'deploy_site', 'publish_release', 'delete_remote'])(
    'forces external tool %s to strict with empty input',
    (name) => {
      const assessment = probe('', { name, input: {} }).harnessAssessment
      expect(assessment.mode).toBe('strict')
      expect(assessment.hardTriggers).toContain('external-operation')
    },
  )

  it('serializes all collection fields as arrays in PowerShell 5 and 7', () => {
    for (const shell of ['powershell.exe', 'pwsh']) {
      for (const text of [
        'hello',
        'Read docs/guide.md',
        'modify Vue payload server',
        '修改 solver constraint，完成後宣稱 READY',
      ]) {
        const assessment = probeWithShell(shell, text).harnessAssessment
        expect(Array.isArray(assessment.subsystems)).toBe(true)
        expect(Array.isArray(assessment.hardTriggers)).toBe(true)
        expect(Array.isArray(assessment.reasons)).toBe(true)
      }
    }
  }, 20_000)

  it('keeps documentation intent light in PowerShell 5 and 7', () => {
    for (const shell of ['powershell.exe', 'pwsh']) {
      for (const text of [
        'Read docs/deploy-guide.md',
        'Fix a typo in docs/constraint-notes.md',
        'Fix a typo in the database migration guide',
        'Fix a typo in docs/authentication.md',
        'Document that the status field READY means successful',
      ]) {
        expect(probeWithShell(shell, text).harnessAssessment.mode).toBe('light')
      }
    }
  }, 20_000)

  it('maps operation tool names consistently in PowerShell 5 and 7', () => {
    for (const shell of ['powershell.exe', 'pwsh']) {
      expect(operationMapWithShell(shell)).toEqual({
        read: 'read',
        write: 'write',
        destructiveWrite: 'write',
        execute: 'execute',
        complete: 'complete',
        external: 'external',
        remoteDelete: 'external',
        unknown: 'unknown',
      })
    }
  })
})
