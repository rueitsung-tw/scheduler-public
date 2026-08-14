import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { resolveAssignmentFormula } from '../src/utils/subjectAssignmentFormulaResolver.js'
import { deriveTeacherFieldsFromRules, validateAndParseExcelRows } from '../src/utils/subjectAssignmentExcelParser.js'

const codeMappings = { 音: '音樂', 美: '美勞' }

function musicClasses() {
  return Array.from({ length: 10 }, (_, index) => ({
    name: `5年${index + 1}班`,
    grade: 5,
    course_requirements: [{ subject: '音樂', periods: index === 4 ? 1 : 1.5 }],
  }))
}

describe('subjectAssignmentFormulaResolver adjusted-class teacher sources', () => {
  it('uses the uniquely matched Excel teacher for an explicit adjusted class', () => {
    const result = resolveAssignmentFormula({
      formulaStr: '505音',
      title: '音樂科任',
      codeMappings,
      classes: musicClasses(),
      currentTeacherId: 10,
      currentTeacherName: '教師甲',
    })

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocker')).toEqual([])
    expect(result.rules[0]).toMatchObject({
      targetClassNames: ['5年5班'],
      resolvedTeacherId: 10,
      resolvedTeacherName: '教師甲',
      teacherSource: 'excel-explicit',
    })
  })

  it('passes the uniquely matched Excel teacher through the parser into an explicit adjusted rule', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['編號', '', '職稱', '姓名', '配課式', '節數'],
      [1, '', '音樂科任', '教師甲', '505音', 1],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '配課')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    const result = validateAndParseExcelRows(
      buffer,
      [{ id: 10, name: '教師甲', type: 'subject' }],
      musicClasses(),
      codeMappings,
    )

    expect(result.success).toBe(true)
    expect(result.rows[0].rules[0]).toMatchObject({
      resolvedTeacherId: 10,
      resolvedTeacherName: '教師甲',
      teacherSource: 'excel-explicit',
    })
  })

  it('uses the class homeroom teacher for an adjusted default-homeroom course', () => {
    const classes = Array.from({ length: 10 }, (_, index) => ({
      name: `3年${index + 1}班`,
      grade: 3,
      homeroom_teacher: index === 4 ? '三年5班導師' : '',
      course_requirements: [{
        subject: '美勞',
        periods: index === 4 ? 1 : 1.5,
        defaultTeacher: 'homeroom',
      }],
    }))

    const result = resolveAssignmentFormula({
      formulaStr: '305美',
      title: '美勞科任',
      codeMappings,
      classes,
    })

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocker')).toEqual([])
    expect(result.rules[0]).toMatchObject({
      targetClassNames: ['3年5班'],
      resolvedTeacherName: '三年5班導師',
      teacherSource: 'homeroom-default',
    })
  })

  it('blocks an adjusted class only when neither Excel nor homeroom source is available', () => {
    const classes = Array.from({ length: 10 }, (_, index) => ({
      name: `3年${index + 1}班`,
      grade: 3,
      course_requirements: [{
        subject: '美勞',
        periods: index === 4 ? 1 : 1.5,
        defaultTeacher: 'homeroom',
      }],
    }))

    const result = resolveAssignmentFormula({
      formulaStr: '305美',
      title: '美勞科任',
      codeMappings,
      classes,
    })

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'blocker', code: 'adjusted-periods-teacher-required' }),
    ]))
  })

  it('reserves an Excel-explicit adjusted class so a grade batch cannot select it', () => {
    const result = resolveAssignmentFormula({
      formulaStr: '505音+5音*9',
      title: '音樂科任',
      codeMappings,
      classes: musicClasses(),
      currentTeacherId: 10,
      currentTeacherName: '教師甲',
    })

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocker')).toEqual([])
    expect(result.rules[0]).toMatchObject({
      targetClassNames: ['5年5班'],
      teacherSource: 'excel-explicit',
    })
    expect(result.rules[1].candidateClassNames).not.toContain('5年5班')

    const fields = deriveTeacherFieldsFromRules(result.rules)
    expect(fields.assignment_rules[0]).toMatchObject({
      resolvedTeacherId: 10,
      resolvedTeacherName: '教師甲',
      teacherSource: 'excel-explicit',
    })
  })
})
