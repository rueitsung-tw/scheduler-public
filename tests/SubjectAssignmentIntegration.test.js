import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useScheduleStore } from '../src/stores/schedule'
import { runSmartSubjectAssignment, materializeImportedAssignmentRules, filterRulesForImportedMaterialization } from '../src/utils/subjectAssignmentMaterializer'
import { applyImportToTeachers } from '../src/utils/subjectAssignmentExcelParser'
import { applyResolvedMixedTeachingPlans } from '../src/utils/mixedTeachingPlan'

describe('SubjectAssignmentIntegration (Task 5 Materialization, Splitting & Idempotency)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('1. Grade-specific assignment rules (e.g. 5th grade 7 + 3rd grade 10) assign exact periods per grade', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 1,
        name: '張科任',
        type: 'subject',
        assignment_rules: [
          { grade: 5, subject: '科技-資訊', periods: 7 },
          { grade: 3, subject: '科技-資訊', periods: 10 }
        ],
        base_periods: 20
      }
    ]
    // 5th grade: 4 classes of 2 periods each = 8 periods total demand
    // 3rd grade: 5 classes of 2 periods each = 10 periods total demand
    store.classes = [
      { name: '501班', grade: 5, course_requirements: [{ id: 'req-501', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] },
      { name: '502班', grade: 5, course_requirements: [{ id: 'req-502', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] },
      { name: '503班', grade: 5, course_requirements: [{ id: 'req-503', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] },
      { name: '504班', grade: 5, course_requirements: [{ id: 'req-504', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] },
      
      { name: '301班', grade: 3, course_requirements: [{ id: 'req-301', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] },
      { name: '302班', grade: 3, course_requirements: [{ id: 'req-302', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] },
      { name: '303班', grade: 3, course_requirements: [{ id: 'req-303', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] },
      { name: '304班', grade: 3, course_requirements: [{ id: 'req-304', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] },
      { name: '305班', grade: 3, course_requirements: [{ id: 'req-305', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }] }
    ]

    const result = runSmartSubjectAssignment(store, [])
    expect(result.success).toBe(true)

    // Check 5th grade assignments: 501(2), 502(2), 503(2) + 504 split (1 assigned + 1 remainder) = 7 periods assigned
    const grade5Assigned = store.classes
      .filter(c => c.grade === 5)
      .flatMap(c => c.course_requirements)
      .filter(r => r.teacher === '張科任')
      .reduce((sum, r) => sum + r.periods, 0)
    expect(grade5Assigned).toBe(7)

    // Check 3rd grade assignments: 301..305 = 10 periods assigned
    const grade3Assigned = store.classes
      .filter(c => c.grade === 3)
      .flatMap(c => c.course_requirements)
      .filter(r => r.teacher === '張科任')
      .reduce((sum, r) => sum + r.periods, 0)
    expect(grade3Assigned).toBe(10)
  })

  it('2. A 2-period rule splits a 3-period class requirement exactly into 2 assigned + 1 unassigned remainder with metadata preserved', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 2,
        name: '李專任',
        type: 'subject',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 2 }],
        base_periods: 20
      }
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          {
            id: 'req-orig',
            subject: '科技-資訊',
            periods: 3,
            defaultTeacher: 'subject',
            room_type: '電腦教室',
            is_consecutive: true,
            teacher: ''
          }
        ]
      }
    ]

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)

    const reqs = store.classes[0].course_requirements
    expect(reqs).toHaveLength(2)

    // Assigned split chunk (2 periods)
    expect(reqs[0].periods).toBe(2)
    expect(reqs[0].teacher).toBe('李專任')
    expect(reqs[0].room_type).toBe('電腦教室')
    expect(reqs[0].is_consecutive).toBe(true)
    expect(reqs[0].id).toContain('_split_李專任_1')

    // Unassigned remainder chunk (1 period)
    expect(reqs[1].periods).toBe(1)
    expect(reqs[1].teacher).toBe('')
    expect(reqs[1].room_type).toBe('電腦教室')
    expect(reqs[1].is_consecutive).toBe(true)
    expect(reqs[1].id).toContain('_split_remainder_2')

    // Per-class subject total is preserved (2 + 1 = 3)
    expect(reqs[0].periods + reqs[1].periods).toBe(3)
  })

  it('3. Confirmed homeroom teacher rules materialize while strictly retaining type === "homeroom"', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 10,
        name: '陳導師',
        type: 'homeroom',
        confirmedHomeroomAssignment: true,
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 2 }],
        base_periods: 20
      }
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'req-1', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }
        ]
      }
    ]

    const res = runSmartSubjectAssignment(store, [10])
    expect(res.success).toBe(true)
    expect(store.teachers[0].type).toBe('homeroom') // Must remain homeroom
    expect(store.classes[0].course_requirements[0].teacher).toBe('陳導師')
  })

  it('4. Blocking demand mismatch leaves teachers and classes completely untouched (Zero Writes)', () => {
    const store = useScheduleStore()
    const initialTeachers = [
      {
        id: 4,
        name: '趙專任',
        type: 'subject',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 10 }],
        base_periods: 20
      }
    ]
    const initialClasses = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'r1', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }
        ]
      }
    ]
    store.teachers = JSON.parse(JSON.stringify(initialTeachers))
    store.classes = JSON.parse(JSON.stringify(initialClasses))

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/需求不符|超額|不足/)

    // Zero Writes verification
    expect(store.teachers).toEqual(initialTeachers)
    expect(store.classes).toEqual(initialClasses)
  })

  it('5. Repeated auto-assignment is idempotent (running 1x vs 3x produces identical state)', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 3,
        name: '王專任',
        type: 'subject',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 2 }],
        base_periods: 20
      }
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'r1', subject: '科技-資訊', periods: 3, defaultTeacher: 'subject', teacher: '' }
        ]
      }
    ]

    runSmartSubjectAssignment(store, [])
    const stateAfterOnce = JSON.parse(JSON.stringify(store.classes))

    runSmartSubjectAssignment(store, [])
    runSmartSubjectAssignment(store, [])
    const stateAfterThrice = JSON.parse(JSON.stringify(store.classes))

    expect(stateAfterThrice).toEqual(stateAfterOnce)
  })

  it('6. Existing manually assigned requirements are preserved and not overwritten', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 5,
        name: '林專任',
        type: 'subject',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 2 }],
        base_periods: 20
      }
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'r-manual', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '王手動', isAutoAssigned: false },
          { id: 'r-open', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }
        ]
      }
    ]

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)

    // Manual assignment must remain '王手動'
    expect(store.classes[0].course_requirements[0].teacher).toBe('王手動')
    // Open requirement gets rule assignment '林專任'
    expect(store.classes[0].course_requirements[1].teacher).toBe('林專任')
  })

  it('7. Within one materialization pass, freshly auto-assigned portion is never treated as eligible for another teacher (two teachers share rules)', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 101,
        name: '專任A',
        type: 'subject',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 2 }],
        base_periods: 20
      },
      {
        id: 102,
        name: '專任B',
        type: 'subject',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 2 }],
        base_periods: 20
      }
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'req-501', subject: '科技-資訊', periods: 4, defaultTeacher: 'subject', teacher: '' }
        ]
      }
    ]

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)

    const reqs = store.classes[0].course_requirements
    expect(reqs).toHaveLength(2)

    // Total periods assigned across split chunks = 4
    const totalPeriods = reqs.reduce((sum, r) => sum + r.periods, 0)
    expect(totalPeriods).toBe(4)

    // Teacher A assigned exact 2 periods
    const teacherAPeriods = reqs.filter(r => r.teacher === '專任A').reduce((sum, r) => sum + r.periods, 0)
    expect(teacherAPeriods).toBe(2)

    // Teacher B assigned exact 2 periods
    const teacherBPeriods = reqs.filter(r => r.teacher === '專任B').reduce((sum, r) => sum + r.periods, 0)
    expect(teacherBPeriods).toBe(2)
  })

  it('8. Preflight and Phase A/B exclude locked unassigned requirements, proving no mutation/assignment', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 201,
        name: '陳專任',
        type: 'subject',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 2 }],
        base_periods: 20
      }
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'req-locked', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '', isLocked: true },
          { id: 'req-open', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }
        ]
      }
    ]

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)

    const reqs = store.classes[0].course_requirements
    const lockedReq = reqs.find(r => r.id === 'req-locked')
    const openReq = reqs.find(r => r.id === 'req-open')

    // Locked requirement must remain untouched/unassigned
    expect(lockedReq.teacher).toBe('')
    expect(lockedReq.isLocked).toBe(true)

    // Open requirement receives rule assignment
    expect(openReq.teacher).toBe('陳專任')
    expect(openReq.isAutoAssigned).toBe(true)
  })

  it('9. Durable homeroom confirmation: persisted nonempty assignment_rules acts as confirmation proof after reload', () => {
    const store = useScheduleStore()
    // Homeroom teacher has persisted non-empty assignment_rules, but confirmedHomeroomAssignment flag is omitted
    store.teachers = [
      {
        id: 301,
        name: '黃導師',
        type: 'homeroom',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 2 }],
        base_periods: 20
      }
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'req-reload', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' }
        ]
      }
    ]

    // Pass empty confirmedHomeroomTeacherIds array to simulate fresh reload without transient state
    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)

    // Requirement is assigned to the homeroom teacher whose rules were persisted
    expect(store.classes[0].course_requirements[0].teacher).toBe('黃導師')
    // Type remains homeroom
    expect(store.teachers[0].type).toBe('homeroom')
  })

  it('10. Preflight blockers preserve zero-write behavior on failed validation', () => {
    const store = useScheduleStore()
    const initialTeachers = [
      {
        id: 401,
        name: '劉專任',
        type: 'subject',
        assignment_rules: [{ grade: 5, subject: '科技-資訊', periods: 6 }],
        base_periods: 20
      }
    ]
    // Demand is only 4 (2 unassigned + 2 locked unassigned), but supply is 6 => Preflight blocker!
    const initialClasses = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'req-1', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '' },
          { id: 'req-locked', subject: '科技-資訊', periods: 2, defaultTeacher: 'subject', teacher: '', isLocked: true }
        ]
      }
    ]
    store.teachers = JSON.parse(JSON.stringify(initialTeachers))
    store.classes = JSON.parse(JSON.stringify(initialClasses))

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(false)
    expect(res.error).toContain('[需求不符]')

    // Strict zero-write verification
    expect(store.teachers).toEqual(initialTeachers)
    expect(store.classes).toEqual(initialClasses)
  })

  it('11. Confirmed mixed-import requirement with actual teacher is never split, consolidated or overwritten, while unassigned requirements are allocated', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 501,
        name: '乙師',
        type: 'subject',
        expertiseSubjects: ['健康', '自然'],
        base_periods: 20
      }
    ]
    store.classes = [
      {
        name: '301班',
        grade: 3,
        course_requirements: [
          {
            id: 'req-mixed-assigned',
            subject: '健康',
            periods: 1,
            defaultTeacher: 'homeroom',
            teacher: '甲師',
            isAutoAssigned: true,
            assignmentSource: 'mixed-import'
          }
        ]
      },
      {
        name: '302班',
        grade: 3,
        course_requirements: [
          {
            id: 'req-mixed-unassigned',
            subject: '健康',
            periods: 1,
            defaultTeacher: 'subject',
            teacher: '',
            isAutoAssigned: false,
            assignmentSource: 'mixed-import'
          }
        ]
      },
      {
        name: '303班',
        grade: 3,
        course_requirements: [
          {
            id: 'req-unrelated-unassigned',
            subject: '自然',
            periods: 2,
            defaultTeacher: 'subject',
            teacher: ''
          }
        ]
      }
    ]

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)

    // 301班: Mixed-import with actual teacher '甲師' is preserved
    const req301 = store.classes[0].course_requirements[0]
    expect(req301.teacher).toBe('甲師')
    expect(req301.assignmentSource).toBe('mixed-import')

    // 302班: Mixed-import with empty teacher '' is allocated to '乙師'
    const req302 = store.classes[1].course_requirements[0]
    expect(req302.teacher).toBe('乙師')

    // 303班: Unrelated unassigned requirement is allocated to '乙師'
    const req303 = store.classes[2].course_requirements[0]
    expect(req303.teacher).toBe('乙師')
  })

  it('12. Blocks smart assignment and preserves state when mixed confirmation is pending', () => {
    const store = useScheduleStore()
    const initialTeachers = [
      {
        id: 601,
        name: '丙師',
        type: 'subject',
        expertiseSubjects: ['自然'],
        base_periods: 20
      }
    ]
    const initialClasses = [
      {
        name: '301班',
        grade: 3,
        course_requirements: [
          { id: 'req-1', subject: '自然', periods: 2, defaultTeacher: 'subject', teacher: '' }
        ]
      }
    ]
    store.teachers = JSON.parse(JSON.stringify(initialTeachers))
    store.classes = JSON.parse(JSON.stringify(initialClasses))

    // Set pending mixed plans flag on store
    store.pendingMixedPlans = [{ key: '3::自然', grade: 3, subject: '自然' }]
    expect(store.hasPendingMixedPlans).toBe(true)

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(false)
    expect(res.error).toBe('尚有混合配課待確認，請先完成匯入確認。')

    // Zero writes
    expect(store.teachers).toEqual(initialTeachers)
    expect(store.classes).toEqual(initialClasses)
  })

  it('13. Component/store boundary & post-committed mixed import: runSmartSubjectAssignment succeeds without re-consuming confirmed quota while unrelated unassigned subject work remains assignable', () => {
    const store = useScheduleStore()

    // Verify declared store state initially
    expect(store.hasPendingMixedPlans).toBe(false)
    expect(store.pendingMixedPlans).toEqual([])

    // Setup committed mixed import:
    // 甲師 (subject) has assignment_rules for 3rd grade 健康 (2 periods).
    // 301班 has 2 periods of 健康 assigned to 甲師 with assignmentSource: 'mixed-import' and defaultTeacher: 'homeroom'.
    // 乙師 (subject) has expertise in 自然.
    // 302班 has 2 periods of 自然 unassigned (defaultTeacher: 'subject', teacher: '').
    store.teachers = [
      {
        id: 701,
        name: '甲師',
        type: 'subject',
        assignment_rules: [{ grade: 3, subject: '健康', periods: 2 }],
        base_periods: 20,
        expertiseSubjects: ['健康']
      },
      {
        id: 702,
        name: '乙師',
        type: 'subject',
        base_periods: 20,
        expertiseSubjects: ['自然']
      }
    ]
    store.classes = [
      {
        name: '301班',
        grade: 3,
        course_requirements: [
          {
            id: 'req-health-mixed',
            subject: '健康',
            periods: 2,
            defaultTeacher: 'homeroom',
            teacher: '甲師',
            isAutoAssigned: true,
            assignmentSource: 'mixed-import'
          }
        ]
      },
      {
        name: '302班',
        grade: 3,
        course_requirements: [
          {
            id: 'req-science-unassigned',
            subject: '自然',
            periods: 2,
            defaultTeacher: 'subject',
            teacher: ''
          }
        ]
      }
    ]

    // Run smart subject assignment after committed mixed import
    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)

    // 1. Confirmed mixed import requirement for 甲師 is preserved and quota is NOT re-consumed or double-allocated
    const reqHealth = store.classes[0].course_requirements[0]
    expect(reqHealth.teacher).toBe('甲師')
    expect(reqHealth.periods).toBe(2)
    expect(reqHealth.assignmentSource).toBe('mixed-import')

    // 2. Unrelated unassigned subject requirement for 302班 (自然) is assigned to 乙師
    const reqScience = store.classes[1].course_requirements[0]
    expect(reqScience.teacher).toBe('乙師')
    expect(reqScience.periods).toBe(2)
    expect(reqScience.isAutoAssigned).toBe(true)
  })

  it('14. Preserves specific class-target imported rules and prevents smart assignment from moving them', () => {
    const store = useScheduleStore()
    const teachers = [
      {
        id: 801,
        name: '音樂教師',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '音樂',
            periods: 1.5,
            sourceKind: 'class-specific',
            targetClassNames: ['5年5班'],
          },
        ],
        base_periods: 20,
      },
    ]
    const classesWithSpecificImport = [
      {
        name: '5年5班',
        grade: 5,
        course_requirements: [
          {
            id: 'req-music-505',
            subject: '音樂',
            periods: 1.5,
            defaultTeacher: 'subject',
            teacher: '音樂教師',
            isAutoAssigned: true,
            assignmentSource: 'mixed-import',
          },
        ],
      },
      {
        name: '5年1班',
        grade: 5,
        course_requirements: [
          {
            id: 'req-music-501',
            subject: '音樂',
            periods: 1.5,
            defaultTeacher: 'subject',
            teacher: '',
          },
        ],
      },
    ]
    store.teachers = teachers
    store.classes = classesWithSpecificImport

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)
    expect(res.classes[0]).toMatchObject({
      course_requirements: [
        expect.objectContaining({ teacher: '音樂教師', assignmentSource: 'mixed-import' }),
      ],
    })
  })

  it('15. Non-mixed 505/605 class-specific rules are preserved on target classes and never assigned to other classes', () => {
    const store = useScheduleStore()
    store.teachers = [
      {
        id: 901,
        name: '張美勞',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '美勞',
            periods: 2,
            sourceKind: 'class-specific',
            targetClassNames: ['505班'],
          },
          {
            grade: 6,
            subject: '美勞',
            periods: 2,
            sourceKind: 'class-specific',
            targetClassNames: ['605班'],
          },
        ],
        base_periods: 20,
      },
    ]
    store.classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [{ id: 'req-501', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '' }],
      },
      {
        name: '505班',
        grade: 5,
        course_requirements: [{ id: 'req-505', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '' }],
      },
      {
        name: '601班',
        grade: 6,
        course_requirements: [{ id: 'req-601', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '' }],
      },
      {
        name: '605班',
        grade: 6,
        course_requirements: [{ id: 'req-605', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '' }],
      },
    ]

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(true)

    // 505班 and 605班 are assigned to '張美勞'
    const c505 = store.classes.find((c) => c.name === '505班')
    const c605 = store.classes.find((c) => c.name === '605班')
    expect(c505.course_requirements[0].teacher).toBe('張美勞')
    expect(c605.course_requirements[0].teacher).toBe('張美勞')

    // 501班 and 601班 are NOT assigned to '張美勞'
    const c501 = store.classes.find((c) => c.name === '501班')
    const c601 = store.classes.find((c) => c.name === '601班')
    expect(c501.course_requirements[0].teacher).not.toBe('張美勞')
    expect(c601.course_requirements[0].teacher).not.toBe('張美勞')
  })

  it('16. Rejects smart assignment with zero mutations when target class is locked', () => {
    const store = useScheduleStore()
    const initialTeachers = [
      {
        id: 902,
        name: '李美勞',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '美勞',
            periods: 2,
            sourceKind: 'class-specific',
            targetClassNames: ['505班'],
          },
        ],
        base_periods: 20,
      },
    ]
    const initialClasses = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [{ id: 'req-501', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '' }],
      },
      {
        name: '505班',
        grade: 5,
        course_requirements: [{ id: 'req-505', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '', isLocked: true }],
      },
    ]

    store.teachers = JSON.parse(JSON.stringify(initialTeachers))
    store.classes = JSON.parse(JSON.stringify(initialClasses))

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/505班|鎖定/)

    // Zero mutations
    expect(store.teachers).toEqual(initialTeachers)
    expect(store.classes).toEqual(initialClasses)
  })

  it('17. Rejects smart assignment with zero mutations when target class is unavailable or missing requirement', () => {
    const store = useScheduleStore()
    const initialTeachers = [
      {
        id: 903,
        name: '王美勞',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '美勞',
            periods: 2,
            sourceKind: 'class-specific',
            targetClassNames: ['505班'],
          },
        ],
        base_periods: 20,
      },
    ]
    const initialClasses = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [{ id: 'req-501', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '' }],
      },
    ]

    store.teachers = JSON.parse(JSON.stringify(initialTeachers))
    store.classes = JSON.parse(JSON.stringify(initialClasses))

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/505班|不存在/)

    // Zero mutations
    expect(store.teachers).toEqual(initialTeachers)
    expect(store.classes).toEqual(initialClasses)
  })

  it('18. Rejects smart assignment with zero mutations when target class has conflicting non-empty teacher', () => {
    const store = useScheduleStore()
    const initialTeachers = [
      {
        id: 904,
        name: '陳美勞',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '美勞',
            periods: 2,
            sourceKind: 'class-specific',
            targetClassNames: ['505班'],
          },
        ],
        base_periods: 20,
      },
    ]
    const initialClasses = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [{ id: 'req-501', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '' }],
      },
      {
        name: '505班',
        grade: 5,
        course_requirements: [{ id: 'req-505', subject: '美勞', periods: 2, defaultTeacher: 'subject', teacher: '林導' }],
      },
    ]

    store.teachers = JSON.parse(JSON.stringify(initialTeachers))
    store.classes = JSON.parse(JSON.stringify(initialClasses))

    const res = runSmartSubjectAssignment(store, [])
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/505班|衝突|指派給/)

    // Zero mutations
    expect(store.teachers).toEqual(initialTeachers)
    expect(store.classes).toEqual(initialClasses)
  })
})

describe('materializeImportedAssignmentRules (Task 4 Materialization)', () => {
  it('A. 5年5班 class-specific music rule targets only 5年5班, not 5年1班', () => {
    const teachers = [
      {
        id: 1,
        name: '音樂專任',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '音樂',
            periods: 1.5,
            sourceKind: 'class-specific',
            targetClassNames: ['5年5班'],
            candidateClassNames: [],
          },
        ],
      },
    ]
    const classes = [
      {
        name: '5年1班',
        grade: 5,
        course_requirements: [{ id: 'req-501', subject: '音樂', periods: 1.5, teacher: '' }],
      },
      {
        name: '5年5班',
        grade: 5,
        course_requirements: [{ id: 'req-505', subject: '音樂', periods: 1.5, teacher: '' }],
      },
    ]

    const res = materializeImportedAssignmentRules({ classes, teachers })
    expect(res.success).toBe(true)
    expect(res.assignedCount).toBe(1.5)

    const c505 = res.classes.find((c) => c.name === '5年5班')
    const c501 = res.classes.find((c) => c.name === '5年1班')

    expect(c505.course_requirements[0]).toMatchObject({
      teacher: '音樂專任',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 1.5,
    })
    expect(c501.course_requirements[0].teacher).toBe('')
  })

  it('B. 6音*10 candidateClassNames excludes 6年5班 and preserves 6年5班 arts teacher', () => {
    const teachers = [
      {
        id: 2,
        name: '音樂專任',
        type: 'subject',
        assignment_rules: [
          {
            grade: 6,
            subject: '音樂',
            periods: 15,
            sourceKind: 'grade-batch',
            targetClassNames: [],
            candidateClassNames: [
              '6年1班', '6年2班', '6年3班', '6年4班',
              '6年6班', '6年7班', '6年8班', '6年9班', '6年10班', '6年11班'
            ],
          },
        ],
      },
    ]
    const classes = [
      ...Array.from({ length: 11 }, (_, i) => {
        const classNum = i + 1
        const name = `6年${classNum}班`
        if (classNum === 5) {
          return {
            name,
            grade: 6,
            course_requirements: [{ id: `req-60${classNum}`, subject: '音樂', periods: 1, teacher: '吳品璇', isAutoAssigned: false }],
          }
        }
        return {
          name,
          grade: 6,
          course_requirements: [{ id: `req-60${classNum}`, subject: '音樂', periods: 1.5, teacher: '' }],
        }
      }),
    ]

    const res = materializeImportedAssignmentRules({ classes, teachers })
    expect(res.success).toBe(true)
    expect(res.assignedCount).toBe(15)

    // 10 standard classes are assigned
    const assignedClasses = res.classes.filter(
      (c) => c.name !== '6年5班' && c.course_requirements[0].teacher === '音樂專任'
    )
    expect(assignedClasses).toHaveLength(10)
    assignedClasses.forEach((c) => {
      expect(c.course_requirements[0]).toMatchObject({
        teacher: '音樂專任',
        isAutoAssigned: true,
        assignmentSource: 'subject-excel-import',
      })
    })

    // 6年5班 is preserved
    const c605 = res.classes.find((c) => c.name === '6年5班')
    expect(c605.course_requirements[0].teacher).toBe('吳品璇')
    expect(c605.course_requirements[0].assignmentSource).not.toBe('subject-excel-import')
  })

  it('C. Re-importing smaller quota clears previously materialized subject-excel-import excess classes while preserving mixed-import and manual/locked classes', () => {
    const initialClasses = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'r1', subject: '音樂', periods: 1.5, teacher: '李大同', isAutoAssigned: true, assignmentSource: 'subject-excel-import' },
        ],
      },
      {
        name: '502班',
        grade: 5,
        course_requirements: [
          { id: 'r2', subject: '音樂', periods: 1.5, teacher: '李大同', isAutoAssigned: true, assignmentSource: 'subject-excel-import' },
        ],
      },
      {
        name: '503班',
        grade: 5,
        course_requirements: [
          { id: 'r3', subject: '音樂', periods: 1.5, teacher: '李大同', isAutoAssigned: true, assignmentSource: 'subject-excel-import' },
        ],
      },
      {
        name: '504班',
        grade: 5,
        course_requirements: [
          { id: 'r4', subject: '音樂', periods: 1.5, teacher: '王手動', isAutoAssigned: false },
        ],
      },
      {
        name: '505班',
        grade: 5,
        course_requirements: [
          { id: 'r5', subject: '音樂', periods: 1.5, teacher: '陳混合', isAutoAssigned: true, assignmentSource: 'mixed-import' },
        ],
      },
      {
        name: '506班',
        grade: 5,
        course_requirements: [
          { id: 'r6', subject: '音樂', periods: 1.5, teacher: '', isLocked: true },
        ],
      },
    ]

    // Re-importing with only 1 class quota (1.5 periods) for 501班
    const updatedTeachers = [
      {
        id: 10,
        name: '李大同',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '音樂',
            periods: 1.5,
            sourceKind: 'class-specific',
            targetClassNames: ['501班'],
          },
        ],
      },
    ]

    const res = materializeImportedAssignmentRules({ classes: initialClasses, teachers: updatedTeachers })
    expect(res.success).toBe(true)

    const c501 = res.classes.find((c) => c.name === '501班')
    const c502 = res.classes.find((c) => c.name === '502班')
    const c503 = res.classes.find((c) => c.name === '503班')
    const c504 = res.classes.find((c) => c.name === '504班')
    const c505 = res.classes.find((c) => c.name === '505班')
    const c506 = res.classes.find((c) => c.name === '506班')

    // 501 is assigned
    expect(c501.course_requirements[0]).toMatchObject({
      teacher: '李大同',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
    })

    // 502 and 503 previously from subject-excel-import are reset to unassigned
    expect(c502.course_requirements[0].teacher).toBe('')
    expect(c502.course_requirements[0].isAutoAssigned).toBe(false)
    expect(c502.course_requirements[0].assignmentSource).toBeUndefined()

    expect(c503.course_requirements[0].teacher).toBe('')
    expect(c503.course_requirements[0].isAutoAssigned).toBe(false)
    expect(c503.course_requirements[0].assignmentSource).toBeUndefined()

    // 504 manual preserved
    expect(c504.course_requirements[0].teacher).toBe('王手動')
    expect(c504.course_requirements[0].isAutoAssigned).toBe(false)

    // 505 mixed-import preserved
    expect(c505.course_requirements[0].teacher).toBe('陳混合')
    expect(c505.course_requirements[0].assignmentSource).toBe('mixed-import')

    // 506 locked preserved
    expect(c506.course_requirements[0].teacher).toBe('')
    expect(c506.course_requirements[0].isLocked).toBe(true)
  })

  it('D. Candidate capacity insufficient fails with zero mutations', () => {
    const teachers = [
      {
        id: 4,
        name: '自然教師',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '自然科學',
            periods: 3,
            sourceKind: 'grade-batch',
            candidateClassNames: ['501班'],
          },
        ],
      },
    ]
    const classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [{ id: 'req-501', subject: '自然科學', periods: 2, teacher: '' }],
      },
    ]
    const classesSnapshot = JSON.parse(JSON.stringify(classes))

    const res = materializeImportedAssignmentRules({ classes, teachers })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/需求不符|不足/)

    // Zero mutations on original input classes
    expect(classes).toEqual(classesSnapshot)
  })

  it('E. Only imported health is assigned and unrelated science stays blank (no smart assignment / Phase B fallback side effects)', () => {
    const teachers = [
      {
        id: 5,
        name: '健康科任',
        type: 'subject',
        assignment_rules: [
          { grade: 3, subject: '健康', periods: 2 },
        ],
        expertiseSubjects: ['健康', '自然科學'],
      },
    ]
    const classes = [
      {
        name: '301班',
        grade: 3,
        course_requirements: [
          { id: 'req-health-301', subject: '健康', periods: 1, defaultTeacher: 'subject', teacher: '' },
          { id: 'req-science-301', subject: '自然科學', periods: 2, defaultTeacher: 'subject', teacher: '' },
        ],
      },
      {
        name: '302班',
        grade: 3,
        course_requirements: [
          { id: 'req-health-302', subject: '健康', periods: 1, defaultTeacher: 'subject', teacher: '' },
          { id: 'req-science-302', subject: '自然科學', periods: 2, defaultTeacher: 'subject', teacher: '' },
        ],
      },
    ]

    const res = materializeImportedAssignmentRules({ classes, teachers })
    expect(res.success).toBe(true)
    expect(res.assignedCount).toBe(2)

    // Health is assigned
    expect(res.classes[0].course_requirements[0]).toMatchObject({
      subject: '健康',
      teacher: '健康科任',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
    })
    expect(res.classes[1].course_requirements[0]).toMatchObject({
      subject: '健康',
      teacher: '健康科任',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
    })

    // Unrelated science MUST remain blank!
    expect(res.classes[0].course_requirements[1]).toMatchObject({
      subject: '自然科學',
      teacher: '',
    })
    expect(res.classes[1].course_requirements[1]).toMatchObject({
      subject: '自然科學',
      teacher: '',
    })
  })

  it('F. Auto-split assigned requirement outside import scope preserves original split state and assignment untouched', () => {
    // Grade 4 has auto-split chunks from another flow (e.g. English teacher)
    // Import rules are only for Grade 5 科技-資訊
    const teachers = [
      {
        id: 101,
        name: '張科技',
        type: 'subject',
        assignment_rules: [
          { grade: 5, subject: '科技-資訊', periods: 2, sourceKind: 'class-specific', targetClassNames: ['501班'] },
        ],
      },
    ]
    const classes = [
      {
        name: '401班',
        grade: 4,
        course_requirements: [
          {
            id: 'req-eng_split_林英語_1',
            subject: '英語',
            periods: 1,
            teacher: '林英語',
            isAutoAssigned: true,
          },
          {
            id: 'req-eng_split_remainder_2',
            subject: '英語',
            periods: 1,
            teacher: '',
            isAutoAssigned: false,
          },
        ],
      },
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          {
            id: 'req-tech-501',
            subject: '科技-資訊',
            periods: 2,
            teacher: '',
          },
        ],
      },
    ]

    const res = materializeImportedAssignmentRules({ classes, teachers })
    expect(res.success).toBe(true)
    expect(res.assignedCount).toBe(2)

    // 501班 科技-資訊 is materialized
    const c501 = res.classes.find((c) => c.name === '501班')
    expect(c501.course_requirements[0]).toMatchObject({
      subject: '科技-資訊',
      teacher: '張科技',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 2,
    })

    // 401班 英語 auto-split chunks outside import scope MUST be completely preserved!
    const c401 = res.classes.find((c) => c.name === '401班')
    expect(c401.course_requirements).toHaveLength(2)
    expect(c401.course_requirements[0]).toMatchObject({
      id: 'req-eng_split_林英語_1',
      subject: '英語',
      periods: 1,
      teacher: '林英語',
      isAutoAssigned: true,
    })
    expect(c401.course_requirements[1]).toMatchObject({
      id: 'req-eng_split_remainder_2',
      subject: '英語',
      periods: 1,
      teacher: '',
      isAutoAssigned: false,
    })
  })

  it('G. Rule scope with pre-existing assigned periods materializes only remaining unassigned quota without over-assignment', () => {
    // Teacher '李自然' has rule: Grade 5 自然 (4 periods total = 2 classes of 2 periods)
    // 501班 already has 2 periods assigned to '李自然' (e.g. manual assignment)
    // 502班 and 503班 each have 2 periods unassigned
    // Candidate scope is ['501班', '502班', '503班']
    // Result should only assign 1 more class (502班), keeping 503班 unassigned, total 4 periods satisfied.
    const teachers = [
      {
        id: 201,
        name: '李自然',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '自然',
            periods: 4,
            sourceKind: 'grade-batch',
            candidateClassNames: ['501班', '502班', '503班'],
          },
        ],
      },
    ]
    const classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'req-501', subject: '自然', periods: 2, teacher: '李自然', isAutoAssigned: false },
        ],
      },
      {
        name: '502班',
        grade: 5,
        course_requirements: [
          { id: 'req-502', subject: '自然', periods: 2, teacher: '' },
        ],
      },
      {
        name: '503班',
        grade: 5,
        course_requirements: [
          { id: 'req-503', subject: '自然', periods: 2, teacher: '' },
        ],
      },
    ]

    const res = materializeImportedAssignmentRules({ classes, teachers })
    expect(res.success).toBe(true)
    expect(res.assignedCount).toBe(2) // Only 2 periods (1 class) newly assigned

    const c501 = res.classes.find((c) => c.name === '501班')
    const c502 = res.classes.find((c) => c.name === '502班')
    const c503 = res.classes.find((c) => c.name === '503班')

    // 501班 remains 李自然 with manual status
    expect(c501.course_requirements[0].teacher).toBe('李自然')
    expect(c501.course_requirements[0].isAutoAssigned).toBe(false)

    // 502班 newly assigned to 李自然
    expect(c502.course_requirements[0]).toMatchObject({
      teacher: '李自然',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 2,
    })

    // 503班 MUST remain unassigned (no over-assignment!)
    expect(c503.course_requirements[0].teacher).toBe('')
    expect(c503.course_requirements[0].isAutoAssigned).toBeFalsy()
  })

  it('H. Pre-existing assigned periods fully satisfy rule quota resulting in zero new assignments and preserving remaining unassigned classes', () => {
    const teachers = [
      {
        id: 202,
        name: '王美勞',
        type: 'subject',
        assignment_rules: [
          {
            grade: 5,
            subject: '美勞',
            periods: 2,
            sourceKind: 'grade-batch',
            candidateClassNames: ['501班', '502班'],
          },
        ],
      },
    ]
    const classes = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'req-501', subject: '美勞', periods: 2, teacher: '王美勞', isAutoAssigned: false },
        ],
      },
      {
        name: '502班',
        grade: 5,
        course_requirements: [
          { id: 'req-502', subject: '美勞', periods: 2, teacher: '' },
        ],
      },
    ]

    const res = materializeImportedAssignmentRules({ classes, teachers })
    expect(res.success).toBe(true)
    expect(res.assignedCount).toBe(0) // No new assignments

    const c501 = res.classes.find((c) => c.name === '501班')
    const c502 = res.classes.find((c) => c.name === '502班')

    expect(c501.course_requirements[0].teacher).toBe('王美勞')
    expect(c502.course_requirements[0].teacher).toBe('')
  })

  it('I. End-to-end integration: applyImportToTeachers + materializeImportedAssignmentRules with homeroom gate', () => {
    const existingTeachers = [
      { id: 1, name: '張導師', type: 'homeroom', max_periods: 15, assignment_rules: [] },
      { id: 2, name: '李科任', type: 'subject', max_periods: 0, assignment_rules: [] },
    ]
    const existingClasses = [
      {
        name: '501班',
        grade: 5,
        course_requirements: [
          { id: 'r-tech-501', subject: '科技-資訊', periods: 2, teacher: '' },
          { id: 'r-mus-501', subject: '音樂', periods: 1, teacher: '' },
        ],
      },
      {
        name: '502班',
        grade: 5,
        course_requirements: [
          { id: 'r-tech-502', subject: '科技-資訊', periods: 2, teacher: '' },
          { id: 'r-mus-502', subject: '音樂', periods: 1, teacher: '' },
        ],
      },
    ]

    const parsedRows = [
      {
        rowNumber: 2,
        teacherId: 1,
        teacherName: '張導師',
        rules: [{ grade: 5, subject: '科技-資訊', periods: 4, classCount: 2, periodsPerClass: 2 }],
      },
      {
        rowNumber: 3,
        teacherId: 2,
        teacherName: '李科任',
        rules: [{ grade: 5, subject: '音樂', periods: 2, classCount: 2, periodsPerClass: 1 }],
      },
    ]

    // Case 1: Homeroom teacher not confirmed -> homeroom rules not applied
    const teachersWithoutHomeroom = applyImportToTeachers(parsedRows, existingTeachers, [])
    const resWithoutHomeroom = materializeImportedAssignmentRules({
      classes: existingClasses,
      teachers: teachersWithoutHomeroom,
      confirmedHomeroomTeacherIds: [],
    })
    expect(resWithoutHomeroom.success).toBe(true)
    expect(resWithoutHomeroom.assignedCount).toBe(2) // Only 李科任's 2 periods of 音樂
    expect(resWithoutHomeroom.classes[0].course_requirements.find((r) => r.subject === '科技-資訊').teacher).toBe('')
    expect(resWithoutHomeroom.classes[0].course_requirements.find((r) => r.subject === '音樂').teacher).toBe('李科任')

    // Case 2: Homeroom teacher confirmed -> both applied
    const teachersWithHomeroom = applyImportToTeachers(parsedRows, existingTeachers, [1])
    const resWithHomeroom = materializeImportedAssignmentRules({
      classes: existingClasses,
      teachers: teachersWithHomeroom,
      confirmedHomeroomTeacherIds: [1],
    })
    expect(resWithHomeroom.success).toBe(true)
    expect(resWithHomeroom.assignedCount).toBe(6) // 4 periods tech + 2 periods music
    expect(resWithHomeroom.classes[0].course_requirements.find((r) => r.subject === '科技-資訊')).toMatchObject({
      teacher: '張導師',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 2,
    })
    expect(resWithHomeroom.classes[1].course_requirements.find((r) => r.subject === '科技-資訊')).toMatchObject({
      teacher: '張導師',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 2,
    })
  })

  it('J. Coexistence: mixed teaching resolutions and subject-excel-import materialization coexist without mutual overwrites', () => {
    const existingTeachers = [
      { id: 10, name: '李體育', type: 'subject', max_periods: 0, assignment_rules: [] },
      { id: 20, name: '王自然', type: 'subject', max_periods: 0, assignment_rules: [] },
    ]
    const existingClasses = [
      {
        name: '501班',
        grade: 5,
        homeroom_teacher: '張導',
        course_requirements: [
          { id: 'r-pe-501', subject: '體育', periods: 2, defaultTeacher: 'homeroom', teacher: '' },
          { id: 'r-sci-501', subject: '自然科學', periods: 3, teacher: '' },
        ],
      },
      {
        name: '502班',
        grade: 5,
        homeroom_teacher: '陳導',
        course_requirements: [
          { id: 'r-pe-502', subject: '體育', periods: 2, defaultTeacher: 'homeroom', teacher: '' },
          { id: 'r-sci-502', subject: '自然科學', periods: 3, teacher: '' },
        ],
      },
    ]

    // 1. Mixed resolution: 501班 PE to 李體育, 502班 PE to 陳導 (homeroom)
    const resolutions = [
      {
        subject: '體育',
        assignments: [
          {
            className: '501班',
            teacherName: '李體育',
          },
          {
            className: '502班',
            teacherName: '陳導',
          },
        ],
      },
    ]
    const classesWithMixed = applyResolvedMixedTeachingPlans(existingClasses, resolutions)

    // 2. Next, Excel import also has 自然科學 for 王自然 (5自*2 = 6 periods)
    const parsedRows = [
      {
        rowNumber: 2,
        teacherId: 20,
        teacherName: '王自然',
        rules: [{ grade: 5, subject: '自然科學', periods: 6, classCount: 2, periodsPerClass: 3 }],
      },
    ]
    const nextTeachers = applyImportToTeachers(parsedRows, existingTeachers, [])

    const materialized = materializeImportedAssignmentRules({
      classes: classesWithMixed,
      teachers: nextTeachers,
    })

    expect(materialized.success).toBe(true)
    expect(materialized.assignedCount).toBe(6)

    const c501 = materialized.classes.find((c) => c.name === '501班')
    const c502 = materialized.classes.find((c) => c.name === '502班')

    // PE requirements preserve mixed-import source and teachers
    expect(c501.course_requirements.find((r) => r.subject === '體育')).toMatchObject({
      teacher: '李體育',
      assignmentSource: 'mixed-import',
      periods: 2,
    })
    expect(c502.course_requirements.find((r) => r.subject === '體育')).toMatchObject({
      teacher: '陳導',
      assignmentSource: 'mixed-import',
      periods: 2,
    })

    // Science requirements have subject-excel-import source and 王自然
    expect(c501.course_requirements.find((r) => r.subject === '自然科學')).toMatchObject({
      teacher: '王自然',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 3,
    })
    expect(c502.course_requirements.find((r) => r.subject === '自然科學')).toMatchObject({
      teacher: '王自然',
      isAutoAssigned: true,
      assignmentSource: 'subject-excel-import',
      periods: 3,
    })
  })

  it('K. Excel rules replace matching unlocked homeroom defaults within their candidate classes', () => {
    const classNames = Array.from({ length: 8 }, (_, index) => `2年${index + 1}班`)
    const classes = classNames.map((name, index) => {
      const homeroomTeacher = `二導${index + 1}`
      return {
        name,
        grade: 2,
        homeroom_teacher: homeroomTeacher,
        course_requirements: [{
          id: `health-${index + 1}`,
          subject: '健康',
          periods: 1,
          defaultTeacher: 'homeroom',
          teacher: homeroomTeacher,
          teacher_name: homeroomTeacher,
          isLocked: false,
        }],
      }
    })
    const teachers = [
      { id: 1, name: '健康科任甲', type: 'subject', assignment_rules: [{ grade: 2, subject: '健康', periods: 4, candidateClassNames: classNames }] },
      { id: 2, name: '健康科任乙', type: 'subject', assignment_rules: [{ grade: 2, subject: '健康', periods: 1, candidateClassNames: classNames }] },
      { id: 3, name: '健康科任丙', type: 'admin', assignment_rules: [{ grade: 2, subject: '健康', periods: 3, candidateClassNames: classNames }] },
    ]

    const result = materializeImportedAssignmentRules({ classes, teachers })

    expect(result.success).toBe(true)
    expect(result.assignedCount).toBe(8)
    expect(result.classes).toHaveLength(8)
    expect(result.classes.every((cls) => cls.course_requirements.length === 1)).toBe(true)
    expect(result.classes.filter((cls) => cls.course_requirements[0].teacher === '健康科任甲')).toHaveLength(4)
    expect(result.classes.filter((cls) => cls.course_requirements[0].teacher === '健康科任乙')).toHaveLength(1)
    expect(result.classes.filter((cls) => cls.course_requirements[0].teacher === '健康科任丙')).toHaveLength(3)
    expect(result.classes.every((cls) => cls.course_requirements[0].assignmentSource === 'subject-excel-import')).toBe(true)
    expect(result.classes.every((cls) => cls.course_requirements[0].teacher_name === cls.course_requirements[0].teacher)).toBe(true)
    expect(classes.every((cls, index) => cls.course_requirements[0].teacher === `二導${index + 1}`)).toBe(true)
  })

  it('L. locked, mixed-import, and manually assigned requirements remain protected when import demand is insufficient', () => {
    const classes = [
      {
        name: '2年1班', grade: 2, homeroom_teacher: '二導1',
        course_requirements: [{ id: 'locked-health', subject: '健康', periods: 1, defaultTeacher: 'homeroom', teacher: '二導1', teacher_name: '二導1', isLocked: true }],
      },
      {
        name: '2年2班', grade: 2, homeroom_teacher: '二導2',
        course_requirements: [{ id: 'mixed-health', subject: '健康', periods: 1, defaultTeacher: 'homeroom', teacher: '既有科任', teacher_name: '既有科任', isAutoAssigned: true, assignmentSource: 'mixed-import' }],
      },
      {
        name: '2年3班', grade: 2, homeroom_teacher: '二導3',
        course_requirements: [{ id: 'manual-health', subject: '健康', periods: 1, defaultTeacher: 'homeroom', teacher: '手動科任', teacher_name: '手動科任', isAutoAssigned: false }],
      },
    ]
    const originalClasses = JSON.parse(JSON.stringify(classes))
    const teachers = [{
      id: 4,
      name: '健康科任',
      type: 'subject',
      assignment_rules: [{ grade: 2, subject: '健康', periods: 3, candidateClassNames: ['2年1班', '2年2班', '2年3班'] }],
    }]

    const result = materializeImportedAssignmentRules({ classes, teachers })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/可分派需求節數不足/)
    expect(classes).toEqual(originalClasses)
  })

  it('M. re-importing a smaller quota clears both teacher fields from prior Excel assignments and consolidated remainders', () => {
    const classes = [
      {
        name: '2年1班', grade: 2,
        course_requirements: [{
          id: 'health-1', subject: '健康', periods: 1,
          teacher: '健康科任', teacher_name: '健康科任', isAutoAssigned: true,
          assignmentSource: 'subject-excel-import',
        }],
      },
      {
        name: '2年2班', grade: 2,
        course_requirements: [
          {
            id: 'health-2_split_健康科任_1', subject: '健康', periods: 1,
            teacher: '健康科任', teacher_name: '健康科任', isAutoAssigned: true,
            assignmentSource: 'subject-excel-import',
          },
          {
            id: 'health-2_split_remainder_2', subject: '健康', periods: 1,
            teacher: '', teacher_name: '', isAutoAssigned: false,
          },
        ],
      },
    ]
    const teachers = [{
      id: 5,
      name: '健康科任',
      type: 'subject',
      assignment_rules: [{ grade: 2, subject: '健康', periods: 1, candidateClassNames: ['2年1班', '2年2班'] }],
    }]

    const result = materializeImportedAssignmentRules({ classes, teachers })
    const reimportedClass = result.classes.find((cls) => cls.name === '2年1班')
    const unassignedClass = result.classes.find((cls) => cls.name === '2年2班')

    expect(result.success).toBe(true)
    expect(reimportedClass.course_requirements[0]).toMatchObject({
      teacher: '健康科任', teacher_name: '健康科任', assignmentSource: 'subject-excel-import',
    })
    expect(unassignedClass.course_requirements).toHaveLength(1)
    expect(unassignedClass.course_requirements[0]).toMatchObject({ teacher: '', teacher_name: '' })
  })

  it('N. filters only grade-subject rules already resolved by mixed teaching without mutating teachers', () => {
    const teachers = [{
      id: 7,
      name: '謝純雅',
      assignment_rules: [
        { grade: 2, subject: '健康', periods: 1 },
        { grade: 2, subject: '體育', periods: 2 },
        { grade: 3, subject: '健康', periods: 1 },
      ],
    }]
    const originalTeachers = JSON.parse(JSON.stringify(teachers))

    const result = filterRulesForImportedMaterialization(teachers, [{
      grade: 2,
      subject: '健康',
      resolution: { assignments: [{ className: '2年5班', teacherName: '謝純雅' }] },
    }])

    expect(result).not.toBe(teachers)
    expect(result[0]).not.toBe(teachers[0])
    expect(result[0].assignment_rules).toEqual([
      { grade: 2, subject: '體育', periods: 2 },
      { grade: 3, subject: '健康', periods: 1 },
    ])
    expect(teachers).toEqual(originalTeachers)
  })

  it('O. does not rematerialize a health rule after its mixed resolution assigns one second-grade class', () => {
    const classes = Array.from({ length: 8 }, (_, index) => {
      const classNumber = index + 1
      const homeroomTeacher = `二導${classNumber}`
      return {
        name: `2年${classNumber}班`,
        grade: 2,
        homeroom_teacher: homeroomTeacher,
        course_requirements: [{
          id: `health-${classNumber}`,
          subject: '健康',
          periods: 1,
          defaultTeacher: 'homeroom',
          teacher: homeroomTeacher,
          teacher_name: homeroomTeacher,
        }],
      }
    })
    const teachers = [{
      id: 8,
      name: '謝純雅',
      type: 'subject',
      assignment_rules: [{ grade: 2, subject: '健康', periods: 1, candidateClassNames: classes.map((cls) => cls.name) }],
    }]
    const resolutions = [{
      grade: 2,
      subject: '健康',
      resolution: {
        assignments: classes.map((cls) => ({
          className: cls.name,
          teacherName: cls.name === '2年5班' ? '謝純雅' : cls.homeroom_teacher,
          teacherType: cls.name === '2年5班' ? 'subject' : 'homeroom',
          periods: 1,
        })),
      },
    }]

    const afterMixed = applyResolvedMixedTeachingPlans(classes, resolutions)
    const materialized = materializeImportedAssignmentRules({
      classes: afterMixed,
      teachers: filterRulesForImportedMaterialization(teachers, resolutions),
    })

    expect(materialized.success).toBe(true)
    expect(materialized.assignedCount).toBe(0)
    expect(materialized.classes.find((cls) => cls.name === '2年5班').course_requirements[0]).toMatchObject({
      teacher: '謝純雅',
      assignmentSource: 'mixed-import',
    })
  })

  it('P. materializes explicit class rules before earlier teachers batch rules, preserving their target class', () => {
    const classNames = Array.from({ length: 11 }, (_, index) => `5年${index + 1}班`)
    const classes = classNames.map((name, index) => ({
      name,
      grade: 5,
      course_requirements: [{
        id: `science-${index + 1}`,
        subject: '自然科學',
        periods: 4,
        teacher: '',
      }],
    }))
    const teachers = [
      {
        id: 21,
        name: '蔡明容',
        type: 'subject',
        assignment_rules: [{
          grade: 5,
          subject: '自然科學',
          periods: 20,
          sourceKind: 'grade-batch',
          candidateClassNames: classNames,
        }],
      },
      {
        id: 22,
        name: '林皎汝',
        type: 'subject',
        assignment_rules: [{
          grade: 5,
          subject: '自然科學',
          periods: 20,
          sourceKind: 'grade-batch',
          candidateClassNames: classNames,
        }],
      },
      {
        id: 23,
        name: '陳陵',
        type: 'subject',
        assignment_rules: [{
          grade: 5,
          subject: '自然科學',
          periods: 4,
          sourceKind: 'class-specific',
          targetClassNames: ['5年5班'],
        }],
      },
    ]
    const originalClasses = JSON.parse(JSON.stringify(classes))
    const originalTeachers = JSON.parse(JSON.stringify(teachers))

    const result = materializeImportedAssignmentRules({ classes, teachers })

    expect(result.success).toBe(true)
    expect(result.assignedCount).toBe(44)
    expect(result.classes.find((cls) => cls.name === '5年5班').course_requirements[0]).toMatchObject({
      teacher: '陳陵',
      assignmentSource: 'subject-excel-import',
    })
    expect(result.classes.filter((cls) => cls.course_requirements[0].teacher === '蔡明容')).toHaveLength(5)
    expect(result.classes.filter((cls) => cls.course_requirements[0].teacher === '林皎汝')).toHaveLength(5)
    expect(classes).toEqual(originalClasses)
    expect(teachers).toEqual(originalTeachers)
  })

  it('Q. materializes all-eligible rules before earlier grade-batch rules while retaining input order within each priority', () => {
    const classNames = ['5年1班', '5年2班']
    const classes = classNames.map((name, index) => ({
      name,
      grade: 5,
      course_requirements: [{
        id: `science-priority-${index + 1}`,
        subject: '自然科學',
        periods: 4,
        teacher: '',
      }],
    }))
    const teachers = [
      {
        id: 31,
        name: '批次教師',
        type: 'subject',
        assignment_rules: [{
          grade: 5,
          subject: '自然科學',
          periods: 4,
          sourceKind: 'grade-batch',
          candidateClassNames: classNames,
        }],
      },
      {
        id: 32,
        name: '全班教師',
        type: 'subject',
        assignment_rules: [{
          grade: 5,
          subject: '自然科學',
          periods: 4,
          sourceKind: 'all-eligible',
          candidateClassNames: classNames,
        }],
      },
    ]

    const result = materializeImportedAssignmentRules({ classes, teachers })

    expect(result.success).toBe(true)
    expect(result.classes.find((cls) => cls.name === '5年1班').course_requirements[0].teacher).toBe('全班教師')
    expect(result.classes.find((cls) => cls.name === '5年2班').course_requirements[0].teacher).toBe('批次教師')
  })

  it('R. returns an immutable ledger for assignments created by this import only', () => {
    const classes = [{
      name: '6年1班', grade: 6, homeroom_teacher: '六導1',
      course_requirements: [{ id: 'science-601', subject: '自然科學', periods: 4, teacher: '' }],
    }]
    const teachers = [{
      id: 201, name: '自然甲', type: 'subject',
      assignment_rules: [{ grade: 6, subject: '自然科學', periods: 4, candidateClassNames: ['6年1班'] }],
    }]

    const result = materializeImportedAssignmentRules({ classes, teachers })

    expect(result.success).toBe(true)
    expect(result.assignmentLedger).toEqual([expect.objectContaining({
      teacherId: 201, teacherName: '自然甲', grade: 6, subject: '自然科學', periods: 4, className: '6年1班',
    })])
    expect(Object.isFrozen(result.assignmentLedger)).toBe(true)
    expect(Object.isFrozen(result.assignmentLedger[0])).toBe(true)
    expect(result.classes[0].homeroom_teacher).toBe('六導1')
    expect(classes[0].homeroom_teacher).toBe('六導1')
  })
})
