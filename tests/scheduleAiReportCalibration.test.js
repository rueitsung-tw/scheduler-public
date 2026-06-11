import { describe, expect, it } from 'vitest'
import { buildScheduleAiReport } from '../src/utils/scheduleAiReport.js'

const baseSchoolInfo = {
  subjectClassroomGrades: {
    '語文-英語': [1, 2, 3, 4, 5, 6],
    '音樂': [3, 4, 5, 6],
    '美勞': [3, 4, 5, 6],
    '自然科學': [3, 4, 5, 6],
  },
  classroomLimits: {
    '語文-英語': 1,
    音樂: 1,
    美勞: 1,
    自然科學: 1,
  },
}

function buildClass(overrides = {}) {
  return {
    name: '1年1班',
    grade: 1,
    timetable: {
      1: {
        1: { subject: '語文-英語', teacher: '英語老師', classroomName: '英語教室A' },
      },
    },
    course_requirements: [
      { subject: '語文-國語', periods: 6, teacher: '導師A', defaultTeacher: 'homeroom' },
      { subject: '數學', periods: 4, teacher: '導師A', defaultTeacher: 'homeroom' },
      { subject: '語文-英語', periods: 1, teacher: '英語老師', defaultTeacher: 'subject' },
    ],
    ...overrides,
  }
}

describe('schedule AI report calibration', () => {
  it('does not report missing homeroom core subjects when homeroom subjects are represented by 導師區塊', () => {
    const result = buildScheduleAiReport({
      scheduleEntries: [],
      classes: [buildClass()],
      teachers: [],
      classrooms: [{ id: 'eng-a', name: '英語教室A', subject: '語文-英語', gradePreferences: [1] }],
      schoolInfo: baseSchoolInfo,
      aiSettings: {},
    })

    const requirementIssues = result.exportJson.classes[0].requirementIssues
    expect(requirementIssues.map((issue) => issue.subject)).not.toContain('語文-國語')
    expect(requirementIssues.map((issue) => issue.subject)).not.toContain('數學')
  })

  it('allows first-grade English when standardDomainSettings/course_requirements require it', () => {
    const schoolInfo = {
      ...baseSchoolInfo,
      subjectClassroomGrades: {
        ...baseSchoolInfo.subjectClassroomGrades,
        '語文-英語': [2, 3, 4, 5, 6],
      },
    }

    const result = buildScheduleAiReport({
      scheduleEntries: [],
      classes: [buildClass()],
      teachers: [],
      classrooms: [{ id: 'eng-a', name: '英語教室A', subject: '語文-英語', gradePreferences: [1] }],
      schoolInfo,
      aiSettings: {},
    })

    const issues = result.exportJson.issues
    expect(issues.some((issue) => issue.type === 'grade' && issue._dedupSubject === '語文-英語')).toBe(false)
  })

  it('treats split art subjects as upper-grade only even when the subject name has a suffix', () => {
    const result = buildScheduleAiReport({
      scheduleEntries: [
        { className: '1年1班', day: 1, period: 1, subject: '音樂_固定', teacherName: '音樂老師' },
        { className: '1年1班', day: 1, period: 2, subject: '美勞_固定', teacherName: '美勞老師' },
      ],
      classes: [
        buildClass({
          course_requirements: [
            { subject: '音樂_固定', periods: 1, teacher: '音樂老師', defaultTeacher: 'subject' },
            { subject: '美勞_固定', periods: 1, teacher: '美勞老師', defaultTeacher: 'subject' },
          ],
        }),
      ],
      teachers: [],
      classrooms: [],
      schoolInfo: baseSchoolInfo,
      aiSettings: {},
    })

    const issues = result.exportJson.issues
    const gradeSubjects = issues
      .filter((issue) => issue.type === 'grade')
      .map((issue) => issue._dedupSubject)

    expect(gradeSubjects).toContain('音樂_固定')
    expect(gradeSubjects).toContain('美勞_固定')
  })
})

describe('space-based conflict keys', () => {
  it('does not treat different homerooms as the same room', () => {
    const classes = [
      buildClass({
        name: '3年1班',
        grade: 3,
        timetable: { 1: { 1: { subject: '國語', teacher: '導師A' } } },
        course_requirements: [],
      }),
      buildClass({
        name: '3年2班',
        grade: 3,
        timetable: { 1: { 1: { subject: '國語', teacher: '導師B' } } },
        course_requirements: [],
      }),
    ]

    const result = buildScheduleAiReport({
      scheduleEntries: [],
      classes,
      teachers: [],
      classrooms: [],
      schoolInfo: baseSchoolInfo,
      aiSettings: {},
    })

    expect(result.exportJson.issues.some((issue) => issue.type === 'room')).toBe(false)
  })

  it('reports same specialized classroom used by two classes in the same week slot', () => {
    const classes = [
      buildClass({
        name: '3年1班',
        grade: 3,
        timetable: { 1: { 1: { subject: '語文-英語', teacher: '英語A', classroomId: 'eng-a', classroomName: '英語教室A' } } },
        course_requirements: [],
      }),
      buildClass({
        name: '3年2班',
        grade: 3,
        timetable: { 1: { 1: { subject: '語文-英語', teacher: '英語B', classroomId: 'eng-a', classroomName: '英語教室A' } } },
        course_requirements: [],
      }),
    ]

    const result = buildScheduleAiReport({
      scheduleEntries: [],
      classes,
      teachers: [],
      classrooms: [{ id: 'eng-a', name: '英語教室A', subject: '語文-英語', gradePreferences: [3] }],
      schoolInfo: baseSchoolInfo,
      aiSettings: {},
    })

    expect(result.exportJson.issues.some((issue) => issue.type === 'room')).toBe(true)
  })
})

describe('biweekly alternating space conflicts', () => {
  it('allows odd/even use of the same specialized room in the same day and period', () => {
    const classes = [
      buildClass({
        name: '5年1班',
        grade: 5,
        timetable: { 1: { 1: { oddWeek: { subject: '音樂', teacher: '音樂A' }, classroomId: 'music-a', classroomName: '音樂教室A' } } },
        course_requirements: [],
      }),
      buildClass({
        name: '5年2班',
        grade: 5,
        timetable: { 1: { 1: { evenWeek: { subject: '音樂', teacher: '音樂B' }, classroomId: 'music-a', classroomName: '音樂教室A' } } },
        course_requirements: [],
      }),
    ]

    const result = buildScheduleAiReport({
      scheduleEntries: [],
      classes,
      teachers: [],
      classrooms: [{ id: 'music-a', name: '音樂教室A', subject: '音樂', gradePreferences: [5] }],
      schoolInfo: baseSchoolInfo,
      aiSettings: {},
    })

    expect(result.exportJson.issues.some((issue) => issue.type === 'room')).toBe(false)
  })

  it('reports same room collision when both classes use the same odd week slot', () => {
    const classes = [
      buildClass({
        name: '5年1班',
        grade: 5,
        timetable: { 1: { 1: { oddWeek: { subject: '音樂', teacher: '音樂A' }, classroomId: 'music-a', classroomName: '音樂教室A' } } },
        course_requirements: [],
      }),
      buildClass({
        name: '5年2班',
        grade: 5,
        timetable: { 1: { 1: { oddWeek: { subject: '音樂', teacher: '音樂B' }, classroomId: 'music-a', classroomName: '音樂教室A' } } },
        course_requirements: [],
      }),
    ]

    const result = buildScheduleAiReport({
      scheduleEntries: [],
      classes,
      teachers: [],
      classrooms: [{ id: 'music-a', name: '音樂教室A', subject: '音樂', gradePreferences: [5] }],
      schoolInfo: baseSchoolInfo,
      aiSettings: {},
    })

    expect(result.exportJson.issues.some((issue) => issue.type === 'room')).toBe(true)
  })
})
