import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useScheduleStore } from '../src/stores/schedule'

describe('Schedule Store Engine Errors', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('應正確處理 INVALID_INPUT：設定錯誤訊息、解析 classLoadTrace 並更新 gradeMaxPeriods', async () => {
    const store = useScheduleStore()

    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ jobId: 'job-invalid-input' }) }
      }
      if (url.includes('/schedule/job-invalid-input')) {
        return {
          ok: true,
          json: async () => ({
            jobId: 'job-invalid-input',
            status: 'FAILED',
            result: {
              status: 'INVALID_INPUT',
              solverStatus: 'INVALID_INPUT',
              error: '輸入資料驗證失敗：有 1 個班級發生總節數超載',
              classLoadTrace: [
                {
                  className: '101',
                  grade: 1,
                  totalPeriods: 32,
                  capacity: 29,
                  periodExcess: 3,
                  validationError: 'INVALID_INPUT_CLASS_LOAD',
                },
              ],
              gradeCapacityMap: {
                grade1: 29,
                grade2: 29,
                grade3: 33,
              },
            },
            progressPhase: 'FAILED',
            progressMessage: '排課失敗：輸入資料驗證失敗',
            startedAt: '2026-08-21T10:00:00.000Z',
            finishedAt: '2026-08-21T10:00:02.000Z',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    const success = await store.runSmartEngine({})

    expect(success).toBe(false)
    expect(store.engineStatus).toBe('ERROR')
    expect(store.enginePhase).toBe('FAILED')
    expect(store.engineErrorMessage).toContain('輸入資料驗證失敗')
    expect(store.engineDiagnosticWarningDetails.length).toBeGreaterThan(0)
    expect(store.engineDiagnosticWarningDetails[0].category).toBe('CLASS_LOAD')
    expect(store.engineDiagnosticWarningDetails[0].className).toBe('101')
    expect(store.schoolInfo.gradeMaxPeriods).toEqual({ 1: 29, 2: 29, 3: 33 })
  })

  it('應正確處理 INFEASIBLE：呈現無法找到可行解錯誤及結構化診斷警示', async () => {
    const store = useScheduleStore()

    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ jobId: 'job-infeasible' }) }
      }
      if (url.includes('/schedule/job-infeasible')) {
        return {
          ok: true,
          json: async () => ({
            jobId: 'job-infeasible',
            status: 'FAILED',
            result: {
              status: 'INFEASIBLE',
              solverStatus: 'INFEASIBLE',
              error: '無法產出符合條件的課表',
              diagnosticWarnings: [
                {
                  level: 'warn',
                  category: 'special_room',
                  message: '電腦教室容量不足（需求 8 節 > 容量 6 節）',
                  displayText: '[WARN] 電腦教室容量不足（需求 8 節 > 容量 6 節）',
                },
              ],
              aiAnalysis: ['[WARN] 電腦教室容量不足'],
            },
            progressPhase: 'FAILED',
            progressMessage: '排課失敗：無法產出符合條件的課表',
            startedAt: '2026-08-21T10:00:00.000Z',
            finishedAt: '2026-08-21T10:00:05.000Z',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    const success = await store.runSmartEngine({})

    expect(success).toBe(false)
    expect(store.engineStatus).toBe('ERROR')
    expect(store.enginePhase).toBe('FAILED')
    expect(store.engineErrorMessage).toContain('無法產出符合條件的課表')
    expect(store.engineDiagnosticWarnings).toContain(
      '[WARN] 電腦教室容量不足（需求 8 節 > 容量 6 節）',
    )
  })

  it('應正確處理 INVALID_VALIDATION：解析驗證錯誤報告並顯示具體違規警示', async () => {
    const store = useScheduleStore()

    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ jobId: 'job-invalid-val' }) }
      }
      if (url.includes('/schedule/job-invalid-val')) {
        return {
          ok: true,
          json: async () => ({
            jobId: 'job-invalid-val',
            status: 'FAILED',
            result: {
              status: 'INVALID_VALIDATION',
              solverStatus: 'INVALID_VALIDATION',
              message: '求解結果未通過硬限制驗證，請檢查 debug_schedule_validation_report.json',
              validationReport: {
                unassigned_special_rooms: [
                  { className: '501', subject: '資訊', reason: '未排入指定專科教室' },
                ],
              },
              diagnosticWarnings: [],
            },
            progressPhase: 'FAILED',
            startedAt: '2026-08-21T10:00:00.000Z',
            finishedAt: '2026-08-21T10:00:04.000Z',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    const success = await store.runSmartEngine({})

    expect(success).toBe(false)
    expect(store.engineStatus).toBe('ERROR')
    expect(store.enginePhase).toBe('FAILED')
    expect(store.engineErrorMessage).toContain('未通過硬限制驗證')
    expect(store.engineDiagnosticWarningDetails.length).toBeGreaterThan(0)
    expect(store.engineDiagnosticWarningDetails[0].category).toBe('SPECIAL_ROOM')
  })

  it('應正確處理 TIMEOUT_NO_SOLUTION：設定逾時專用錯誤訊息與階段狀態', async () => {
    const store = useScheduleStore()

    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ jobId: 'job-timeout' }) }
      }
      if (url.includes('/schedule/job-timeout')) {
        return {
          ok: true,
          json: async () => ({
            jobId: 'job-timeout',
            status: 'FAILED',
            result: {
              status: 'TIMEOUT_NO_SOLUTION',
              solverStatus: 'TIMEOUT_NO_SOLUTION',
              message: '求解逾時，未找到任何可行解',
              diagnosticWarnings: [],
              aiAnalysis: [],
            },
            progressPhase: 'FAILED',
            startedAt: '2026-08-21T10:00:00.000Z',
            finishedAt: '2026-08-21T10:00:30.000Z',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    const success = await store.runSmartEngine({})

    expect(success).toBe(false)
    expect(store.engineStatus).toBe('ERROR')
    expect(store.enginePhase).toBe('FAILED')
    expect(store.engineErrorMessage).toContain('逾時')
  })

  it('應正確處理成功排課 (COMPLETED + OPTIMAL)：狀態為 COMPLETED 且無錯誤訊息', async () => {
    const store = useScheduleStore()

    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ jobId: 'job-success' }) }
      }
      if (url.includes('/schedule/job-success')) {
        return {
          ok: true,
          json: async () => ({
            jobId: 'job-success',
            status: 'COMPLETED',
            result: {
              status: 'OPTIMAL',
              solverStatus: 'OPTIMAL',
              schedule: [{ id: 1, class_id: 101, teacher_name: '張老師', day: 1, period: 1 }],
            },
            progressPhase: 'COMPLETED',
            startedAt: '2026-08-21T10:00:00.000Z',
            finishedAt: '2026-08-21T10:00:03.000Z',
          }),
        }
      }
      if (url.endsWith('/schedule') && (!options || options.method === 'GET')) {
        return { ok: true, json: async () => ({ timetable: [] }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    const success = await store.runSmartEngine({})

    expect(success).toBe(true)
    expect(store.engineStatus).toBe('COMPLETED')
    expect(store.engineErrorMessage).toBe('')
  })

  it('應正確處理 COMPLETED + ERROR 回歸案例：狀態為 ERROR 且判定為失敗', async () => {
    const store = useScheduleStore()

    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ jobId: 'job-completed-error' }) }
      }
      if (url.includes('/schedule/job-completed-error')) {
        return {
          ok: true,
          json: async () => ({
            jobId: 'job-completed-error',
            status: 'COMPLETED',
            result: {
              status: 'ERROR',
              solverStatus: 'ERROR',
              error: '排課引擎發生非預期錯誤',
            },
            progressPhase: 'FAILED',
            startedAt: '2026-08-21T10:00:00.000Z',
            finishedAt: '2026-08-21T10:00:02.000Z',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    const success = await store.runSmartEngine({})

    expect(success).toBe(false)
    expect(store.engineStatus).toBe('ERROR')
    expect(store.enginePhase).toBe('FAILED')
    expect(store.engineErrorMessage).toContain('排課引擎發生非預期錯誤')
  })
})
