import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SystemSettingsView from '../src/views/SystemSettingsView.vue'
import { useScheduleStore } from '../src/stores/schedule'

describe('SystemSettingsView information-room grade settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountWithInfoSubject() {
    const store = useScheduleStore()
    store.standardDomainSettings = [
      { name: '科技-資訊', color: '#38bdf8', periods: { 3: 1, 4: 1, 5: 1, 6: 1 } },
    ]
    store.schoolInfo.subjectClassroomGrades = {}

    const wrapper = mount(SystemSettingsView)
    return { wrapper, store }
  }

  function findInfoRow(wrapper) {
    return wrapper
      .findAll('tbody tr')
      .find((row) =>
        row.text().includes('科技-資訊')
        && row.findAll('input[type="checkbox"]').length === 6
      )
  }

  it('shows 科技-資訊 as a special-room configurable subject', () => {
    const { wrapper } = mountWithInfoSubject()

    const row = findInfoRow(wrapper)
    expect(row).toBeTruthy()
    expect(row.text()).toContain('專科教室鍵：資訊')
  })

  it('writes 科技-資訊 grade toggles to canonical 資訊 key', async () => {
    const { wrapper, store } = mountWithInfoSubject()
    const row = findInfoRow(wrapper)
    const grade3Checkbox = row.findAll('input[type="checkbox"]')[2]

    await grade3Checkbox.trigger('change')

    expect(store.schoolInfo.subjectClassroomGrades['資訊']).toEqual([3])
    expect(store.schoolInfo.subjectClassroomGrades['科技-資訊']).toBeUndefined()
  })

  it('keeps 資訊 in resetAllData default subjectClassroomGrades', () => {
    const store = useScheduleStore()

    store.resetAllData()

    expect(store.schoolInfo.subjectClassroomGrades['資訊']).toEqual([3, 4, 5, 6])
  })
})
