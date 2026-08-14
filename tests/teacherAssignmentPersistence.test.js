import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import net from 'net'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { createHash, randomUUID } from 'crypto'

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
    } catch {}
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

describe('Subject Assignment Rules & Code Mappings Persistence API', () => {
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
    serverExitError = new Error(
      `Child server on port ${testPort} exited unexpectedly (code: ${code}, signal: ${signal}). Stderr:\n${stderrBuffer}`,
    )
  }

  const handleChildError = (err) => {
    serverExitError = new Error(
      `Child server error on port ${testPort}: ${err.message}. Stderr:\n${stderrBuffer}`,
    )
  }

  beforeAll(async () => {
    initialDevDbInfo = getFileHashAndMtime(devDbPath)

    testPort = await getFreePort()
    baseUrl = `http://127.0.0.1:${testPort}`

    tempDir = path.join(os.tmpdir(), 'teacher-assign-test-' + randomUUID())
    tempDbPath = path.join(tempDir, 'test.db')

    fs.mkdirSync(tempDir, { recursive: true })
    fs.writeFileSync(tempDbPath, '')

    const dbUrl = `file:${tempDbPath.replace(/\\/g, '/')}`
    const prismaJs = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js')

    execFileSync(
      process.execPath,
      [prismaJs, 'db', 'push', '--schema=prisma/schema.prisma', `--url=${dbUrl}`],
      {
        cwd: rootDir,
        env: { ...process.env, DATABASE_URL: dbUrl },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    )

    const adapter = new PrismaBetterSqlite3({ url: dbUrl })
    prisma = new PrismaClient({ adapter })

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
  }, 60000)

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.removeListener('exit', handleChildExit)
      serverProcess.removeListener('error', handleChildError)
      await stopServerProcess(serverProcess)
    }

    if (prisma) {
      await prisma.$disconnect()
    }

    if (tempDir && fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      })
    }

    const finalDevDbInfo = getFileHashAndMtime(devDbPath)
    if (initialDevDbInfo && finalDevDbInfo) {
      expect(finalDevDbInfo.hash).toBe(initialDevDbInfo.hash)
      expect(finalDevDbInfo.mtime).toBe(initialDevDbInfo.mtime)
    }
  })

  it('persists subjectCodeMappings, expertise_allocations, and assignment_rules across save-all and load-data', async () => {
    if (serverExitError) throw serverExitError

    const payload = {
      schoolInfo: {
        subjectCodeMappings: { 電: '科技-資訊', 藝: '音樂' },
      },
      teachers: [
        {
          name: '測試專任',
          type: 'subject',
          max_periods: 17,
          expertise_allocations: [{ subject: '科技-資訊', quota: 17 }],
          assignment_rules: [
            { grade: 5, subject: '科技-資訊', periods: 7, excelCode: '電' },
            { grade: 3, subject: '科技-資訊', periods: 10, excelCode: '電' },
          ],
        },
      ],
      classes: [],
    }

    const saveRes = await fetch(`${baseUrl}/api/save-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(saveRes.status).toBe(200)

    const loadRes = await fetch(`${baseUrl}/api/schedule`)
    expect(loadRes.status).toBe(200)
    const data = await loadRes.json()

    expect(data.schoolInfo.subjectCodeMappings).toEqual({ 電: '科技-資訊', 藝: '音樂' })
    expect(data.teachers[0].expertise_allocations).toEqual([{ subject: '科技-資訊', quota: 17 }])
    expect(data.teachers[0].assignment_rules).toHaveLength(2)
    expect(data.teachers[0].assignment_rules[0]).toEqual({
      grade: 5,
      subject: '科技-資訊',
      periods: 7,
      excelCode: '電',
    })
  })

  it('round-trips UI-resolved homeroom teachers and homeroom lesson assignments', async () => {
    if (serverExitError) throw serverExitError

    const payload = {
      teachers: [
        { name: '康惠淑', type: 'homeroom', assignedClass: '1年1班' },
      ],
      classes: [
        {
          name: '1年1班',
          grade: 1,
          homeroom_teacher: '康惠淑',
          course_requirements: [
            { subject: '數學', periods: 4, defaultTeacher: 'homeroom', teacher: '康惠淑' },
          ],
        },
      ],
    }

    const saveRes = await fetch(`${baseUrl}/api/save-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(saveRes.status).toBe(200)

    const loadRes = await fetch(`${baseUrl}/api/schedule`)
    expect(loadRes.status).toBe(200)
    const data = await loadRes.json()
    const savedClass = data.classes.find((cls) => cls.name === '1年1班')

    expect(savedClass).toMatchObject({ homeroom_teacher: '康惠淑' })
    const savedRequirement = savedClass.course_requirements.find((requirement) => requirement.subject === '數學')
    expect(savedRequirement).toMatchObject({ periods: 4 })
    expect(savedRequirement.teacher_name).toBe('康惠淑')
    expect(savedRequirement.teacher).toBe('康惠淑')
  })
})
