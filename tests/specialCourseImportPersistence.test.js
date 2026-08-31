import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
    server.on('error', reject)
  })
}

async function waitForServer(baseUrl, getExitError) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const exitError = getExitError()
    if (exitError) throw exitError
    try {
      const response = await fetch(`${baseUrl}/api/schedule`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw getExitError() || new Error('Timed out waiting for the test server')
}

async function stopServer(process) {
  if (!process || process.exitCode !== null || process.signalCode !== null) return
  const exited = new Promise((resolve) => process.once('exit', resolve))
  process.kill('SIGTERM')
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
  if (process.exitCode === null && process.signalCode === null) {
    process.kill('SIGKILL')
    await exited
  }
}

describe('Special-course source metadata persistence API', () => {
  const rootDir = path.resolve(__dirname, '..')
  let baseUrl = ''
  let tempDir = ''
  let serverProcess = null
  let serverExitError = null

  beforeAll(async () => {
    const port = await getFreePort()
    baseUrl = `http://127.0.0.1:${port}`
    tempDir = path.join(os.tmpdir(), `special-course-import-${randomUUID()}`)
    fs.mkdirSync(tempDir, { recursive: true })
    const dbPath = path.join(tempDir, 'test.db')
    fs.writeFileSync(dbPath, '')
    const databaseUrl = `file:${dbPath.replace(/\\/g, '/')}`
    const prismaCli = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js')

    execFileSync(process.execPath, [prismaCli, 'db', 'push', '--schema=prisma/schema.prisma', `--url=${databaseUrl}`], {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    })

    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port) },
      stdio: 'pipe',
    })
    serverProcess.on('exit', (code, signal) => {
      serverExitError = new Error(`Test server exited unexpectedly (code: ${code}, signal: ${signal})`)
    })
    serverProcess.on('error', (error) => {
      serverExitError = error
    })

    await waitForServer(baseUrl, () => serverExitError)
  }, 60000)

  afterAll(async () => {
    await stopServer(serverProcess)
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  async function saveAndLoad(specialCourses) {
    const saveResponse = await fetch(`${baseUrl}/api/save-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teachers: [], classes: [], specialCourses }),
    })
    expect(saveResponse.status).toBe(200)
    const loadResponse = await fetch(`${baseUrl}/api/schedule`)
    expect(loadResponse.status).toBe(200)
    return (await loadResponse.json()).specialCourses
  }

  it('round-trips gifted source metadata with a null source group', async () => {
    const courses = await saveAndLoad([
      {
        type: 'arrow',
        name: '數理資優抽離',
        targetSubject: '數學',
        teacher: '王老師',
        targetClasses: ['5年1班'],
        lockedSlots: [{ day: 1, period: 1 }],
        sourceKind: 'gifted',
        projectName: '數理',
        sourceGroup: null,
      },
    ])

    expect(courses).toHaveLength(1)
    expect(courses[0]).toMatchObject({
      sourceKind: 'gifted',
      projectName: '數理',
      sourceGroup: null,
    })
  })

  it('round-trips learning-center source metadata', async () => {
    const courses = await saveAndLoad([
      {
        type: 'arrow',
        name: '國語學習中心',
        targetSubject: '國語',
        teacher: '李老師',
        targetClasses: ['1年1班'],
        lockedSlots: [{ day: 2, period: 2 }],
        sourceKind: 'learning_center',
        sourceGroup: '國1',
      },
    ])

    expect(courses[0]).toMatchObject({
      sourceKind: 'learning_center',
      sourceGroup: '國1',
      projectName: null,
    })
  })

  it('loads legacy special-course rows with missing source metadata as null', async () => {
    const courses = await saveAndLoad([
      {
        type: 'swimming',
        name: '游泳課',
        targetSubject: '體育',
        teacher: '陳老師',
        targetClasses: ['3年1班'],
        lockedSlots: [{ day: 3, period: 3 }],
      },
    ])

    expect(courses[0]).toMatchObject({
      sourceKind: null,
      projectName: null,
      sourceGroup: null,
      sharedEventId: null,
    })
  })

  it('round-trips sharedEventId for multi-class shared learning-center events', async () => {
    const courses = await saveAndLoad([
      {
        type: 'pullout',
        name: '學習中心',
        targetSubject: '數學',
        teacher: '佑瑩',
        targetClasses: ['4年2班', '4年6班'],
        lockedSlots: [{ day: 4, period: 1 }],
        sourceKind: 'learning_center',
        sourceGroup: null,
        sharedEventId: 'evt-77-80',
      },
      {
        type: 'pullout',
        name: '學習中心',
        targetSubject: '數學',
        teacher: '佑瑩',
        targetClasses: ['5年1班', '5年4班', '5年6班', '5年9班'],
        lockedSlots: [{ day: 4, period: 1 }],
        sourceKind: 'learning_center',
        sourceGroup: null,
        sharedEventId: 'evt-77-80',
      },
    ])

    expect(courses).toHaveLength(2)
    expect(courses[0].sharedEventId).toBe('evt-77-80')
    expect(courses[1].sharedEventId).toBe('evt-77-80')
  })

  it('round-trips mixed confirmed sharedEventId and null sharedEventId payload', async () => {
    const courses = await saveAndLoad([
      { type: 'pullout', name: '學習中心', targetSubject: '數學', teacher: '佑瑩', targetClasses: ['4年2班', '4年6班'], lockedSlots: [{ day: 4, period: 1 }], sourceKind: 'learning_center', sharedEventId: 'evt-198-201' },
      { type: 'pullout', name: '學習中心', targetSubject: '數學', teacher: '佑瑩', targetClasses: ['5年1班', '5年4班', '5年6班', '5年9班'], lockedSlots: [{ day: 4, period: 1 }], sourceKind: 'learning_center', sharedEventId: 'evt-198-201' },
      { type: 'pullout', name: '學習中心', targetSubject: '數學', teacher: '何采珍', targetClasses: ['2年4班', '2年6班', '2年7班'], lockedSlots: [{ day: 4, period: 2 }], sourceKind: 'learning_center', sharedEventId: null },
      { type: 'pullout', name: '學習中心', targetSubject: '語文-國語', teacher: '何采珍', targetClasses: ['5年1班', '5年6班', '5年9班'], lockedSlots: [{ day: 4, period: 2 }], sourceKind: 'learning_center', sharedEventId: null },
    ])

    expect(courses).toHaveLength(4)
    expect(courses.filter((c) => c.sharedEventId === 'evt-198-201')).toHaveLength(2)
    expect(courses.filter((c) => c.sharedEventId === null)).toHaveLength(2)
  })
})
