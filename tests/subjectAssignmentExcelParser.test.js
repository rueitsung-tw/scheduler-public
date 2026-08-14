import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  DEFAULT_SUBJECT_CODE_MAPPINGS,
  parseAssignmentFormula,
  validateAndParseExcelRows,
  generateSubjectAssignmentTemplate,
  deriveTeacherFieldsFromRules,
  buildDiffComparison,
  applyImportToTeachers,
} from '../src/utils/subjectAssignmentExcelParser.js'
import { resolveAssignmentFormula } from '../src/utils/subjectAssignmentFormulaResolver.js'

function buildWorkbookBuffer(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('subjectAssignmentExcelParser (Task 2)', () => {
  const sampleTeachers = [
    { id: 1, name: '張小華', type: 'homeroom' },
    { id: 2, name: '李大同', type: 'subject' },
    { id: 3, name: '陳美智', type: 'admin' },
  ]

  const sampleClasses = [
    ...Array.from({ length: 10 }, (_, i) => ({
      name: `30${i + 1}班`,
      grade: 3,
      course_requirements: [{ subject: '科技-資訊', periods: 1 }],
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      name: `40${i + 1}班`,
      grade: 4,
      course_requirements: [{ subject: '美勞', periods: 1 }],
    })),
    ...Array.from({ length: 7 }, (_, i) => ({
      name: `50${i + 1}班`,
      grade: 5,
      course_requirements: [{ subject: '科技-資訊', periods: 1 }],
    })),
    ...Array.from({ length: 12 }, (_, i) => ({
      name: `60${i + 1}班`,
      grade: 6,
      course_requirements: [{ subject: '音樂', periods: 1 }],
    })),
  ]

  it('1. DEFAULT_SUBJECT_CODE_MAPPINGS contains exactly the 9 user-approved entries', () => {
    const approvedMappings = {
      '本': '語文-本土語',
      '英': '語文-英語',
      '自': '自然科學',
      '社': '社會',
      '健': '健康',
      '體': '體育',
      '音': '音樂',
      '美': '美勞',
      '電': '科技-資訊',
    }
    expect(Object.keys(DEFAULT_SUBJECT_CODE_MAPPINGS)).toHaveLength(9)
    expect(DEFAULT_SUBJECT_CODE_MAPPINGS).toEqual(approvedMappings)

    const unapprovedAliases = ['國', '數', '綜', '生', '資', '科', '彈', '特']
    for (const code of unapprovedAliases) {
      expect(DEFAULT_SUBJECT_CODE_MAPPINGS[code]).toBeUndefined()
    }
  })

  it('2. parses supplied workbook profile: Row 1 title, Row 2 A=編號, C=職    稱, D=姓  名, F=節數, Row 3+ data', () => {
    const sheetData = [
      ['科任／行政教師配課匯入範例（去識別化）', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '導師', '級任教師', '張小華', '5電*7+3電*10', 17],
      [2, '專任', '科任教師', '李大同', '6音*12', 12],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, sampleClasses)

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(2)

    expect(result.rows[0].teacherName).toBe('張小華')
    expect(result.rows[0].declaredTotal).toBe(17)
    expect(result.rows[0].calculatedTotal).toBe(17)
    expect(result.rows[0].rules).toMatchObject([
      { grade: 5, excelCode: '電', systemSubject: '科技-資訊', classCount: 7, periodsPerClass: 1, periods: 7 },
      { grade: 3, excelCode: '電', systemSubject: '科技-資訊', classCount: 10, periodsPerClass: 1, periods: 10 },
    ])

    expect(result.rows[1].teacherName).toBe('李大同')
    expect(result.rows[1].rules).toMatchObject([
      { grade: 6, excelCode: '音', systemSubject: '音樂', classCount: 12, periodsPerClass: 1, periods: 12 },
    ])
  })


  it('3. parses formula 6音*12 and normalizes full-width plus/multiply/numbers', () => {
    const formula1 = '６音✕１２'
    const parsed1 = parseAssignmentFormula(formula1, DEFAULT_SUBJECT_CODE_MAPPINGS)
    expect(parsed1.valid).toBe(true)
    expect(parsed1.rules).toEqual([{ grade: 6, excelCode: '音', systemSubject: '音樂', classCount: 12, periodsPerClass: 1, periods: 12 }])

    const formula2 = '５電＊７＋３電＊１０'
    const parsed2 = parseAssignmentFormula(formula2, DEFAULT_SUBJECT_CODE_MAPPINGS)
    expect(parsed2.valid).toBe(true)
    expect(parsed2.rules).toEqual([
      { grade: 5, excelCode: '電', systemSubject: '科技-資訊', classCount: 7, periodsPerClass: 1, periods: 7 },
      { grade: 3, excelCode: '電', systemSubject: '科技-資訊', classCount: 10, periodsPerClass: 1, periods: 10 },
    ])
  })

  it('4. blocks for unknown code and identifies the exact code for UI warning dialog', () => {
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '5國*7', 7], // '國' is an unapproved alias
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, sampleClasses)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      rowNumber: 3,
      teacherName: '李大同',
      rawFormula: '5國*7',
      code: '國',
    })
    expect(result.errors[0].cause).toContain('國')
    expect(result.unknownCodes).toContain('國')
  })

  it('5. blocks for missing teacher', () => {
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '路人甲', '6音*12', 12],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, sampleClasses)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      rowNumber: 3,
      teacherName: '路人甲',
      rawFormula: '6音*12',
    })
    expect(result.errors[0].cause).toContain('未登錄')
  })

  it('6. blocks for duplicate teacher in Excel file', () => {
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '6音*12', 12],
      [2, '專任', '科任教師', '李大同', '4美*8', 8],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, sampleClasses)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      rowNumber: 4,
      teacherName: '李大同',
    })
    expect(result.errors[0].cause).toContain('重複')
  })

  it('7. blocks for declared total mismatch', () => {
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '導師', '級任教師', '張小華', '5電*7+3電*10', 15], // Declared 15, actual calculated 17
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, sampleClasses)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      rowNumber: 3,
      teacherName: '張小華',
      rawFormula: '5電*7+3電*10',
    })
    expect(result.errors[0].cause).toContain('不符')
  })

  it('8. blocks for non-positive integer / decimals in period or class count', () => {
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '6音*7.5', 7.5],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, sampleClasses)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].cause).toMatch(/正整數|格式|小數/)
  })

  it('9. blocks when subject code mapping target is inapplicable for grade', () => {
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '1音*2', 2], // Music is 3-6 grade only
    ]
    const classesWithGrade1 = [
      ...sampleClasses,
      { name: '101班', grade: 1, course_requirements: [{ subject: '音樂', periods: 1 }] },
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, classesWithGrade1)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].cause).toContain('不適用')
  })

  it('10. blocks for missing class catalog for grade', () => {
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '2英*4', 4], // Grade 2 has no classes in sampleClasses
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, sampleClasses)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].cause).toContain('班級資料')
  })

  it('11. generateSubjectAssignmentTemplate returns xlsx buffer matching exact profile without actual people data', () => {
    const buffer = generateSubjectAssignmentTemplate()
    expect(buffer).toBeDefined()
    expect(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array).toBe(true)

    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

    // Check Row 1 title
    expect(aoa[0][0]).toContain('科任／行政教師配課匯入範例')

    // Check instruction content for Task 4 requirements
    const fullText = aoa.flat().join('\n')
    expect(fullText).toContain('課程管理 → 班級課程列表')
    expect(fullText).toContain('絕不變更課程與每班節數')
    expect(fullText).toContain('6自*5')
    expect(fullText).toContain('5美')
    expect(fullText).toContain('505音')
    expect(fullText).toContain('505')
    expect(fullText).toContain('唯一推導科目')
    expect(fullText).toContain('留白')

    // Check Row 5 headers (index 4)
    expect(aoa[4][0].trim()).toBe('編號')
    expect(aoa[4][2].replace(/\s+/g, '')).toBe('職稱')
    expect(aoa[4][3].replace(/\s+/g, '')).toBe('姓名')
    expect(aoa[4][5].trim()).toBe('節數')

    // Check sample rows
    expect(aoa.length).toBeGreaterThan(5)
    const sampleNames = aoa.slice(5).map(r => r[3]).filter(Boolean)
    expect(sampleNames.length).toBeGreaterThan(0)
    for (const name of sampleNames) {
      expect(['張小華', '李大同', '陳美智']).toContain(name)
    }
  })

  it('12. calculates formula periods with per-class course requirements (e.g. 4國語*6 + 2國語*1 = 3*6 + 1*1 = 19)', () => {
    const codeMappings = { ...DEFAULT_SUBJECT_CODE_MAPPINGS, '國': '語文-國語' }
    const customClasses = [
      ...Array.from({ length: 6 }, (_, i) => ({
        name: `40${i + 1}班`,
        grade: 4,
        course_requirements: [{ subject: '語文-國語', periods: 3 }],
      })),
      {
        name: '201班',
        grade: 2,
        course_requirements: [{ subject: '語文-國語', periods: 1 }],
      },
    ]
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '行政', '兼任教師', '李大同', '4國*6+2國*1', 19],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, customClasses, codeMappings)

    expect(result.success).toBe(true)
    expect(result.rows[0].calculatedTotal).toBe(19)
    expect(result.rows[0].rules).toMatchObject([
      { grade: 4, excelCode: '國', systemSubject: '語文-國語', classCount: 6, periodsPerClass: 3, periods: 18 },
      { grade: 2, excelCode: '國', systemSubject: '語文-國語', classCount: 1, periodsPerClass: 1, periods: 1 },
    ])
  })

  it('13. blocks when classCount exceeds actual class count in system', () => {
    const customClasses = [
      { name: '601班', grade: 6, course_requirements: [{ subject: '音樂', periods: 2 }] },
    ]
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '6音*5', 10], // 5 classes written, system only has 1
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, customClasses)

    expect(result.success).toBe(false)
    expect(result.errors[0].cause).toContain('填寫 5 個班，但系統僅有 1 個班')
  })

  it('14. blocks when per-class periods config is missing or inconsistent', () => {
    const inconsistentClasses = [
      { name: '601班', grade: 6, course_requirements: [{ subject: '音樂', periods: 2 }] },
      { name: '602班', grade: 6, course_requirements: [{ subject: '音樂', periods: 3 }] },
    ]
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '6音*2', 5],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, inconsistentClasses)

    expect(result.success).toBe(false)
    expect(result.errors[0].cause).toMatch(/每班節數.*不一致|無唯一眾數|無法自動判斷基準節數/)
  })

  it('15. handles "-" or blank formula for teachers with vs without existing allocations', () => {
    const teachers = [
      { id: 1, name: '有既有配課教師', type: 'subject', max_periods: 12 },
      { id: 2, name: '無既有配課教師', type: 'subject', max_periods: 0, assignment_rules: [], expertise_allocations: [] },
    ]
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '有既有配課教師', '-', ''],
      [2, '專任', '科任教師', '無既有配課教師', '', ''],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, teachers, sampleClasses)

    expect(result.success).toBe(true)
    expect(result.rows).toHaveLength(0) // Zero writes!
    expect(result.skippedRows).toHaveLength(1)
    expect(result.skippedRows[0].teacherName).toBe('有既有配課教師')
    expect(result.unassignedTeacherWarnings).toHaveLength(1)
    expect(result.unassignedTeacherWarnings[0].teacherName).toBe('無既有配課教師')
  })

  it('16. integrates resolveAssignmentFormula into validateAndParseExcelRows and exposes correctionWarnings for typos', () => {
    const classesWithHealth = [
      ...sampleClasses,
      { name: '301班', grade: 3, course_requirements: [{ subject: '健康', periods: 1 }] },
    ]
    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '健康科任', '李大同', '3建1', 1],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, classesWithHealth)


    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.correctionWarnings).toBeDefined()
    expect(result.correctionWarnings).toHaveLength(1)
    expect(result.correctionWarnings[0]).toMatchObject({
      rowNumber: 3,
      teacherName: '李大同',
      originalToken: '3建1',
      replacementToken: '3健*1',
    })
    expect(result.rows[0].rules[0]).toMatchObject({
      grade: 3,
      excelCode: '健',
      subject: '健康',
      sourceKind: 'grade-batch',
    })
  })

  it('17. supports decimal F totals matching resolved total in validateAndParseExcelRows', () => {
    const customClasses = [
      ...Array.from({ length: 10 }, (_, i) => {
        const classNum = i + 1
        const periods = classNum === 5 ? 1 : 1.5
        const teacher = classNum === 5 ? '李大同' : ''
        return { name: `50${classNum}班`, grade: 5, course_requirements: [{ subject: '音樂', periods, teacher }] }
      }),
      { name: '301班', grade: 3, course_requirements: [{ subject: '音樂', periods: 1.5 }] },
      { name: '605班', grade: 6, course_requirements: [{ subject: '音樂', periods: 1 }] },
    ]
    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '音樂科任', '李大同', '5音*9+3音*1+505+605', 17],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, customClasses)

    expect(result.success).toBe(true)
    expect(result.rows[0].declaredTotal).toBe(17)
    expect(result.rows[0].calculatedTotal).toBe(17)
  })

  it('18. blocks bare class code under ambiguous title in validateAndParseExcelRows', () => {
    const sheetData = [
      ['115學年教師授課鐘點一覽表', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '導師', '級任教師', '張小華', '608', 3],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, sampleTeachers, sampleClasses)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].cause).toMatch(/職稱.*未包含可辨識之科目關鍵字|無法.*推導科目/)
  })
})


describe('subjectAssignmentExcelParser Task 3: Diff Comparison & Boundary Guard Transformer', () => {
  const existingTeachers = [
    {
      id: 10,
      name: '張導師',
      type: 'homeroom',
      assignedClass: '501班',
      google_account: 'chang@school.edu',
      reduction: 2,
      overtime: 1,
      unavailable_slots: [{ day: 1, period: 2 }],
      assignment_rules: [],
      expertise_allocations: [],
      gradePreferences: [],
      max_periods: 0,
    },
    {
      id: 20,
      name: '李專任',
      type: 'subject',
      assignedClass: null,
      google_account: 'lee@school.edu',
      reduction: 0,
      overtime: 0,
      unavailable_slots: [{ day: 3, period: 4 }],
      assignment_rules: [{ grade: 6, subject: '音樂', periods: 12, excelCode: '音', classCount: 12, periodsPerClass: 1 }],
      expertise_allocations: [{ subject: '音樂', quota: 12 }],
      gradePreferences: [6],
      max_periods: 12,
    },
  ]

  const parsedRows = [
    {
      rowNumber: 3,
      teacherId: 10,
      teacherName: '張導師',
      rawFormula: '5電*7+3電*10',
      declaredTotal: 17,
      calculatedTotal: 17,
      rules: [
        { grade: 5, excelCode: '電', systemSubject: '科技-資訊', classCount: 7, periodsPerClass: 1, periods: 7 },
        { grade: 3, excelCode: '電', systemSubject: '科技-資訊', classCount: 10, periodsPerClass: 1, periods: 10 },
      ],
    },
    {
      rowNumber: 4,
      teacherId: 20,
      teacherName: '李專任',
      rawFormula: '6音*12',
      declaredTotal: 12,
      calculatedTotal: 12,
      rules: [
        { grade: 6, excelCode: '音', systemSubject: '音樂', classCount: 12, periodsPerClass: 1, periods: 12 },
      ],
    },
  ]

  it('1. deriveTeacherFieldsFromRules correctly computes assignment_rules, expertise_allocations, gradePreferences, and max_periods', () => {
    const rules = [
      { grade: 5, excelCode: '電', systemSubject: '科技-資訊', classCount: 7, periodsPerClass: 1, periods: 7 },
      { grade: 3, excelCode: '電', systemSubject: '科技-資訊', classCount: 10, periodsPerClass: 1, periods: 10 },
      { grade: 4, excelCode: '美', systemSubject: '美勞', classCount: 5, periodsPerClass: 1, periods: 5 },
    ]
    const derived = deriveTeacherFieldsFromRules(rules)

    expect(derived.assignment_rules).toHaveLength(3)
    expect(derived.expertise_allocations).toEqual([
      { subject: '科技-資訊', quota: 17 },
      { subject: '美勞', quota: 5 },
    ])
    expect(derived.expertiseSubjects).toEqual(['科技-資訊', '美勞'])
    expect(derived.gradePreferences).toEqual([3, 4, 5])
    expect(derived.max_periods).toBe(22)
  })

  it('2. buildDiffComparison correctly compares old vs imported state and flags homeroom teachers', () => {
    const diffs = buildDiffComparison(parsedRows, existingTeachers)
    expect(diffs).toHaveLength(2)

    const homeroomDiff = diffs.find(d => d.teacherName === '張導師')
    expect(homeroomDiff.isHomeroom).toBe(true)
    expect(homeroomDiff.hasChanges).toBe(true)
    expect(homeroomDiff.diffs.assignment_rules).toBe(true)
    expect(homeroomDiff.diffs.max_periods).toBe(true)
    expect(homeroomDiff.imported.max_periods).toBe(17)

    const subjectDiff = diffs.find(d => d.teacherName === '李專任')
    expect(subjectDiff.isHomeroom).toBe(false)
    expect(subjectDiff.hasChanges).toBe(false)
  })

  it('3. applyImportToTeachers preserves ALL protected fields byte/equality-wise and keeps homeroom type', () => {
    // Unconfirmed homeroom teacher -> rules not applied
    const unconfirmedResult = applyImportToTeachers(parsedRows, existingTeachers, [])
    const unconfirmedHomeroom = unconfirmedResult.find(t => t.name === '張導師')
    expect(unconfirmedHomeroom.assignment_rules).toEqual([])

    // Confirmed homeroom teacher -> rules applied, but type MUST remain 'homeroom'
    const confirmedResult = applyImportToTeachers(parsedRows, existingTeachers, [10])
    const targetHomeroom = confirmedResult.find(t => t.name === '張導師')

    // Rule transformation verified
    expect(targetHomeroom.assignment_rules).toHaveLength(2)
    expect(targetHomeroom.max_periods).toBe(17)
    expect(targetHomeroom.expertise_allocations).toEqual([{ subject: '科技-資訊', quota: 17 }])

    // Protected fields verification:
    // Homeroom teacher MUST retain type === 'homeroom'
    expect(targetHomeroom.type).toBe('homeroom')
    // Scalar fields equality
    expect(targetHomeroom.name).toBe('張導師')
    expect(targetHomeroom.assignedClass).toBe('501班')
    expect(targetHomeroom.google_account).toBe('chang@school.edu')
    expect(targetHomeroom.reduction).toBe(2)
    expect(targetHomeroom.overtime).toBe(1)
    // Reference / equality check for object/array protected fields
    const originalHomeroom = existingTeachers.find(t => t.name === '張導師')
    expect(targetHomeroom.unavailable_slots).toBe(originalHomeroom.unavailable_slots)
  })

  it('4. Teacher ID 0 remains valid (not replaced by null or fallback)', () => {
    const teachersWithZeroId = [
      { id: 0, name: '零號教師', type: 'homeroom' },
    ]
    const classes = [
      ...Array.from({ length: 7 }, (_, i) => ({
        name: `50${i + 1}班`,
        grade: 5,
        course_requirements: [{ subject: '科技-資訊', periods: 1 }],
      })),
    ]
    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '導師', '級任教師', '零號教師', '5電*7', 7],
    ]
    const buffer = buildWorkbookBuffer(sheetData)
    const result = validateAndParseExcelRows(buffer, teachersWithZeroId, classes)

    expect(result.success).toBe(true)
    expect(result.rows[0].teacherId).toBe(0) // Must be 0, NOT null!

    const diffs = buildDiffComparison(result.rows, teachersWithZeroId)
    expect(diffs[0].teacherId).toBe(0) // Must be 0!

    const applied = applyImportToTeachers(result.rows, teachersWithZeroId, [0])
    expect(applied[0].assignment_rules).toHaveLength(1)
  })

  it('5. Browser parser supports ArrayBuffer and Uint8Array input', () => {
    const teachers = [{ id: 2, name: '李大同', type: 'subject' }]
    const classes = Array.from({ length: 12 }, (_, i) => ({
      name: `60${i + 1}班`,
      grade: 6,
      course_requirements: [{ subject: '音樂', periods: 1 }],
    }))

    const sheetData = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '專任', '科任教師', '李大同', '6音*12', 12],
    ]
    const nodeBuffer = buildWorkbookBuffer(sheetData)

    // Convert Buffer to Uint8Array and ArrayBuffer
    const uint8Arr = new Uint8Array(nodeBuffer)
    const arrayBuf = uint8Arr.buffer

    const resFromUint8 = validateAndParseExcelRows(uint8Arr, teachers, classes)
    expect(resFromUint8.success).toBe(true)
    expect(resFromUint8.rows).toHaveLength(1)

    const resFromArrayBuf = validateAndParseExcelRows(arrayBuf, teachers, classes)
    expect(resFromArrayBuf.success).toBe(true)
    expect(resFromArrayBuf.rows).toHaveLength(1)
  })

  it('6. Formula injection boundary: template generator prefixes apostrophe for user-controlled labels starting with formula triggers without breaking assignment formulas or named data', () => {
    // Custom template sample rows with formula trigger characters
    const customRows = [
      ['科任／行政教師配課匯入範例', '', '', '', '', ''],
      ['編號', '', '職    稱', '姓  名', '', '節數'],
      [1, '=CMD()', '@EXEC', '-MALICIOUS', '5電*7', 7],
    ]

    const buffer = generateSubjectAssignmentTemplate(customRows)
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

    // Formula trigger labels MUST be prefixed with apostrophe `'` to be literal text
    expect(aoa[2][1]).toBe("'=CMD()")
    expect(aoa[2][2]).toBe("'@EXEC")
    expect(aoa[2][3]).toBe("'-MALICIOUS")

    // Real assignment formulas starting with digits (e.g. 5電*7) are parsed cleanly
    const parsed = parseAssignmentFormula('5電*7', DEFAULT_SUBJECT_CODE_MAPPINGS)
    expect(parsed.valid).toBe(true)
    expect(parsed.rules[0]).toMatchObject({ grade: 5, excelCode: '電', systemSubject: '科技-資訊', classCount: 7, periodsPerClass: 1, periods: 7 })
  })

  it('7. deriveTeacherFieldsFromRules preserves sourceKind, targetClassNames, and candidateClassNames (defaults to [])', () => {
    const rules = [
      {
        grade: 5,
        subject: '音樂',
        periods: 1.5,
        sourceKind: 'class-specific',
        targetClassNames: ['5年5班'],
        candidateClassNames: [],
      },
      {
        grade: 6,
        subject: '音樂',
        periods: 15,
        sourceKind: 'grade-batch',
        candidateClassNames: ['6年1班', '6年2班'],
      },
      {
        grade: 4,
        subject: '美勞',
        periods: 2,
      },
    ]
    const derived = deriveTeacherFieldsFromRules(rules)

    expect(derived.assignment_rules[0]).toMatchObject({
      grade: 5,
      subject: '音樂',
      periods: 1.5,
      sourceKind: 'class-specific',
      targetClassNames: ['5年5班'],
      candidateClassNames: [],
    })
    expect(derived.assignment_rules[1]).toMatchObject({
      grade: 6,
      subject: '音樂',
      periods: 15,
      sourceKind: 'grade-batch',
      targetClassNames: [],
      candidateClassNames: ['6年1班', '6年2班'],
    })
    expect(derived.assignment_rules[2]).toMatchObject({
      grade: 4,
      subject: '美勞',
      periods: 2,
      sourceKind: '',
      targetClassNames: [],
      candidateClassNames: [],
    })

    // Test that arrays are cloned and not shared by reference
    rules[0].targetClassNames.push('5年6班')
    expect(derived.assignment_rules[0].targetClassNames).toEqual(['5年5班'])
  })
})

describe('subjectAssignmentFormulaResolver (Task 1 & Task 2)', () => {
  const sampleClasses = [
    { name: '5年1班', grade: 5, course_requirements: [{ subject: '音樂', periods: 1.5 }, { subject: '美勞', periods: 1 }, { subject: '自然科學', periods: 3 }] },
    { name: '5年2班', grade: 5, course_requirements: [{ subject: '音樂', periods: 1 }, { subject: '美勞', periods: 1 }] },
    { name: '5年5班', grade: 5, course_requirements: [{ subject: '音樂', periods: 1.5 }, { subject: '自然科學', periods: 3 }] }, // missing 美勞
    { name: '6年5班', grade: 6, course_requirements: [{ subject: '音樂', periods: 1 }] },
    { name: '6年8班', grade: 6, course_requirements: [{ subject: '自然科學', periods: 3 }] },
    { name: '3年1班', grade: 3, course_requirements: [{ subject: '健康', periods: 1 }] },
  ]

  it('1. warning-normalizes typo 3建1 to 3健*1 with typo-corrected diagnostic', () => {
    const res = resolveAssignmentFormula({
      formulaStr: '3建1',
      title: '健康科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: sampleClasses,
    })

    expect(res.normalizedFormula).toBe('3健*1')
    expect(res.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', code: 'typo-corrected' }),
      ])
    )
    expect(res.rules).toEqual([
      expect.objectContaining({
        grade: 3,
        excelCode: '健',
        subject: '健康',
        sourceKind: 'grade-batch',
        classCount: 1,
        periodsPerClass: 1,
        periods: 1,
      }),
    ])
  })

  it('2. resolves class-specific formula 505+605 under title 音樂科任', () => {
    const res = resolveAssignmentFormula({
      formulaStr: '505+605',
      title: '音樂科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: sampleClasses,
    })

    expect(res.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ grade: 5, subject: '音樂', sourceKind: 'class-specific', targetClassNames: ['5年5班'], periods: 1.5 }),
        expect.objectContaining({ grade: 6, subject: '音樂', sourceKind: 'class-specific', targetClassNames: ['6年5班'], periods: 1 }),
      ])
    )
    expect(res.totalPeriods).toBe(2.5)
  })

  it('3. resolves explicit subject class-specific formula 505自', () => {
    const res = resolveAssignmentFormula({
      formulaStr: '505自',
      title: '導師',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: sampleClasses,
    })

    expect(res.rules).toHaveLength(1)
    expect(res.rules[0]).toMatchObject({
      grade: 5,
      excelCode: '自',
      subject: '自然科學',
      sourceKind: 'class-specific',
      targetClassNames: ['5年5班'],
      periods: 3,
    })
  })

  it('4. resolves bare class code 608 under title 自然超鐘點 by keyword inference', () => {
    const res = resolveAssignmentFormula({
      formulaStr: '608',
      title: '自然超鐘點',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: sampleClasses,
    })

    expect(res.rules).toHaveLength(1)
    expect(res.rules[0]).toMatchObject({
      grade: 6,
      excelCode: '自',
      subject: '自然科學',
      sourceKind: 'class-specific',
      targetClassNames: ['6年8班'],
      periods: 3,
    })
  })

  it('5. returns blocker diagnostic for bare class code under ambiguous title', () => {
    const resNoKeyword = resolveAssignmentFormula({
      formulaStr: '608',
      title: '導師',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: sampleClasses,
    })

    expect(resNoKeyword.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'blocker', code: 'ambiguous-title-subject' }),
      ])
    )

    const resMultiKeyword = resolveAssignmentFormula({
      formulaStr: '608',
      title: '自然與音樂科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: sampleClasses,
    })

    expect(resMultiKeyword.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'blocker', code: 'ambiguous-title-subject' }),
      ])
    )
  })

  it('6. all-eligible 5美 targets only classes with active 美勞 requirement and excludes 5年5班', () => {
    const res = resolveAssignmentFormula({
      formulaStr: '5美',
      title: '美勞科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: sampleClasses,
    })

    expect(res.rules).toHaveLength(1)
    expect(res.rules[0]).toMatchObject({
      grade: 5,
      excelCode: '美',
      subject: '美勞',
      sourceKind: 'all-eligible',
      classCount: 2,
      targetClassNames: ['5年1班', '5年2班'],
      periods: 2,
    })
    expect(res.rules[0].targetClassNames).not.toContain('5年5班')
  })

  it('7. returns blocker diagnostic missing-class-course when class-specific requirement is missing', () => {
    const res = resolveAssignmentFormula({
      formulaStr: '605健',
      title: '健康科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: sampleClasses,
    })

    expect(res.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'blocker', code: 'missing-class-course' }),
      ])
    )
  })

  it('8. derives total periods 18.5 from real confirmed formula 5音*10+3音*1+505+605 with two-pass reservation', () => {
    // 505 and 605 are arts classes with 1 period music, normal grade 5 classes have 1.5 periods
    const realWorldClasses = [
      ...Array.from({ length: 11 }, (_, i) => {
        const classNum = i + 1
        const name = `5年${classNum}班`
        // 505 is arts class with 1 period; others are 1.5 periods
        const periods = classNum === 5 ? 1 : 1.5
        const teacher = classNum === 5 ? '李大同' : ''
        return { name, grade: 5, course_requirements: [{ subject: '音樂', periods, teacher }] }
      }),
      { name: '3年1班', grade: 3, course_requirements: [{ subject: '音樂', periods: 1.5 }] },
      { name: '6年5班', grade: 6, course_requirements: [{ subject: '音樂', periods: 1 }] },
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '5音*10+3音*1+505+605',
      title: '音樂科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes: realWorldClasses,
    })

    expect(res.diagnostics.filter((d) => d.severity === 'blocker')).toHaveLength(0)
    expect(res.totalPeriods).toBe(18.5)
    expect(res.rules).toHaveLength(4)

    // 5音*10 (grade-batch) uses remaining 10 unreserved classes (excluding 5年5班), candidateClassNames populated, targetClassNames empty
    expect(res.rules[0]).toMatchObject({
      grade: 5,
      excelCode: '音',
      subject: '音樂',
      sourceKind: 'grade-batch',
      classCount: 10,
      periodsPerClass: 1.5,
      periods: 15,
      targetClassNames: [],
    })
    expect(res.rules[0].candidateClassNames).toHaveLength(10)
    expect(res.rules[0].candidateClassNames).not.toContain('5年5班')

    // 3音*1 (grade-batch)
    expect(res.rules[1]).toMatchObject({
      grade: 3,
      excelCode: '音',
      subject: '音樂',
      sourceKind: 'grade-batch',
      classCount: 1,
      periodsPerClass: 1.5,
      periods: 1.5,
      candidateClassNames: ['3年1班'],
      targetClassNames: [],
    })

    // 505 (class-specific)
    expect(res.rules[2]).toMatchObject({
      grade: 5,
      excelCode: '音',
      subject: '音樂',
      sourceKind: 'class-specific',
      periods: 1,
      targetClassNames: ['5年5班'],
    })

    // 605 (class-specific)
    expect(res.rules[3]).toMatchObject({
      grade: 6,
      excelCode: '音',
      subject: '音樂',
      sourceKind: 'class-specific',
      periods: 1,
      targetClassNames: ['6年5班'],
    })
  })

  it('9. resolves grade-batch 6音*10+3音*2 excluding individually adjusted class with teacher (6年5班) without blocker', () => {
    const classes = [
      ...Array.from({ length: 11 }, (_, i) => {
        const classNum = i + 1
        const name = `6年${classNum}班`
        if (classNum === 5) {
          return { name, grade: 6, course_requirements: [{ subject: '音樂', periods: 1, teacher: '吳品璇' }] }
        }
        return { name, grade: 6, course_requirements: [{ subject: '音樂', periods: 1.5, teacher: '' }] }
      }),
      { name: '3年1班', grade: 3, course_requirements: [{ subject: '音樂', periods: 1.5 }] },
      { name: '3年2班', grade: 3, course_requirements: [{ subject: '音樂', periods: 1.5 }] },
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '6音*10+3音*2',
      title: '音樂科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes,
    })

    expect(res.diagnostics.filter((d) => d.severity === 'blocker')).toHaveLength(0)
    expect(res.totalPeriods).toBe(18)
    expect(res.rules[0]).toMatchObject({
      sourceKind: 'grade-batch',
      periods: 15,
      periodsPerClass: 1.5,
      classCount: 10,
    })
    expect(res.rules[0].candidateClassNames).toHaveLength(10)
    expect(res.rules[0].candidateClassNames).not.toContain('6年5班')

    expect(res.rules[1]).toMatchObject({
      sourceKind: 'grade-batch',
      periods: 3,
      periodsPerClass: 1.5,
      classCount: 2,
    })
  })

  it('10. resolves grade-batch 3美*3 excluding individually adjusted class with teacher (3年5班) without blocker', () => {
    const classes = [
      ...Array.from({ length: 10 }, (_, i) => {
        const classNum = i + 1
        const name = `3年${classNum}班`
        if (classNum === 5) {
          return { name, grade: 3, course_requirements: [{ subject: '美勞', periods: 1, teacher: '洪靖雅' }] }
        }
        return { name, grade: 3, course_requirements: [{ subject: '美勞', periods: 1.5, teacher: '' }] }
      }),
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '3美*3',
      title: '美勞科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes,
    })

    expect(res.diagnostics.filter((d) => d.severity === 'blocker')).toHaveLength(0)
    expect(res.totalPeriods).toBe(4.5)
    expect(res.rules[0]).toMatchObject({
      sourceKind: 'grade-batch',
      periods: 4.5,
      periodsPerClass: 1.5,
      classCount: 3,
    })
    expect(res.rules[0].candidateClassNames).toHaveLength(9)
    expect(res.rules[0].candidateClassNames).not.toContain('3年5班')
  })

  it('11. returns blocker adjusted-periods-teacher-required when individually adjusted class has no teacher', () => {
    const classes = [
      ...Array.from({ length: 10 }, (_, i) => {
        const classNum = i + 1
        const name = `3年${classNum}班`
        if (classNum === 5) {
          return { name, grade: 3, course_requirements: [{ subject: '美勞', periods: 1, teacher: '', teacher_name: '' }] }
        }
        return { name, grade: 3, course_requirements: [{ subject: '美勞', periods: 1.5, teacher: '' }] }
      }),
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '3美*3',
      title: '美勞科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes,
    })

    const blockers = res.diagnostics.filter((d) => d.severity === 'blocker')
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toMatchObject({
      code: 'adjusted-periods-teacher-required',
    })
    expect(blockers[0].message).toContain('3年5班')
    expect(blockers[0].message).toContain('美勞')
    expect(blockers[0].message).toContain('1')
    expect(blockers[0].message).toContain('請先指定老師後再匯入')
    expect(blockers.map((b) => b.code)).not.toContain('inconsistent-periods')
  })

  it('12. returns blocker ambiguous-baseline-periods when positive periods have tied max frequency', () => {
    const classes = [
      { name: '3年1班', grade: 3, course_requirements: [{ subject: '美勞', periods: 1 }] },
      { name: '3年2班', grade: 3, course_requirements: [{ subject: '美勞', periods: 1 }] },
      { name: '3年3班', grade: 3, course_requirements: [{ subject: '美勞', periods: 1.5 }] },
      { name: '3年4班', grade: 3, course_requirements: [{ subject: '美勞', periods: 1.5 }] },
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '3美*2',
      title: '美勞科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes,
    })

    const blockers = res.diagnostics.filter((d) => d.severity === 'blocker')
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toMatchObject({
      code: 'ambiguous-baseline-periods',
    })
    expect(blockers[0].message).toMatch(/無唯一眾數|無法自動判斷基準節數/)
  })

  it('13. does not exclude class that has assigned teacher if its periods match baseline (overwritable by batch)', () => {
    const classes = [
      { name: '5年1班', grade: 5, course_requirements: [{ subject: '音樂', periods: 1.5, teacher: '張老師' }] },
      { name: '5年2班', grade: 5, course_requirements: [{ subject: '音樂', periods: 1.5, teacher: '' }] },
      { name: '5年3班', grade: 5, course_requirements: [{ subject: '音樂', periods: 1.5, teacher: '' }] },
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '5音*3',
      title: '音樂科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes,
    })

    expect(res.diagnostics.filter((d) => d.severity === 'blocker')).toHaveLength(0)
    expect(res.rules[0].candidateClassNames).toEqual(['5年1班', '5年2班', '5年3班'])
  })

  it('14. class-count-mismatch diagnostic reports remaining available classes count excluding adjusted arts class', () => {
    const classes = [
      ...Array.from({ length: 11 }, (_, i) => {
        const classNum = i + 1
        const name = `6年${classNum}班`
        if (classNum === 5) {
          return { name, grade: 6, course_requirements: [{ subject: '音樂', periods: 1, teacher: '吳品璇' }] }
        }
        return { name, grade: 6, course_requirements: [{ subject: '音樂', periods: 1.5, teacher: '' }] }
      }),
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '6音*11',
      title: '音樂科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes,
    })

    const blockers = res.diagnostics.filter((d) => d.severity === 'blocker')
    expect(blockers).toHaveLength(1)
    expect(blockers[0].code).toBe('class-count-mismatch')
    expect(blockers[0].message).toBe('6 年級科目「音樂」填寫 11 個班，但系統僅有 10 個班')
  })

  it('15. all-eligible formula excludes individually adjusted class with teacher', () => {
    const classes = [
      ...Array.from({ length: 10 }, (_, i) => {
        const classNum = i + 1
        const name = `5年${classNum}班`
        if (classNum === 5) {
          return { name, grade: 5, course_requirements: [{ subject: '美勞', periods: 1, teacher: '洪老師' }] }
        }
        return { name, grade: 5, course_requirements: [{ subject: '美勞', periods: 1.5, teacher: '' }] }
      }),
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '5美',
      title: '美勞科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes,
    })

    expect(res.diagnostics.filter((d) => d.severity === 'blocker')).toHaveLength(0)
    expect(res.totalPeriods).toBe(13.5)
    expect(res.rules[0]).toMatchObject({
      sourceKind: 'all-eligible',
      classCount: 9,
      periodsPerClass: 1.5,
      periods: 13.5,
    })
    expect(res.rules[0].targetClassNames).toHaveLength(9)
    expect(res.rules[0].targetClassNames).not.toContain('5年5班')
  })

  it('16. accepts explicit codeMappings and defaults to empty object when omitted (preventing circular import)', () => {
    const resOmitted = resolveAssignmentFormula({
      formulaStr: '5音*1',
      title: '音樂科任',
      classes: [{ name: '5年1班', grade: 5, course_requirements: [{ subject: '音樂', periods: 1 }] }],
    })
    expect(resOmitted.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'blocker', code: 'unknown-subject-code' }),
      ])
    )

    const resExplicit = resolveAssignmentFormula({
      formulaStr: '5音*1',
      title: '音樂科任',
      codeMappings: { 音: '音樂' },
      classes: [{ name: '5年1班', grade: 5, course_requirements: [{ subject: '音樂', periods: 1 }] }],
    })
    expect(resExplicit.diagnostics.filter((d) => d.severity === 'blocker')).toHaveLength(0)
    expect(resExplicit.rules[0].subject).toBe('音樂')
  })

  it('17. returns blocker adjusted-periods-teacher-required even when formula explicitly names unassigned individually adjusted class (e.g. 305美+3美*1)', () => {
    const classes = [
      ...Array.from({ length: 10 }, (_, i) => {
        const classNum = i + 1
        const name = `3年${classNum}班`
        if (classNum === 5) {
          return { name, grade: 3, course_requirements: [{ subject: '美勞', periods: 1, teacher: '', teacher_name: '' }] }
        }
        return { name, grade: 3, course_requirements: [{ subject: '美勞', periods: 1.5, teacher: '' }] }
      }),
    ]

    const res = resolveAssignmentFormula({
      formulaStr: '305美+3美*1',
      title: '美勞科任',
      codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
      classes,
    })

    const blockers = res.diagnostics.filter((d) => d.severity === 'blocker')
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toMatchObject({
      code: 'adjusted-periods-teacher-required',
    })
    expect(blockers[0].message).toContain('3年5班')
    expect(blockers[0].message).toContain('美勞')
    expect(blockers[0].message).toContain('1')
    expect(blockers[0].message).toContain('請先指定老師後再匯入')
  })
})
