import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const probePath = 'docs/pre-commit-preflight-probe.md'
const generatedDocs = [
  '.clinerules/CodeMap.md',
  '.clinerules/ChangeLog.md',
  '.clinerules/ExperienceLog.md',
]

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' })
}

function readGeneratedDocs() {
  return Object.fromEntries(generatedDocs.map((file) => [file, readFileSync(file, 'utf8')]))
}

afterEach(() => {
  git(['restore', '--staged', '--', probePath])
  if (existsSync(probePath)) {
    rmSync(probePath, { force: true })
  }
})

describe('repo pre-commit dependency preflight', () => {
  it('fails before mutating generated docs when Prettier is unavailable', () => {
    const before = readGeneratedDocs()
    writeFileSync(probePath, '# Pre-commit preflight probe\n', 'utf8')
    expect(git(['add', '--', probePath]).status).toBe(0)

    const result = spawnSync('node', ['scripts/hooks/pre-commit.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOOKS_PRETTIER_BIN: resolve('node_modules/.bin/prettier-missing-for-test.cmd'),
      },
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stderr}\n${result.stdout}`).toContain('Required Prettier binary is missing')
    expect(readGeneratedDocs()).toEqual(before)
  })
})
