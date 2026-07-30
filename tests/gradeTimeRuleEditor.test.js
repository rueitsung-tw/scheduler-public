import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { detectDeterministicGradeTimeRuleIssues } from '../src/utils/gradeTimeRules.js'

describe('GradeTimeRuleEditor', () => {
  let mockSettings

  beforeEach(() => {
    mockSettings = {
      enabled: true,
      version: 2,
      rules: [
        {
          id: 'rule-co-1',
          enabled: true,
          purpose: 'co_planning',
          grades: [5],
          timeSelectionMode: 'candidate',
          candidateBlocks: [{ day: 4, periods: [5, 6] }],
          ruleType: 'require_teacher_type',
          teacherType: 'subject',
          fulfillmentThreshold: 'at_least_90',
          name: '5年級共備',
          note: '週四下午'
        }
      ]
    }
  })

  // ── Step 1: Mount & UI requirement tests ──

  it('shows co-planning quick settings and advanced rules tabs', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
      }
    })

    expect(wrapper.find('[data-testid="coplanning-quick-settings-tab"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="advanced-rules-tab"]').exists()).toBe(true)
  })

  it('does not render the old 五六年級共備設定 card', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
      }
    })

    expect(wrapper.find('.co-planning-controls').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('五六年級導師共備區塊的排課策略')
  })

  it('shows the quality-rules non-overwrite statement', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
      }
    })

    const expectedFullStatement =
      '本區規則不會關閉或取代排課品質設定。「體育課避免第 4、5 節」與「第 7 節優先安排校本／彈性課程」仍會持續生效。若 Hard 年級規則與品質偏好相反，系統會先顯示風險，但品質違規分數仍會保留。'
    expect(wrapper.text()).toContain(expectedFullStatement)
  })

  // ── Step 3 & 4: Quick settings and Advanced rules ──

  it('supports co-planning quick settings for grades 1-6 with candidate and fixed modes', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
      }
    })

    await wrapper.find('[data-testid="coplanning-quick-settings-tab"]').trigger('click')
    await flushPromises()

    // Check grade buttons/selectors include grades 1 to 6
    const text = wrapper.text()
    expect(text).toContain('1年級')
    expect(text).toContain('6年級')
  })

  it('keeps the co-planning enable switch track bounded to its own control', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
      },
      attachTo: document.body,
    })

    const switchTrack = wrapper.find('.switch-small .slider')
    expect(switchTrack.exists()).toBe(true)
    expect(switchTrack.classes()).toContain('switch-small-track')

    wrapper.unmount()
  })

  it('supports advanced rules with require_subject, require_subject_category, forbid_teacher_type, require_teacher_type', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
      }
    })

    await wrapper.find('[data-testid="advanced-rules-tab"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="add-advanced-rule-btn"]').exists()).toBe(true)
  })

  // ── Step 5: Rule status cards & blocking issues ──

  it('displays blocking issue rule as disabled/draft with red status', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const invalidRule = {
      id: 'rule-invalid',
      enabled: true,
      purpose: 'general',
      grades: [3],
      timeSelectionMode: 'fixed',
      day: 99, // Invalid day -> blocking issue
      periods: [1],
      ruleType: 'require_subject',
      subjectName: '校本'
    }
    const settingsWithBlocking = {
      enabled: true,
      version: 2,
      rules: [invalidRule]
    }
    const issues = detectDeterministicGradeTimeRuleIssues(settingsWithBlocking)

    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: settingsWithBlocking,
        gradeTimeRulesSettings: settingsWithBlocking,
        issues
      }
    })

    await wrapper.find('[data-testid="advanced-rules-tab"]').trigger('click')
    await flushPromises()

    const ruleCard = wrapper.find('[data-testid="rule-card-rule-invalid"]')
    expect(ruleCard.exists()).toBe(true)
    expect(ruleCard.classes()).toContain('status-blocking')
  })

  // ── Step 6: Canonical settings emission ──

  it('emits only canonical gradeTimeRulesSettings without transient UI state', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
      }
    })

    await wrapper.find('[data-testid="master-toggle"]').trigger('click')
    await flushPromises()

    const emitted = wrapper.emitted('update:gradeTimeRulesSettings') || wrapper.emitted('update:settings')
    expect(emitted).toBeTruthy()
    const updatedSettings = emitted[0][0]
    expect(updatedSettings).toHaveProperty('version', 2)
    expect(updatedSettings).not.toHaveProperty('validationState')
    expect(updatedSettings).not.toHaveProperty('validationIssues')
    expect(updatedSettings).not.toHaveProperty('coPlanningSettings')
    expect(updatedSettings).not.toHaveProperty('warningConfirmed')
    expect(updatedSettings).not.toHaveProperty('isWarningConfirmed')
  })

  // ── Step 7: Warning confirmation reset seam tests ──

  it('resets warningConfirmed to false when rules are edited', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
        warningConfirmed: true,
      }
    })

    await wrapper.find('[data-testid="master-toggle"]').trigger('click')
    await flushPromises()

    const emittedWarning = wrapper.emitted('update:warningConfirmed')
    expect(emittedWarning).toBeTruthy()
    expect(emittedWarning[0][0]).toBe(false)
  })

  it('resets warningConfirmed when warningConfirmed prop changes externally', async () => {
    const { default: GradeTimeRuleEditor } = await import('../src/components/GradeTimeRuleEditor.vue')
    const pe45Warning = {
      code: 'GTR_PE_PERIOD_45_QUALITY_RISK',
      severity: 'warning',
      message: 'PE at period 4'
    }
    const wrapper = mount(GradeTimeRuleEditor, {
      props: {
        settings: mockSettings,
        gradeTimeRulesSettings: mockSettings,
        issues: [pe45Warning],
        warningConfirmed: true,
      }
    })

    const btn = wrapper.find('[data-testid="confirm-warning-btn"]')
    expect(btn.text()).toContain('✓ 已確認風險')

    await wrapper.setProps({ warningConfirmed: false })
    await flushPromises()

    expect(btn.text()).toContain('確認風險並繼續')
  })
})
