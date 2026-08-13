import * as XLSX from 'xlsx'
import { isSubjectApplicableToGrade } from './gradeSubjectUtils.js'
import { resolveAssignmentFormula } from './subjectAssignmentFormulaResolver.js'

/**
 * 全校預設科目與 Excel 代碼對照表
 */
export const DEFAULT_SUBJECT_CODE_MAPPINGS = {
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

/**
 * 全角字元與符號正規化
 */
function normalizeFullWidth(str) {
  if (!str) return ''
  return String(str)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/✕|×/g, '*')
    .replace(/＋/g, '+')
    .replace(/＊/g, '*')
    .replace(/\s+/g, '')
}

/**
 * 解析單一教師的配課公式 (例如: 5電*7+3電*10)。
 * 「*」後的數字是班級數；實際節數由每班科目節數乘上班級數。
 *
 * @param {string} formulaStr
 * @param {Object} codeMappings
 * @returns {{ valid: boolean, rules: Array, totalPeriods: number, errors: Array<string>, unknownCodes: Array<string> }}
 */
export function parseAssignmentFormula(
  formulaStr,
  codeMappings = DEFAULT_SUBJECT_CODE_MAPPINGS,
  resolvePeriodsPerClass = () => 1,
) {
  const norm = normalizeFullWidth(formulaStr)
  if (!norm) {
    return { valid: false, rules: [], totalPeriods: 0, errors: ['配課公式空白'], unknownCodes: [] }
  }

  const terms = norm.split('+').filter(Boolean)
  const rules = []
  const errors = []
  const unknownCodes = []
  let totalPeriods = 0

  for (const term of terms) {
    // 小數點檢查
    if (term.includes('.')) {
      errors.push(`配課節數必須為正整數，不可使用小數「${term}」`)
      continue
    }

    // 正則匹配: <年級><代碼>*<班級數> (年級必須 1-6，班級數為正整數)
    const match = term.match(/^(\d+)([^\d*+]+)\*(\d+)$/)
    if (!match) {
      errors.push(`配課式格式不合法「${term}」，應為「<年級><科目代碼>*<班級數>」`)
      continue
    }

    const grade = parseInt(match[1], 10)
    const excelCode = match[2].trim()
    const classCount = parseInt(match[3], 10)

    if (grade < 1 || grade > 6) {
      errors.push(`年級「${grade}」超出合法範圍 (1-6 年級)`)
      continue
    }

    if (isNaN(classCount) || classCount <= 0) {
      errors.push(`配課班級數必須為大於 0 之正整數「${term}」`)
      continue
    }

    const systemSubject = codeMappings[excelCode]
    if (!systemSubject) {
      if (!unknownCodes.includes(excelCode)) {
        unknownCodes.push(excelCode)
      }
      errors.push(`未知科目代碼「${excelCode}」`)
      continue
    }

    const resolved = resolvePeriodsPerClass({ grade, excelCode, systemSubject, classCount })
    let periodsPerClass = 0
    let periodsErr = null

    if (typeof resolved === 'number') {
      periodsPerClass = resolved
    } else if (resolved && typeof resolved === 'object') {
      if (resolved.valid) {
        periodsPerClass = Number(resolved.periodsPerClass)
      } else {
        periodsErr = resolved.cause
      }
    }

    if (!Number.isInteger(periodsPerClass) || periodsPerClass <= 0) {
      errors.push(periodsErr || `系統未設定 ${grade} 年級科目「${systemSubject || excelCode}」的每班節數，無法計算「${term}」`)
      continue
    }

    const periods = periodsPerClass * classCount
    rules.push({
      grade,
      excelCode,
      systemSubject: systemSubject || '',
      classCount,
      periodsPerClass,
      periods,
    })
    totalPeriods += periods
  }

  const valid = errors.length === 0
  return { valid, rules, totalPeriods, errors, unknownCodes }
}

function getSubjectPeriodsPerClass(existingClasses, grade, subject, schoolInfo = null, standardDomainSettings = null) {
  if (subject && !isSubjectApplicableToGrade(subject, grade, schoolInfo, standardDomainSettings)) {
    return { valid: false, cause: `科目「${subject}」不適用於 ${grade} 年級` }
  }

  const classesInGrade = existingClasses.filter((c) => Number(c.grade) === grade)
  if (classesInGrade.length === 0) {
    return { valid: false, cause: `系統未設定 ${grade} 年級的班級資料` }
  }

  const requirements = classesInGrade.map((c) =>
    (c.course_requirements || []).find((r) => (r.systemSubject || r.subject) === subject)
  )

  if (requirements.some((r) => !r || !Number.isInteger(Number(r.periods)) || Number(r.periods) <= 0)) {
    return { valid: false, cause: `系統未設定 ${grade} 年級科目「${subject}」的每班節數` }
  }

  const periodValues = [...new Set(requirements.map((r) => Number(r.periods)))]
  if (periodValues.length > 1) {
    return { valid: false, cause: `系統 ${grade} 年級各班科目「${subject}」的每班節數設定不一致` }
  }

  return { valid: true, periodsPerClass: periodValues[0] }
}

function teacherHasExistingAssignments(teacher, existingClasses) {
  if (Number(teacher?.max_periods) > 0) return true
  if ((teacher?.assignment_rules || []).length > 0) return true
  if ((teacher?.expertise_allocations || []).some((item) => Number(item?.quota) > 0)) return true
  return existingClasses.some((classItem) =>
    (classItem.course_requirements || []).some((requirement) => requirement.teacher === teacher?.name)
  )
}

/**
 * 驗證並解析 Excel 上傳檔案
 *
 * @param {Buffer|Uint8Array} fileBuffer
 * @param {Array} existingTeachers
 * @param {Array} existingClasses
 * @param {Object} codeMappings
 * @param {Object|null} schoolInfo
 * @param {Array|null} standardDomainSettings
 * @returns {{ success: boolean, rows: Array, errors: Array<{rowNumber: number, teacherName: string, rawFormula: string, cause: string, code: string|null}>, unknownCodes: Array<string>, correctionWarnings: Array }}
 */
export function validateAndParseExcelRows(
  fileBuffer,
  existingTeachers = [],
  existingClasses = [],
  codeMappings = DEFAULT_SUBJECT_CODE_MAPPINGS,
  schoolInfo = null,
  standardDomainSettings = null,
) {
  if (!fileBuffer) {
    return {
      success: false,
      rows: [],
      errors: [{ rowNumber: 1, teacherName: '', rawFormula: '', cause: '請提供有效的 Excel 檔案', code: null }],
      unknownCodes: [],
      correctionWarnings: [],
    }
  }

  let wb
  try {
    wb = XLSX.read(fileBuffer, { type: 'array' })
  } catch (err) {
    try {
      wb = XLSX.read(fileBuffer, { type: 'buffer' })
    } catch {
      return {
        success: false,
        rows: [],
        errors: [{ rowNumber: 1, teacherName: '', rawFormula: '', cause: `Excel 檔案讀取失敗: ${err.message}`, code: null }],
        unknownCodes: [],
        correctionWarnings: [],
      }
    }
  }

  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return {
      success: false,
      rows: [],
      errors: [{ rowNumber: 1, teacherName: '', rawFormula: '', cause: 'Excel 檔案內無工作表', code: null }],
      unknownCodes: [],
      correctionWarnings: [],
    }
  }

  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  if (!aoa || aoa.length === 0) {
    return {
      success: false,
      rows: [],
      errors: [{ rowNumber: 1, teacherName: '', rawFormula: '', cause: 'Excel 檔案內容為空', code: null }],
      unknownCodes: [],
      correctionWarnings: [],
    }
  }

  // 搜尋 Header 列 index (預設為第 2 列，即 index 1)
  let headerRowIdx = 1
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const row = aoa[i]
    if (!row || !Array.isArray(row)) continue
    const colA = String(row[0] || '').replace(/\s+/g, '')
    const colC = String(row[2] || '').replace(/\s+/g, '')
    const colD = String(row[3] || '').replace(/\s+/g, '')
    const colF = String(row[5] || '').replace(/\s+/g, '')
    if (colD === '姓名' || (colA === '編號' && colC === '職稱' && colF === '節數')) {
      headerRowIdx = i
      break
    }
  }

  const parsedRows = []
  const blockers = []
  const skippedRows = []
  const unassignedTeacherWarnings = []
  const correctionWarnings = []
  const allUnknownCodesSet = new Set()
  const seenTeachers = new Map() // teacherName -> firstRowNumber

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row || !Array.isArray(row)) continue

    const rowNumber = r + 1 // 1-based Excel row number
    const titleVal = String(row[2] || '').trim()
    const rawTeacherName = String(row[3] || '').trim()
    const rawFormula = String(row[4] || '').trim()
    const rawDeclaredTotal = row[5]

    // 完全空白列過濾
    if (!rawTeacherName && !rawFormula && (rawDeclaredTotal === '' || rawDeclaredTotal == null)) {
      continue
    }

    let hasRowError = false

    // 1. 姓名檢查
    if (!rawTeacherName) {
      blockers.push({
        rowNumber,
        teacherName: '',
        rawFormula,
        cause: `第 ${rowNumber} 列缺少教師姓名`,
        code: null,
      })
      hasRowError = true
      continue
    }

    // 2. 登錄教師與同名檢查
    const matchedTeachers = existingTeachers.filter((t) => t.name === rawTeacherName)
    if (matchedTeachers.length === 0) {
      blockers.push({
        rowNumber,
        teacherName: rawTeacherName,
        rawFormula,
        cause: `系統未登錄教師「${rawTeacherName}」`,
        code: null,
      })
      hasRowError = true
    } else if (matchedTeachers.length > 1) {
      blockers.push({
        rowNumber,
        teacherName: rawTeacherName,
        rawFormula,
        cause: `系統存在重複同名教師「${rawTeacherName}」，無法唯一對應`,
        code: null,
      })
      hasRowError = true
    }

    // 3. Excel 檔案內重複教師檢查
    if (seenTeachers.has(rawTeacherName)) {
      const prevRow = seenTeachers.get(rawTeacherName)
      blockers.push({
        rowNumber,
        teacherName: rawTeacherName,
        rawFormula,
        cause: `Excel 檔案中包含重複教師「${rawTeacherName}」（第 ${prevRow} 列與第 ${rowNumber} 列）`,
        code: null,
      })
      hasRowError = true
    } else {
      seenTeachers.set(rawTeacherName, rowNumber)
    }

    if (hasRowError) {
      continue
    }

    // 4. 「-」或空白代表此教師由其他流程配課；絕不以空規則覆寫。
    if (!rawFormula || normalizeFullWidth(rawFormula) === '-') {
      const teacher = matchedTeachers[0]
      if (teacher && teacherHasExistingAssignments(teacher, existingClasses)) {
        skippedRows.push({ rowNumber, teacherName: rawTeacherName, rawFormula: rawFormula || '-' })
      } else if (teacher) {
        unassignedTeacherWarnings.push({ rowNumber, teacherName: rawTeacherName, rawFormula: rawFormula || '-' })
      }
      continue
    } else {
      const normFormula = normalizeFullWidth(rawFormula)
      const terms = normFormula.split('+').filter(Boolean)
      for (const term of terms) {
        const match = term.match(/^([1-6])([^\d*+]+)/)
        if (match) {
          const g = parseInt(match[1], 10)
          const code = match[2].trim()
          const sysSubj = codeMappings[code]
          if (sysSubj && !isSubjectApplicableToGrade(sysSubj, g, schoolInfo, standardDomainSettings)) {
            blockers.push({
              rowNumber,
              teacherName: rawTeacherName,
              rawFormula,
              cause: `科目「${sysSubj}」不適用於 ${g} 年級`,
              code: null,
            })
            hasRowError = true
          }
        }
      }

      if (hasRowError) {
        continue
      }

      const resolved = resolveAssignmentFormula({
        formulaStr: rawFormula,
        title: titleVal,
        codeMappings,
        classes: existingClasses,
      })

      const { rules: formulaRules, totalPeriods, diagnostics } = resolved

      for (const diag of diagnostics) {
        if (diag.severity === 'warning') {
          correctionWarnings.push({
            rowNumber,
            teacherName: rawTeacherName,
            rawFormula,
            originalToken: diag.originalToken,
            replacementToken: diag.replacementToken,
            message: diag.message,
          })
        } else if (diag.severity === 'blocker') {
          let code = null
          if (diag.code === 'unknown-subject-code') {
            const match = diag.message.match(/(?:未知科目代碼|推導之科目代碼)「([^」]+)」/)
            if (match) {
              code = match[1]
              allUnknownCodesSet.add(code)
            }
          }
          blockers.push({
            rowNumber,
            teacherName: rawTeacherName,
            rawFormula,
            cause: diag.code === 'unknown-subject-code' && code
              ? `科目代碼「${code}」尚未建立對照，請先於設定中關聯`
              : diag.message,
            code,
          })
          hasRowError = true
        }
      }

      // Check grade subject applicability for each resolved rule
      for (const rule of formulaRules) {
        if (rule.subject && !isSubjectApplicableToGrade(rule.subject, rule.grade, schoolInfo, standardDomainSettings)) {
          blockers.push({
            rowNumber,
            teacherName: rawTeacherName,
            rawFormula,
            cause: `科目「${rule.subject}」不適用於 ${rule.grade} 年級`,
            code: null,
          })
          hasRowError = true
        }
      }


      // 5. 宣告總節數與計算加總比對 (僅在公式語法與權限無誤時比對)
      let declaredTotalVal = null
      if (rawDeclaredTotal !== '' && rawDeclaredTotal != null) {
        declaredTotalVal = Number(rawDeclaredTotal)
        if (!isNaN(declaredTotalVal) && !hasRowError && Math.abs(declaredTotalVal - totalPeriods) > 0.001) {
          blockers.push({
            rowNumber,
            teacherName: rawTeacherName,
            rawFormula,
            cause: `第 ${rowNumber} 列教師「${rawTeacherName}」宣告節數（${declaredTotalVal} 節）與公式計算總節數（${totalPeriods} 節）不符`,
            code: null,
          })
          hasRowError = true
        }
      }

      if (!hasRowError) {
        parsedRows.push({
          rowNumber,
          teacherName: rawTeacherName,
          teacherId: matchedTeachers[0]?.id ?? null,
          title: titleVal,
          rawFormula,
          declaredTotal: (declaredTotalVal != null && !isNaN(declaredTotalVal)) ? declaredTotalVal : totalPeriods,
          calculatedTotal: totalPeriods,
          rules: formulaRules,
        })
      }
    }
  }

  return {
    success: blockers.length === 0,
    rows: parsedRows,
    errors: blockers,
    unknownCodes: Array.from(allUnknownCodesSet),
    skippedRows,
    unassignedTeacherWarnings,
    correctionWarnings,
  }
}


/**
 * Formula Injection Boundary Documentation:
 * - Template generator ensures generated text cells are safely literal (prefixing apostrophe `'` if user-controlled label values start with formula triggers `=`, `+`, `-`, `@`).
 * - Real assignment formulas (e.g., "5電*7+3電*10") begin with digits (1-6) and are parsed as literal strings during import.
 * - The app does not export uploaded teacher fields; imported teacher names/titles are persisted as literal strings in memory/DB without applying blanket sanitizers that could break valid named data.
 */
function safeLiteralCell(val) {
  if (typeof val === 'string' && /^[=+\-@]/.test(val)) {
    return "'" + val
  }
  return val
}

/**
 * 產生去識別化之範例配課 Excel 檔案 Buffer
 *
 * @param {Array<Array>} [customRows] 可選之客製化範例列
 * @returns {Buffer}
 */
export function generateSubjectAssignmentTemplate(customRows) {
  const defaultRows = [
    ['科任／行政教師配課匯入範例（去識別化）', '', '', '', '', ''],
    ['填寫說明：特殊班級每週節數異動或刪除未開設科目（如無美勞）須先於「課程管理 → 班級課程列表」設定；Excel 僅分配教師，絕不變更課程與每班節數。', '', '', '', '', ''],
    ['配課式範例：標準年級批次如「6自*5」；全年級符合班級如「5美」；指定班級如「505音」；僅填班號如「505」限職稱可唯一推導科目（如音樂科任）。', '', '', '', '', ''],
    ['配課式填「-」或留白時，不覆寫該教師資料；節數欄為系統依班級課程算得之總節數。', '', '', '', '', ''],
    ['編號', '', '職    稱', '姓  名', '配課式', '節數'],
    [1, '專任', '科任教師', '張小華', '6自*5', 20],
    [2, '行政', '兼任教師', '李大同', '5美+505音', 11.5],
    [3, '導師', '級任教師', '陳美智', '-', ''],
  ]
  const rows = Array.isArray(customRows) ? customRows : defaultRows
  const safeRows = rows.map((row) =>
    Array.isArray(row) ? row.map(safeLiteralCell) : row
  )
  const ws = XLSX.utils.aoa_to_sheet(safeRows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '科任配課')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/**
 * 依據配課規則陣列衍生相關相容與統計欄位 (assignment_rules, expertise_allocations, expertiseSubjects, gradePreferences, max_periods)
 *
 * @param {Array} rules
 * @returns {{ assignment_rules: Array, expertise_allocations: Array, expertiseSubjects: Array, gradePreferences: Array, max_periods: number }}
 */
export function deriveTeacherFieldsFromRules(rules = []) {
  const assignment_rules = rules.map((r) => ({
    grade: Number(r.grade),
    subject: r.systemSubject || r.subject || '',
    periods: Number(r.periods),
    excelCode: r.excelCode || '',
    classCount: Number(r.classCount || 0),
    periodsPerClass: Number(r.periodsPerClass || 0),
  }))

  const quotaMap = new Map()
  let max_periods = 0
  const gradesSet = new Set()

  for (const r of assignment_rules) {
    if (r.subject) {
      quotaMap.set(r.subject, (quotaMap.get(r.subject) || 0) + r.periods)
    }
    max_periods += r.periods
    if (r.grade) {
      gradesSet.add(r.grade)
    }
  }

  const expertise_allocations = Array.from(quotaMap.entries()).map(([subject, quota]) => ({
    subject,
    quota,
  }))
  const expertiseSubjects = Array.from(quotaMap.keys())
  const gradePreferences = Array.from(gradesSet).sort((a, b) => a - b)

  return {
    assignment_rules,
    expertise_allocations,
    expertiseSubjects,
    gradePreferences,
    max_periods,
  }
}

/**
 * 比對舊有教師資料與 Excel 匯入配課規則之差異 (assignment_rules, expertise_allocations, gradePreferences, max_periods)
 *
 * @param {Array} parsedRows
 * @param {Array} existingTeachers
 * @returns {Array<{ teacherId: number|string|null, teacherName: string, teacherType: string, isHomeroom: boolean, hasChanges: boolean, old: Object, imported: Object, diffs: Object }>}
 */
function normalizeRulesForComparison(rules = []) {
  return rules.map((r) => ({
    grade: Number(r.grade),
    subject: String(r.subject || r.systemSubject || '').trim(),
    periods: Number(r.periods),
    excelCode: String(r.excelCode || '').trim(),
  }))
}

export function buildDiffComparison(parsedRows = [], existingTeachers = []) {
  const teacherMap = new Map()
  for (const t of existingTeachers) {
    if (t.id != null) teacherMap.set(String(t.id), t)
    if (t.name) teacherMap.set(t.name, t)
  }

  const results = []

  for (const row of parsedRows) {
    const existing = teacherMap.get(String(row.teacherId)) ?? teacherMap.get(row.teacherName)
    const derived = deriveTeacherFieldsFromRules(row.rules)

    const oldRules = existing?.assignment_rules || []
    const oldAllocations = existing?.expertise_allocations || []
    const oldGradePrefs = existing?.gradePreferences || []
    const oldMaxPeriods = existing?.max_periods != null ? existing.max_periods : 0

    const isRulesChanged = JSON.stringify(normalizeRulesForComparison(oldRules)) !== JSON.stringify(normalizeRulesForComparison(derived.assignment_rules))
    const isAllocationsChanged = JSON.stringify(oldAllocations) !== JSON.stringify(derived.expertise_allocations)
    const isGradePrefsChanged = JSON.stringify(oldGradePrefs) !== JSON.stringify(derived.gradePreferences)
    const isMaxPeriodsChanged = oldMaxPeriods !== derived.max_periods

    const hasChanges = isRulesChanged || isAllocationsChanged || isGradePrefsChanged || isMaxPeriodsChanged

    results.push({
      teacherId: existing?.id ?? row.teacherId ?? null,
      teacherName: row.teacherName,
      teacherType: existing?.type || 'subject',
      isHomeroom: existing?.type === 'homeroom',
      hasChanges,
      old: {
        assignment_rules: oldRules,
        expertise_allocations: oldAllocations,
        gradePreferences: oldGradePrefs,
        max_periods: oldMaxPeriods,
      },
      imported: {
        assignment_rules: derived.assignment_rules,
        expertise_allocations: derived.expertise_allocations,
        gradePreferences: derived.gradePreferences,
        max_periods: derived.max_periods,
      },
      diffs: {
        assignment_rules: isRulesChanged,
        expertise_allocations: isAllocationsChanged,
        gradePreferences: isGradePrefsChanged,
        max_periods: isMaxPeriodsChanged,
      },
    })
  }

  return results
}

/**
 * 嚴格受控邊界轉換器：僅將 permit 欄位寫入教師物件，並嚴格保護 name, type (homeroom retain), assignedClass, google_account, reduction, overtime, unavailable_slots 等非匯入欄位
 *
 * @param {Array} parsedRows
 * @param {Array} existingTeachers
 * @param {Array<number|string>} confirmedHomeroomTeacherIds
 * @returns {Array} 轉換後的教師陣列 (純轉換器不直接突變輸入)
 */
export function applyImportToTeachers(
  parsedRows = [],
  existingTeachers = [],
  confirmedHomeroomTeacherIds = [],
) {
  const rowMap = new Map()
  for (const row of parsedRows) {
    if (row.teacherId != null) {
      rowMap.set(String(row.teacherId), row)
    }
    if (row.teacherName) {
      rowMap.set(row.teacherName, row)
    }
  }

  return existingTeachers.map((teacher) => {
    const matchedRow = rowMap.get(String(teacher.id)) ?? rowMap.get(teacher.name)
    if (!matchedRow) {
      return { ...teacher }
    }

    const isHomeroom = teacher.type === 'homeroom'
    const isConfirmedHomeroom =
      confirmedHomeroomTeacherIds.includes(teacher.id) ||
      confirmedHomeroomTeacherIds.includes(teacher.name)

    if (isHomeroom && !isConfirmedHomeroom) {
      // 導師尚未通過 confirmation gate 授權時，絕不更新其科任配課規則
      return { ...teacher }
    }

    const derived = deriveTeacherFieldsFromRules(matchedRow.rules)

    // 嚴格保留所有受保護欄位，絕不改動 name, type, assignedClass, google_account, reduction, overtime, unavailable_slots...
    return {
      ...teacher,
      type: teacher.type, // 導師 100% 保持 'homeroom'，純轉換器絕不改寫為 'subject'
      assignment_rules: derived.assignment_rules,
      expertise_allocations: derived.expertise_allocations,
      expertiseSubjects: derived.expertiseSubjects,
      gradePreferences: derived.gradePreferences,
      max_periods: derived.max_periods,
    }
  })
}
