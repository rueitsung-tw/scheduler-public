import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ClassForm from '../src/components/ClassForm.vue'

const mocked = vi.hoisted(() => ({ scheduleStore: null }))

vi.mock('../src/stores/schedule', () => ({
  useScheduleStore: () => mocked.scheduleStore,
}))

describe('ClassForm batch generation', () => {
  let wrapper

  beforeEach(() => {
    mocked.scheduleStore = {
      classes: [{ name: '1年1班', homeroom_teacher: null, course_requirements: [] }],
      teachers: [{ id: 1, name: '康惠淑', type: 'homeroom', assignedClass: '1年1班' }],
      standardDomainSettings: [{ name: '數學', defaultTeacher: 'homeroom', periods: { 1: 4 } }],
      schoolInfo: {
        classExceptions: [],
        alternativeMatrix: { 1: [{ subject: '彈性導師課', defaultTeacher: 'homeroom', periods: 1 }] },
      },
      markScheduleDirty: vi.fn(),
      syncToCloud: vi.fn().mockResolvedValue(true),
    }
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    mocked.scheduleStore = null
  })

  it('fills missing homeroom teachers from the uniquely assigned homeroom teacher', async () => {
    wrapper = mount(ClassForm)

    await wrapper.get('button.batch-btn').trigger('click')
    await flushPromises()

    const classData = mocked.scheduleStore.classes[0]
    expect(classData.course_requirements).toEqual([
      expect.objectContaining({ subject: '數學', periods: 4, teacher: '康惠淑' }),
      expect.objectContaining({ subject: '彈性導師課', periods: 1, teacher: '康惠淑' }),
    ])
    expect(classData.homeroom_teacher).toBe('康惠淑')
    expect(mocked.scheduleStore.markScheduleDirty).toHaveBeenCalledTimes(1)
    expect(mocked.scheduleStore.syncToCloud).toHaveBeenCalledTimes(1)
  })

  it('uses the class homeroom teacher name before an assigned-class fallback candidate', async () => {
    mocked.scheduleStore.classes[0].homeroom_teacher = '直接班導'
    mocked.scheduleStore.teachers = [
      { id: 1, name: '直接班導', type: 'homeroom', assignedClass: '1年2班' },
      { id: 2, name: 'fallback 班導', type: 'homeroom', assignedClass: '1年1班' },
    ]
    wrapper = mount(ClassForm)

    await wrapper.get('button.batch-btn').trigger('click')
    await flushPromises()

    const requirements = mocked.scheduleStore.classes[0].course_requirements
    expect(mocked.scheduleStore.classes[0].homeroom_teacher).toBe('直接班導')
    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: '數學', teacher: '直接班導' }),
      expect.objectContaining({ subject: '彈性導師課', teacher: '直接班導' }),
    ]))
  })

  it('resolves an object homeroom teacher reference with only an ID', async () => {
    mocked.scheduleStore.classes[0].homeroom_teacher = { id: 42 }
    mocked.scheduleStore.teachers = [
      { id: 42, name: 'ID 班導', type: 'homeroom', assignedClass: '1年2班' },
      { id: 7, name: 'fallback 班導', type: 'homeroom', assignedClass: '1年1班' },
    ]
    wrapper = mount(ClassForm)

    await wrapper.get('button.batch-btn').trigger('click')
    await flushPromises()

    const requirements = mocked.scheduleStore.classes[0].course_requirements
    expect(mocked.scheduleStore.classes[0].homeroom_teacher).toBe('ID 班導')
    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: '數學', teacher: 'ID 班導' }),
      expect.objectContaining({ subject: '彈性導師課', teacher: 'ID 班導' }),
    ]))
  })

  it('leaves homeroom lessons unassigned when only non-homeroom teachers match the class', async () => {
    mocked.scheduleStore.teachers = [
      { id: 1, name: '專任候選', type: 'subject', assignedClass: '1年1班' },
      { id: 2, name: '行政候選', type: 'admin', assignedClass: '1年1班' },
    ]
    wrapper = mount(ClassForm)

    await wrapper.get('button.batch-btn').trigger('click')
    await flushPromises()

    const requirements = mocked.scheduleStore.classes[0].course_requirements
    expect(mocked.scheduleStore.classes[0].homeroom_teacher).toBeNull()
    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: '數學', teacher: '' }),
      expect.objectContaining({ subject: '彈性導師課', teacher: '' }),
    ]))
  })

  it('leaves homeroom lessons unassigned when multiple homeroom teachers claim the class', async () => {
    mocked.scheduleStore.teachers = [
      { id: 1, name: '第一位班導', type: 'homeroom', assignedClass: '1年1班' },
      { id: 2, name: '第二位班導', type: 'homeroom', assignedClass: '1年1班' },
    ]
    wrapper = mount(ClassForm)

    await wrapper.get('button.batch-btn').trigger('click')
    await flushPromises()

    const requirements = mocked.scheduleStore.classes[0].course_requirements
    expect(mocked.scheduleStore.classes[0].homeroom_teacher).toBeNull()
    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: '數學', teacher: '' }),
      expect.objectContaining({ subject: '彈性導師課', teacher: '' }),
    ]))
  })

  it('does not update teacher state or show success when cloud sync returns false', async () => {
    mocked.scheduleStore.classes[0].homeroom_teacher = '待同步班導'
    mocked.scheduleStore.teachers = [
      { id: 1, name: '待同步班導', type: 'subject', assignedClass: '原班級' },
    ]
    mocked.scheduleStore.syncToCloud.mockResolvedValue(false)
    wrapper = mount(ClassForm)

    await wrapper.get('button.batch-btn').trigger('click')
    await flushPromises()

    const requirements = mocked.scheduleStore.classes[0].course_requirements
    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: '數學', teacher: '待同步班導' }),
      expect.objectContaining({ subject: '彈性導師課', teacher: '待同步班導' }),
    ]))
    expect(mocked.scheduleStore.teachers[0]).toMatchObject({
      type: 'subject',
      assignedClass: '原班級',
    })
    expect(globalThis.alert).not.toHaveBeenCalled()
  })
})
