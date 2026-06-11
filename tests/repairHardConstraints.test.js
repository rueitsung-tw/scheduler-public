import { describe, expect, it } from 'vitest'
import { validateRepairHardConstraints } from '../src/utils/repairHardConstraints.js'

describe('validateRepairHardConstraints', () => {
  it('counts room overloads by subject bucket instead of raw period total', () => {
    const scheduleEntries = [
      { day: 1, period: 1, className: '3年1班', teacherName: '自然A', subject: '自然科學' },
      { day: 1, period: 1, className: '3年2班', teacherName: '自然B', subject: '自然科學' },
      { day: 1, period: 1, className: '3年3班', teacherName: '英語A', subject: '語文-英語' },
    ]

    const payloadData = {
      classrooms: [
        { subject: '自然科學' },
        { subject: '語文-英語' },
      ],
      schoolInfo: {
        classroomLimits: {
          自然科學: 1,
          '語文-英語': 1,
        },
        subjectClassroomGrades: {
          自然科學: [3, 4, 5, 6],
          '語文-英語': [3, 4, 5, 6],
        },
      },
      classes: [
        { name: '3年1班', grade: 3 },
        { name: '3年2班', grade: 3 },
        { name: '3年3班', grade: 3 },
      ],
    }

    const errors = validateRepairHardConstraints(scheduleEntries, payloadData)

    expect(errors).toEqual([
      expect.stringContaining('Room overload: 自然科學'),
    ])
  })

  it('uses standardDomainSettings as fallback when subjectGradeRules is partial', () => {
    const scheduleEntries = [
      { day: 1, period: 1, className: '1年1班', teacherName: '英語A', subject: '語文-英語' },
    ]

    const payloadData = {
      classrooms: [],
      standardDomainSettings: [
        { name: '語文-英語', periods: { 1: 0, 2: 0, 3: 3 } },
      ],
      schoolInfo: {
        subjectGradeRules: {
          自然科學: [3, 4, 5, 6],
        },
        subjectClassroomGrades: {
          '語文-英語': [3, 4, 5, 6],
        },
      },
      classes: [
        { name: '1年1班', grade: 1 },
      ],
    }

    const errors = validateRepairHardConstraints(scheduleEntries, payloadData)

    expect(errors).toEqual([
      expect.stringContaining('Grade-subject issue: 1年1班'),
    ])
  })

  it('suppresses virtual teacher conflicts for arts classes when arts mode is enabled', () => {
    const scheduleEntries = [
      { day: 1, period: 1, className: '3年5班', teacherName: '虛擬外聘教師', subject: '舞蹈' },
      { day: 1, period: 1, className: '4年5班', teacherName: '虛擬外聘教師', subject: '舞蹈' },
    ]

    const payloadData = {
      aiSettings: {
        artsClassEnabled: true,
      },
      classrooms: [],
      schoolInfo: {},
      classes: [
        { name: '3年5班', grade: 3, isArtsClass: true },
        { name: '4年5班', grade: 4, isArtsClass: true },
      ],
    }

    const errors = validateRepairHardConstraints(scheduleEntries, payloadData)

    expect(errors).toEqual([])
  })
})
