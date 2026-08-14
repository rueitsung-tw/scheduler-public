import { describe, it, expect } from 'vitest'
import {
  buildMixedTeachingPlans,
  resolveMixedTeachingPlan,
  applyResolvedMixedTeachingPlans,
  buildMixedTeachingAssignmentLedger,
  validateImportedTeacherAssignments,
} from '../src/utils/mixedTeachingPlan.js'

describe('mixedTeachingPlan utils', () => {
  const sampleTeachers = [
    { id: 21, name: '甲師', type: 'subject' },
    { id: 35, name: '乙師', type: 'admin' },
    { id: 101, name: '張導', type: 'homeroom', assignedClass: '3年1班' },
    { id: 102, name: '李導', type: 'homeroom', assignedClass: '3年2班' },
    { id: 103, name: '王導', type: 'homeroom', assignedClass: '3年3班' },
    { id: 104, name: '陳導', type: 'homeroom', assignedClass: '3年4班' },
    { id: 105, name: '林導', type: 'homeroom', assignedClass: '3年5班' },
    { id: 106, name: '黃導', type: 'homeroom', assignedClass: '3年6班' },
    { id: 107, name: '周導', type: 'homeroom', assignedClass: '3年7班' },
    { id: 108, name: '吳導', type: 'homeroom', assignedClass: '3年8班' },
    { id: 109, name: '蔡導', type: 'homeroom', assignedClass: '3年9班' },
    { id: 110, name: '楊導', type: 'homeroom', assignedClass: '3年10班' },
  ]

  const create10Classes1Period = () => [
    { name: '3年1班', grade: 3, homeroom_teacher: '張導', course_requirements: [{ id: 'r1', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年2班', grade: 3, homeroom_teacher: '李導', course_requirements: [{ id: 'r2', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年3班', grade: 3, homeroom_teacher: '王導', course_requirements: [{ id: 'r3', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年4班', grade: 3, homeroom_teacher: '陳導', course_requirements: [{ id: 'r4', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年5班', grade: 3, homeroom_teacher: '林導', course_requirements: [{ id: 'r5', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年6班', grade: 3, homeroom_teacher: '黃導', course_requirements: [{ id: 'r6', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年7班', grade: 3, homeroom_teacher: '周導', course_requirements: [{ id: 'r7', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年8班', grade: 3, homeroom_teacher: '吳導', course_requirements: [{ id: 'r8', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年9班', grade: 3, homeroom_teacher: '蔡導', course_requirements: [{ id: 'r9', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    { name: '3年10班', grade: 3, homeroom_teacher: '楊導', course_requirements: [{ id: 'r10', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
  ]

  const sampleParsedRows = [
    {
      teacherId: 21,
      teacherName: '甲師',
      rules: [{ grade: 3, systemSubject: '健康', periods: 2 }],
    },
    {
      teacherId: 35,
      teacherName: '乙師',
      rules: [{ grade: 3, systemSubject: '健康', periods: 3 }],
    },
  ]

  it('detects 3年級健康 mixed teaching and allocates five complete classes', () => {
    const classes = create10Classes1Period()
    const { plans, blockers } = buildMixedTeachingPlans({
      parsedRows: sampleParsedRows,
      teachers: sampleTeachers,
      classes,
    })
    expect(blockers).toEqual([])
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      grade: 3,
      subject: '健康',
      totalDemandPeriods: 10,
      importedSubjectAdminPeriods: 5,
      homeroomPeriods: 5,
    })

    const res = resolveMixedTeachingPlan(plans[0], { mode: 'auto' })
    expect(res.valid).toBe(true)
    expect(res.resolution.assignments).toHaveLength(10)

    const jiaAssigned = res.resolution.assignments.filter((a) => a.teacherName === '甲師')
    const yiAssigned = res.resolution.assignments.filter((a) => a.teacherName === '乙師')
    const homeroomAssigned = res.resolution.assignments.filter((a) => a.teacherType === 'homeroom')

    expect(jiaAssigned).toHaveLength(2)
    expect(yiAssigned).toHaveLength(3)
    expect(homeroomAssigned).toHaveLength(5)
  })

  it('keeps class order by default and supports reproducible seeded random auto allocation', () => {
    const classes = Array.from({ length: 8 }, (_, index) => ({
      name: `2年${index + 1}班`,
      grade: 2,
      homeroom_teacher: `二年${index + 1}班導師`,
      course_requirements: [{ id: `health-${index + 1}`, subject: '健康', periods: 1, defaultTeacher: 'homeroom' }],
    }))
    const plan = {
      grade: 2,
      subject: '健康',
      defaultRoleGroup: 'homeroom',
      classBlocks: classes.map((cls) => ({
        className: cls.name,
        periods: 1,
        homeroomTeacherName: cls.homeroom_teacher,
      })),
      importedTeacherQuotas: [
        { teacherName: '健康科任甲', teacherType: 'subject', periods: 4 },
        { teacherName: '健康科任乙', teacherType: 'subject', periods: 1 },
        { teacherName: '健康科任丙', teacherType: 'admin', periods: 3 },
      ],
    }

    const byOrder = resolveMixedTeachingPlan(plan, {
      mode: 'auto',
      autoAllocation: { strategy: 'class-order' },
    })
    const randomOne = resolveMixedTeachingPlan(plan, {
      mode: 'auto',
      autoAllocation: { strategy: 'random', seed: 20260814 },
    })
    const randomTwo = resolveMixedTeachingPlan(plan, {
      mode: 'auto',
      autoAllocation: { strategy: 'random', seed: 20260814 },
    })

    expect(byOrder.valid).toBe(true)
    expect(byOrder.resolution.assignments
      .filter((assignment) => assignment.teacherName === '健康科任甲')
      .map((assignment) => assignment.className))
      .toEqual(['2年1班', '2年2班', '2年3班', '2年4班'])
    expect(randomTwo.resolution.assignments).toEqual(randomOne.resolution.assignments)
    expect(randomOne.resolution.assignments).not.toEqual(byOrder.resolution.assignments)

    const preallocatedPlan = {
      ...plan,
      importedTeacherQuotas: [
        { ...plan.importedTeacherQuotas[0], allocatedClassNames: ['2年8班', '2年7班', '2年6班', '2年5班'] },
        { ...plan.importedTeacherQuotas[1], allocatedClassNames: ['2年4班'] },
        { ...plan.importedTeacherQuotas[2], allocatedClassNames: ['2年3班', '2年2班', '2年1班'] },
      ],
    }
    const beforeAllocatedNames = preallocatedPlan.importedTeacherQuotas.map((quota) => quota.allocatedClassNames)
    const preallocatedRandom = resolveMixedTeachingPlan(preallocatedPlan, {
      mode: 'auto',
      autoAllocation: { strategy: 'random', seed: 20260814 },
    })
    expect(preallocatedRandom.resolution.assignments
      .filter((assignment) => assignment.teacherName === '健康科任甲')
      .map((assignment) => assignment.className))
      .toEqual(['2年5班', '2年6班', '2年7班', '2年8班'])
    expect(preallocatedPlan.importedTeacherQuotas.map((quota) => quota.allocatedClassNames)).toEqual(beforeAllocatedNames)
  })

  it('blocks a 3-period import when every class requires 2 complete periods', () => {
    const twoPeriodsClasses = [
      { name: '3年1班', grade: 3, homeroom_teacher: '張導', course_requirements: [{ id: 'r1', subject: '健康', periods: 2 }] },
      { name: '3年2班', grade: 3, homeroom_teacher: '李導', course_requirements: [{ id: 'r2', subject: '健康', periods: 2 }] },
      { name: '3年3班', grade: 3, homeroom_teacher: '王導', course_requirements: [{ id: 'r3', subject: '健康', periods: 2 }] },
      { name: '3年4班', grade: 3, homeroom_teacher: '陳導', course_requirements: [{ id: 'r4', subject: '健康', periods: 2 }] },
      { name: '3年5班', grade: 3, homeroom_teacher: '林導', course_requirements: [{ id: 'r5', subject: '健康', periods: 2 }] },
    ]
    const parsedRows = [
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [{ grade: 3, systemSubject: '健康', periods: 3 }],
      },
    ]

    const { plans } = buildMixedTeachingPlans({
      parsedRows,
      teachers: sampleTeachers,
      classes: twoPeriodsClasses,
    })

    expect(plans).toHaveLength(1)
    const result = resolveMixedTeachingPlan(plans[0], { mode: 'auto' })
    expect(result).toMatchObject({
      valid: false,
      errors: ['目前節數無法依每班完整課程節數分配，請檢查匯入資料。'],
    })
  })

  it('detects over-allocation blocker', () => {
    const classes = create10Classes1Period()
    const overParsedRows = [
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [{ grade: 3, systemSubject: '健康', periods: 12 }],
      },
    ]
    const { plans, blockers } = buildMixedTeachingPlans({
      parsedRows: overParsedRows,
      teachers: sampleTeachers,
      classes,
    })

    expect(plans).toHaveLength(0)
    expect(blockers.length).toBeGreaterThan(0)
    expect(blockers[0].cause || blockers[0]).toContain('超過')
  })

  it('does not block plan build for missing homeroom teacher, but fails resolution when assigned to homeroom', () => {
    const classesPartialHomeroom = [
      { name: '3年1班', grade: 3, homeroom_teacher: '張導', course_requirements: [{ id: 'r1', subject: '健康', periods: 1 }] },
      { name: '3年99班', grade: 3, course_requirements: [{ id: 'r2', subject: '健康', periods: 1 }] },
    ]
    const parsedRows = [
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [{ grade: 3, systemSubject: '健康', periods: 1 }],
      },
    ]
    const { plans, blockers } = buildMixedTeachingPlans({
      parsedRows,
      teachers: sampleTeachers,
      classes: classesPartialHomeroom,
    })

    expect(blockers).toEqual([])
    expect(plans).toHaveLength(1)

    const res = resolveMixedTeachingPlan(plans[0], { mode: 'auto' })
    expect(res.valid).toBe(false)
    expect(res.errors[0]).toContain('未設定導師')
  })

  it('detects locked class requirement blocker', () => {
    const classesWithLock = [
      { name: '3年1班', grade: 3, homeroom_teacher: '張導', course_requirements: [{ id: 'r1', subject: '健康', periods: 1, isLocked: true }] },
      { name: '3年2班', grade: 3, homeroom_teacher: '李導', course_requirements: [{ id: 'r2', subject: '健康', periods: 1 }] },
    ]
    const parsedRows = [
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [{ grade: 3, systemSubject: '健康', periods: 1 }],
      },
    ]
    const { plans, blockers } = buildMixedTeachingPlans({
      parsedRows,
      teachers: sampleTeachers,
      classes: classesWithLock,
    })

    expect(plans).toHaveLength(0)
    expect(blockers.length).toBeGreaterThan(0)
    expect(blockers[0].cause || blockers[0]).toContain('已鎖定')
  })

  it('resolves manual mode with subjectAdminClassNames correctly', () => {
    const classes = create10Classes1Period()
    const { plans } = buildMixedTeachingPlans({
      parsedRows: sampleParsedRows,
      teachers: sampleTeachers,
      classes,
    })

    const res = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      subjectAdminClassNames: ['3年9班', '3年10班', '3年1班', '3年2班', '3年3班'],
    })

    expect(res.valid).toBe(true)
    const jiaAssigned = res.resolution.assignments.filter((a) => a.teacherName === '甲師')
    const yiAssigned = res.resolution.assignments.filter((a) => a.teacherName === '乙師')
    expect(jiaAssigned.length + yiAssigned.length).toBe(5)
  })

  it('applies resolved plans immutably', () => {
    const classes = create10Classes1Period()
    const originalJson = JSON.stringify(classes)
    const { plans } = buildMixedTeachingPlans({
      parsedRows: sampleParsedRows,
      teachers: sampleTeachers,
      classes,
    })
    const res = resolveMixedTeachingPlan(plans[0], { mode: 'auto' })

    const nextClasses = applyResolvedMixedTeachingPlans(classes, [res.resolution])

    expect(JSON.stringify(classes)).toBe(originalJson)
    expect(nextClasses).not.toBe(classes)
    expect(nextClasses[0]).not.toBe(classes[0])
    expect(nextClasses[0].course_requirements[0].teacher).toBe('甲師')
    expect(nextClasses[0].course_requirements[0].isAutoAssigned).toBe(true)
    expect(nextClasses[0].course_requirements[0].assignmentSource).toBe('mixed-import')
  })

  it('skips homeroom teacher imported rules from subject-admin quota aggregation', () => {
    const classes = create10Classes1Period()
    const parsedRowsWithHomeroom = [
      ...sampleParsedRows,
      {
        teacherId: 101,
        teacherName: '張導',
        rules: [{ grade: 3, systemSubject: '健康', periods: 2 }],
      },
    ]

    const { plans } = buildMixedTeachingPlans({
      parsedRows: parsedRowsWithHomeroom,
      teachers: sampleTeachers,
      classes,
    })

    expect(plans).toHaveLength(1)
    // Homeroom teacher's rules shouldn't be added to importedSubjectAdminPeriods
    expect(plans[0].importedSubjectAdminPeriods).toBe(5)
  })

  it('validates manual mode errors for duplicate, invalid, or mismatched period allocations', () => {
    const classes = create10Classes1Period()
    const { plans } = buildMixedTeachingPlans({
      parsedRows: sampleParsedRows,
      teachers: sampleTeachers,
      classes,
    })

    // Duplicate class
    const dupRes = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      subjectAdminClassNames: ['3年1班', '3年1班', '3年2班', '3年3班', '3年4班'],
    })
    expect(dupRes.valid).toBe(false)
    expect(dupRes.errors).toContain('選擇的班級包含重複項目')

    // Invalid class name
    const invRes = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      subjectAdminClassNames: ['3年99班', '3年2班', '3年3班', '3年4班', '3年5班'],
    })
    expect(invRes.valid).toBe(false)
    expect(invRes.errors[0]).toContain('無效班級')

    // Period quota deficit (selected 2 classes instead of 5)
    const defRes = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      subjectAdminClassNames: ['3年1班', '3年2班'],
    })
    expect(defRes.valid).toBe(false)
    expect(defRes.errors).toContain('科任／行政分配節數不足匯入配額')

    // Period quota excess (selected 6 classes instead of 5)
    const excRes = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      subjectAdminClassNames: ['3年1班', '3年2班', '3年3班', '3年4班', '3年5班', '3年6班'],
    })
    expect(excRes.valid).toBe(false)
    expect(excRes.errors).toContain('科任／行政分配節數超過匯入配額')
  })

  it('sorts classes naturally so 3年10班 comes after 3年2班', () => {
    const unorderedClasses = [
      { name: '3年10班', grade: 3, homeroom_teacher: '楊導', course_requirements: [{ id: 'r10', subject: '健康', periods: 1 }] },
      { name: '3年2班', grade: 3, homeroom_teacher: '李導', course_requirements: [{ id: 'r2', subject: '健康', periods: 1 }] },
      { name: '3年1班', grade: 3, homeroom_teacher: '張導', course_requirements: [{ id: 'r1', subject: '健康', periods: 1 }] },
    ]
    const parsedRows = [
      { teacherId: 21, teacherName: '甲師', rules: [{ grade: 3, systemSubject: '健康', periods: 1 }] },
    ]

    const { plans } = buildMixedTeachingPlans({
      parsedRows,
      teachers: sampleTeachers,
      classes: unorderedClasses,
    })

    expect(plans[0].classBlocks.map((b) => b.className)).toEqual(['3年1班', '3年2班', '3年10班'])
    const res = resolveMixedTeachingPlan(plans[0], { mode: 'auto' })
    expect(res.resolution.assignments[0].className).toBe('3年1班')
    expect(res.resolution.assignments[0].teacherName).toBe('甲師')
    expect(res.resolution.assignments[1].teacherName).toBe('李導')
    expect(res.resolution.assignments[2].teacherName).toBe('楊導')
  })

  it('detects reverse direction mixed teaching (default subject + imported homeroom) and resolves auto mode', () => {
    const reverseClasses = [
      { name: '4年1班', grade: 4, homeroom_teacher: '王導', course_requirements: [{ id: 'r1', subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年2班', grade: 4, homeroom_teacher: '趙導', course_requirements: [{ id: 'r2', subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年3班', grade: 4, homeroom_teacher: '孫導', course_requirements: [{ id: 'r3', subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
    ]
    const reverseParsedRows = [
      {
        teacherId: 103,
        teacherName: '王導',
        rules: [{ grade: 4, systemSubject: '美勞', periods: 2 }],
      },
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [{ grade: 4, systemSubject: '美勞', periods: 4 }],
      },
    ]

    const { plans, blockers } = buildMixedTeachingPlans({
      parsedRows: reverseParsedRows,
      teachers: sampleTeachers,
      classes: reverseClasses,
    })

    expect(blockers).toEqual([])
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      grade: 4,
      subject: '美勞',
      defaultTeacher: 'subject',
      defaultRoleGroup: 'subject-admin',
      exceptionRoleGroup: 'homeroom',
      totalDemandPeriods: 6,
      importedHomeroomPeriods: 2,
      defaultRolePeriods: 4,
    })

    const res = resolveMixedTeachingPlan(plans[0], { mode: 'auto' })
    expect(res.valid).toBe(true)
    expect(res.resolution.assignments).toHaveLength(3)

    const wangAssigned = res.resolution.assignments.find((a) => a.teacherName === '王導')
    expect(wangAssigned).toMatchObject({
      className: '4年1班',
      teacherName: '王導',
      teacherType: 'homeroom',
      periods: 2,
    })

    const defaultAssigned = res.resolution.assignments.filter((a) => a.teacherName === '甲師')
    expect(defaultAssigned).toHaveLength(2)
    expect(defaultAssigned.every((a) => a.teacherName === '甲師')).toBe(true)

    // 套用決議至班級需求，驗證套用後的結果
    const updatedClasses = applyResolvedMixedTeachingPlans(reverseClasses, [res.resolution])

    // 1. 匯入導師配額精確：只有 1 班 (2 堂) 分配給 '王導'
    const importedReqs = updatedClasses.flatMap((c) => c.course_requirements).filter((r) => r.teacher === '王導')
    expect(importedReqs).toHaveLength(1)
    expect(updatedClasses.find((c) => c.name === '4年1班').course_requirements[0].teacher).toBe('王導')

    // 2. 留在預設群組的班級由具名科任授課，且 defaultTeacher 維持 'subject'
    const defaultClass1Req = updatedClasses.find((c) => c.name === '4年2班').course_requirements[0]
    const defaultClass2Req = updatedClasses.find((c) => c.name === '4年3班').course_requirements[0]

    expect(defaultClass1Req.teacher).toBe('甲師')
    expect(defaultClass1Req.defaultTeacher).toBe('subject')
    expect(defaultClass2Req.teacher).toBe('甲師')
    expect(defaultClass2Req.defaultTeacher).toBe('subject')

    // 3. 任何 requirement 皆不得拿到字串 'subject' 或 'admin' 作為 teacher
    const invalidTeacherReqs = updatedClasses
      .flatMap((c) => c.course_requirements)
      .filter((r) => r.teacher === 'subject' || r.teacher === 'admin')
    expect(invalidTeacherReqs).toHaveLength(0)
  })

  it('resolves reverse direction mixed teaching in manual mode using exceptionClassNames', () => {
    const reverseClasses = [
      { name: '4年1班', grade: 4, homeroom_teacher: '王導', course_requirements: [{ id: 'r1', subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年2班', grade: 4, homeroom_teacher: '趙導', course_requirements: [{ id: 'r2', subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年3班', grade: 4, homeroom_teacher: '孫導', course_requirements: [{ id: 'r3', subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
    ]
    const reverseParsedRows = [
      {
        teacherId: 103,
        teacherName: '王導',
        rules: [{ grade: 4, systemSubject: '美勞', periods: 2 }],
      },
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [{ grade: 4, systemSubject: '美勞', periods: 4 }],
      },
    ]

    const { plans } = buildMixedTeachingPlans({
      parsedRows: reverseParsedRows,
      teachers: sampleTeachers,
      classes: reverseClasses,
    })

    const res = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      exceptionClassNames: ['4年2班'],
    })

    expect(res.valid).toBe(true)
    const zhaoAssigned = res.resolution.assignments.find((a) => a.className === '4年2班')
    expect(zhaoAssigned).toMatchObject({
      teacherName: '王導',
      teacherType: 'homeroom',
    })

    const defaultAssignedManual = res.resolution.assignments.filter((a) => a.teacherName === '甲師')
    expect(defaultAssignedManual).toHaveLength(2)
    expect(defaultAssignedManual.every((a) => a.teacherName === '甲師')).toBe(true)

    const updatedClassesManual = applyResolvedMixedTeachingPlans(reverseClasses, [res.resolution])

    // 1. 匯入導師配額精確：只有 4年2班 分配給 '王導'
    expect(updatedClassesManual.find((c) => c.name === '4年2班').course_requirements[0].teacher).toBe('王導')
    expect(updatedClassesManual.find((c) => c.name === '4年1班').course_requirements[0].teacher).toBe('甲師')
    expect(updatedClassesManual.find((c) => c.name === '4年3班').course_requirements[0].teacher).toBe('甲師')

    // 2. 不得拿到 'subject' 或 'admin' 作為 teacher
    const invalidTeacherReqsManual = updatedClassesManual
      .flatMap((c) => c.course_requirements)
      .filter((r) => r.teacher === 'subject' || r.teacher === 'admin')
    expect(invalidTeacherReqsManual).toHaveLength(0)

    // 3. defaultTeacher 維持 'subject'
    expect(updatedClassesManual.every((c) => c.course_requirements.every((r) => r.defaultTeacher === 'subject'))).toBe(true)
  })

  it('validates homeroom teacher existence only when assigned to homeroom role', () => {
    const classesPartialHomeroom = [
      { name: '3年1班', grade: 3, homeroom_teacher: '張導', course_requirements: [{ id: 'r1', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
      { name: '3年99班', grade: 3, course_requirements: [{ id: 'r2', subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    ]
    const parsedRows = [
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [{ grade: 3, systemSubject: '健康', periods: 1 }],
      },
    ]
    const { plans, blockers } = buildMixedTeachingPlans({
      parsedRows,
      teachers: sampleTeachers,
      classes: classesPartialHomeroom,
    })

    expect(blockers).toEqual([])
    expect(plans).toHaveLength(1)

    // Manual mode assigns 3年99班 (no homeroom teacher) to subject teacher 甲師 -> valid!
    const resValid = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      exceptionClassNames: ['3年99班'],
    })
    expect(resValid.valid).toBe(true)

    // Manual mode assigns 3年1班 to subject teacher 甲師 -> 3年99班 assigned to homeroom (missing teacher) -> invalid!
    const resInvalid = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      exceptionClassNames: ['3年1班'],
    })
    expect(resInvalid.valid).toBe(false)
    expect(resInvalid.errors[0]).toContain('未設定導師')
  })

  it('detects blocker when specific target overlaps a batch allocation', () => {
    const classes = [
      { name: '5年1班', grade: 5, homeroom_teacher: '張導', course_requirements: [{ id: 'r1', subject: '音樂', periods: 1.5 }] },
      { name: '5年2班', grade: 5, homeroom_teacher: '李導', course_requirements: [{ id: 'r2', subject: '音樂', periods: 1.5 }] },
      { name: '5年3班', grade: 5, homeroom_teacher: '王導', course_requirements: [{ id: 'r3', subject: '音樂', periods: 1.5 }] },
      { name: '5年4班', grade: 5, homeroom_teacher: '陳導', course_requirements: [{ id: 'r4', subject: '音樂', periods: 1.5 }] },
      { name: '5年5班', grade: 5, homeroom_teacher: '林導', course_requirements: [{ id: 'r5', subject: '音樂', periods: 1.5 }] },
    ]
    const parsedRows = [
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [
          {
            grade: 5,
            systemSubject: '音樂',
            periods: 6,
            sourceKind: 'grade-batch',
            classCount: 4,
            candidateClassNames: ['5年2班', '5年3班', '5年4班', '5年5班'],
          },
        ],
      },
      {
        teacherId: 35,
        teacherName: '乙師',
        rules: [
          {
            grade: 5,
            systemSubject: '音樂',
            periods: 1.5,
            sourceKind: 'class-specific',
            targetClassNames: ['5年5班'],
          },
        ],
      },
    ]

    const { blockers } = buildMixedTeachingPlans({
      parsedRows,
      teachers: sampleTeachers,
      classes,
    })

    expect(blockers.length).toBeGreaterThan(0)
    expect(blockers[0].cause).toContain('5年5班')
  })

  it('reserves class-specific targets first before batch allocation in auto resolution mode', () => {
    const classes = [
      { name: '5年1班', grade: 5, homeroom_teacher: '張導', course_requirements: [{ id: 'r1', subject: '音樂', periods: 1 }] },
      { name: '5年2班', grade: 5, homeroom_teacher: '李導', course_requirements: [{ id: 'r2', subject: '音樂', periods: 1 }] },
      { name: '5年3班', grade: 5, homeroom_teacher: '王導', course_requirements: [{ id: 'r3', subject: '音樂', periods: 1 }] },
      { name: '5年4班', grade: 5, homeroom_teacher: '陳導', course_requirements: [{ id: 'r4', subject: '音樂', periods: 1 }] },
      { name: '5年5班', grade: 5, homeroom_teacher: '林導', course_requirements: [{ id: 'r5', subject: '音樂', periods: 1 }] },
    ]
    const parsedRows = [
      {
        teacherId: 35,
        teacherName: '乙師',
        rules: [
          {
            grade: 5,
            systemSubject: '音樂',
            periods: 1,
            sourceKind: 'class-specific',
            targetClassNames: ['5年5班'],
          },
        ],
      },
      {
        teacherId: 21,
        teacherName: '甲師',
        rules: [
          {
            grade: 5,
            systemSubject: '音樂',
            periods: 2,
            sourceKind: 'grade-batch',
            classCount: 2,
          },
        ],
      },
    ]

    const { plans, blockers } = buildMixedTeachingPlans({
      parsedRows,
      teachers: sampleTeachers,
      classes,
    })

    expect(blockers).toEqual([])
    expect(plans).toHaveLength(1)

    const res = resolveMixedTeachingPlan(plans[0], { mode: 'auto' })
    expect(res.valid).toBe(true)

    const yiAssign = res.resolution.assignments.find((a) => a.teacherName === '乙師')
    expect(yiAssign.className).toBe('5年5班')

    const jiaAssigns = res.resolution.assignments.filter((a) => a.teacherName === '甲師')
    expect(jiaAssigns.map((a) => a.className)).toEqual(['5年1班', '5年2班'])
  })

  it('allocates every named teacher in reverse mixed teaching without blank subject-admin assignments', () => {
    const naturalTeachers = [
      { id: 201, name: '自然甲', type: 'subject' },
      { id: 202, name: '自然乙', type: 'admin' },
      { id: 203, name: '施懿珊', type: 'homeroom', assignedClass: '6年8班' },
    ]
    const naturalClasses = Array.from({ length: 11 }, (_, index) => ({
      name: `6年${index + 1}班`,
      grade: 6,
      homeroom_teacher: index === 7 ? '施懿珊' : `六導${index + 1}`,
      course_requirements: [{ id: `n${index + 1}`, subject: '自然科學', periods: 4, defaultTeacher: 'subject' }],
    }))
    const parsedRows = [
      { teacherId: 201, teacherName: '自然甲', rules: [{ grade: 6, systemSubject: '自然科學', periods: 20 }] },
      { teacherId: 202, teacherName: '自然乙', rules: [{ grade: 6, systemSubject: '自然科學', periods: 20 }] },
      { teacherId: 203, teacherName: '施懿珊', rules: [{ grade: 6, systemSubject: '自然科學', periods: 4 }] },
    ]

    const { plans, blockers } = buildMixedTeachingPlans({
      parsedRows,
      teachers: naturalTeachers,
      classes: naturalClasses,
    })

    expect(blockers).toEqual([])
    expect(plans).toHaveLength(1)
    const [plan] = plans
    expect(plan.defaultRoleTeacherQuotas.map((q) => q.teacherName)).toEqual(['自然甲', '自然乙'])
    expect(plan.exceptionTeacherQuotas).toMatchObject([{ teacherName: '施懿珊', periods: 4 }])
    expect(plan.allNamedPeriods).toBe(44)
    expect(plan.implicitDefaultPeriods).toBe(0)

    const result = resolveMixedTeachingPlan(plan, { mode: 'auto' })
    expect(result.valid).toBe(true)
    expect(result.resolution.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: '6年8班', teacherName: '施懿珊', periods: 4 }),
      expect.objectContaining({ teacherName: '自然甲', periods: 4 }),
      expect.objectContaining({ teacherName: '自然乙', periods: 4 }),
    ]))
    expect(result.resolution.assignments.every((assignment) => assignment.teacherName)).toBe(true)
  })

  it('blocks reverse mixed teaching when subject-admin residual has no named teacher', () => {
    const classes = [
      { name: '4年1班', grade: 4, homeroom_teacher: '王導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年2班', grade: 4, homeroom_teacher: '趙導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
    ]
    const { plans } = buildMixedTeachingPlans({
      parsedRows: [{ teacherId: 103, teacherName: '王導', rules: [{ grade: 4, systemSubject: '美勞', periods: 2 }] }],
      teachers: sampleTeachers,
      classes,
    })

    const result = resolveMixedTeachingPlan(plans[0], { mode: 'auto' })
    expect(result).toMatchObject({ valid: false })
    expect(result.errors).toContain('科任／行政剩餘 2 堂未指定教師')
  })

  it('keeps a class-specific homeroom exception fixed in manual mode without requiring it in the selection', () => {
    const classes = [
      { name: '4年1班', grade: 4, homeroom_teacher: '王導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年2班', grade: 4, homeroom_teacher: '趙導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年3班', grade: 4, homeroom_teacher: '孫導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年4班', grade: 4, homeroom_teacher: '陳導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
    ]
    const teachers = [
      { id: 21, name: '甲師', type: 'subject' },
      { id: 103, name: '王導', type: 'homeroom' },
      { id: 104, name: '趙導', type: 'homeroom' },
    ]
    const parsedRows = [
      { teacherId: 21, teacherName: '甲師', rules: [{ grade: 4, systemSubject: '美勞', periods: 4 }] },
      {
        teacherId: 103,
        teacherName: '王導',
        rules: [{ grade: 4, systemSubject: '美勞', periods: 2, sourceKind: 'class-specific', targetClassNames: ['4年1班'] }],
      },
      { teacherId: 104, teacherName: '趙導', rules: [{ grade: 4, systemSubject: '美勞', periods: 2 }] },
    ]
    const { plans } = buildMixedTeachingPlans({ parsedRows, teachers, classes })

    const result = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      exceptionClassNames: ['4年3班'],
    })

    expect(result.valid).toBe(true)
    expect(result.resolution.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: '4年1班', teacherName: '王導' }),
      expect.objectContaining({ className: '4年3班', teacherName: '趙導' }),
    ]))
  })

  it('keeps a class-specific default-role teacher fixed when manual mode selects exceptions', () => {
    const classes = [
      { name: '4年1班', grade: 4, homeroom_teacher: '王導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年2班', grade: 4, homeroom_teacher: '趙導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
      { name: '4年3班', grade: 4, homeroom_teacher: '孫導', course_requirements: [{ subject: '美勞', periods: 2, defaultTeacher: 'subject' }] },
    ]
    const teachers = [
      { id: 21, name: '甲師', type: 'subject' },
      { id: 103, name: '王導', type: 'homeroom' },
    ]
    const parsedRows = [
      { teacherId: 21, teacherName: '甲師', rules: [{ grade: 4, systemSubject: '美勞', periods: 4, sourceKind: 'class-specific', targetClassNames: ['4年1班'] }] },
      { teacherId: 103, teacherName: '王導', rules: [{ grade: 4, systemSubject: '美勞', periods: 2 }] },
    ]
    const { plans } = buildMixedTeachingPlans({ parsedRows, teachers, classes })

    expect(plans[0].forcedDefaultClassNames).toEqual(['4年1班'])
    const result = resolveMixedTeachingPlan(plans[0], {
      mode: 'manual',
      // A stale/malicious UI selection must not move the fixed default-role class into exceptions.
      exceptionClassNames: ['4年1班', '4年2班'],
    })

    expect(result.valid).toBe(true)
    expect(result.resolution.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: '4年1班', teacherName: '甲師' }),
      expect.objectContaining({ className: '4年2班', teacherName: '王導' }),
    ]))
  })

  it('keeps same-name teachers separated by id in plans and ledgers', () => {
    const classes = [
      { name: '4年1班', grade: 4, course_requirements: [{ subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
      { name: '4年2班', grade: 4, course_requirements: [{ subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
      { name: '4年3班', grade: 4, course_requirements: [{ subject: '健康', periods: 1, defaultTeacher: 'homeroom' }] },
    ]
    const teachers = [
      { id: 21, name: '同名教師', type: 'subject' },
      { id: 22, name: '同名教師', type: 'subject' },
      { id: 103, name: '王導', type: 'homeroom' },
    ]
    const parsedRows = [
      { teacherId: 21, teacherName: '同名教師', rules: [{ grade: 4, systemSubject: '健康', periods: 1 }] },
      { teacherId: 22, teacherName: '同名教師', rules: [{ grade: 4, systemSubject: '健康', periods: 1 }] },
      { teacherId: 103, teacherName: '王導', rules: [{ grade: 4, systemSubject: '健康', periods: 1 }] },
    ]
    const { plans } = buildMixedTeachingPlans({ parsedRows, teachers, classes })
    expect(plans[0].exceptionTeacherQuotas).toEqual(expect.arrayContaining([
      expect.objectContaining({ teacherId: 21, periods: 1 }),
      expect.objectContaining({ teacherId: 22, periods: 1 }),
    ]))

    const ledger = buildMixedTeachingAssignmentLedger({
      teachers,
      resolutions: [{ grade: 4, subject: '健康', resolution: { assignments: [
        { className: '4年1班', teacherId: 21, teacherName: '同名教師', periods: 1 },
        { className: '4年2班', teacherId: 22, teacherName: '同名教師', periods: 1 },
      ] } }],
    })
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ teacherId: 21, className: '4年1班' }),
      expect.objectContaining({ teacherId: 22, className: '4年2班' }),
    ]))
  })

  it('validates every non-empty imported teacher rule against this import ledger by teacher identity', () => {
    const parsedRows = [
      { teacherId: 201, teacherName: '自然甲', rules: [{ grade: 6, systemSubject: '自然科學', periods: 20 }] },
      { teacherId: 202, teacherName: '自然乙', rules: [{ grade: 6, systemSubject: '自然科學', periods: 20 }] },
      { teacherId: 203, teacherName: '施懿珊', rules: [{ grade: 6, systemSubject: '自然科學', periods: 4 }] },
      { teacherId: 204, teacherName: '空白配課', rules: [] },
    ]
    const teachers = [
      { id: 201, name: '自然甲' },
      { id: 202, name: '自然乙' },
      { id: 203, name: '施懿珊' },
      { id: 204, name: '空白配課' },
    ]
    const assignmentLedger = [
      ...Array.from({ length: 5 }, (_, index) => ({ teacherId: 201, teacherName: '自然甲', grade: 6, subject: '自然科學', periods: 4, className: `6年${index + 1}班` })),
      ...Array.from({ length: 5 }, (_, index) => ({ teacherId: 202, teacherName: '自然乙', grade: 6, subject: '自然科學', periods: 4, className: `6年${index + 6}班` })),
      { teacherId: 203, teacherName: '施懿珊', grade: 6, subject: '自然科學', periods: 4, className: '6年8班' },
    ]

    expect(validateImportedTeacherAssignments({ parsedRows, teachers, assignmentLedger })).toEqual({ valid: true, errors: [] })
  })

  it('aggregates multiple imported rules for the same teacher, grade, and subject before validating the ledger', () => {
    const parsedRows = [{
      teacherId: 201,
      teacherName: '自然甲',
      rules: [
        { grade: 5, systemSubject: '自然科學', periods: 20 },
        { grade: 5, systemSubject: '自然科學', periods: 4 },
      ],
    }]
    const teachers = [{ id: 201, name: '自然甲' }]
    const fullLedger = [{ teacherId: 201, teacherName: '自然甲', grade: 5, subject: '自然科學', periods: 24, className: '5年1班' }]
    const shortLedger = [{ teacherId: 201, teacherName: '自然甲', grade: 5, subject: '自然科學', periods: 20, className: '5年1班' }]

    expect(validateImportedTeacherAssignments({ parsedRows, teachers, assignmentLedger: fullLedger }))
      .toEqual({ valid: true, errors: [] })

    expect(validateImportedTeacherAssignments({ parsedRows, teachers, assignmentLedger: shortLedger })).toEqual({
      valid: false,
      errors: ['教師「自然甲」5 年級科目「自然科學」應配 24 節，實際已配 20 節'],
    })
  })

  it('does not let an old same-name class assignment satisfy this import ledger validation', () => {
    const parsedRows = [{ teacherId: 201, teacherName: '自然甲', rules: [{ grade: 6, systemSubject: '自然科學', periods: 20 }] }]
    const teachers = [{ id: 201, name: '自然甲' }]
    const staleClasses = [{
      name: '6年1班',
      course_requirements: [{ subject: '自然科學', periods: 20, teacher: '自然甲' }],
    }]

    const result = validateImportedTeacherAssignments({ parsedRows, teachers, assignmentLedger: [] })

    expect(staleClasses[0].course_requirements[0].teacher).toBe('自然甲')
    expect(result).toMatchObject({ valid: false })
    expect(result.errors).toEqual([expect.stringContaining('自然甲')])
    expect(result.errors).toEqual([expect.stringContaining('應配 20 節，實際已配 0 節')])
  })

  it('builds mixed ledgers from resolutions without changing homeroom_teacher', () => {
    const classes = [{
      name: '6年8班', grade: 6, homeroom_teacher: '施懿珊',
      course_requirements: [{ subject: '自然科學', periods: 4, teacher: '' }],
    }]
    const resolutions = [{
      grade: 6, subject: '自然科學',
      resolution: { assignments: [{ className: '6年8班', teacherName: '施懿珊', periods: 4 }] },
    }]

    const ledger = buildMixedTeachingAssignmentLedger({ resolutions, teachers: [{ id: 203, name: '施懿珊' }] })
    const applied = applyResolvedMixedTeachingPlans(classes, resolutions)

    expect(ledger).toEqual([expect.objectContaining({ teacherId: 203, teacherName: '施懿珊', grade: 6, subject: '自然科學', periods: 4 })])
    expect(applied[0].homeroom_teacher).toBe('施懿珊')
    expect(classes[0].homeroom_teacher).toBe('施懿珊')
  })
})
