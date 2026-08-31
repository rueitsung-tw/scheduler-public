import { describe, expect, it } from 'vitest'
import { createPinia } from 'pinia'
import { useScheduleStore } from '../src/stores/schedule.js'

describe('applyBlockScheduleImport', () => {
  function getStore() {
    const pinia = createPinia()
    const store = useScheduleStore(pinia)
    return store
  }

  it('appends new courses and generates IDs with teacher_name', () => {
    const store = getStore()
    store.specialCourses = []
    const courses = [
      { name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', teacher: null },
    ]
    store.applyBlockScheduleImport({ courses, replaceIds: [], clearExisting: false })
    expect(store.specialCourses).toHaveLength(1)
    expect(store.specialCourses[0]).toMatchObject({ targetSubject: '數學', teacher_name: '' })
    expect(store.specialCourses[0].id).toBeDefined()
  })

  it('replaces only selected IDs and retains the rest', () => {
    const store = getStore()
    store.specialCourses = [
      { id: 'keep-me', name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', teacher: '李靖', teacher_name: '李靖' },
      { id: 'replace-me', name: '學習中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', teacher: null, teacher_name: '' },
    ]
    const courses = [
      { name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', teacher: null },
    ]
    store.applyBlockScheduleImport({ courses, replaceIds: ['replace-me'], clearExisting: false })
    expect(store.specialCourses).toHaveLength(2)
    expect(store.specialCourses.find(c => c.id === 'keep-me')).toBeDefined()
    expect(store.specialCourses.find(c => c.id === 'replace-me')).toBeUndefined()
    expect(store.specialCourses[1].targetSubject).toBe('數學')
  })

  it('clears all existing third-track rules when clearExisting is true', () => {
    const store = getStore()
    store.specialCourses = [
      { id: 'a', name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', teacher: '李靖', teacher_name: '李靖' },
      { id: 'b', name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', teacher: null, teacher_name: '' },
    ]
    const courses = [
      { name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', teacher: null },
    ]
    store.applyBlockScheduleImport({ courses, replaceIds: [], clearExisting: true })
    expect(store.specialCourses).toHaveLength(1)
    expect(store.specialCourses[0]).toMatchObject({ targetSubject: '數學', teacher_name: '' })
  })

  it('syncs teacher_name from teacher for learning center courses', () => {
    const store = getStore()
    store.specialCourses = []
    const courses = [
      { name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', teacher: '李靖' },
    ]
    store.applyBlockScheduleImport({ courses, replaceIds: [], clearExisting: false })
    expect(store.specialCourses[0].teacher_name).toBe('李靖')
  })

  it('produces records matching the solver special-course contract', () => {
    // Contract: every record must have isAutoTime=false, isAutoClass=false,
    // a single lockedSlots entry, non-empty targetClasses, and a targetSubject
    const store = getStore()
    store.specialCourses = []
    const courses = [
      { name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班', '3年8班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', teacher: null, isAutoTime: false, isAutoClass: false },
      { name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', teacher: '李靖', isAutoTime: false, isAutoClass: false },
    ]
    store.applyBlockScheduleImport({ courses, replaceIds: [], clearExisting: false })
    expect(store.specialCourses).toHaveLength(2)
    for (const course of store.specialCourses) {
      expect(course.isAutoTime).toBe(false)
      expect(course.isAutoClass).toBe(false)
      expect(Array.isArray(course.lockedSlots)).toBe(true)
      expect(course.lockedSlots.length).toBeGreaterThan(0)
      expect(Array.isArray(course.targetClasses)).toBe(true)
      expect(course.targetClasses.length).toBeGreaterThan(0)
      expect(typeof course.targetSubject).toBe('string')
      expect(course.targetSubject.length).toBeGreaterThan(0)
      expect(typeof course.id).toBe('string')
      expect(typeof course.teacher_name).toBe('string')
    }
  })

  it('replaces legacy-null records 198, 201, 204, 210 without duplicate course appends', () => {
    const store = getStore()
    store.specialCourses = [
      { id: 198, name: '學習中心', targetSubject: '數學', targetClasses: ['4年2班', '4年6班'], lockedSlots: [{ day: 4, period: 1 }], sourceKind: 'learning_center', teacher: '佑瑩', teacher_name: '佑瑩', sharedEventId: null },
      { id: 201, name: '學習中心', targetSubject: '數學', targetClasses: ['5年1班', '5年4班', '5年6班', '5年9班'], lockedSlots: [{ day: 4, period: 1 }], sourceKind: 'learning_center', teacher: '佑瑩', teacher_name: '佑瑩', sharedEventId: null },
      { id: 204, name: '學習中心', targetSubject: '數學', targetClasses: ['2年4班', '2年6班', '2年7班'], lockedSlots: [{ day: 4, period: 2 }], sourceKind: 'learning_center', teacher: '何采珍', teacher_name: '何采珍', sharedEventId: null },
      { id: 210, name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年1班', '5年6班', '5年9班'], lockedSlots: [{ day: 4, period: 2 }], sourceKind: 'learning_center', teacher: '何采珍', teacher_name: '何采珍', sharedEventId: null },
    ]

    const courses = [
      { name: '學習中心', targetSubject: '數學', targetClasses: ['4年2班', '4年6班'], lockedSlots: [{ day: 4, period: 1 }], sourceKind: 'learning_center', teacher: '佑瑩', sharedEventId: 'evt-198-201' },
      { name: '學習中心', targetSubject: '數學', targetClasses: ['5年1班', '5年4班', '5年6班', '5年9班'], lockedSlots: [{ day: 4, period: 1 }], sourceKind: 'learning_center', teacher: '佑瑩', sharedEventId: 'evt-198-201' },
      { name: '學習中心', targetSubject: '數學', targetClasses: ['2年4班', '2年6班', '2年7班'], lockedSlots: [{ day: 4, period: 2 }], sourceKind: 'learning_center', teacher: '何采珍', sharedEventId: null },
      { name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年1班', '5年6班', '5年9班'], lockedSlots: [{ day: 4, period: 2 }], sourceKind: 'learning_center', teacher: '何采珍', sharedEventId: null },
    ]

    store.applyBlockScheduleImport({ courses, replaceIds: [198, 201, 204, 210], clearExisting: false })

    expect(store.specialCourses).toHaveLength(4)
    expect(store.specialCourses.some((c) => c.id === 198 || c.id === 201 || c.id === 204 || c.id === 210)).toBe(false)
    const sharedIds = store.specialCourses.map((c) => c.sharedEventId)
    expect(sharedIds.filter((id) => id === 'evt-198-201')).toHaveLength(2)
    expect(sharedIds.filter((id) => id === null)).toHaveLength(2)
  })
})
