import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import * as XLSX from 'xlsx'
import { useScheduleStore } from '../src/stores/schedule'
import SubjectExcelImport from '../src/components/SubjectExcelImport.vue'
import * as materializerModule from '../src/utils/subjectAssignmentMaterializer'

function buildWorkbookBuffer(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '科任配課')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('SubjectExcelImport.vue (Task 4 Component Tests)', () => {
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

  const triggerFileUpload = async (wrapper, buffer, filename = 'subject_assignment.xlsx') => {
    const fileInput = wrapper.find('input[type="file"]#subject-excel-upload')
    expect(fileInput.exists()).toBe(true)

    const mockFile = {
      name: filename,
      buffer: buffer,
    }

    Object.defineProperty(fileInput.element, 'files', {
      value: [mockFile],
      writable: true,
    })

    await fileInput.trigger('change')
    await nextTick()
  }

  it('1. Initial prerequisite disabled state when teachers or classes list is empty', async () => {
    const store = useScheduleStore()
    store.teachers = []
    store.classes = []

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    // Prerequisite warning message must be displayed
    const warning = wrapper.find('#prerequisite-warning')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toContain('教師名冊')
    expect(warning.text()).toContain('班級')

    // File input and download template button must be disabled
    const fileInput = wrapper.find('#subject-excel-upload')
    expect(fileInput.attributes('disabled')).toBeDefined()

    const downloadBtn = wrapper.find('#download-template-btn')
    expect(downloadBtn.attributes('disabled')).toBeDefined()
  })

  it('2. Mapping unknown-code blocker text display', async () => {
    const store = useScheduleStore()
    store.teachers = [
      { id: 1, name: '張小華', type: 'homeroom' },
      { id: 2, name: '李大同', type: 'subject' },
    ]
    store.classes = [
      { name: '501班', grade: 5, course_requirements: [{ subject: '自然科學', periods: 7 }] },
    ]

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    // Sheet data with an unknown code '神' (not in codeMappings)
    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '5神*7', 7],
    ]
    const buffer = buildWorkbookBuffer(sheetData)

    await triggerFileUpload(wrapper, buffer)

    // Blocker notice must be visible
    const blockerNotice = wrapper.find('#blocker-notice')
    expect(blockerNotice.exists()).toBe(true)
    const blockerText = blockerNotice.text()

    // Must show row, teacher, formula, cause, and explicitly state unknown code blocks import
    expect(blockerText).toContain('李大同')
    expect(blockerText).toContain('5神*7')
    expect(blockerText).toContain('神')
    expect(blockerText).toContain('尚未建立對照')

    // Apply button must not be available or disabled
    const applyBtn = wrapper.find('#apply-import-btn')
    if (applyBtn.exists()) {
      expect(applyBtn.attributes('disabled')).toBeDefined()
    }
  })

  it('3. Overwrite gate requires confirm overwrite checkbox before enabling apply', async () => {
    const store = useScheduleStore()
    store.teachers = [
      { id: 1, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    store.classes = Array.from({ length: 12 }, (_, i) => ({
      name: `60${i + 1 < 10 ? '0' + (i + 1) : i + 1}班`,
      grade: 6,
      course_requirements: [{ subject: '音樂', periods: 1 }],
    }))

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '6音*12', 12],
    ]
    const buffer = buildWorkbookBuffer(sheetData)

    await triggerFileUpload(wrapper, buffer)

    // Diff preview should show
    const previewSection = wrapper.find('#preview-section')
    expect(previewSection.exists()).toBe(true)

    // Apply button should initially be disabled
    const applyBtn = wrapper.find('#apply-import-btn')
    expect(applyBtn.exists()).toBe(true)
    expect(applyBtn.attributes('disabled')).toBeDefined()

    // Check overwrite checkbox
    const overwriteCheckbox = wrapper.find('#confirm-overwrite')
    expect(overwriteCheckbox.exists()).toBe(true)
    await overwriteCheckbox.setValue(true)
    await nextTick()

    // Apply button should now be enabled
    expect(applyBtn.attributes('disabled')).toBeUndefined()
  })

  it('4. Homeroom confirmation gate: canApply requires confirmHomeroom whenever parsed import has homeroom teachers, and handler defensively rejects missing confirmation', async () => {
    const store = useScheduleStore()
    store.teachers = [
      { id: 1, name: '張小華', type: 'homeroom', max_periods: 15, assignment_rules: [] },
      { id: 2, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    store.classes = [
      ...Array.from({ length: 7 }, (_, i) => ({
        name: `50${i + 1}班`,
        grade: 5,
        course_requirements: [{ subject: '科技-資訊', periods: 1 }],
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `60${i + 1 < 10 ? '0' + (i + 1) : i + 1}班`,
        grade: 6,
        course_requirements: [{ subject: '音樂', periods: 1 }],
      })),
    ]
    vi.spyOn(store, 'syncToCloud').mockResolvedValue(true)

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '導師', '級任教師', '張小華', '5電*7', 7],
      [2, '專任', '科任教師', '李大同', '6音*12', 12],
    ]
    const buffer = buildWorkbookBuffer(sheetData)

    const wrapper = mount(SubjectExcelImport)
    await nextTick()
    await triggerFileUpload(wrapper, buffer)

    // Check overwrite checkbox ONLY (homeroom checkbox unchecked)
    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    // Apply button MUST still be disabled because import includes a homeroom teacher
    const applyBtn = wrapper.find('#apply-import-btn')
    expect(applyBtn.attributes('disabled')).toBeDefined()

    // Now test with homeroom gate checked
    const homeroomCheckbox = wrapper.find('#confirm-homeroom')
    expect(homeroomCheckbox.exists()).toBe(true)
    await homeroomCheckbox.setValue(true)
    await nextTick()

    // Apply button SHOULD now be enabled
    expect(applyBtn.attributes('disabled')).toBeUndefined()

    await applyBtn.trigger('click')
    await nextTick()

    // Homeroom teacher SHOULD be updated now
    const homeroomTeacherConfirmed = store.teachers.find((t) => t.name === '張小華')
    expect(homeroomTeacherConfirmed.assignment_rules).toHaveLength(1)
    expect(homeroomTeacherConfirmed.assignment_rules[0].subject).toBe('科技-資訊')
  })

  it('5. Sync failure preserves preview state in DOM', async () => {
    const store = useScheduleStore()
    store.teachers = [
      { id: 2, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    store.classes = Array.from({ length: 12 }, (_, i) => ({
      name: `60${i + 1 < 10 ? '0' + (i + 1) : i + 1}班`,
      grade: 6,
      course_requirements: [{ subject: '音樂', periods: 1 }],
    }))
    vi.spyOn(store, 'syncToCloud').mockRejectedValue(new Error('網路異常，無法儲存至雲端'))

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '6音*12', 12],
    ]
    const buffer = buildWorkbookBuffer(sheetData)

    const wrapper = mount(SubjectExcelImport)
    await nextTick()
    await triggerFileUpload(wrapper, buffer)

    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    await wrapper.find('#apply-import-btn').trigger('click')
    await nextTick()

    // Error message displayed
    const statusMsg = wrapper.find('#status-message')
    expect(statusMsg.exists()).toBe(true)
    expect(statusMsg.text()).toContain('無法儲存至雲端')

    // Preview section must still be visible in DOM
    const previewSection = wrapper.find('#preview-section')
    expect(previewSection.exists()).toBe(true)
    expect(previewSection.text()).toContain('李大同')
    expect(previewSection.text()).toContain('音樂')
  })

  it('6. handleSaveMappings never replaces schoolInfo with {} and safely merges subjectCodeMappings without losing existing keys', async () => {
    const store = useScheduleStore()
    store.schoolInfo = {
      name: '測試國小',
      periodDefaults: { homeroom: 15, subject: 19, admin: 6 },
    }
    vi.spyOn(store, 'syncToCloud').mockResolvedValue(true)

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    // Add a new mapping
    await wrapper.find('#new-excel-code-input').setValue('藝')
    const select = wrapper.find('#new-target-subject-select')
    await select.setValue('美勞')
    await wrapper.find('#add-mapping-btn').trigger('click')
    await nextTick()

    // Save mappings
    await wrapper.find('#save-mappings-btn').trigger('click')
    await nextTick()

    // Verify existing keys are preserved!
    expect(store.schoolInfo.name).toBe('測試國小')
    expect(store.schoolInfo.periodDefaults).toEqual({ homeroom: 15, subject: 19, admin: 6 })
    expect(store.schoolInfo.subjectCodeMappings['藝']).toBe('美勞')
  })

  it('7. Reset file input value after reading so the same file can be reselected', async () => {
    const store = useScheduleStore()
    store.teachers = [{ id: 1, name: '李大同', type: 'subject' }]
    store.classes = Array.from({ length: 12 }, (_, i) => ({
      name: `60${i + 1 < 10 ? '0' + (i + 1) : i + 1}班`,
      grade: 6,
      course_requirements: [{ subject: '音樂', periods: 1 }],
    }))

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const fileInput = wrapper.find('input[type="file"]#subject-excel-upload')
    let inputVal = 'C:\\fakepath\\test.xlsx'
    Object.defineProperty(fileInput.element, 'value', {
      get: () => inputVal,
      set: (val) => { inputVal = val },
      configurable: true,
    })

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '6音*12', 12],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    // Verify input value was reset to empty string after reading
    expect(inputVal).toBe('')
  })

  it('8. handleDownloadTemplate appends/removes anchor to document.body and revokes URL', async () => {
    const store = useScheduleStore()
    store.teachers = [{ id: 1, name: '李大同' }]
    store.classes = [{ name: '601班', grade: 6 }]

    const appendSpy = vi.spyOn(document.body, 'appendChild')
    const removeSpy = vi.spyOn(document.body, 'removeChild')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const downloadBtn = wrapper.find('#download-template-btn')
    await downloadBtn.trigger('click')
    await nextTick()

    expect(createSpy).toHaveBeenCalled()
    expect(appendSpy).toHaveBeenCalled()
    const appendedEl = appendSpy.mock.calls[0][0]
    expect(appendedEl.tagName).toBe('A')
    expect(appendedEl.download).toBe('科任配課範例檔.xlsx')
    expect(removeSpy).toHaveBeenCalledWith(appendedEl)
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url')
  })

  it('9. Mixed teaching detection: does not mutate store while mixed confirmation is open, and writes teacher rules and whole-class teachers together after confirmation', async () => {
    const store = useScheduleStore()
    const originalTeachers = [
      { id: 1, name: '張小華', type: 'homeroom', assignedClass: '501班' },
      { id: 2, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    const originalClasses = [
      { name: '501班', grade: 5, homeroom_teacher: '張小華', course_requirements: [{ subject: '健康', periods: 2, defaultTeacher: 'homeroom' }] },
      { name: '502班', grade: 5, homeroom_teacher: '陳老師', course_requirements: [{ subject: '健康', periods: 2, defaultTeacher: 'homeroom' }] },
    ]
    store.teachers = JSON.parse(JSON.stringify(originalTeachers))
    store.classes = JSON.parse(JSON.stringify(originalClasses))
    vi.spyOn(store, 'syncToCloud').mockResolvedValue(true)

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [2, '專任', '科任教師', '李大同', '5健*1', 2],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    await wrapper.find('#apply-import-btn').trigger('click')
    await nextTick()

    expect(wrapper.find('[data-testid="mixed-dialog-content"]').exists()).toBe(true)
    expect(store.teachers).toEqual(originalTeachers)
    expect(store.classes).toEqual(originalClasses)
    expect(store.syncToCloud).not.toHaveBeenCalled()

    const confirmBtn = wrapper.find('[data-testid="mixed-confirm"]')
    expect(confirmBtn.exists()).toBe(true)
    await confirmBtn.trigger('click')
    await nextTick()

    expect(store.syncToCloud).toHaveBeenCalledTimes(1)
    const updatedTeacher = store.teachers.find((t) => t.name === '李大同')
    expect(updatedTeacher.assignment_rules).toHaveLength(1)
    expect(updatedTeacher.assignment_rules[0].subject).toBe('健康')

    const cls501 = store.classes.find((c) => c.name === '501班')
    const cls502 = store.classes.find((c) => c.name === '502班')
    const req501 = cls501.course_requirements.find((r) => r.subject === '健康')
    const req502 = cls502.course_requirements.find((r) => r.subject === '健康')

    expect(req501.teacher).toBe('李大同')
    expect(req501.assignmentSource).toBe('mixed-import')
    expect(req502.teacher).toBe('陳老師')
    expect(req502.assignmentSource).toBe('mixed-import')
  })

  it('10. Mixed teaching blocker prevents import, displays explicit error, retaining parse preview without opening dialog or mutating store', async () => {
    const store = useScheduleStore()
    const originalTeachers = [
      { id: 2, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [] },
      { id: 3, name: '王大明', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    const originalClasses = Array.from({ length: 5 }, (_, i) => ({
      name: `50${i + 1}班`,
      grade: 5,
      homeroom_teacher: `導師${i + 1}`,
      course_requirements: [{ subject: '健康', periods: 2, defaultTeacher: 'homeroom' }],
    }))
    store.teachers = JSON.parse(JSON.stringify(originalTeachers))
    store.classes = JSON.parse(JSON.stringify(originalClasses))
    const syncSpy = vi.spyOn(store, 'syncToCloud').mockResolvedValue(true)

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [2, '專任', '科任教師', '李大同', '5健*3', 6],
      [3, '專任', '科任教師', '王大明', '5健*3', 6],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    await wrapper.find('#apply-import-btn').trigger('click')
    await nextTick()

    const statusMsg = wrapper.find('#status-message')
    expect(statusMsg.exists()).toBe(true)
    expect(statusMsg.text()).toContain('混合配課檢核阻擋')
    expect(statusMsg.text()).toContain('超過總需求')

    expect(wrapper.find('#preview-section').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mixed-dialog-content"]').exists()).toBe(false)
    expect(store.teachers).toEqual(originalTeachers)
    expect(store.classes).toEqual(originalClasses)
    expect(syncSpy).not.toHaveBeenCalled()
  })

  it('11. Sync failure during mixed import restores original teachers and classes while preserving pending dialog state', async () => {
    const store = useScheduleStore()
    const originalTeachers = [
      { id: 1, name: '張小華', type: 'homeroom', assignedClass: '501班' },
      { id: 2, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    const originalClasses = [
      { name: '501班', grade: 5, homeroom_teacher: '張小華', course_requirements: [{ subject: '健康', periods: 2, defaultTeacher: 'homeroom' }] },
      { name: '502班', grade: 5, homeroom_teacher: '陳老師', course_requirements: [{ subject: '健康', periods: 2, defaultTeacher: 'homeroom' }] },
    ]
    store.teachers = JSON.parse(JSON.stringify(originalTeachers))
    store.classes = JSON.parse(JSON.stringify(originalClasses))
    vi.spyOn(store, 'syncToCloud').mockRejectedValue(new Error('網路斷線儲存失敗'))

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [2, '專任', '科任教師', '李大同', '5健*1', 2],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    await wrapper.find('#apply-import-btn').trigger('click')
    await nextTick()

    expect(wrapper.find('[data-testid="mixed-dialog-content"]').exists()).toBe(true)

    await wrapper.find('[data-testid="mixed-confirm"]').trigger('click')
    await nextTick()

    const statusMsg = wrapper.find('#status-message')
    expect(statusMsg.text()).toContain('無法儲存至雲端')
    expect(statusMsg.text()).toContain('網路斷線儲存失敗')

    expect(store.teachers).toEqual(originalTeachers)
    expect(store.classes).toEqual(originalClasses)

    expect(wrapper.find('[data-testid="mixed-dialog-content"]').exists()).toBe(true)
  })

  it('12. Pinia store pendingMixedPlans and hasPendingMixedPlans state lifecycle during mixed import, cancel, and sync failure', async () => {
    const store = useScheduleStore()
    const originalTeachers = [
      { id: 1, name: '張小華', type: 'homeroom', assignedClass: '501班' },
      { id: 2, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    const originalClasses = [
      { name: '501班', grade: 5, homeroom_teacher: '張小華', course_requirements: [{ subject: '健康', periods: 2, defaultTeacher: 'homeroom' }] },
      { name: '502班', grade: 5, homeroom_teacher: '陳老師', course_requirements: [{ subject: '健康', periods: 2, defaultTeacher: 'homeroom' }] },
    ]
    store.teachers = JSON.parse(JSON.stringify(originalTeachers))
    store.classes = JSON.parse(JSON.stringify(originalClasses))
    const syncSpy = vi.spyOn(store, 'syncToCloud')

    expect(store.hasPendingMixedPlans).toBe(false)
    expect(store.pendingMixedPlans).toEqual([])

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [2, '專任', '科任教師', '李大同', '5健*1', 2],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    // 1. Apply import opens mixed dialog -> sets store.pendingMixedPlans & store.hasPendingMixedPlans
    await wrapper.find('#apply-import-btn').trigger('click')
    await nextTick()

    expect(store.hasPendingMixedPlans).toBe(true)
    expect(store.pendingMixedPlans.length).toBeGreaterThan(0)

    // 2. Sync failure during confirm keeps pendingMixedPlans intact in store
    syncSpy.mockRejectedValueOnce(new Error('Sync failed'))
    await wrapper.find('[data-testid="mixed-confirm"]').trigger('click')
    await nextTick()

    expect(store.hasPendingMixedPlans).toBe(true)
    expect(store.pendingMixedPlans.length).toBeGreaterThan(0)

    // 3. Cancel clears pendingMixedPlans in store
    await wrapper.find('[data-testid="mixed-cancel"]').trigger('click')
    await nextTick()

    expect(store.hasPendingMixedPlans).toBe(false)
    expect(store.pendingMixedPlans).toEqual([])
  })

  it('13. a "-" row with existing assignment produces nonblocking skipped notice and no overwrite', async () => {
    const store = useScheduleStore()
    const initialAssignmentRules = [{ grade: 6, subject: '音樂', classCount: 10, periods: 10 }]
    store.teachers = [
      { id: 1, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [...initialAssignmentRules] },
      { id: 2, name: '王大明', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    store.classes = Array.from({ length: 10 }, (_, i) => ({
      name: `60${i + 1 < 10 ? '0' + (i + 1) : i + 1}班`,
      grade: 6,
      course_requirements: [{ subject: '音樂', periods: 1 }],
    }))
    vi.spyOn(store, 'syncToCloud').mockResolvedValue(true)

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '-', ''],
      [2, '專任', '科任教師', '王大明', '6音*10', 10],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    // Nonblocking skipped notice must be visible
    const skippedNotice = wrapper.find('#skipped-import-notice')
    expect(skippedNotice.exists()).toBe(true)
    expect(skippedNotice.text()).toContain('1 位教師填寫「-」或空白且已有配課，已略過')

    // Confirm overwrite & apply
    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()
    const applyBtn = wrapper.find('#apply-import-btn')
    expect(applyBtn.exists()).toBe(true)
    await applyBtn.trigger('click')
    await nextTick()

    // Teacher's existing assignment was preserved and NOT overwritten
    const teacher = store.teachers.find((t) => t.name === '李大同')
    expect(teacher.max_periods).toBe(10)
    expect(teacher.assignment_rules).toEqual(initialAssignmentRules)

    // Teacher 王大明's assignment WAS imported
    const teacher2 = store.teachers.find((t) => t.name === '王大明')
    expect(teacher2.assignment_rules).toHaveLength(1)
  })

  it('14. blank / "-" row with no existing assignment invokes alert and no write', async () => {
    const store = useScheduleStore()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    store.teachers = [
      { id: 1, name: '李大同', type: 'subject', max_periods: 0, assignment_rules: [] },
      { id: 2, name: '王大明', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    store.classes = Array.from({ length: 10 }, (_, i) => ({
      name: `60${i + 1 < 10 ? '0' + (i + 1) : i + 1}班`,
      grade: 6,
      course_requirements: [{ subject: '音樂', periods: 1 }],
    }))
    vi.spyOn(store, 'syncToCloud').mockResolvedValue(true)

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '-', ''],
      [2, '專任', '科任教師', '王大明', '6音*10', 10],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    // Alert must be invoked for unassigned teacher
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('提醒：李大同 的配課式為「-」或空白，且系統尚未發現任何配課資料')
    )

    // Unassigned notice displayed
    const unassignedNotice = wrapper.find('#unassigned-teacher-notice')
    expect(unassignedNotice.exists()).toBe(true)
    expect(unassignedNotice.text()).toContain('李大同')

    // Confirm overwrite & apply
    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()
    await wrapper.find('#apply-import-btn').trigger('click')
    await nextTick()

    // Teacher 李大同 has no assignment written (no write)
    const teacher = store.teachers.find((t) => t.name === '李大同')
    expect(teacher.max_periods).toBe(0)
    expect(teacher.assignment_rules || []).toHaveLength(0)

    // Teacher 王大明's assignment WAS written
    const teacher2 = store.teachers.find((t) => t.name === '王大明')
    expect(teacher2.assignment_rules).toHaveLength(1)
    expect(teacher2.assignment_rules[0].subject).toBe('音樂')
  })

  it('15. requires confirm-corrections checkbox when correction warnings exist before enabling apply button', async () => {
    const store = useScheduleStore()
    store.teachers = [
      { id: 2, name: '李大同', type: 'subject', max_periods: 10, assignment_rules: [] },
    ]
    store.classes = [
      { name: '301班', grade: 3, course_requirements: [{ subject: '健康', periods: 1 }] },
    ]

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    // Sheet data containing typo 3建1
    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '健康科任', '李大同', '3建1', 1],
    ]
    const buffer = buildWorkbookBuffer(sheetData)

    await triggerFileUpload(wrapper, buffer)

    // Check correction notice exists and shows info
    const correctionNotice = wrapper.find('#correction-warnings-notice')
    expect(correctionNotice.exists()).toBe(true)
    expect(correctionNotice.text()).toContain('3建1')
    expect(correctionNotice.text()).toContain('3健*1')

    // Confirm corrections checkbox MUST exist
    const confirmCorrectionsCheckbox = wrapper.find('#confirm-corrections')
    expect(confirmCorrectionsCheckbox.exists()).toBe(true)

    // Check overwrite checkbox ONLY (confirmCorrections unchecked)
    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    // Apply button MUST be disabled because confirmCorrections is not checked
    const applyBtn = wrapper.find('#apply-import-btn')
    expect(applyBtn.attributes('disabled')).toBeDefined()

    // Check confirm-corrections
    await confirmCorrectionsCheckbox.setValue(true)
    await nextTick()

    // Apply button SHOULD now be enabled
    expect(applyBtn.attributes('disabled')).toBeUndefined()
  })

  it('16. End-to-end component import: materializes class requirements, marks source, leaves unrelated subjects unassigned, and updates status with count', async () => {
    const store = useScheduleStore()
    store.teachers = [
      { id: 101, name: '張科任', type: 'subject', max_periods: 0, assignment_rules: [] },
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'req-h-501', subject: '健康', periods: 2, teacher: '' },
          { id: 'req-s-501', subject: '自然科學', periods: 3, teacher: '' },
        ],
      },
      {
        name: '502班',
        grade: 5,
        course_requirements: [
          { id: 'req-h-502', subject: '健康', periods: 2, teacher: '' },
          { id: 'req-s-502', subject: '自然科學', periods: 3, teacher: '' },
        ],
      },
    ]
    const syncSpy = vi.spyOn(store, 'syncToCloud').mockResolvedValue(true)

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '張科任', '5健*2', 4],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    const applyBtn = wrapper.find('#apply-import-btn')
    expect(applyBtn.attributes('disabled')).toBeUndefined()
    await applyBtn.trigger('click')
    await nextTick()

    expect(syncSpy).toHaveBeenCalledTimes(1)

    // Verify teacher rules
    const teacher = store.teachers.find((t) => t.name === '張科任')
    expect(teacher.assignment_rules).toHaveLength(1)
    expect(teacher.max_periods).toBe(4)

    // Verify classes materialized
    const c501 = store.classes.find((c) => c.name === '501班')
    const c502 = store.classes.find((c) => c.name === '502班')

    const h501 = c501.course_requirements.find((r) => r.subject === '健康')
    const h502 = c502.course_requirements.find((r) => r.subject === '健康')
    expect(h501).toMatchObject({
      teacher: '張科任',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 2,
    })
    expect(h502).toMatchObject({
      teacher: '張科任',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 2,
    })

    // Unrelated subject '自然科學' MUST remain blank without side effects
    const s501 = c501.course_requirements.find((r) => r.subject === '自然科學')
    const s502 = c502.course_requirements.find((r) => r.subject === '自然科學')
    expect(s501.teacher).toBe('')
    expect(s502.teacher).toBe('')

    // Status message verification
    const statusMsg = wrapper.find('#status-message')
    expect(statusMsg.text()).toContain('已指派 4 節')
  })

  it('17. Materialization failure on demand shortage displays error message and makes zero store mutations', async () => {
    const store = useScheduleStore()
    const initialTeachers = [
      { id: 102, name: '王科任', type: 'subject', max_periods: 0, assignment_rules: [] },
    ]
    const initialClasses = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [{ id: 'req-s-501', subject: '自然科學', periods: 3, teacher: '' }],
      },
    ]
    store.teachers = JSON.parse(JSON.stringify(initialTeachers))
    store.classes = JSON.parse(JSON.stringify(initialClasses))
    const syncSpy = vi.spyOn(store, 'syncToCloud').mockResolvedValue(true)

    vi.spyOn(materializerModule, 'materializeImportedAssignmentRules').mockReturnValueOnce({
      success: false,
      classes: initialClasses,
      assignedCount: 0,
      error: '[需求不符] 可分派需求節數不足',
    })

    const wrapper = mount(SubjectExcelImport)
    await nextTick()

    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '王科任', '5自*1', 3],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    await triggerFileUpload(wrapper, buffer)

    await wrapper.find('#confirm-overwrite').setValue(true)
    await nextTick()

    await wrapper.find('#apply-import-btn').trigger('click')
    await nextTick()

    // Error status message displayed from commitImport materialization failure
    const statusMsg = wrapper.find('#status-message')
    expect(statusMsg.exists()).toBe(true)
    expect(statusMsg.text()).toContain('❌ 無法套用班級配課')
    expect(statusMsg.text()).toContain('需求不符')

    // Zero mutations and no cloud sync
    expect(store.teachers).toEqual(initialTeachers)
    expect(store.classes).toEqual(initialClasses)
    expect(syncSpy).not.toHaveBeenCalled()
  })
})
