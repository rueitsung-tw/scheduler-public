import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import { parseBlockScheduleWorkbook, buildBlockScheduleImportPlan } from '../src/utils/blockScheduleExcelImport.js'

const classes = [
  { name: '3年4班', course_requirements: [{ subject: '語文-國語' }, { subject: '數學' }] },
  { name: '3年5班', course_requirements: [{ subject: '語文-國語' }, { subject: '數學' }] },
  { name: '3年6班', course_requirements: [{ subject: '數學' }] },
  { name: '3年8班', course_requirements: [{ subject: '數學' }] },
  { name: '3年9班', course_requirements: [{ subject: '數學' }] },
  { name: '5年4班', course_requirements: [{ subject: '語文-國語' }, { subject: '數學' }] },
  { name: '5年9班', course_requirements: [{ subject: '語文-國語' }, { subject: '數學' }] },
]

const teachers = [
  { id: 'li-full', name: '李靖', type: 'subject' },
  { id: 'li-suffix', name: '特教李靖', type: 'subject' },
  { id: 'guo-full', name: '郭嘉', type: 'subject' },
  { id: 'guo-suffix', name: '特教郭嘉', type: 'subject' },
  { id: 'agent-1', name: '代理1', type: 'subject' },
  { id: 'agent-1-suffix', name: '特教代理1', type: 'subject' },
  { id: 'agent-2', name: '代理2', type: 'subject' },
  { id: 'agent-2-suffix', name: '特教代理2', type: 'subject' },
]

function workbookBuffer(rows, merges = []) {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = merges
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '區塊排課')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

function parse(rows, merges, options = {}) {
  return parseBlockScheduleWorkbook(workbookBuffer(rows, merges), {
    classes,
    teachers,
    giftedUnitName: '創思中心',
    ...options,
  })
}

describe('parseBlockScheduleWorkbook', () => {
  it('imports a gifted arrow rule as a teacherless locked pullout', () => {
    const result = parse([
      ['星期', '節次', '區塊'],
      ['三', '二', '304、308、309數學→數理'],
    ])

    expect(result.blockers).toEqual([])
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      course: {
        type: 'pullout',
        name: '創思中心',
        sourceKind: 'gifted',
        projectName: '數理',
        sourceGroup: null,
        teacher: null,
        targetSubject: '數學',
        classes: ['3年4班', '3年8班', '3年9班'],
        targetClasses: ['3年4班', '3年8班', '3年9班'],
        isAutoTime: false,
        isAutoClass: false,
        autoClassConfig: null,
        lockedSlots: [{ day: 3, period: 2 }],
      },
      source: { cell: 'C2', raw: '304、308、309數學→數理' },
    })
  })

  it('preserves same-cell learning-center groups without deduplicating overlap', () => {
    const result = parse([
      ['星期', '節次', '區塊'],
      ['一', '一', '504、509國1 (李靖)\n504、509國2 (郭嘉)'],
    ])

    expect(result.blockers).toEqual([])
    expect(result.entries).toHaveLength(2)
    expect(result.entries.map(({ course }) => ({
      classes: course.classes,
      targetClasses: course.targetClasses,
      targetSubject: course.targetSubject,
      sourceGroup: course.sourceGroup,
      teacher: course.teacher,
      teacherId: course.teacherId,
    }))).toEqual([
      { classes: ['5年4班', '5年9班'], targetClasses: ['5年4班', '5年9班'], targetSubject: '語文-國語', sourceGroup: '國1', teacher: '李靖', teacherId: 'li-full' },
      { classes: ['5年4班', '5年9班'], targetClasses: ['5年4班', '5年9班'], targetSubject: '語文-國語', sourceGroup: '國2', teacher: '郭嘉', teacherId: 'guo-full' },
    ])
  })

  it('carries merged weekdays forward and parses multiple lines and aliases', () => {
    const result = parse([
      ['星期', '節次', '區塊'],
      ['二', '三', '304數1(代理1)\n305數2(代理2)'],
      ['', '四', '304國(李靖)'],
    ], [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }])

    expect(result.blockers).toEqual([])
    expect(result.entries).toHaveLength(3)
    expect(result.entries.map(({ course }) => [course.targetSubject, course.teacher, course.lockedSlots[0]])).toEqual([
      ['數學', '代理1', { day: 2, period: 3 }],
      ['數學', '代理2', { day: 2, period: 3 }],
      ['語文-國語', '李靖', { day: 2, period: 4 }],
    ])
  })

  it('reports cell-addressed blockers for invalid classes, requirements, syntax, slots, and teachers', () => {
    const result = parse([
      ['星期', '節次', '區塊'],
      ['八', '9', '999 國語 (不存在)\n306 國語 (李靖)\n304 國語 李靖\n304 國語 (李)\n304 自然 (李靖)\n304 國語 →'],
    ], [], {
      teachers: [
        ...teachers,
        { id: 'li-other', name: '資源李', type: 'special_ed_resource' },
        { id: 'li-another', name: '教學李', type: 'special_ed_resource' },
      ],
    })

    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ cell: 'A2', code: 'INVALID_DAY' }),
      expect.objectContaining({ cell: 'B2', code: 'INVALID_PERIOD' }),
      expect.objectContaining({ cell: 'C2', code: 'UNKNOWN_CLASS' }),
      expect.objectContaining({ cell: 'C2', code: 'MISSING_SUBJECT_REQUIREMENT' }),
      expect.objectContaining({ cell: 'C2', code: 'MALFORMED_LINE' }),
      expect.objectContaining({ cell: 'C2', code: 'MISSING_TEACHER' }),
      expect.objectContaining({ cell: 'C2', code: 'AMBIGUOUS_TEACHER' }),
      expect.objectContaining({ cell: 'C2', code: 'UNKNOWN_SUBJECT' }),
      expect.objectContaining({ cell: 'C2', code: 'EMPTY_PROJECT' }),
    ]))
  })

  it('prefers exact special-ed names over suffix matches and treats 修正 as a warning', () => {
    const result = parse([
      ['星期', '節次', '區塊'],
      ['四', '5', '304 國語 (李靖) 修正\n305 數學 (代理1)'],
    ])

    expect(result.blockers).toEqual([])
    expect(result.entries.map(({ course }) => course.teacherId)).toEqual(['li-full', 'agent-1'])
    expect(result.entries.map(({ course }) => course.targetSubject)).toEqual(['語文-國語', '數學'])
    expect(result.warnings).toEqual([expect.objectContaining({ cell: 'C2', code: 'CORRECTION_SUFFIX' })])
  })

  it('uses a unique special-ed suffix match when no exact teacher name exists', () => {
    const result = parse([
      ['星期', '節次', '區塊'],
      ['五', '六', '304數學(嘉)'],
    ], [], { teachers: teachers.filter((teacher) => teacher.id !== 'guo-suffix') })

    expect(result.blockers).toEqual([])
    expect(result.entries[0].course.teacherId).toBe('guo-full')
  })

  it('uses exact names for 代理1 and 代理2, then blocks unmatched and ambiguous variants', () => {
    const exact = parse([
      ['星期', '節次', '區塊'],
      ['一', '七', '304數1(代理1)\n305數2(代理2)'],
    ])
    const missing = parse([
      ['星期', '節次', '區塊'],
      ['一', '七', '304數2(代理2)'],
    ], [], { teachers: teachers.filter((teacher) => !teacher.name.endsWith('代理2')) })
    const ambiguous = parse([
      ['星期', '節次', '區塊'],
      ['一', '七', '304數1(代理1)'],
    ], [], {
      teachers: teachers.filter((teacher) => teacher.name !== '代理1').concat([
        { id: 'agent-1-alt-a', name: '資源代理1', type: 'special_ed_resource' },
        { id: 'agent-1-alt-b', name: '教學代理1', type: 'special_ed_resource' },
      ]),
    })

    expect(exact.blockers).toEqual([])
    expect(exact.entries.map(({ course }) => course.teacherId)).toEqual(['agent-1', 'agent-2'])
    expect(missing.blockers).toEqual([expect.objectContaining({ cell: 'C2', code: 'MISSING_TEACHER' })])
    expect(ambiguous.blockers).toEqual([expect.objectContaining({ cell: 'C2', code: 'AMBIGUOUS_TEACHER' })])
  })
})

describe('buildBlockScheduleImportPlan', () => {
  it('only flags an exact learning-center identity as replaceable', () => {
    const existing = [
      { id: 'e1', name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班', '5年9班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', sourceGroup: '國1', teacher: '李靖', teacher_name: '李靖' },
      { id: 'e2', name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班', '5年9班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', sourceGroup: '國2', teacher: '郭嘉', teacher_name: '郭嘉' },
    ]
    const incoming = [
      { course: { name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班', '5年9班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', sourceGroup: '國1', teacher: '李靖' } },
      { course: { name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班', '5年9班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', sourceGroup: '國2', teacher: '郭嘉' } },
    ]
    const plan = buildBlockScheduleImportPlan(incoming, existing)
    expect(plan.replacements).toHaveLength(2)
    expect(plan.replacements[0].existingCandidates.map(e => e.id)).toEqual(['e1'])
    expect(plan.replacements[1].existingCandidates.map(e => e.id)).toEqual(['e2'])
    expect(plan.appendable).toHaveLength(0)
  })

  it('warns on same-slot overlap for non-learning-center courses', () => {
    // Gifted courses with overlapping classes at same slot should produce a warning
    const existing = [
      { id: 'e1', name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', sourceGroup: null, teacher: null, teacher_name: '' },
    ]
    const incoming = [
      { course: { name: '創思中心', targetSubject: '語文-國語', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', sourceGroup: null, teacher: null } },
    ]
    const plan = buildBlockScheduleImportPlan(incoming, existing)
    expect(plan.replacements).toHaveLength(0)
    expect(plan.appendable).toHaveLength(1)
    expect(plan.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAPPING_LOCK_WARNING' })
    ]))
  })

  it('does not warn when different classes share a slot', () => {
    const existing = [
      { id: 'e1', name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', sourceGroup: null, teacher: null, teacher_name: '' },
    ]
    const incoming = [
      { course: { name: '創思中心', targetSubject: '語文-國語', targetClasses: ['3年5班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', sourceGroup: null, teacher: null } },
    ]
    const plan = buildBlockScheduleImportPlan(incoming, existing)
    expect(plan.appendable).toHaveLength(1)
    expect(plan.warnings).toEqual([])
  })

  it('classifies gifted replacement without teacher matching', () => {
    const existing = [
      { id: 'e1', name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班', '3年8班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', sourceGroup: null, projectName: '數理', teacher: null, teacher_name: '' },
    ]
    const incoming = [
      { course: { name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班', '3年8班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', sourceGroup: null, projectName: '數理', teacher: null } },
    ]
    const plan = buildBlockScheduleImportPlan(incoming, existing)
    expect(plan.replacements).toHaveLength(1)
    expect(plan.replacements[0].existingCandidates.map(e => e.id)).toEqual(['e1'])
  })

  it('warns for different sourceGroup learning center overlap', () => {
    // Different sourceGroup means different identity (not a replacement),
    // but same-slot same-class overlap should still produce a warning.
    const existing = [
      { id: 'e1', name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', sourceGroup: '國1', teacher: '李靖', teacher_name: '李靖' },
    ]
    const incoming = [
      { course: { name: '學習中心', targetSubject: '語文-國語', targetClasses: ['5年4班'], lockedSlots: [{ day: 1, period: 1 }], sourceKind: 'learning_center', sourceGroup: '國2', teacher: '郭嘉' } },
    ]
    const plan = buildBlockScheduleImportPlan(incoming, existing)
    expect(plan.replacements).toHaveLength(0)
    expect(plan.appendable).toHaveLength(1)
    expect(plan.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAPPING_LOCK_WARNING' })
    ]))
  })

  it('presents all duplicate existing candidates for user to choose', () => {
    // When existing data has two identical entries, the user should pick which to replace
    const dupCourse = { id: '', name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', sourceGroup: null, teacher: null, teacher_name: '' }
    const existing = [
      { ...dupCourse, id: 'dup-a' },
      { ...dupCourse, id: 'dup-b' },
    ]
    const incoming = [
      { course: { name: '創思中心', targetSubject: '數學', targetClasses: ['3年4班'], lockedSlots: [{ day: 3, period: 2 }], sourceKind: 'gifted', sourceGroup: null, teacher: null } },
    ]
    const plan = buildBlockScheduleImportPlan(incoming, existing)
    expect(plan.replacements).toHaveLength(1)
    expect(plan.replacements[0].existingCandidates.map(e => e.id)).toEqual(['dup-a', 'dup-b'])
    expect(plan.appendable).toHaveLength(0)
  })

  it('emits the fixed manual special-course contract consumed by the solver', () => {
    // Contract: imported records must match the solver's expected shape
    const result = parse([
      ['星期', '節次', '區塊'],
      ['一', '一', '504、509國1 (李靖)'],
    ])
    const { course } = result.entries[0]
    expect(course).toMatchObject({ type: 'pullout', isAutoTime: false, isAutoClass: false })
    expect(course.lockedSlots).toEqual([{ day: 1, period: 1 }])
    expect(course.targetClasses.length).toBeGreaterThan(0)
    expect(course.targetSubject).toBe('語文-國語')
    // Gifted course contract
    const gifted = parse([
      ['星期', '節次', '區塊'],
      ['三', '二', '304、308、309數學→數理'],
    ])
    const { course: giftedCourse } = gifted.entries[0]
    expect(giftedCourse).toMatchObject({ type: 'pullout', isAutoTime: false, isAutoClass: false })
    expect(giftedCourse.lockedSlots).toEqual([{ day: 3, period: 2 }])
    expect(giftedCourse.targetClasses.length).toBeGreaterThan(0)
    expect(giftedCourse.targetSubject).toBe('數學')
    expect(giftedCourse.teacher).toBeNull()
  })

  it('parses explicit sharedEventId tag with #tag or [event:tag] syntax', () => {
    const result = parse([
      ['星期', '節次', '區塊'],
      ['四', '一', '504、509國1 (李靖)#EVT-LC-01\n304、305數(郭嘉)[event:EVT-LC-02]'],
    ])

    expect(result.blockers).toEqual([])
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].course.sharedEventId).toBe('EVT-LC-01')
    expect(result.entries[0].course.teacher).toBe('李靖')
    expect(result.entries[1].course.sharedEventId).toBe('EVT-LC-02')
    expect(result.entries[1].course.teacher).toBe('郭嘉')
  })

  it('handles 77/80-style multi-class shared events sharing the same sharedEventId', () => {
    const result = parse([
      ['星期', '節次', '區塊'],
      ['四', '一', '304、305數(李靖)#EVT-77-80\n504、509數(李靖)#EVT-77-80'],
    ])

    expect(result.blockers).toEqual([])
    expect(result.entries).toHaveLength(2)

    const plan = buildBlockScheduleImportPlan(result.entries, [])
    expect(plan.blockers).toEqual([])
    expect(plan.appendable).toHaveLength(2)
    expect(plan.appendable[0].course.sharedEventId).toBe('EVT-77-80')
    expect(plan.appendable[1].course.sharedEventId).toBe('EVT-77-80')
  })

  it('flags blocker when entries sharing same sharedEventId have conflicting teachers', () => {
    const incoming = [
      {
        course: {
          name: '學習中心',
          type: 'pullout',
          sourceKind: 'learning_center',
          targetSubject: '數學',
          teacher: '李靖',
          targetClasses: ['3年4班'],
          lockedSlots: [{ day: 4, period: 1 }],
          sharedEventId: 'EVT-CONFLICT-TEACHER',
        },
        source: { cellRef: 'C2' },
      },
      {
        course: {
          name: '學習中心',
          type: 'pullout',
          sourceKind: 'learning_center',
          targetSubject: '數學',
          teacher: '郭嘉',
          targetClasses: ['5年4班'],
          lockedSlots: [{ day: 4, period: 1 }],
          sharedEventId: 'EVT-CONFLICT-TEACHER',
        },
        source: { cellRef: 'C3' },
      },
    ]

    const plan = buildBlockScheduleImportPlan(incoming, [])
    expect(plan.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'MISMATCHED_SHARED_EVENT_TEACHER',
      }),
    ]))
  })

  it('flags blocker when entries sharing same sharedEventId have conflicting locked slots', () => {
    const incoming = [
      {
        course: {
          name: '學習中心',
          type: 'pullout',
          sourceKind: 'learning_center',
          targetSubject: '數學',
          teacher: '李靖',
          targetClasses: ['3年4班'],
          lockedSlots: [{ day: 4, period: 1 }],
          sharedEventId: 'EVT-CONFLICT-SLOTS',
        },
        source: { cellRef: 'C2' },
      },
      {
        course: {
          name: '學習中心',
          type: 'pullout',
          sourceKind: 'learning_center',
          targetSubject: '數學',
          teacher: '李靖',
          targetClasses: ['5年4班'],
          lockedSlots: [{ day: 4, period: 2 }],
          sharedEventId: 'EVT-CONFLICT-SLOTS',
        },
        source: { cellRef: 'C3' },
      },
    ]

    const plan = buildBlockScheduleImportPlan(incoming, [])
    expect(plan.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'MISMATCHED_SHARED_EVENT_SLOTS',
      }),
    ]))
  })

  it('flags warning when entries sharing same sharedEventId assign multiple different subjects to the same class', () => {
    const incoming = [
      {
        course: {
          name: '學習中心',
          type: 'pullout',
          sourceKind: 'learning_center',
          targetSubject: '數學',
          teacher: '何采珍',
          targetClasses: ['5年1班'],
          lockedSlots: [{ day: 4, period: 2 }],
          sharedEventId: 'EVT-SAME-CLASS-MULTI-SUBJ',
        },
        source: { cellRef: 'C2' },
      },
      {
        course: {
          name: '學習中心',
          type: 'pullout',
          sourceKind: 'learning_center',
          targetSubject: '語文-國語',
          teacher: '何采珍',
          targetClasses: ['5年1班'],
          lockedSlots: [{ day: 4, period: 2 }],
          sharedEventId: 'EVT-SAME-CLASS-MULTI-SUBJ',
        },
        source: { cellRef: 'C3' },
      },
    ]

    const plan = buildBlockScheduleImportPlan(incoming, [])
    expect(plan.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'MISMATCHED_SHARED_EVENT_SAME_CLASS_MULTI_SUBJECT',
      }),
    ]))
  })
})
