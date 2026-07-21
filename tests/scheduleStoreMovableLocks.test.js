import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useScheduleStore } from '../src/stores/schedule'

describe('Movable Locks P3a - Store Contract Implementation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('ST-01: Default state has movableLocksEnabled = false and correct empty structures', () => {
    const store = useScheduleStore()
    const policy = store.movableLocksPolicy
    
    // Default disabled
    expect(policy.movableLocksEnabled).toBe(false)
    expect(store.isMovableLocksActive).toBe(false)
    
    // Default arrays are empty
    expect(policy.movableSubjects).toEqual([])
    expect(policy.movableSpecialCourseTypes).toEqual([])
    expect(policy.movableCourseTags).toEqual([])
    
    // Default budgets are 0
    expect(policy.maxMovesTotal).toBe(0)
    expect(policy.maxMovesPerClass).toBe(0)
    expect(policy.maxMovesPerSubject).toBe(0)
    
    // Move window defaults
    expect(policy.moveWindow.scope).toBe('same_day')
    expect(policy.moveWindow.allowCrossMorningAfternoon).toBe(false)
    expect(policy.moveWindow.maxPeriodDistance).toBe(2)
  })

  it('ST-02: setMovableLocksEnabled(true) only enables, does not destroy other fields', () => {
    const store = useScheduleStore()
    store.updateMovableLocksPolicy({ maxMovesTotal: 5 })
    
    store.setMovableLocksEnabled(true)
    expect(store.movableLocksPolicy.movableLocksEnabled).toBe(true)
    expect(store.movableLocksPolicy.maxMovesTotal).toBe(5)
  })

  it('ST-02a: setMovableLocksEnabled(false) resets policy to default disabled shape', () => {
    const store = useScheduleStore()
    store.setMovableLocksEnabled(true)
    store.updateMovableLocksPolicy({ maxMovesTotal: 10, movableSubjects: ['Math'] })
    
    store.setMovableLocksEnabled(false)
    const policy = store.movableLocksPolicy
    expect(policy.movableLocksEnabled).toBe(false)
    expect(policy.maxMovesTotal).toBe(0)
    expect(policy.movableSubjects).toEqual([])
  })

  it('ST-03: updateMovableLocksPolicy merges nested objects like moveWindow correctly', () => {
    const store = useScheduleStore()
    
    store.updateMovableLocksPolicy({
      moveWindow: { maxPeriodDistance: 3 }
    })
    
    const moveWindow = store.movableLocksPolicy.moveWindow
    expect(moveWindow.maxPeriodDistance).toBe(3)
    // scope should still be same_day
    expect(moveWindow.scope).toBe('same_day')
    expect(moveWindow.allowCrossMorningAfternoon).toBe(false)
  })

  it('ST-04: resetMovableLocksPolicy resets to factory defaults', () => {
    const store = useScheduleStore()
    
    store.setMovableLocksEnabled(true)
    store.updateMovableLocksPolicy({
      maxMovesTotal: 10,
      moveWindow: { scope: 'any' }
    })
    
    store.resetMovableLocksPolicy()
    
    const policy = store.movableLocksPolicy
    expect(policy.movableLocksEnabled).toBe(false)
    expect(policy.maxMovesTotal).toBe(0)
    expect(policy.moveWindow.scope).toBe('same_day')
  })

  it('ST-05: isMovableLocksActive computed logic', () => {
    const store = useScheduleStore()
    
    // Disabled by default
    expect(store.isMovableLocksActive).toBe(false)
    
    // Enabled but no budget -> false
    store.setMovableLocksEnabled(true)
    store.updateMovableLocksPolicy({ maxMovesTotal: 0, movableSubjects: ['A'] })
    expect(store.isMovableLocksActive).toBe(false)
    
    // Budget > 0 but no whitelist -> false
    store.updateMovableLocksPolicy({ maxMovesTotal: 5, movableSubjects: [] })
    expect(store.isMovableLocksActive).toBe(false)
    
    // Budget > 0 and has whitelist -> true
    store.updateMovableLocksPolicy({ maxMovesTotal: 5, movableSubjects: ['A'] })
    expect(store.isMovableLocksActive).toBe(true)
  })

  it('ST-06: resetAllData resets movableLocksPolicy and review data', () => {
    const store = useScheduleStore()
    store.setMovableLocksEnabled(true)
    store.updateMovableLocksPolicy({ maxMovesTotal: 5 })
    store.movableLocksReviewData = { someData: true } // Mock review data presence

    store.resetAllData()
    expect(store.movableLocksPolicy.movableLocksEnabled).toBe(false)
    expect(store.movableLocksPolicy.maxMovesTotal).toBe(0)
    expect(store.movableLocksReviewData).toBeNull()
  })

  it('PL-01: runSmartEngine payload assembly injects movableLocksPolicy without dangling timers', async () => {
    const store = useScheduleStore()
    let requestPayload = null
    
    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        requestPayload = JSON.parse(options.body)
        return { ok: true, json: async () => ({ jobId: 'fake-job' }) }
      }
      if (url.includes('/schedule/fake-job') && (!options || options.method === 'GET')) {
        // Return COMPLETED immediately to avoid polling timer
        return { 
          ok: true, 
          json: async () => ({ 
            status: 'COMPLETED',
            result: { schedule: [{}] } // Minimum result
          }) 
        }
      }
      return { ok: true, json: async () => ({}) }
    })
    
    store.updateMovableLocksPolicy({ maxMovesTotal: 7 })
    
    await store.runSmartEngine({ foo: 'bar' })
    
    expect(requestPayload).not.toBeNull()
    expect(requestPayload.movableLocksPolicy).toBeDefined()
    expect(requestPayload.movableLocksPolicy.maxMovesTotal).toBe(7)
    expect(requestPayload.movableLocksPolicy.movableLocksEnabled).toBe(false)
  })

  it('RP-01: Result processing creates movableLocksReviewData only if required', async () => {
    const store = useScheduleStore()
    let mockResult = {}
    
    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ jobId: 'fake-job' }) }
      }
      if (url.includes('/schedule/fake-job')) {
        return { 
          ok: true, 
          json: async () => ({ 
            status: 'COMPLETED',
            result: mockResult
          }) 
        }
      }
      // Provide a mock for loadFromDB which is called by runSmartEngine upon completion
      if (url.endsWith('/schedule') && (!options || options.method === 'GET')) {
        return { ok: true, json: async () => ({}) }
      }
      return { ok: true, json: async () => ({}) }
    })

    // Case 1: no moved lessons -> review data should be null
    mockResult = { schedule: [{}], requiresUserReview: false }
    await store.runSmartEngine({})
    expect(store.movableLocksReviewData).toBeNull()

    // Case 2: has moved lessons -> review data populated
    mockResult = { 
      schedule: [{}], 
      requiresUserReview: true, 
      movedLockedLessons: [{ lessonId: 1 }],
      movableLockSummary: { totalMoves: 1 }
    }
    await store.runSmartEngine({})
    expect(store.movableLocksReviewData).not.toBeNull()
    expect(store.movableLocksReviewData.movedLockedLessons).toHaveLength(1)
    expect(store.movableLocksReviewData.requiresUserReview).toBe(true)
  })
})
