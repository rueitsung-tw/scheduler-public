import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Cline harness documentation', () => {
  it('documents all modes, state location, and rollback', () => {
    const hooks = readFileSync('.clinerules/HOOKS.md', 'utf8')
    for (const mode of ['disabled', 'shadow', 'review', 'full']) {
      expect(hooks).toContain(`\`${mode}\``)
    }
    expect(hooks).toContain('%LOCALAPPDATA%\\ClineHarness')
    expect(hooks).toContain('不修改 repository')
    expect(hooks).toContain('"mode": "review"')
  })

  it('keeps project rules concise and points to the hook contract', () => {
    const rules = readFileSync('.clinerules/PROJECT_RULES.md', 'utf8')
    expect(rules).toContain('風險分級 harness')
    expect(rules).toContain('.clinerules/HOOKS.md')
    expect(rules.split(/\r?\n/).length).toBeLessThan(90)
  })
})
