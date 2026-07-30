import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useScheduleStore } from '../src/stores/schedule'
import SlotRuleEditor from '../src/components/SlotRuleEditor.vue'

describe('slot rule engine store contract', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('adds, updates, and deletes operator slot rules', () => {
    const store = useScheduleStore()
    const created = store.addSlotRule({
      name: '資訊組長週五不排',
      ownerType: 'teacher',
      ownerId: 'T001',
      day: 5,
      period: [1, 2, 3, 4, 5, 6, 7],
      mode: 'hard',
      action: 'avoid',
      weight: 3,
      note: '行政業務',
    })

    expect(created.id).toBeTruthy()
    expect(store.aiSettings.slotRules).toHaveLength(1)
    expect(store.aiSettings.slotRules[0].enabled).toBe(true)

    store.updateSlotRule(created.id, { mode: 'soft', weight: 1 })
    expect(store.aiSettings.slotRules[0].mode).toBe('soft')
    expect(store.aiSettings.slotRules[0].weight).toBe(1)

    store.deleteSlotRule(created.id)
    expect(store.aiSettings.slotRules).toHaveLength(0)
  })

  it('normalizes invalid slot rule fields to safe defaults', () => {
    const store = useScheduleStore()
    const rule = store.normalizeSlotRule({
      ownerType: 'unknown',
      ownerId: '',
      day: 99,
      period: 99,
      mode: 'bad',
    })

    expect(rule.ownerType).toBe('teacher')
    expect(rule.day).toBe(1)
    expect(rule.period).toBe(1)
    expect(rule.mode).toBe('soft')
    expect(rule.action).toBe('avoid')
  })

  it('mounts SlotRuleEditor and adds a rule on button click', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(SlotRuleEditor, {
      global: {
        plugins: [pinia],
      },
    })
    const store = useScheduleStore()
    expect(store.aiSettings.slotRules).toHaveLength(0)

    const addBtn = wrapper.find('.add-rule-btn')
    await addBtn.trigger('click')

    expect(store.aiSettings.slotRules).toHaveLength(1)
  })

  it('initializes quality rule defaults', () => {
    const store = useScheduleStore()

    expect(store.aiSettings.qualityRules.period7FlexiblePreference.weight).toBe('lowest')
    expect(store.aiSettings.qualityRules.period7FlexiblePreference.includeSubjects).toContain('資訊')
    expect(store.aiSettings.qualityRules.period7FlexiblePreference.excludeSubjectNames).toContain(
      '體育',
    )
    expect(store.aiSettings.qualityRules.peAvoidPeriod45.weight).toBe('lowest')
  })
})
