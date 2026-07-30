import { readdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createHarnessStateRoot,
  loadHookFixture,
  removeHarnessStateRoot,
  runHookScript,
} from './helpers/clineHarness.js'

describe('full lifecycle dispatch', () => {
  it('classifies prompt, restores mainline, and does not duplicate normal context', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const prompt = loadHookFixture('user-prompt-submit')
      const submitted = runHookScript('.clinerules/hooks/UserPromptSubmit.ps1', prompt, {
        mode: 'shadow',
        stateRoot,
      })
      expect(submitted.json.context).toContain('HARNESS=STRICT')

      const resumed = runHookScript(
        '.clinerules/hooks/TaskResume.ps1',
        loadHookFixture('task-resume'),
        { mode: 'shadow', stateRoot },
      )
      expect(resumed.json.context).toContain('MAINLINE CHECK')
      expect(resumed.json.context).toContain('solver timeout')

      const read = {
        ...loadHookFixture('pre-tool-use'),
        taskId: 'lifecycle-task',
        tool_call: {
          id: 'read-solver',
          name: 'read_file',
          input: { path: 'F:\\scheduler-frontend\\solver.py' },
        },
      }
      const allowed = runHookScript('.clinerules/hooks/PreToolUse.ps1', read, {
        mode: 'shadow',
        stateRoot,
      })
      expect(allowed.json.context).toBe('')
      expect(allowed.json.cancel).toBe(false)
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('reports would-block in shadow and actually blocks in full', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const prompt = loadHookFixture('user-prompt-submit')
      runHookScript('.clinerules/hooks/UserPromptSubmit.ps1', prompt, {
        mode: 'shadow',
        stateRoot,
      })
      const write = {
        ...loadHookFixture('pre-tool-use'),
        taskId: 'lifecycle-task',
        tool_call: {
          id: 'write-solver',
          name: 'write_to_file',
          input: { path: 'F:\\scheduler-frontend\\solver.py', content: '# change' },
        },
      }
      const shadow = runHookScript('.clinerules/hooks/PreToolUse.ps1', write, {
        mode: 'shadow',
        stateRoot,
      })
      expect(shadow.json.cancel).toBe(false)
      expect(shadow.json.context).toContain('SHADOW WOULD BLOCK')

      const full = runHookScript('.clinerules/hooks/PreToolUse.ps1', write, {
        mode: 'full',
        stateRoot,
      })
      expect(full.json.cancel).toBe(true)
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })

  it('fails open for a recognizable malformed read event', () => {
    const malformed = '{"hookName":"tool_call","name":"read_file","taskId":"broken-read",'
    const result = runHookScript('.clinerules/hooks/PreToolUse.ps1', malformed, {
      mode: 'full',
    })
    expect(result.json.cancel).toBe(false)
    expect(result.json.review).toBe(false)
  })

  it('requires review when state is corrupt before a write', () => {
    const stateRoot = createHarnessStateRoot()
    try {
      const prompt = loadHookFixture('user-prompt-submit')
      runHookScript('.clinerules/hooks/UserPromptSubmit.ps1', prompt, {
        mode: 'full',
        stateRoot,
      })
      const relativePath = readdirSync(stateRoot, { recursive: true })
        .map(String)
        .find((name) => name.endsWith('lifecycle-task.json'))
      writeFileSync(`${stateRoot}\\${relativePath}`, '{broken-state', 'utf8')
      const write = {
        ...loadHookFixture('pre-tool-use'),
        taskId: 'lifecycle-task',
        tool_call: {
          id: 'write-after-corruption',
          name: 'write_to_file',
          input: { path: 'F:\\scheduler-frontend\\solver.py', content: '# change' },
        },
      }
      const result = runHookScript('.clinerules/hooks/PreToolUse.ps1', write, {
        mode: 'full',
        stateRoot,
      })
      expect(result.json.cancel || result.json.review).toBe(true)
    } finally {
      removeHarnessStateRoot(stateRoot)
    }
  })
})
