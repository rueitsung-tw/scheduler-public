import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MixedTeachingResolutionDialog from '../src/components/MixedTeachingResolutionDialog.vue'

describe('MixedTeachingResolutionDialog.vue', () => {
  const homeroomDefaultPlan = {
    key: '3::健康',
    grade: 3,
    subject: '健康',
    defaultTeacher: 'homeroom',
    defaultRoleGroup: 'homeroom',
    exceptionRoleGroup: 'subject-admin',
    totalDemandPeriods: 10,
    importedPeriods: 5,
    importedSubjectAdminPeriods: 5,
    importedHomeroomPeriods: 0,
    defaultRolePeriods: 5,
    homeroomPeriods: 5,
    importedTeacherQuotas: [
      { teacherId: 21, teacherName: '甲師', teacherType: 'subject', periods: 2 },
      { teacherId: 35, teacherName: '乙師', teacherType: 'admin', periods: 3 },
    ],
    classBlocks: [
      { className: '3年1班', periods: 1, homeroomTeacherName: '張導', isLocked: false },
      { className: '3年2班', periods: 1, homeroomTeacherName: '李導', isLocked: false },
      { className: '3年3班', periods: 1, homeroomTeacherName: '王導', isLocked: false },
      { className: '3年4班', periods: 1, homeroomTeacherName: '陳導', isLocked: false },
      { className: '3年5班', periods: 1, homeroomTeacherName: '林導', isLocked: false },
      { className: '3年6班', periods: 1, homeroomTeacherName: '黃導', isLocked: false },
      { className: '3年7班', periods: 1, homeroomTeacherName: '周導', isLocked: false },
      { className: '3年8班', periods: 1, homeroomTeacherName: '吳導', isLocked: false },
      { className: '3年9班', periods: 1, homeroomTeacherName: '蔡導', isLocked: false },
      { className: '3年10班', periods: 1, homeroomTeacherName: '楊導', isLocked: false },
    ],
    resolution: null,
  }

  const subjectDefaultPlan = {
    key: '4::體育',
    grade: 4,
    subject: '體育',
    defaultTeacher: 'subject',
    defaultRoleGroup: 'subject-admin',
    exceptionRoleGroup: 'homeroom',
    totalDemandPeriods: 6,
    importedPeriods: 2,
    importedSubjectAdminPeriods: 0,
    importedHomeroomPeriods: 2,
    defaultRolePeriods: 4,
    homeroomPeriods: 2,
    subjectAdminPeriods: 4,
    defaultRoleNamedPeriods: 4,
    exceptionRoleNamedPeriods: 2,
    allNamedPeriods: 6,
    implicitDefaultPeriods: 0,
    importedTeacherQuotas: [
      { teacherId: 101, teacherName: '張導', teacherType: 'homeroom', periods: 2 },
    ],
    exceptionTeacherQuotas: [
      { teacherId: 101, teacherName: '張導', teacherType: 'homeroom', periods: 2 },
    ],
    defaultRoleTeacherQuotas: [
      { teacherId: 201, teacherName: '體育甲', teacherType: 'subject', periods: 2 },
      { teacherId: 202, teacherName: '體育乙', teacherType: 'subject', periods: 2 },
    ],
    namedTeacherQuotas: [
      { teacherId: 201, teacherName: '體育甲', teacherType: 'subject', periods: 2 },
      { teacherId: 202, teacherName: '體育乙', teacherType: 'subject', periods: 2 },
      { teacherId: 101, teacherName: '張導', teacherType: 'homeroom', periods: 2 },
    ],
    classBlocks: [
      { className: '4年1班', periods: 2, homeroomTeacherName: '張導', isLocked: false },
      { className: '4年2班', periods: 2, homeroomTeacherName: '李導', isLocked: false },
      { className: '4年3班', periods: 2, homeroomTeacherName: '王導', isLocked: false },
    ],
    resolution: null,
  }

  it('1. does not render modal content when visible is false', () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: false, plans: [homeroomDefaultPlan] },
    })
    expect(wrapper.find('[data-testid="mixed-dialog-content"]').exists()).toBe(false)
  })

  it('2. renders plan information and auto preview when visible is true', () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: true, plans: [homeroomDefaultPlan] },
    })
    expect(wrapper.find('[data-testid="mixed-dialog-content"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('3年級')
    expect(wrapper.text()).toContain('健康')
    expect(wrapper.text()).toContain('10')
    expect(wrapper.text()).toContain('5')
  })

  it('3. does not emit confirm until every plan is valid', async () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: true, plans: [homeroomDefaultPlan] },
    })
    // Switch to manual mode without selecting any classes -> invalid
    const manualRadio = wrapper.get('[data-testid="mode-manual"]')
    await manualRadio.trigger('click')
    await nextTick()

    const confirmBtn = wrapper.get('[data-testid="mixed-confirm"]')
    expect(confirmBtn.attributes('disabled')).toBeDefined()

    await confirmBtn.trigger('click')
    expect(wrapper.emitted('confirm')).toBeFalsy()
  })

  it('4. shows only subject-admin exception classes for a homeroom-default plan', async () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: true, plans: [homeroomDefaultPlan] },
    })
    await wrapper.get('[data-testid="mode-manual"]').trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('其餘班級維持由導師授課')
  })

  it('5. shows only homeroom exception classes for a subject-default plan', async () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: true, plans: [subjectDefaultPlan] },
    })
    await wrapper.get('[data-testid="mode-manual"]').trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('其餘班級維持由科任／行政授課')
  })

  it('6. validates manual selection and enables confirm when quota is fulfilled', async () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: true, plans: [homeroomDefaultPlan] },
    })
    await wrapper.get('[data-testid="mode-manual"]').trigger('click')
    await nextTick()

    // 0 selected -> error displayed
    expect(wrapper.text()).toContain('節數不足')
    expect(wrapper.get('[data-testid="mixed-confirm"]').attributes('disabled')).toBeDefined()

    // Check 5 classes (3年1班 to 3年5班)
    const checkboxes = wrapper.findAll('input[type="checkbox"][data-testid^="class-checkbox-"]')
    expect(checkboxes.length).toBe(10)

    for (let i = 0; i < 5; i++) {
      await checkboxes[i].setValue(true)
    }
    await nextTick()

    expect(wrapper.text()).not.toContain('節數不足')
    expect(wrapper.get('[data-testid="mixed-confirm"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-testid="mixed-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()
    const emitted = wrapper.emitted('confirm')[0][0]
    expect(emitted).toHaveProperty('resolutions')
    expect(emitted.resolutions).toHaveLength(1)
  })

  it('7. emits cancel event when cancel button or icon is clicked', async () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: true, plans: [homeroomDefaultPlan] },
    })
    await wrapper.get('[data-testid="mixed-cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()

    await wrapper.get('[data-testid="mixed-cancel-icon"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(2)
  })

  it('8. multi-plan validation requires all plans to be valid before confirm', async () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: true, plans: [homeroomDefaultPlan, subjectDefaultPlan] },
    })

    // Plan 1 stays in auto (valid), Plan 2 switched to manual with 0 selected (invalid)
    const manualRadios = wrapper.findAll('[data-testid="mode-manual"]')
    expect(manualRadios.length).toBe(2)
    await manualRadios[1].trigger('click')
    await nextTick()

    // Confirm should be disabled
    const confirmBtn = wrapper.get('[data-testid="mixed-confirm"]')
    expect(confirmBtn.attributes('disabled')).toBeDefined()

    // Now select 1 class for Plan 2 (4年1班 = 2 periods)
    const plan2Checkboxes = wrapper.findAll('input[type="checkbox"][data-testid="class-checkbox-4年1班"]')
    expect(plan2Checkboxes.length).toBe(1)
    await plan2Checkboxes[0].setValue(true)
    await nextTick()

    // Confirm button enabled
    expect(confirmBtn.attributes('disabled')).toBeUndefined()

    await confirmBtn.trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()
    const emitted = wrapper.emitted('confirm')[0][0]
    expect(emitted.resolutions).toHaveLength(2)
  })

  it('9. displays error when manual selection exceeds imported quota', async () => {
    const wrapper = mount(MixedTeachingResolutionDialog, {
      props: { visible: true, plans: [homeroomDefaultPlan] },
    })
    await wrapper.get('[data-testid="mode-manual"]').trigger('click')
    await nextTick()

    const checkboxes = wrapper.findAll('input[type="checkbox"][data-testid^="class-checkbox-"]')
    // Select 6 classes = 6 periods (quota is 5)
    for (let i = 0; i < 6; i++) {
      await checkboxes[i].setValue(true)
    }
    await nextTick()

    expect(wrapper.text()).toContain('超過匯入配額')
    expect(wrapper.get('[data-testid="mixed-confirm"]').attributes('disabled')).toBeDefined()
  })
})
