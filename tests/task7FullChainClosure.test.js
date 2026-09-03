import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import * as XLSX from 'xlsx'

import SpecialCourseView from '../src/views/SpecialCourseView.vue'
import { useScheduleStore } from '../src/stores/schedule'

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
  throw getExitError() || new Error('Timed out waiting for the Task 7 test server')
}

async function stopServer(serverProcess) {
  if (!serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode !== null) return
  const exited = new Promise((resolve) => serverProcess.once('exit', resolve))
  serverProcess.kill('SIGTERM')
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
  if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
    serverProcess.kill('SIGKILL')
    await exited
  }
}

function buildWorkbookBuffer() {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['星期', '節次', '3年1班'],
    ['三', '三', '301數學→資訊表達'],
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '區塊排課教務處版0807含創思')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

function seedStore() {
  const store = useScheduleStore()
  store.schoolInfo = {
    academic_year: '115',
    semester: '上學期',
    periodDefaults: { homeroom: 4, subject: 3, admin: 1 },
    gradeSettings: { '3': 1 },
    alternativeMatrix: {},
    classExceptions: [],
  }
  store.aiSettings = {
    homeroomBlockizationEnabled: false,
    allowTeacherOverlap: false,
  }
  store.standardDomainSettings = [
    { id: 'native', name: '語文-國語', defaultTeacher: 'homeroom', periods: { 3: 4 } },
    { id: 'math', name: '數學', defaultTeacher: 'subject', periods: { 3: 2 } },
    { id: 'english', name: '語文-英語', defaultTeacher: 'subject', periods: { 3: 1 } },
  ]
  store.teachers = [
    { id: 't-home', name: '導師A', type: 'homeroom', max_periods: 20, assignedClass: '3年1班', unavailable_slots: [] },
    { id: 't-math', name: '數學老師', type: 'subject', max_periods: 10, subjects: ['數學'], unavailable_slots: [] },
    { id: 't-english', name: '英語老師', type: 'subject', max_periods: 10, subjects: ['語文-英語'], unavailable_slots: [] },
  ]
  store.classes = [{
    name: '3年1班',
    grade: 3,
    homeroomTeacher: '導師A',
    course_requirements: [
      { subject: '語文-國語', periods: 4, teacher_name: '導師A', defaultTeacher: 'homeroom' },
      { subject: '數學', periods: 2, teacher_name: '數學老師', defaultTeacher: 'subject' },
      { subject: '語文-英語', periods: 1, teacher_name: '英語老師', defaultTeacher: 'subject' },
    ],
    timetable: { '1': { '1': { subject: '語文-國語', isLocked: true }, '2': { subject: '語文-國語', isLocked: true } } },
  }]
  store.classrooms = []
  return store
}

describe('Task 7 full chain closure', () => {
  const rootDir = path.resolve(__dirname, '..')
  let baseUrl = ''
  let tempDir = ''
  let serverProcess = null
  let serverExitError = null
  let nativeFetch = null
  let submittedJobId = ''
  let serverOutput = ''

  beforeAll(async () => {
    const port = await getFreePort()
    baseUrl = `http://127.0.0.1:${port}`
    tempDir = path.join(os.tmpdir(), `task7-full-chain-${randomUUID()}`)
    fs.mkdirSync(tempDir, { recursive: true })
    fs.symlinkSync(path.join(rootDir, 'node_modules'), path.join(tempDir, 'node_modules'), 'junction')

    const dbPath = path.join(tempDir, 'test.db')
    fs.writeFileSync(dbPath, '')
    const databaseUrl = `file:${dbPath.replace(/\\/g, '/')}`
    const prismaCli = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js')
    execFileSync(process.execPath, [prismaCli, 'db', 'push', '--schema=prisma/schema.prisma', `--url=${databaseUrl}`], {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    })

    serverProcess = spawn(process.execPath, [path.join(rootDir, 'server.js')], {
      cwd: tempDir,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(port),
        REPAIR_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    serverProcess.stdout.on('data', (data) => { serverOutput += data.toString() })
    serverProcess.stderr.on('data', (data) => { serverOutput += data.toString() })
    serverProcess.on('exit', (code, signal) => {
      serverExitError = new Error(`Task 7 test server exited early (code=${code}, signal=${signal}): ${serverOutput}`)
    })
    await waitForServer(baseUrl, () => serverExitError)
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('alert', vi.fn())
    class MockFileReader {
      readAsArrayBuffer(file) {
        this.onload?.({ target: { result: file.buffer } })
      }
    }
    vi.stubGlobal('FileReader', MockFileReader)

    nativeFetch = globalThis.fetch.bind(globalThis)
    submittedJobId = ''
    vi.stubGlobal('fetch', async (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      const response = await nativeFetch(url.startsWith('/api/') ? `${baseUrl}${url}` : url, init)
      if (url === '/api/schedule' && init?.method === 'POST') {
        submittedJobId = (await response.clone().json()).jobId
      }
      return response
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await stopServer(serverProcess)
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('imports an Excel v2 course through the UI, persists it, and completes the real schedule-worker solver path', async () => {
    const store = seedStore()
    const wrapper = mount(SpecialCourseView)
    const fileInput = wrapper.get('[data-testid="block-schedule-import-file"]')
    Object.defineProperty(fileInput.element, 'files', {
      value: [{ name: 'task7.xlsx', buffer: buildWorkbookBuffer() }],
      writable: true,
    })

    await fileInput.trigger('change')
    await flushPromises()
    expect(wrapper.find('[data-testid="blocker-section"]').exists()).toBe(false)

    await wrapper.get('[data-testid="confirm-block-schedule-import"]').trigger('click')
    await flushPromises()

    const importedCourse = store.specialCourses.at(-1)
    expect(importedCourse).toMatchObject({
      semanticVersion: 2,
      pulloutLabelSubject: '數學',
      deliveryCourseName: '資訊表達',
      participantGroupId: null,
      teacherAssignmentMode: 'center_pool',
      timePolicy: 'legacy_hard',
      classSubjectSynchronization: 'none',
      targetClasses: ['3年1班'],
      legalTimeWindow: [{ day: 3, period: 3 }],
    })

    const persisted = await nativeFetch(`${baseUrl}/api/schedule`).then((response) => response.json())
    expect(persisted.specialCourses).toHaveLength(1)
    expect(persisted.specialCourses[0]).toMatchObject({
      semanticVersion: 2,
      deliveryCourseName: '資訊表達',
      participantGroupId: null,
      teacherAssignmentMode: 'center_pool',
      sourceAnchor: expect.objectContaining({ day: 3, period: 3 }),
    })
    expect(persisted.classes[0].course_requirements.map(({ subject, periods }) => ({ subject, periods }))).toEqual([
      { subject: '語文-國語', periods: 4 },
      { subject: '數學', periods: 2 },
      { subject: '語文-英語', periods: 1 },
    ])
    expect(store.classes[0].course_requirements.map(({ subject, periods }) => ({ subject, periods }))).toEqual([
      { subject: '語文-國語', periods: 4 },
      { subject: '數學', periods: 2 },
      { subject: '語文-英語', periods: 1 },
    ])

    const completed = await store.runSmartEngine({
      schoolInfo: store.schoolInfo,
      teachers: store.teachers,
      classes: store.classes,
      specialCourses: store.specialCourses,
      classrooms: store.classrooms,
      standardDomainSettings: store.standardDomainSettings,
      aiSettings: store.aiSettings,
    })

    const completedJob = await nativeFetch(`${baseUrl}/api/schedule/${submittedJobId}`).then((response) => response.json())
    expect(completed, JSON.stringify(completedJob)).toBe(true)
    expect(completedJob.status).toBe('COMPLETED')
    expect(store.engineResult?.solverStatus).toMatch(/^(OPTIMAL|FEASIBLE)$/)
    expect(serverOutput).toContain('加入特殊課程鎖定')
  }, 60000)
})
