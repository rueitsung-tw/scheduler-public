/**
 * 職稱與 Excel 科目代碼對照表（封閉 mapping，不從教師姓名猜測）
 */
const TITLE_SUBJECT_KEYWORD_MAP = [
  { keyword: '自然', excelCode: '自' },
  { keyword: '音樂', excelCode: '音' },
  { keyword: '美勞', excelCode: '美' },
  { keyword: '英語', excelCode: '英' },
  { keyword: '體育', excelCode: '體' },
  { keyword: '健康', excelCode: '健' },
  { keyword: '社會', excelCode: '社' },
  { keyword: '資訊', excelCode: '電' },
  { keyword: '閩語', excelCode: '本' },
]

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
 * 從職稱中推導科目 Excel 代碼（必須剛好 1 個關鍵字命中，0 個或 2 個以上皆 fail closed）
 */
function inferExcelCodeFromTitle(title) {
  if (!title || typeof title !== 'string') {
    return { excelCode: null, matches: [] }
  }
  const matches = TITLE_SUBJECT_KEYWORD_MAP.filter((item) => title.includes(item.keyword))
  if (matches.length === 1) {
    return { excelCode: matches[0].excelCode, matches }
  }
  return { excelCode: null, matches }
}

/**
 * 檢查課程需求是否已指定教師 (teacher 或 teacher_name 非空白)
 */
function hasAssignedTeacher(requirement) {
  if (!requirement) return false
  const teacher = String(requirement.teacher || '').trim()
  const teacherName = String(requirement.teacher_name || '').trim()
  return Boolean(teacher || teacherName)
}

/**
 * 計算特定年級與科目正數節數的基準（唯一眾數）
 *
 * @param {Array} classesInGrade
 * @param {string} systemSubject
 * @returns {{ baselinePeriods: number|null, ambiguous: boolean, hasPositiveCourses: boolean }}
 */
function getPeriodBaseline(classesInGrade = [], systemSubject = '') {
  const counts = new Map()
  for (const c of classesInGrade) {
    const req = (c.course_requirements || []).find(
      (r) => (r.systemSubject || r.subject) === systemSubject
    )
    if (req && Number(req.periods) > 0) {
      const p = Number(req.periods)
      counts.set(p, (counts.get(p) || 0) + 1)
    }
  }

  if (counts.size === 0) {
    return { baselinePeriods: null, ambiguous: false, hasPositiveCourses: false }
  }

  let maxCount = 0
  for (const count of counts.values()) {
    if (count > maxCount) {
      maxCount = count
    }
  }

  const modes = []
  for (const [period, count] of counts.entries()) {
    if (count === maxCount) {
      modes.push(period)
    }
  }

  if (modes.length > 1) {
    return { baselinePeriods: null, ambiguous: true, hasPositiveCourses: true }
  }

  return { baselinePeriods: modes[0], ambiguous: false, hasPositiveCourses: true }
}

/**
 * 判定課程需求是否為個別調整節數（正數節數與基準節數不同）
 */
function isIndividuallyAdjusted(requirement, baselinePeriods) {
  if (!requirement || baselinePeriods == null) return false
  const p = Number(requirement.periods)
  if (isNaN(p) || p <= 0) return false
  return p !== baselinePeriods
}

/**
 * 依據 3 位數班級代碼 (如 505, 608) 比對系統班級
 */
function findClassByCode(classes = [], classCodeStr = '') {
  if (!classCodeStr || classCodeStr.length !== 3) return null
  const grade = parseInt(classCodeStr[0], 10)
  const classNum = parseInt(classCodeStr.slice(1), 10)

  const candidate1 = `${grade}年${classNum}班`
  const candidate2 = `${grade}年${String(classNum).padStart(2, '0')}班`
  const candidate3 = `${classCodeStr}班`
  const candidate4 = classCodeStr

  return classes.find((c) => {
    if (Number(c.grade) !== grade) return false
    const name = String(c.name || '').trim()
    return name === candidate1 || name === candidate2 || name === candidate3 || name === candidate4
  })
}

/**
 * 解析與驗證特別配課公式（純運算解析器，不更改系統班級課程設定）
 *
 * @param {Object} params
 * @param {string} params.formulaStr 配課公式字串
 * @param {string} [params.title] 教師職稱
 * @param {Object} [params.codeMappings] 科目代碼對照表 (預設為空物件 `{}`)
 * @param {Array} [params.classes] 班級與課程需求清單
 * @returns {{ rules: Array, totalPeriods: number, diagnostics: Array, normalizedFormula: string }}
 */
export function resolveAssignmentFormula({
  formulaStr = '',
  title = '',
  codeMappings = {},
  classes = [],
  currentTeacherId = null,
  currentTeacherName = '',
} = {}) {
  const diagnostics = []
  const rules = []
  let totalPeriods = 0

  const norm = normalizeFullWidth(formulaStr)
  if (!norm || norm === '-') {
    return {
      rules: [],
      totalPeriods: 0,
      diagnostics: [],
      normalizedFormula: norm,
    }
  }

  const rawTerms = norm.split('+').filter(Boolean)
  const normalizedTermParts = []
  const tokenDescriptors = []

  for (let i = 0; i < rawTerms.length; i++) {
    let term = rawTerms[i]

    // 接受已知誤字轉換 (如 3建1 -> 3健*1) 並發出警告
    const typoMatch = term.match(/^(\d+)建(\d+)$/)
    if (typoMatch) {
      const gradeNum = typoMatch[1]
      const classCountNum = typoMatch[2]
      const replacement = `${gradeNum}健*${classCountNum}`
      diagnostics.push({
        severity: 'warning',
        code: 'typo-corrected',
        message: `配課式「${term}」包含已知誤字「建」，已自動修正為「${replacement}」`,
        originalToken: rawTerms[i],
        replacementToken: replacement,
      })
      term = replacement
    }
    normalizedTermParts.push(term)

    const gradeBatchMatch = term.match(/^([1-6])([^\d*+]+)\*(\d+)$/)
    const classSpecificExplicitMatch = term.match(/^([1-6]\d{2})([^\d*+]+)$/)
    const classSpecificBareMatch = term.match(/^([1-6]\d{2})$/)
    const allEligibleMatch = term.match(/^([1-6])([^\d*+]+)$/)

    if (gradeBatchMatch) {
      tokenDescriptors.push({
        index: i,
        rawTerm: rawTerms[i],
        term,
        kind: 'grade-batch',
        grade: parseInt(gradeBatchMatch[1], 10),
        excelCode: gradeBatchMatch[2].trim(),
        classCount: parseInt(gradeBatchMatch[3], 10),
      })
    } else if (classSpecificExplicitMatch) {
      tokenDescriptors.push({
        index: i,
        rawTerm: rawTerms[i],
        term,
        kind: 'class-specific-explicit',
        classCodeStr: classSpecificExplicitMatch[1],
        excelCode: classSpecificExplicitMatch[2].trim(),
        grade: parseInt(classSpecificExplicitMatch[1][0], 10),
      })
    } else if (classSpecificBareMatch) {
      tokenDescriptors.push({
        index: i,
        rawTerm: rawTerms[i],
        term,
        kind: 'class-specific-bare',
        classCodeStr: classSpecificBareMatch[1],
        grade: parseInt(classSpecificBareMatch[1][0], 10),
      })
    } else if (allEligibleMatch) {
      tokenDescriptors.push({
        index: i,
        rawTerm: rawTerms[i],
        term,
        kind: 'all-eligible',
        grade: parseInt(allEligibleMatch[1], 10),
        excelCode: allEligibleMatch[2].trim(),
      })
    } else {
      diagnostics.push({
        severity: 'blocker',
        code: 'invalid-formula-syntax',
        message: `配課式格式不合法「${term}」`,
        originalToken: rawTerms[i],
      })
    }
  }

  // Key: `${grade}_${systemSubject}` -> Set of reserved class names
  const reservedClassesMap = new Map()
  const tokenResults = new Array(tokenDescriptors.length)
  const reportedDiagnosticKeys = new Set()

  // Pass 1: Identify and resolve explicit/bare class-specific targets first
  for (let i = 0; i < tokenDescriptors.length; i++) {
    const desc = tokenDescriptors[i]
    if (desc.kind !== 'class-specific-explicit' && desc.kind !== 'class-specific-bare') {
      continue
    }

    let excelCode = desc.excelCode
    if (desc.kind === 'class-specific-bare') {
      const { excelCode: inferredCode, matches } = inferExcelCodeFromTitle(title)
      if (matches.length === 0) {
        diagnostics.push({
          severity: 'blocker',
          code: 'ambiguous-title-subject',
          message: `職稱「${title}」未包含可辨識之科目關鍵字，無法為班級代碼「${desc.classCodeStr}」推導科目`,
          originalToken: desc.rawTerm,
        })
        continue
      }
      if (matches.length > 1) {
        diagnostics.push({
          severity: 'blocker',
          code: 'ambiguous-title-subject',
          message: `職稱「${title}」包含多個科目關鍵字，無法唯一為班級代碼「${desc.classCodeStr}」推導科目`,
          originalToken: desc.rawTerm,
        })
        continue
      }
      excelCode = inferredCode
    }

    const systemSubject = codeMappings[excelCode]
    if (!systemSubject) {
      diagnostics.push({
        severity: 'blocker',
        code: 'unknown-subject-code',
        message: desc.kind === 'class-specific-bare'
          ? `推導之科目代碼「${excelCode}」尚未建立對照`
          : `未知科目代碼「${excelCode}」`,
        originalToken: desc.rawTerm,
      })
      continue
    }

    const targetClass = findClassByCode(classes, desc.classCodeStr)
    if (!targetClass) {
      diagnostics.push({
        severity: 'blocker',
        code: 'missing-class-course',
        message: `系統找不到班級代碼「${desc.classCodeStr}」對應的班級`,
        originalToken: desc.rawTerm,
      })
      continue
    }

    const req = (targetClass.course_requirements || []).find(
      (r) => (r.systemSubject || r.subject) === systemSubject
    )

    if (!req || !Number(req.periods) || Number(req.periods) <= 0) {
      diagnostics.push({
        severity: 'blocker',
        code: 'missing-class-course',
        message: `班級「${targetClass.name}」未設定「${systemSubject}」課程需求或節數為 0`,
        originalToken: desc.rawTerm,
      })
      continue
    }

    const periodsPerClass = Number(req.periods)
    const periods = periodsPerClass

    const classesInGrade = classes.filter((c) => Number(c.grade) === desc.grade)
    const { baselinePeriods, ambiguous } = getPeriodBaseline(classesInGrade, systemSubject)
    const individuallyAdjusted = !ambiguous && baselinePeriods != null && isIndividuallyAdjusted(req, baselinePeriods)
    const resolvedTeacherName = String(currentTeacherName || '').trim()
    const resolvedTeacherId = currentTeacherId ?? null
    const homeroomTeacherName = String(targetClass.homeroom_teacher || '').trim()

    const teacherResolution = individuallyAdjusted && resolvedTeacherName
      ? {
          resolvedTeacherId,
          resolvedTeacherName,
          teacherSource: 'excel-explicit',
        }
      : individuallyAdjusted && req.defaultTeacher === 'homeroom' && homeroomTeacherName
        ? {
            resolvedTeacherId: null,
            resolvedTeacherName: homeroomTeacherName,
            teacherSource: 'homeroom-default',
          }
        : {}

    tokenResults[i] = {
      rule: {
        grade: desc.grade,
        excelCode,
        subject: systemSubject,
        systemSubject,
        periods,
        sourceKind: 'class-specific',
        classCount: 1,
        periodsPerClass,
        targetClassNames: [targetClass.name],
        ...teacherResolution,
      },
    }

    const key = `${desc.grade}_${systemSubject}`
    if (!reservedClassesMap.has(key)) {
      reservedClassesMap.set(key, new Set())
    }
    reservedClassesMap.get(key).add(targetClass.name)
  }

  // Pre-check: 對所有引用的年級與科目，檢查基準唯一性與個別調整未指定教師 blocker
  for (let i = 0; i < tokenDescriptors.length; i++) {
    const desc = tokenDescriptors[i]
    let excelCode = desc.excelCode
    if (desc.kind === 'class-specific-bare') {
      const { excelCode: inferredCode, matches } = inferExcelCodeFromTitle(title)
      if (matches.length === 1) {
        excelCode = inferredCode
      } else {
        continue
      }
    }
    if (!excelCode) continue

    const systemSubject = codeMappings[excelCode]
    if (!systemSubject) continue

    const grade = desc.grade
    const key = `${grade}_${systemSubject}`
    const classesInGrade = classes.filter((c) => Number(c.grade) === grade)
    if (classesInGrade.length === 0) continue

    const { baselinePeriods, ambiguous } = getPeriodBaseline(classesInGrade, systemSubject)
    if (ambiguous) {
      const diagKey = `ambiguous_${key}`
      if (!reportedDiagnosticKeys.has(diagKey)) {
        reportedDiagnosticKeys.add(diagKey)
        diagnostics.push({
          severity: 'blocker',
          code: 'ambiguous-baseline-periods',
          message: `系統 ${grade} 年級科目「${systemSubject}」每班節數無唯一眾數（最高出現次數並列），無法自動判斷基準節數；請先於班級課程列表確認各班節數與教師設定`,
          originalToken: desc.rawTerm,
        })
      }
    } else if (baselinePeriods != null) {
      for (const c of classesInGrade) {
        const req = (c.course_requirements || []).find(
          (r) => (r.systemSubject || r.subject) === systemSubject
        )
        if (req && Number(req.periods) > 0 && isIndividuallyAdjusted(req, baselinePeriods)) {
          const explicitRule = tokenResults.find((result) => (
            result?.rule?.grade === grade &&
            result.rule.systemSubject === systemSubject &&
            result.rule.targetClassNames?.includes(c.name) &&
            result.rule.teacherSource
          ))
          const hasHomeroomDefaultSource = req.defaultTeacher === 'homeroom' && String(c.homeroom_teacher || '').trim()

          // 個別調整班級必須有既有教師、Excel 明示教師，或可推導的班導來源。
          if (!hasAssignedTeacher(req) && !explicitRule && !hasHomeroomDefaultSource) {
            const diagKey = `adjusted_no_teacher_${key}_${c.name}`
            if (!reportedDiagnosticKeys.has(diagKey)) {
              reportedDiagnosticKeys.add(diagKey)
              diagnostics.push({
                severity: 'blocker',
                code: 'adjusted-periods-teacher-required',
                message: `班級「${c.name}」科目「${systemSubject}」的每週節數已個別調整為 ${req.periods} 節，但尚未於班級課程列表指定授課老師；請先指定老師後再匯入。`,
                originalToken: desc.rawTerm,
              })
            }
          }
        }
      }
    }
  }

  // Pass 2: Grade-batch and All-eligible tokens using remaining eligible unreserved candidates
  for (let i = 0; i < tokenDescriptors.length; i++) {
    const desc = tokenDescriptors[i]
    if (desc.kind !== 'grade-batch' && desc.kind !== 'all-eligible') {
      continue
    }

    const excelCode = desc.excelCode
    const systemSubject = codeMappings[excelCode]

    if (!systemSubject) {
      diagnostics.push({
        severity: 'blocker',
        code: 'unknown-subject-code',
        message: `未知科目代碼「${excelCode}」`,
        originalToken: desc.rawTerm,
      })
      continue
    }

    const classesInGrade = classes.filter((c) => Number(c.grade) === desc.grade)
    if (classesInGrade.length === 0) {
      diagnostics.push({
        severity: 'blocker',
        code: 'missing-class-course',
        message: `系統未設定 ${desc.grade} 年級的班級資料`,
        originalToken: desc.rawTerm,
      })
      continue
    }

    const key = `${desc.grade}_${systemSubject}`
    const { baselinePeriods, ambiguous } = getPeriodBaseline(classesInGrade, systemSubject)

    // 若基準模稜兩可，前置檢查已發出 blocker，此處略過後續處理
    if (ambiguous) {
      continue
    }

    const reservedSet = reservedClassesMap.get(key) || new Set()

    // 若有未指定教師的個別調整班級，前置檢查已發出 blocker，此處略過後續處理避免產生混淆訊息
    const hasUnassignedAdjusted = classesInGrade.some((c) => {
      const req = (c.course_requirements || []).find(
        (r) => (r.systemSubject || r.subject) === systemSubject
      )
      const explicitRule = tokenResults.find((result) => (
        result?.rule?.grade === desc.grade &&
        result.rule.systemSubject === systemSubject &&
        result.rule.targetClassNames?.includes(c.name) &&
        result.rule.teacherSource
      ))
      const hasHomeroomDefaultSource = req?.defaultTeacher === 'homeroom' && String(c.homeroom_teacher || '').trim()
      return (
        req &&
        Number(req.periods) > 0 &&
        isIndividuallyAdjusted(req, baselinePeriods) &&
        !hasAssignedTeacher(req) &&
        !explicitRule &&
        !hasHomeroomDefaultSource
      )
    })
    if (hasUnassignedAdjusted) {
      continue
    }

    if (desc.kind === 'grade-batch') {
      const remainingCandidates = classesInGrade.filter((c) => {
        if (reservedSet.has(c.name)) return false
        const req = (c.course_requirements || []).find(
          (r) => (r.systemSubject || r.subject) === systemSubject
        )
        if (!req || Number(req.periods) <= 0) return false
        // 個別調整節數班級一律不交由年級批次規則選取。
        if (isIndividuallyAdjusted(req, baselinePeriods)) {
          return false
        }
        return true
      })

      if (remainingCandidates.length === 0) {
        diagnostics.push({
          severity: 'blocker',
          code: 'missing-class-course',
          message: `系統未設定 ${desc.grade} 年級科目「${systemSubject}」的每班節數`,
          originalToken: desc.rawTerm,
        })
        continue
      }

      if (desc.classCount > remainingCandidates.length) {
        diagnostics.push({
          severity: 'blocker',
          code: 'class-count-mismatch',
          message: `${desc.grade} 年級科目「${systemSubject}」填寫 ${desc.classCount} 個班，但系統僅有 ${remainingCandidates.length} 個班`,
          originalToken: desc.rawTerm,
        })
        continue
      }

      const candidateReqs = remainingCandidates.map((c) =>
        (c.course_requirements || []).find(
          (r) => (r.systemSubject || r.subject) === systemSubject
        )
      )
      const periodValues = [...new Set(candidateReqs.map((r) => Number(r.periods)))]

      if (periodValues.length > 1) {
        diagnostics.push({
          severity: 'blocker',
          code: 'inconsistent-periods',
          message: `系統 ${desc.grade} 年級科目「${systemSubject}」的每班節數設定不一致`,
          originalToken: desc.rawTerm,
        })
        continue
      }

      const periodsPerClass = periodValues[0]
      const periods = periodsPerClass * desc.classCount
      const candidateClassNames = remainingCandidates.map((c) => c.name)

      tokenResults[i] = {
        rule: {
          grade: desc.grade,
          excelCode,
          subject: systemSubject,
          systemSubject,
          periods,
          sourceKind: 'grade-batch',
          classCount: desc.classCount,
          periodsPerClass,
          candidateClassNames,
          targetClassNames: [],
        },
      }
    } else if (desc.kind === 'all-eligible') {
      const eligibleClasses = classesInGrade.filter((c) => {
        if (reservedSet.has(c.name)) return false
        const req = (c.course_requirements || []).find(
          (r) => (r.systemSubject || r.subject) === systemSubject
        )
        if (!req || Number(req.periods) <= 0) return false
        // 個別調整節數班級一律不交由年級批次規則選取。
        if (isIndividuallyAdjusted(req, baselinePeriods)) {
          return false
        }
        return true
      })

      if (eligibleClasses.length === 0) {
        diagnostics.push({
          severity: 'blocker',
          code: 'missing-class-course',
          message: `${desc.grade} 年級無任何班級設定「${systemSubject}」課程需求`,
          originalToken: desc.rawTerm,
        })
        continue
      }

      const reqs = eligibleClasses.map((c) =>
        (c.course_requirements || []).find(
          (r) => (r.systemSubject || r.subject) === systemSubject
        )
      )

      const periodValues = [...new Set(reqs.map((r) => Number(r.periods)))]
      const periodsPerClass = periodValues.length === 1 ? periodValues[0] : null
      const classCount = eligibleClasses.length
      const periods = reqs.reduce((sum, r) => sum + Number(r.periods), 0)
      const targetClassNames = eligibleClasses.map((c) => c.name)

      tokenResults[i] = {
        rule: {
          grade: desc.grade,
          excelCode,
          subject: systemSubject,
          systemSubject,
          periods,
          sourceKind: 'all-eligible',
          classCount,
          periodsPerClass,
          targetClassNames,
        },
      }
    }
  }

  for (let i = 0; i < tokenResults.length; i++) {
    if (tokenResults[i] && tokenResults[i].rule) {
      rules.push(tokenResults[i].rule)
      totalPeriods += tokenResults[i].rule.periods
    }
  }

  totalPeriods = Math.round(totalPeriods * 1000) / 1000

  return {
    rules,
    totalPeriods,
    diagnostics,
    normalizedFormula: normalizedTermParts.join('+'),
  }
}
