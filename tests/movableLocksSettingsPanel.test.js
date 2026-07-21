import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useScheduleStore } from '../src/stores/schedule'
import AiSettingsView from '../src/views/AiSettingsView.vue'

describe('Movable Locks Settings UI & Policy Selector', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('1. 預設 disabled：主開關未開且 isMovableLocksActive === false', () => {
    const store = useScheduleStore()
    expect(store.movableLocksPolicy.movableLocksEnabled).toBe(false)
    expect(store.isMovableLocksActive).toBe(false)
    expect(store.movableLocksPolicy.movableSubjects).toEqual([])
    expect(store.movableLocksPolicy.maxMovesTotal).toBe(0)
  })

  it('2. 開啟主開關但沒有白名單：顯示 warning，isMovableLocksActive === false', () => {
    const store = useScheduleStore()
    store.setMovableLocksEnabled(true)
    store.updateMovableLocksPolicy({
      movableSubjects: [],
      movableSpecialCourseTypes: [],
      movableCourseTags: [],
      maxMovesTotal: 5
    })

    expect(store.movableLocksPolicy.movableLocksEnabled).toBe(true)
    expect(store.isMovableLocksActive).toBe(false)

    // Component mount check for warning banner
    const wrapper = mount(AiSettingsView, {
      global: {
        stubs: {
          // stub axios or store calls if needed
        }
      }
    })

    const warningBanner = wrapper.find('.movable-locks-warning-banner')
    expect(warningBanner.exists()).toBe(true)
    expect(warningBanner.text()).toContain('尚未勾選任何允許微調的科目或特殊課程類型')
  })

  it('3. 選擇一個科目 + maxMovesTotal > 0：movableSubjects 正確更新且 isMovableLocksActive === true', () => {
    const store = useScheduleStore()
    store.setMovableLocksEnabled(true)
    store.updateMovableLocksPolicy({
      movableSubjects: ['語文-英語'],
      maxMovesTotal: 5
    })

    expect(store.movableLocksPolicy.movableSubjects).toContain('語文-英語')
    expect(store.movableLocksPolicy.maxMovesTotal).toBe(5)
    expect(store.isMovableLocksActive).toBe(true)

    // Component mount check for active badge
    const wrapper = mount(AiSettingsView)
    const activeBadge = wrapper.find('.status-badge')
    expect(activeBadge.exists()).toBe(true)
    expect(activeBadge.text()).toContain('提案功能已生效 (Active)')
  })

  it('4. 關閉主開關：policy reset，movableSubjects 清空，budgets 回 0', () => {
    const store = useScheduleStore()
    store.setMovableLocksEnabled(true)
    store.updateMovableLocksPolicy({
      movableSubjects: ['語文-英語', '自然科學'],
      movableSpecialCourseTypes: ['pullout_lock'],
      maxMovesTotal: 10,
      maxMovesPerClass: 3
    })

    expect(store.isMovableLocksActive).toBe(true)

    // 關閉主開關
    store.setMovableLocksEnabled(false)

    const policy = store.movableLocksPolicy
    expect(policy.movableLocksEnabled).toBe(false)
    expect(policy.movableSubjects).toEqual([])
    expect(policy.movableSpecialCourseTypes).toEqual([])
    expect(policy.maxMovesTotal).toBe(0)
    expect(policy.maxMovesPerClass).toBe(0)
    expect(policy.maxMovesPerSubject).toBe(0)
    expect(store.isMovableLocksActive).toBe(false)
  })

  it('5. moveWindow 修改：scope, allowCrossMorningAfternoon, maxPeriodDistance 都能正確寫入 store', () => {
    const store = useScheduleStore()
    store.setMovableLocksEnabled(true)

    store.updateMovableLocksPolicy({
      moveWindow: {
        scope: 'same_halfday',
        allowCrossMorningAfternoon: true,
        maxPeriodDistance: 4
      }
    })

    const moveWindow = store.movableLocksPolicy.moveWindow
    expect(moveWindow.scope).toBe('same_halfday')
    expect(moveWindow.allowCrossMorningAfternoon).toBe(true)
    expect(moveWindow.maxPeriodDistance).toBe(4)
  })
})
