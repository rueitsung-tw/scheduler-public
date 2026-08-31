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

  it('renders candidate review controls and blocks import until decision is made', async () => {
    const store = seedStore()
    store.teachers.push({ id: 't-youying', name: '佑瑩', type: 'special_ed_resource' })
    store.classes.push(
      { name: '4年2班', grade: 4, course_requirements: [{ subject: '數學' }] },
      { name: '4年6班', grade: 4, course_requirements: [{ subject: '數學' }] },
      { name: '5年1班', grade: 5, course_requirements: [{ subject: '數學' }] },
      { name: '5年4班', grade: 5, course_requirements: [{ subject: '數學' }] },
      { name: '5年6班', grade: 5, course_requirements: [{ subject: '數學' }] },
      { name: '5年9班', grade: 5, course_requirements: [{ subject: '數學' }] }
    )

    const wrapper = mount(SpecialCourseView)
    await uploadWorkbook(wrapper, [
      ['星期', '節次', '4年2班、4年6班', '5年1班、5年4班、5年6班、5年9班'],
      ['四', '一', '402、406數(佑瑩)', '501、504、506、509數(佑瑩)'],
    ])

    const candidateSection = wrapper.get('[data-testid="shared-event-candidates"]')
    expect(candidateSection.text()).toContain('佑瑩')
    expect(candidateSection.text()).toContain('4年2班')

    const confirmBtn = wrapper.get('[data-testid="confirm-block-schedule-import"]')
    expect(confirmBtn.attributes('disabled')).toBeDefined()

    const candidateConfirmBtn = wrapper.find('[data-testid^="confirm-shared-event-"]')
    expect(candidateConfirmBtn.exists()).toBe(true)
    await candidateConfirmBtn.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="confirm-block-schedule-import"]').attributes('disabled')).toBeUndefined()
  })

  it('allows selecting keep_independent to enable final import', async () => {
    const store = seedStore()
    store.teachers.push({ id: 't-youying', name: '佑瑩', type: 'special_ed_resource' })
    store.classes.push(
      { name: '4年2班', grade: 4, course_requirements: [{ subject: '數學' }] },
      { name: '4年6班', grade: 4, course_requirements: [{ subject: '數學' }] },
      { name: '5年1班', grade: 5, course_requirements: [{ subject: '數學' }] },
      { name: '5年4班', grade: 5, course_requirements: [{ subject: '數學' }] }
    )

    const wrapper = mount(SpecialCourseView)
    await uploadWorkbook(wrapper, [
      ['星期', '節次', '4年2班、4年6班', '5年1班、5年4班'],
      ['四', '一', '402、406數(佑瑩)', '501、504數(佑瑩)'],
    ])

    const keepIndepBtn = wrapper.find('[data-testid^="keep-independent-"]')
    expect(keepIndepBtn.exists()).toBe(true)
    await keepIndepBtn.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="confirm-block-schedule-import"]').attributes('disabled')).toBeUndefined()
  })

  it('renders decision summary, card status text, aria-pressed, and handles resets correctly', async () => {
    const store = seedStore()
    store.teachers.push(
      { id: 't-youying', name: '佑瑩', type: 'special_ed_resource' },
      { id: 't-hecaizhen', name: '何采珍', type: 'special_ed_resource' }
    )
    store.classes.push(
      { name: '4年2班', grade: 4, course_requirements: [{ subject: '數學' }] },
      { name: '4年6班', grade: 4, course_requirements: [{ subject: '數學' }] },
      { name: '5年1班', grade: 5, course_requirements: [{ subject: '數學' }] },
      { name: '5年4班', grade: 5, course_requirements: [{ subject: '數學' }] },
      { name: '3年1班', grade: 3, course_requirements: [{ subject: '數學' }] },
      { name: '3年2班', grade: 3, course_requirements: [{ subject: '語文-國語' }] }
    )

    const wrapper = mount(SpecialCourseView)
    const rows = [
      ['星期', '節次', '4年2班、4年6班', '5年1班、5年4班', '3年1班', '3年2班'],
      ['四', '一', '402、406數(佑瑩)', '501、504數(佑瑩)', '', ''],
      ['四', '二', '', '', '301數(何采珍)', '302國(何采珍)'],
    ]
    await uploadWorkbook(wrapper, rows)

    const summaryEl = wrapper.get('[data-testid="shared-event-decision-summary"]')
    expect(summaryEl.text()).toContain('待決策：2')
    expect(summaryEl.text()).toContain('已確認：0')
    expect(summaryEl.text()).toContain('維持獨立：0')

    const confirmBtns = wrapper.findAll('[data-testid^="confirm-shared-event-"]')
    const keepBtns = wrapper.findAll('[data-testid^="keep-independent-"]')
    expect(confirmBtns).toHaveLength(2)
    expect(keepBtns).toHaveLength(2)

    await confirmBtns[0].trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="shared-event-decision-summary"]').text()).toContain('待決策：1')
    expect(wrapper.get('[data-testid="shared-event-decision-summary"]').text()).toContain('已確認：1')
    expect(confirmBtns[0].attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="confirm-block-schedule-import"]').attributes('disabled')).toBeDefined()

    // Double-click idempotency check
    await confirmBtns[0].trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="shared-event-decision-summary"]').text()).toContain('已確認：1')

    await keepBtns[1].trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="shared-event-decision-summary"]').text()).toContain('待決策：0')
    expect(wrapper.get('[data-testid="shared-event-decision-summary"]').text()).toContain('維持獨立：1')
    expect(keepBtns[1].attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="confirm-block-schedule-import"]').attributes('disabled')).toBeUndefined()

    // Re-upload resets decisions to pending
    await uploadWorkbook(wrapper, rows)
    expect(wrapper.get('[data-testid="shared-event-decision-summary"]').text()).toContain('待決策：2')

    // Unit-name watcher reset
    await confirmBtns[0].trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="shared-event-decision-summary"]').text()).toContain('已確認：1')

    const unitNameInput = wrapper.get('[data-testid="block-schedule-unit-name"]')
    await unitNameInput.setValue('學習中心新名稱')
    await flushPromises()
    expect(wrapper.get('[data-testid="shared-event-decision-summary"]').text()).toContain('待決策：2')
  })

  it('prevents duplicate in-flight final import clicks when sync is deferred', async () => {
    const store = seedStore()
    store.teachers.push({ id: 't-youying', name: '佑瑩', type: 'special_ed_resource' })
    store.classes.push(
      { name: '4年2班', grade: 4, course_requirements: [{ subject: '數學' }] },
      { name: '4年6班', grade: 4, course_requirements: [{ subject: '數學' }] },
      { name: '5年1班', grade: 5, course_requirements: [{ subject: '數學' }] },
      { name: '5年4班', grade: 5, course_requirements: [{ subject: '數學' }] }
    )

    let resolveSync
    const syncPromise = new Promise((resolve) => { resolveSync = resolve })
    const applySpy = vi.spyOn(store, 'applyBlockScheduleImport')
    const syncSpy = vi.spyOn(store, 'syncToCloud').mockReturnValue(syncPromise)

    const wrapper = mount(SpecialCourseView)
    await uploadWorkbook(wrapper, [
      ['星期', '節次', '4年2班、4年6班', '5年1班、5年4班'],
      ['四', '一', '402、406數(佑瑩)', '501、504數(佑瑩)'],
    ])

    const confirmCandidate = wrapper.get('[data-testid^="confirm-shared-event-"]')
    await confirmCandidate.trigger('click')
    await flushPromises()

    const finalBtn = wrapper.get('[data-testid="confirm-block-schedule-import"]')
    await finalBtn.trigger('click')
    await finalBtn.trigger('click')

    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(syncSpy).toHaveBeenCalledTimes(1)

    resolveSync()
    await flushPromises()

    expect(wrapper.get('[data-testid="import-status"]').text()).toContain('已匯入')
  })

  it('renders read-only source-priority conflicts report and explicit contract block message', async () => {
    const store = seedStore()
    store.teachers.push({ id: 't-youying', name: '佑瑩', type: 'special_ed_resource' })
    store.classes.push({
      name: '5年7班',
      grade: 5,
      course_requirements: [{ subject: '數學', periods: 5 }],
    })

    const wrapper = mount(SpecialCourseView)
    const rows = [
      ['星期', '節次', '5年7班'],
      ['一', '一', '507數(佑瑩)'],
      ['一', '二', '507數(佑瑩)'],
      ['一', '三', '507數(佑瑩)'],
      ['一', '四', '507數(佑瑩)'],
      ['一', '五', '507數(佑瑩)'],
      ['一', '六', '507數學→數理'],
      ['一', '七', '507數學→數理'],
    ]

    await uploadWorkbook(wrapper, rows)

    const reportEl = wrapper.get('[data-testid="source-priority-conflicts"]')
    expect(reportEl.text()).toContain('5年7班')
    expect(reportEl.text()).toContain('數學')
    expect(reportEl.text()).toContain('需求 5')
    expect(reportEl.text()).toContain('固定合計 7')
    expect(reportEl.text()).toContain('超額 2')
    expect(reportEl.text()).toContain('來源優先權轉換尚無已核定的一般導師區塊資料契約；未修改任何課程或鎖定。')
  })
})
