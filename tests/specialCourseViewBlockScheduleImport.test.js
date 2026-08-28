import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import * as XLSX from 'xlsx'

import SpecialCourseView from '../src/views/SpecialCourseView.vue'
import { useScheduleStore } from '../src/stores/schedule'

function buildWorkbookBuffer(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '區塊排課教務處版0807含創思')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('SpecialCourseView block schedule import', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('alert', vi.fn())

    class MockFileReader {
      readAsArrayBuffer(file) {
        if (this.onload) {
          const buffer = file.buffer || file.arrayBuffer || new ArrayBuffer(0)
          this.onload({ target: { result: buffer } })
        }
      }
    }

    vi.stubGlobal('FileReader', MockFileReader)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const seedStore = () => {
    const store = useScheduleStore()
    store.standardDomainSettings = [{ name: '語文-國語' }, { name: '數學' }]
    store.classes = [
      {
        name: '3年3班',
        grade: 3,
        course_requirements: [{ subject: '語文-國語' }, { subject: '數學' }],
      },
    ]
    store.teachers = [
      { id: 't-1', name: '李靖', type: 'special_ed_resource' },
    ]
    return store
  }

  const uploadWorkbook = async (wrapper, rows) => {
    const fileInput = wrapper.get('[data-testid="block-schedule-import-file"]')
    const mockFile = {
      name: '115學年度區塊排課0807.xlsx',
      buffer: buildWorkbookBuffer(rows),
    }

    Object.defineProperty(fileInput.element, 'files', {
      value: [mockFile],
      writable: true,
    })

    await fileInput.trigger('change')
    await flushPromises()
  }

  it('shows appendable, replacement, and warning previews after upload', async () => {
    const store = seedStore()
    store.specialCourses = [
      {
        id: 'warn-1',
        name: '學習中心',
        targetSubject: '語文-國語',
        targetClasses: ['3年3班'],
        lockedSlots: [{ day: 1, period: 2 }],
        sourceKind: 'learning_center',
        sourceGroup: '國1',
        teacher: '李靖',
        teacher_name: '李靖',
      },
      {
        id: 'replace-1',
        name: '學習中心',
        targetSubject: '語文-國語',
        targetClasses: ['3年3班'],
        lockedSlots: [{ day: 1, period: 3 }],
        sourceKind: 'learning_center',
        sourceGroup: '國1',
        teacher: '李靖',
        teacher_name: '李靖',
      },
    ]

    const wrapper = mount(SpecialCourseView)
    await uploadWorkbook(wrapper, [
      ['星期', '節次', '3年3班'],
      ['一', '一', '303數學→數理'],
      ['一', '二', '303國2 (李靖)'],
      ['一', '三', '303國1 (李靖)'],
    ])

    expect(wrapper.get('[data-testid="appendable-section"]').text()).toContain('可追加')
    expect(wrapper.get('[data-testid="appendable-section"]').text()).toContain('數理')
    expect(wrapper.get('[data-testid="replacement-section"]').text()).toContain('需確認取代')
    expect(wrapper.get('[data-testid="replacement-section"]').text()).toContain('取代既有 replace-1')
    expect(wrapper.get('[data-testid="import-warnings"]').text()).toContain('重疊')
    expect(wrapper.get('[data-testid="block-schedule-unit-name"]').element.value).toBe('創思中心')
  })

  it('shows learning-center import guidance and safety limitations', () => {
    const wrapper = mount(SpecialCourseView)
    const guidance = wrapper.get('[data-testid="learning-center-import-guidance"]')

    expect(guidance.text()).toContain('sharedEventId')
    expect(guidance.text()).toContain('不得以同一教師或同一時段自行推測')
    expect(guidance.text()).toContain('同一班級對應不同有效科目')
    expect(guidance.text()).toContain('班內不同學生子群')
    expect(guidance.text()).toContain('不會放寬班級、教室與教師可用時段限制')
    expect(guidance.text()).toContain('導師設定與有效科目')
  })

  it('disables confirmation when blockers exist and does not apply or sync', async () => {
    const store = seedStore()
    const applySpy = vi.spyOn(store, 'applyBlockScheduleImport')
    const syncSpy = vi.spyOn(store, 'syncToCloud').mockResolvedValue(undefined)

    const wrapper = mount(SpecialCourseView)
    await uploadWorkbook(wrapper, [
      ['星期', '節次', '3年3班'],
      ['一', '一', '303國1 (不存在)'],
    ])

    const confirmButton = wrapper.get('[data-testid="confirm-block-schedule-import"]')
    expect(confirmButton.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="blocker-section"]').text()).toContain('找不到教師')

    await confirmButton.trigger('click')
    expect(applySpy).not.toHaveBeenCalled()
    expect(syncSpy).not.toHaveBeenCalled()
  })

  it('clears existing third-track rules before appending when requested', async () => {
    const store = seedStore()
    store.specialCourses = [
      {
        id: 'old-1',
        name: '學習中心',
        targetSubject: '語文-國語',
        targetClasses: ['3年3班'],
        lockedSlots: [{ day: 1, period: 1 }],
        sourceKind: 'learning_center',
        sourceGroup: '國1',
        teacher: '李靖',
        teacher_name: '李靖',
      },
    ]

    const applySpy = vi.spyOn(store, 'applyBlockScheduleImport')
    const syncSpy = vi.spyOn(store, 'syncToCloud').mockResolvedValue(undefined)
    const wrapper = mount(SpecialCourseView)

    await uploadWorkbook(wrapper, [
      ['星期', '節次', '3年3班'],
      ['一', '一', '303數學→數理'],
    ])

    await wrapper.get('[data-testid="clear-block-schedule"]').setValue(true)
    await wrapper.get('[data-testid="confirm-block-schedule-import"]').trigger('click')
    await flushPromises()

    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(applySpy.mock.calls[0][0]).toMatchObject({
      clearExisting: true,
      replaceIds: [],
    })
    expect(applySpy.mock.calls[0][0].courses).toHaveLength(1)
    expect(syncSpy).toHaveBeenCalledTimes(1)
    expect(store.specialCourses).toHaveLength(1)
    expect(store.specialCourses[0]).toMatchObject({
      name: '創思中心',
      targetSubject: '數學',
      teacher_name: '',
    })
    expect(wrapper.get('[data-testid="import-status"]').text()).toContain('已匯入 1 筆第三軌規則')
  })

  it('keeps the incoming replacement row inserted once while replacing only selected existing ids', async () => {
    const store = seedStore()
    store.specialCourses = [
      {
        id: 'dup-a',
        name: '學習中心',
        targetSubject: '語文-國語',
        targetClasses: ['3年3班'],
        lockedSlots: [{ day: 1, period: 3 }],
        sourceKind: 'learning_center',
        sourceGroup: '國1',
        teacher: '李靖',
        teacher_name: '李靖',
      },
      {
        id: 'dup-b',
        name: '學習中心',
        targetSubject: '語文-國語',
        targetClasses: ['3年3班'],
        lockedSlots: [{ day: 1, period: 3 }],
        sourceKind: 'learning_center',
        sourceGroup: '國1',
        teacher: '李靖',
        teacher_name: '李靖',
      },
    ]

    const applySpy = vi.spyOn(store, 'applyBlockScheduleImport')
    const syncSpy = vi.spyOn(store, 'syncToCloud').mockResolvedValue(undefined)
    const wrapper = mount(SpecialCourseView)

    await uploadWorkbook(wrapper, [
      ['星期', '節次', '3年3班'],
      ['一', '三', '303國1 (李靖)'],
    ])

    const candidateCheckboxes = wrapper.findAll('[data-testid="replacement-section"] input[type="checkbox"]')
    expect(candidateCheckboxes).toHaveLength(2)
    await candidateCheckboxes[0].setValue(false)
    await wrapper.get('[data-testid="confirm-block-schedule-import"]').trigger('click')
    await flushPromises()

    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(applySpy.mock.calls[0][0].courses).toHaveLength(1)
    expect(applySpy.mock.calls[0][0].replaceIds).toEqual(['dup-b'])
    expect(syncSpy).toHaveBeenCalledTimes(1)
    expect(store.specialCourses).toHaveLength(2)
    expect(store.specialCourses.some((course) => course.id === 'dup-a')).toBe(true)
    expect(store.specialCourses.some((course) => course.id === 'dup-b')).toBe(false)
  })
})
