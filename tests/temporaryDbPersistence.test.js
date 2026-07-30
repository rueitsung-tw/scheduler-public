import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { spawn, execFileSync } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDefaultGradeTimeRulesSettings,
  normalizeGradeTimeRulesSettings,
} from '../src/utils/gradeTimeRules.js'
import {
  parseGradeTimeRulesSettings,
  prepareGradeTimeRulesPersistence,
  serializeGradeTimeRulesSettings,
} from '../src/utils/gradeTimeRulesPersistence.js'

function getFileHashAndMtime(filePath) {
  if (!fs.existsSync(filePath)) return null
  const stat = fs.statSync(filePath)
  const content = fs.readFileSync(filePath)
  const hash = createHash('sha256').update(content).digest('hex')
  return { mtime: stat.mtimeMs, hash }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
    server.on('error', reject)
  })
}

async function waitForServerReady(baseUrl, testPort, checkExit) {
  const start = Date.now()
  while (Date.now() - start < 15000) {
    const exitErr = checkExit()
    if (exitErr) throw exitErr

    try {
      const res = await fetch(`${baseUrl}/api/schedule`)
      if (res.ok || res.status === 200 || res.status === 404) return
    } catch {
      // Waiting for server process to listen
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  const exitErr = checkExit()
  if (exitErr) throw exitErr
  throw new Error(`Timeout (15s) waiting for server on port ${testPort}`)
}

async function stopServerProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
    return
  }

  const exitPromise = new Promise((resolve) => {
    proc.once('exit', () => resolve())
  })

  proc.kill('SIGTERM')

  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000))

  const result = await Promise.race([exitPromise, timeoutPromise])
  if (result === 'timeout') {
    proc.kill('SIGKILL')
    await exitPromise
  }
}

describe('Temporary Database Atomic Persistence & Migration', () => {
  const rootDir = path.resolve(__dirname, '..')
  const devDbPath = path.join(rootDir, 'dev.db')

  let initialDevDbInfo = null
  let tempDir = ''
  let tempDbPath = ''
  let prisma = null
  let serverProcess = null
  let testPort = 0
  let baseUrl = ''
  let serverExitError = null
  let stderrBuffer = ''

  const handleChildExit = (code, signal) => {
    const err = new Error(
      `Child server on port ${testPort} exited unexpectedly ` +
        `(code: ${code}, signal: ${signal}). Stderr:\n${stderrBuffer}`,
    )
    serverExitError = err
  }

  const handleChildError = (err) => {
    serverExitError = new Error(
      `Child server error on port ${testPort}: ${err.message}. Stderr:\n${stderrBuffer}`,
    )
  }

  const assertServerHealthy = () => {
    if (serverExitError) {
      throw serverExitError
    }
  }

  beforeAll(async () => {
    // 1. Record dev.db hash and timestamp BEFORE any test operations
    initialDevDbInfo = getFileHashAndMtime(devDbPath)

    // 2. Dynamically allocate an available port on 127.0.0.1
    testPort = await getFreePort()
    baseUrl = `http://127.0.0.1:${testPort}`

    // 3. Create GUID unique temporary directory in %TEMP%
    tempDir = path.join(os.tmpdir(), 'gtr-schema-test-' + randomUUID())
    tempDbPath = path.join(tempDir, 'schema-test.db')

    expect(fs.existsSync(tempDbPath)).toBe(false)
    fs.mkdirSync(tempDir, { recursive: true })
    fs.writeFileSync(tempDbPath, '')

    // 4. Run prisma db push strictly targeting ONLY temporary DB
    const dbUrl = `file:${tempDbPath.replace(/\\/g, '/')}`
    const prismaJs = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js')

    try {
      execFileSync(
        process.execPath,
        [prismaJs, 'db', 'push', '--schema=prisma/schema.prisma', `--url=${dbUrl}`],
        {
          cwd: rootDir,
          env: {
            ...process.env,
            DATABASE_URL: dbUrl,
          },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      )
    } catch (err) {
      console.error('prisma db push STDOUT:', err.stdout)
      console.error('prisma db push STDERR:', err.stderr)
      throw new Error(
        `prisma db push failed with exit code ${err.status}: ${err.stderr || err.message}`,
      )
    }

    expect(fs.existsSync(tempDbPath)).toBe(true)

    // Connect PrismaClient to the temp DB
    const adapter = new PrismaBetterSqlite3({ url: dbUrl })
    prisma = new PrismaClient({ adapter })

    // Spawn child server process with dynamic port and temporary DB
    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(testPort),
        DATABASE_URL: dbUrl,
      },
      stdio: 'pipe',
    })

    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString()
      })
    }

    serverProcess.on('exit', handleChildExit)
    serverProcess.on('error', handleChildError)

    await waitForServerReady(baseUrl, testPort, () => serverExitError)
  }, 20000)

  afterAll(async () => {
    // Graceful stop child process & await exit
    if (serverProcess) {
      serverProcess.removeListener('exit', handleChildExit)
      serverProcess.removeListener('error', handleChildError)
      await stopServerProcess(serverProcess)
    }

    // Disconnect Prisma client
    if (prisma) {
      await prisma.$disconnect()
    }

    // Async retryable directory cleanup
    if (tempDir && fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      })
    }

    // Prove primary dev.db timestamp & SHA256 remained completely UNCHANGED
    const finalDevDbInfo = getFileHashAndMtime(devDbPath)
    if (initialDevDbInfo && finalDevDbInfo) {
      expect(finalDevDbInfo.hash).toBe(initialDevDbInfo.hash)
      expect(finalDevDbInfo.mtime).toBe(initialDevDbInfo.mtime)
    }
  })

  it('HTTP POST /api/save-all saves canonical settings & strips legacy keys', async () => {
    assertServerHealthy()

    const canonicalRule = {
      id: 'http-rule-1',
      enabled: true,
      purpose: 'general',
      grades: [1],
      timeSelectionMode: 'fixed',
      day: 1,
      periods: [1],
    }

    const postPayload = {
      teachers: [{ name: 'T1', max_periods: 20 }],
      classes: [{ name: '101', grade: 1, course_requirements: [] }],
      schoolInfo: {
        academic_year: '115',
        semester: '上學期',
        gradeTimeRulesSettings: {
          enabled: true,
          version: 2,
          rules: [canonicalRule],
        },
      },
      aiSettings: {
        coPlanningSettings: { enabled: true },
        __schoolInfoCoPlanningSettings: { enabled: true },
        validSetting: 'ok',
      },
    }

    const res = await fetch(`${baseUrl}/api/save-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postPayload),
    })

    expect(res.status).toBe(200)

    const dbRecord = await prisma.systemSetting.findUnique({
      where: { id: 1 },
    })
    const savedRules = parseGradeTimeRulesSettings(dbRecord.gradeTimeRulesSettings)
    const savedAi = JSON.parse(dbRecord.ai_settings)

    expect(savedRules.rules).toHaveLength(1)
    expect(savedRules.rules[0].id).toBe('http-rule-1')
    expect(savedAi.coPlanningSettings).toBeUndefined()
    expect(savedAi.__schoolInfoCoPlanningSettings).toBeUndefined()
    expect(savedAi.validSetting).toBe('ok')
  })

  it('HTTP GET /api/schedule performs legacy migration and writeback', async () => {
    assertServerHealthy()

    const legacyManual = {
      enabled: true,
      grades: [5],
      mode: 'manual',
      manualBlocks: {
        5: { day: 2, startPeriod: 3, length: 2 },
      },
    }

    const legacyAiSettings = {
      coPlanningSettings: legacyManual,
      customAiField: 42,
    }

    await prisma.systemSetting.upsert({
      where: { id: 1 },
      update: {
        gradeTimeRulesSettings: '{}',
        ai_settings: JSON.stringify(legacyAiSettings),
      },
      create: {
        id: 1,
        grade_settings: '{}',
        period_defaults: '{}',
        alternative_matrix: '{}',
        gradeTimeRulesSettings: '{}',
        ai_settings: JSON.stringify(legacyAiSettings),
      },
    })

    // First GET call: triggers migration & writeback
    const res1 = await fetch(`${baseUrl}/api/schedule`)
    expect(res1.status).toBe(200)
    const body1 = await res1.json()

    expect(body1.schoolInfo).toBeDefined()
    const rules1 = body1.schoolInfo.gradeTimeRulesSettings
    expect(rules1).toBeDefined()
    expect(rules1.rules.length).toBeGreaterThan(0)
    expect(body1.schoolInfo.ai_settings.coPlanningSettings).toBeUndefined()
    expect(body1.schoolInfo.ai_settings.customAiField).toBe(42)

    // Verify DB writeback
    const dbRecord1 = await prisma.systemSetting.findUnique({
      where: { id: 1 },
    })
    const dbRules1 = parseGradeTimeRulesSettings(dbRecord1.gradeTimeRulesSettings)
    const dbAi1 = JSON.parse(dbRecord1.ai_settings)

    expect(dbRules1.rules.length).toBeGreaterThan(0)
    expect(dbAi1.coPlanningSettings).toBeUndefined()
    expect(dbAi1.customAiField).toBe(42)

    // Second GET call: reads canonical from DB directly
    const res2 = await fetch(`${baseUrl}/api/schedule`)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()

    expect(body2.schoolInfo.gradeTimeRulesSettings).toEqual(rules1)
    expect(body2.schoolInfo.ai_settings.coPlanningSettings).toBeUndefined()
  })

  it('migrates legacy manual co-planning and cleans legacy keys atomically', async () => {
    assertServerHealthy()

    const legacyManual = {
      enabled: true,
      grades: [5, 6],
      mode: 'manual',
      manualBlocks: {
        5: { day: 1, startPeriod: 1, length: 2 },
        6: { day: 2, startPeriod: 3, length: 2 },
      },
    }

    const aiSettings = { coPlanningSettings: legacyManual, otherOption: true }

    // Seed temp DB with legacy data
    await prisma.systemSetting.upsert({
      where: { id: 1 },
      update: {
        ai_settings: JSON.stringify(aiSettings),
        gradeTimeRulesSettings: '{}',
      },
      create: {
        id: 1,
        grade_settings: '{}',
        period_defaults: '{}',
        alternative_matrix: '{}',
        ai_settings: JSON.stringify(aiSettings),
        gradeTimeRulesSettings: '{}',
      },
    })

    // Execute pure persistence preparation
    const prepared = prepareGradeTimeRulesPersistence({
      schoolInfo: null,
      aiSettings,
    })

    expect(prepared.migrated).toBe(true)
    expect(prepared.migrationIssues).toHaveLength(0)

    // Save into temp DB in single atomic operation
    await prisma.systemSetting.update({
      where: { id: 1 },
      data: {
        gradeTimeRulesSettings: serializeGradeTimeRulesSettings(prepared.gradeTimeRulesSettings),
        ai_settings: JSON.stringify(prepared.cleanedAiSettings),
      },
    })

    // Query temp DB and verify
    const dbRecord = await prisma.systemSetting.findUnique({
      where: { id: 1 },
    })
    const savedRules = parseGradeTimeRulesSettings(dbRecord.gradeTimeRulesSettings)
    const savedAi = JSON.parse(dbRecord.ai_settings)

    expect(savedRules.rules).toHaveLength(2)
    expect(savedRules.rules[0].purpose).toBe('co_planning')
    expect(savedAi.coPlanningSettings).toBeUndefined()
    expect(savedAi.__schoolInfoCoPlanningSettings).toBeUndefined()
    expect(savedAi.otherOption).toBe(true)
  })

  it('migrates legacy auto co-planning settings', async () => {
    assertServerHealthy()

    const legacyAuto = {
      enabled: true,
      grades: [5, 6],
      mode: 'auto',
      candidateBlocks: [{ day: 4, startPeriod: 1, length: 2 }],
    }

    const aiSettings = { __schoolInfoCoPlanningSettings: legacyAuto }

    const prepared = prepareGradeTimeRulesPersistence({ aiSettings })
    expect(prepared.migrated).toBe(true)
    expect(prepared.gradeTimeRulesSettings.rules).toHaveLength(2)

    await prisma.systemSetting.update({
      where: { id: 1 },
      data: {
        gradeTimeRulesSettings: serializeGradeTimeRulesSettings(prepared.gradeTimeRulesSettings),
        ai_settings: JSON.stringify(prepared.cleanedAiSettings),
      },
    })

    const dbRecord = await prisma.systemSetting.findUnique({
      where: { id: 1 },
    })
    const savedRules = parseGradeTimeRulesSettings(dbRecord.gradeTimeRulesSettings)
    expect(savedRules.rules[0].timeSelectionMode).toBe('candidate')
  })

  it('canonical setting is preserved and cannot be overwritten by legacy input', async () => {
    assertServerHealthy()

    const canonical = {
      enabled: true,
      version: 2,
      rules: [
        {
          id: 'canonical-rule-1',
          enabled: true,
          purpose: 'general',
          grades: [3],
          timeSelectionMode: 'fixed',
          day: 3,
          periods: [1],
        },
      ],
    }

    const legacy = {
      enabled: true,
      grades: [5, 6],
      mode: 'manual',
      manualBlocks: { 5: { day: 1, startPeriod: 1, length: 2 } },
    }

    const prepared = prepareGradeTimeRulesPersistence({
      gradeTimeRulesSettings: canonical,
      aiSettings: { coPlanningSettings: legacy },
    })

    expect(prepared.migrated).toBe(false)
    expect(prepared.gradeTimeRulesSettings.rules[0].id).toBe('canonical-rule-1')

    await prisma.systemSetting.update({
      where: { id: 1 },
      data: {
        gradeTimeRulesSettings: serializeGradeTimeRulesSettings(prepared.gradeTimeRulesSettings),
        ai_settings: JSON.stringify(prepared.cleanedAiSettings),
      },
    })

    const dbRecord = await prisma.systemSetting.findUnique({
      where: { id: 1 },
    })
    const savedRules = parseGradeTimeRulesSettings(dbRecord.gradeTimeRulesSettings)
    expect(savedRules.rules).toHaveLength(1)
    expect(savedRules.rules[0].id).toBe('canonical-rule-1')
  })

  it('proves cleanLegacyCoPlanningKeys strips legacy keys without ReferenceError', async () => {
    const { cleanLegacyCoPlanningKeys, resolveGradeTimeRulesServerLoad } =
      await import('../src/utils/gradeTimeRulesPersistence.js')

    const legacyAiSettings = {
      coPlanningSettings: { enabled: true },
      __schoolInfoCoPlanningSettings: { enabled: true },
      keepSetting: 'ok',
    }

    const cleanedAi = cleanLegacyCoPlanningKeys(legacyAiSettings)
    expect(cleanedAi.coPlanningSettings).toBeUndefined()
    expect(cleanedAi.__schoolInfoCoPlanningSettings).toBeUndefined()
    expect(cleanedAi.keepSetting).toBe('ok')

    const resolved = resolveGradeTimeRulesServerLoad({
      gradeTimeRulesSettings: null,
      aiSettings: legacyAiSettings,
    })

    expect(resolved.gradeTimeRulesSettings).toBeDefined()
    expect(Array.isArray(resolved.gradeTimeRulesSettings.rules)).toBe(true)
  })

  it('handles migration failure with GRADE_TIME_RULE_MIGRATION_FAILED issue', async () => {
    assertServerHealthy()

    const corruptLegacy = {
      enabled: true,
      grades: [5],
      mode: 'invalid_mode_corrupted',
    }

    const prepared = prepareGradeTimeRulesPersistence({
      aiSettings: { coPlanningSettings: corruptLegacy },
    })

    expect(prepared.migrated).toBe(false)
    expect(prepared.migrationIssues).toHaveLength(1)
    expect(prepared.migrationIssues[0].code).toBe('GRADE_TIME_RULE_MIGRATION_FAILED')
    expect(prepared.migrationIssues[0].severity).toBe('blocking')
    // Legacy keys kept when migration fails
    expect(prepared.cleanedAiSettings.coPlanningSettings).toBeDefined()
  })

  it('duplicate save does not duplicate rules', async () => {
    assertServerHealthy()

    const canonical = {
      enabled: true,
      version: 2,
      rules: [
        {
          id: 'rule-dup-1',
          enabled: true,
          purpose: 'general',
          grades: [1],
          timeSelectionMode: 'fixed',
          day: 1,
          periods: [1],
        },
      ],
    }

    // First save
    const p1 = prepareGradeTimeRulesPersistence({
      gradeTimeRulesSettings: canonical,
    })
    await prisma.systemSetting.update({
      where: { id: 1 },
      data: {
        gradeTimeRulesSettings: serializeGradeTimeRulesSettings(p1.gradeTimeRulesSettings),
      },
    })

    // Second save
    const p2 = prepareGradeTimeRulesPersistence({
      gradeTimeRulesSettings: canonical,
    })
    await prisma.systemSetting.update({
      where: { id: 1 },
      data: {
        gradeTimeRulesSettings: serializeGradeTimeRulesSettings(p2.gradeTimeRulesSettings),
      },
    })

    const dbRecord = await prisma.systemSetting.findUnique({
      where: { id: 1 },
    })
    const savedRules = parseGradeTimeRulesSettings(dbRecord.gradeTimeRulesSettings)
    expect(savedRules.rules).toHaveLength(1)
  })
})
