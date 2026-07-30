import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('Cline harness performance budget', () => {
  it('stays within no-op-relative latency budgets', () => {
    const result = spawnSync('node', ['scripts/hooks/benchmark-cline-harness.mjs'], {
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).budgetsPassed).toBe(true)
  }, 60_000)
})
