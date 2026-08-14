import { isSubjectApplicableToGrade } from './gradeSubjectUtils'

/**
 * 💡 提取班級年級的穩健函式
 */
export function getGradeFromClassName(className, gradeAttr = null) {
  if (typeof gradeAttr === 'number' && gradeAttr > 0) return gradeAttr
  const match = String(className || '').match(/(\d+)\s*(年|grade)/i) || String(className || '').match(/^(\d)/)
  return match ? parseInt(match[1], 10) : 1
}

/**
 * 💡 科目名稱模糊/標準比對
 */
export function isSubjectMatch(reqSub, ruleSub) {
  if (!reqSub || !ruleSub) return false
  const cleanReq = String(reqSub).replace(/["']/g, '').trim()
  const cleanRule = String(ruleSub).replace(/["']/g, '').trim()
  if (cleanReq === cleanRule) return true

  const reqParts = cleanReq.split(/[、,,/]/).map(s => s.trim()).filter(Boolean)
  const ruleParts = cleanRule.split(/[、,,/]/).map(s => s.trim()).filter(Boolean)
  return reqParts.some(r => ruleParts.some(t => r.includes(t) || t.includes(r)))
}

/**
 * 從一般 Excel 物化輸入排除已由混合配課決議處理的年級＋科目。
 * 保留教師完整規則供 store 儲存；此函式只產生一般物化器使用的不可變副本。
 */
export function filterRulesForImportedMaterialization(teachers = [], resolutions = []) {
  const mixedPairs = resolutions
    .filter((item) => item?.resolution && Array.isArray(item.resolution.assignments))
    .map((item) => ({
      grade: Number(item.grade),
      subject: String(item.subject || item.resolution.subject || '').trim(),
    }))
    .filter((pair) => pair.grade > 0 && pair.subject)

  return teachers.map((teacher) => ({
    ...teacher,
    assignment_rules: Array.isArray(teacher.assignment_rules)
      ? teacher.assignment_rules.filter((rule) => !mixedPairs.some(
        (pair) => Number(rule.grade) === pair.grade && isSubjectMatch(rule.subject, pair.subject)
      ))
      : [],
  }))
}

/**
 * 🛡️ 檢查教師是否符合 assignment_rules 配課資格
 * - subject 與 admin 預設符合
 * - homeroom 教師若已有持久化的 non-empty assignment_rules（由匯入關口寫入），或帶有確認狀態，即視為耐久確認 (Durable Confirmation)
 */
export function isTeacherEligibleForRules(t, confirmedHomeroomTeacherIds = []) {
  if (!t) return false
  if (t.type === 'subject' || t.type === 'admin') return true
  if (t.type === 'homeroom') {
    const hasRules = Array.isArray(t.assignment_rules) && t.assignment_rules.length > 0
    const isConfirmedFlag = Boolean(t.confirmedHomeroomAssignment)
    const isIdConfirmed = Array.isArray(confirmedHomeroomTeacherIds) && (
      confirmedHomeroomTeacherIds.includes(t.id) || confirmedHomeroomTeacherIds.includes(t.name)
    )
    return hasRules || isConfirmedFlag || isIdConfirmed
  }
  return false
}

/**
 * 💡 Pre-pass 拆分整合 (Idempotency Consolidation)
 * 掃描 classes，若包含由先前自動配課產生的 _split_ 拆分項，且該拆分項未手動鎖定/覆寫，
 * 將其重新合併為單一基底需求項目。
 */
export function consolidateSplitRequirements(classes, options = {}) {
  if (!Array.isArray(classes)) return

  const { targetBaseIds = null, targetPairs = null } = options || {}

  classes.forEach(cls => {
    if (!Array.isArray(cls.course_requirements)) return
    const clsGrade = getGradeFromClassName(cls.name, cls.grade)

    const newReqs = []
    const splitGroups = new Map() // baseId -> array of split chunks

    cls.course_requirements.forEach(req => {
      if (req.id && String(req.id).includes('_split_')) {
        const baseId = String(req.id).split('_split_')[0]
        if (!splitGroups.has(baseId)) {
          splitGroups.set(baseId, [])
        }
        splitGroups.get(baseId).push(req)
      } else {
        newReqs.push(req)
      }
    })

    splitGroups.forEach((chunks, baseId) => {
      // If targetBaseIds is specified, only consolidate baseIds in the set
      if (targetBaseIds instanceof Set && !targetBaseIds.has(baseId)) {
        newReqs.push(...chunks)
        return
      }

      // If targetPairs is specified, only consolidate if chunk subject/grade matches targetPairs
      if (Array.isArray(targetPairs) && targetPairs.length > 0) {
        const subjectMatch = chunks.some(c =>
          targetPairs.some(p => p.grade === clsGrade && isSubjectMatch(c.subject, p.subject))
        )
        if (!subjectMatch) {
          newReqs.push(...chunks)
          return
        }
      }

      // Check if any chunk in group is manually modified (not auto-assigned or locked) or confirmed mixed-import with teacher
      const hasManualOverride = chunks.some(
        c => c.isLocked || (c.teacher && !c.isAutoAssigned) || (c.assignmentSource === 'mixed-import' && c.teacher)
      )

      if (hasManualOverride) {
        // Keep chunks as is
        newReqs.push(...chunks)
      } else {
        // Re-consolidate into base requirement
        const firstChunk = chunks[0]
        const totalPeriods = chunks.reduce((sum, c) => sum + (Number(c.periods) || 0), 0)
        const consolidatedReq = {
          ...firstChunk,
          id: baseId,
          periods: totalPeriods,
          teacher: '',
          teacher_name: '',
          isAutoAssigned: false
        }
        delete consolidatedReq.assignmentSource
        newReqs.push(consolidatedReq)
      }
    })

    cls.course_requirements = newReqs
  })
}

/**
 * 💡 班級名稱比對（支援 '505'、'505班'、'5年5班' 等形式）
 */
export function isClassNameMatch(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const cleanA = String(a).trim().replace(/班$/, '')
  const cleanB = String(b).trim().replace(/班$/, '')
  return cleanA === cleanB
}

/**
 * 💡 提取規則之班級目標/候選範圍清單
 * 優先回傳 targetClassNames，其次回傳 candidateClassNames，兩者皆無時回傳 null
 */
export function getRuleScopeClassNames(rule) {
  if (!rule) return null
  if (Array.isArray(rule.targetClassNames) && rule.targetClassNames.length > 0) {
    return rule.targetClassNames
  }
  if (Array.isArray(rule.candidateClassNames) && rule.candidateClassNames.length > 0) {
    return rule.candidateClassNames
  }
  return null
}

/**
 * 判斷目前教師是否只是系統依班導帶入的預設值。
 * 這類未鎖定、未有匯入來源的需求，允許本次 Excel 科任規則在自身 scope 內覆寫。
 */
export function isReplaceableDefaultHomeroomRequirement(cls, req) {
  const homeroomName = String(cls?.homeroom_teacher || cls?.homeroomTeacher || '').trim()
  const assignedName = String(req?.teacher || '').trim()
  const storedName = String(req?.teacher_name || '').trim()

  return Boolean(
    homeroomName &&
    req?.defaultTeacher === 'homeroom' &&
    !req?.isLocked &&
    !req?.assignmentSource &&
    assignedName === homeroomName &&
    (!storedName || storedName === homeroomName)
  )
}

/**
 * 🛡️ 需求預檢擋寫 (Preflight Allocation Guard)
 * 針對 active teachers 的 assignment_rules 加總 supply，與相應年級+科目的未指派需求 demand 比對。
 * 排除鎖定需求，僅統計符合 assignment-rule 與年級適用性的需求。
 * 若 aggregateSupply > aggregateDemand 或 demand 不足以滿足規則，回傳錯誤訊息且 apply ZERO mutations。
 */
export function preflightValidateDemand(classes, teachers, confirmedHomeroomTeacherIds = []) {
  if (!Array.isArray(teachers) || !Array.isArray(classes)) {
    return { valid: true }
  }

  // 0. Target Rules Validation (Class-Specific & Explicit Target Rules Guard)
  for (const t of teachers) {
    const isEligible = isTeacherEligibleForRules(t, confirmedHomeroomTeacherIds)
    if (!isEligible || !Array.isArray(t.assignment_rules)) continue

    for (const rule of t.assignment_rules) {
      const targetGrade = Number(rule.grade)
      const targetSubject = String(rule.subject || '').trim()
      const targetPeriods = Number(rule.periods) || 0
      const targetClassNames = Array.isArray(rule.targetClassNames) && rule.targetClassNames.length > 0
        ? rule.targetClassNames
        : null
      const isExplicitTarget = Boolean(targetClassNames)
      const scopeClassNames = targetClassNames || (Array.isArray(rule.candidateClassNames) && rule.candidateClassNames.length > 0 ? rule.candidateClassNames : null)

      if (targetGrade <= 0 || targetPeriods <= 0 || !targetSubject || !scopeClassNames) continue

      let alreadyAssignedToT = 0
      let availableUnassignedPeriods = 0

      for (const targetName of scopeClassNames) {
        const cls = classes.find(
          c => getGradeFromClassName(c.name, c.grade) === targetGrade && isClassNameMatch(c.name, targetName)
        )
        if (!cls) {
          if (isExplicitTarget) {
            return {
              valid: false,
              error: `[需求不符] 年級 ${targetGrade} 科目「${targetSubject}」指定標的班級「${targetName}」不存在`
            }
          }
          continue
        }

        const reqs = cls.course_requirements || []
        const matchingReqs = reqs.filter(
          r => isSubjectMatch(r.subject, targetSubject) && isSubjectApplicableToGrade(r.subject, targetGrade)
        )

        if (matchingReqs.length === 0) {
          if (isExplicitTarget) {
            return {
              valid: false,
              error: `[需求不符] 班級「${targetName}」無科目「${targetSubject}」之課程需求`
            }
          }
          continue
        }

        for (const req of matchingReqs) {
          const p = Number(req.periods) || 0
          if (req.teacher && req.teacher.trim() === t.name.trim()) {
            alreadyAssignedToT += p
          } else if (isExplicitTarget && req.isLocked) {
            return {
              valid: false,
              error: `[需求不符] 班級「${targetName}」科目「${targetSubject}」已鎖定，無法套用匯入分配`
            }
          } else if (
            isExplicitTarget &&
            req.teacher &&
            req.teacher.trim() !== '' &&
            !isReplaceableDefaultHomeroomRequirement(cls, req) &&
            (!req.isAutoAssigned || req.assignmentSource === 'mixed-import')
          ) {
            return {
              valid: false,
              error: `[需求不符] 班級「${targetName}」科目「${targetSubject}」已指派給「${req.teacher}」，與「${t.name}」的匯入規則衝突`
            }
          } else if (
            !req.isLocked &&
            (!req.teacher || req.teacher.trim() === '' || isReplaceableDefaultHomeroomRequirement(cls, req))
          ) {
            availableUnassignedPeriods += p
          }
        }
      }

      const neededPeriods = Math.max(0, targetPeriods - alreadyAssignedToT)
      if (neededPeriods > 0 && availableUnassignedPeriods < neededPeriods) {
        return {
          valid: false,
          error: `[需求不符] 班級「${scopeClassNames.join('、')}」科目「${targetSubject}」可分派需求節數不足（需要 ${neededPeriods} 節，實際可用 ${availableUnassignedPeriods} 節）`
        }
      }
    }
  }

  // 1. Calculate aggregate remaining supply per (grade, subjectKey)
  const supplyMap = new Map() // `${grade}_${subject}` -> total remaining periods

  teachers.forEach(t => {
    const isEligible = isTeacherEligibleForRules(t, confirmedHomeroomTeacherIds)

    if (isEligible && Array.isArray(t.assignment_rules)) {
      t.assignment_rules.forEach(rule => {
        const grade = Number(rule.grade)
        const periods = Number(rule.periods) || 0
        const subject = String(rule.subject || '').trim()
        if (grade > 0 && periods > 0 && subject) {
          // Count periods already assigned/materialized to teacher t for this grade & subject
          let alreadyAssigned = 0
          classes.forEach(cls => {
            const clsGrade = getGradeFromClassName(cls.name, cls.grade)
            if (clsGrade === grade && Array.isArray(cls.course_requirements)) {
              cls.course_requirements.forEach(req => {
                if (req.teacher && req.teacher.trim() === t.name.trim() && isSubjectMatch(req.subject, subject)) {
                  alreadyAssigned += Number(req.periods) || 0
                }
              })
            }
          })

          const remainingSupply = Math.max(0, periods - alreadyAssigned)
          if (remainingSupply > 0) {
            const key = `${grade}_${subject}`
            supplyMap.set(key, (supplyMap.get(key) || 0) + remainingSupply)
          }
        }
      })
    }
  })

  // If no remaining rules exist, preflight passes
  if (supplyMap.size === 0) {
    return { valid: true }
  }

  // 2. Calculate aggregate truly unassigned demand per (grade, subjectKey)
  for (const [key, supply] of supplyMap.entries()) {
    const [gradeStr, ruleSubj] = key.split('_')
    const grade = Number(gradeStr)

    let totalDemand = 0
    classes.forEach(cls => {
      const clsGrade = getGradeFromClassName(cls.name, cls.grade)
      if (clsGrade === grade && Array.isArray(cls.course_requirements)) {
        cls.course_requirements.forEach(req => {
          if (
            !req.isLocked &&
            (
              !req.teacher ||
              req.teacher.trim() === '' ||
              isReplaceableDefaultHomeroomRequirement(cls, req) ||
              (req.isAutoAssigned && req.assignmentSource !== 'mixed-import')
            ) &&
            isSubjectApplicableToGrade(req.subject, clsGrade)
          ) {
            if (isSubjectMatch(req.subject, ruleSubj)) {
              totalDemand += Number(req.periods) || 0
            }
          }
        })
      }
    })

    if (supply > totalDemand) {
      return {
        valid: false,
        error: `[需求不符] 年級 ${grade} 科目「${ruleSubj}」全校班級需求總計 ${totalDemand} 節，但匯入規則要求指派 ${supply} 節`
      }
    }
  }

  return { valid: true }
}

/**
 * 🎯 Phase A: 物化專任、行政與已確認導師規則 (Exact Rules Materialization with Splitting)
 * 只消費真正未指派且未鎖定 (truly unassigned unlocked) 且符合年級適用性的需求。
 * 在單次物化 pass 內，絕不將剛自動配給某一教師的 chunk 當成另一教師的配給目標。
 */
export function materializeExactRules(classes, teachers, confirmedHomeroomTeacherIds = []) {
  let assignedCount = 0

  teachers.forEach(t => {
    const isEligible = isTeacherEligibleForRules(t, confirmedHomeroomTeacherIds)

    if (!isEligible || !Array.isArray(t.assignment_rules)) return

    t.assignment_rules.forEach(rule => {
      const targetGrade = Number(rule.grade)
      const targetSubject = String(rule.subject || '').trim()
      const targetPeriods = Number(rule.periods) || 0
      if (targetGrade <= 0 || targetPeriods <= 0 || !targetSubject) return

      // Count periods already assigned to teacher t for this grade & subject
      let alreadyAssigned = 0
      classes.forEach(cls => {
        const clsGrade = getGradeFromClassName(cls.name, cls.grade)
        if (clsGrade === targetGrade && Array.isArray(cls.course_requirements)) {
          cls.course_requirements.forEach(req => {
            if (req.teacher && req.teacher.trim() === t.name.trim() && isSubjectMatch(req.subject, targetSubject)) {
              alreadyAssigned += Number(req.periods) || 0
            }
          })
        }
      })

      let ruleAssigned = alreadyAssigned
      if (ruleAssigned >= targetPeriods) return

      // Collect eligible classes restricted to targetClassNames or candidateClassNames if present, otherwise sorted by natural class name
      const targetClassNames = Array.isArray(rule.targetClassNames) && rule.targetClassNames.length > 0
        ? rule.targetClassNames
        : null
      const candidateClassNames = Array.isArray(rule.candidateClassNames) && rule.candidateClassNames.length > 0
        ? rule.candidateClassNames
        : null

      let sortedClasses = [...classes]
      if (targetClassNames) {
        sortedClasses = sortedClasses.filter(c =>
          targetClassNames.includes(c.name) ||
          targetClassNames.some(tn => isClassNameMatch(c.name, tn))
        )
      } else if (candidateClassNames) {
        sortedClasses = sortedClasses.filter(c =>
          candidateClassNames.includes(c.name) ||
          candidateClassNames.some(tn => isClassNameMatch(c.name, tn))
        )
      } else {
        sortedClasses.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      }

      for (const cls of sortedClasses) {
        if (ruleAssigned >= targetPeriods) break

        const clsGrade = getGradeFromClassName(cls.name, cls.grade)
        if (clsGrade !== targetGrade || !Array.isArray(cls.course_requirements)) continue

        for (let i = 0; i < cls.course_requirements.length; i++) {
          if (ruleAssigned >= targetPeriods) break

          const req = cls.course_requirements[i]
          if (
            !req.isLocked &&
            (!req.teacher || req.teacher.trim() === '' || isReplaceableDefaultHomeroomRequirement(cls, req)) &&
            isSubjectApplicableToGrade(req.subject, clsGrade)
          ) {
            if (isSubjectMatch(req.subject, targetSubject)) {
              const needed = targetPeriods - ruleAssigned
              const P = Number(req.periods) || 0

              if (P <= needed) {
                // Fully assign this requirement
                req.teacher = t.name
                req.teacher_name = t.name
                req.isAutoAssigned = true
                ruleAssigned += P
                assignedCount += P
              } else {
                // Straddle / Requirement Splitting (P > needed)
                const baseId = req.id ? String(req.id).split('_split_')[0] : `req_${Date.now()}`
                const chunk1 = {
                  ...req,
                  id: `${baseId}_split_${t.name}_1`,
                  periods: needed,
                  teacher: t.name,
                  teacher_name: t.name,
                  isAutoAssigned: true
                }
                const chunk2 = {
                  ...req,
                  id: `${baseId}_split_remainder_2`,
                  periods: P - needed,
                  teacher: '',
                  teacher_name: '',
                  isAutoAssigned: false
                }
                cls.course_requirements.splice(i, 1, chunk1, chunk2)
                ruleAssigned += needed
                assignedCount += needed
                i++ // Skip chunk2 in current iteration
              }
            }
          }
        }
      }
    })
  })

  return assignedCount
}

function getImportedRulePriority(rule) {
  if (Array.isArray(rule?.targetClassNames) && rule.targetClassNames.length > 0) return 0
  if (rule?.sourceKind === 'all-eligible') return 1
  return 2
}

function freezeAssignmentLedger(entries = []) {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })))
}

function createAssignmentLedgerEntry(teacher, grade, subject, periods, className) {
  return {
    teacherId: teacher?.id ?? null,
    teacherName: String(teacher?.name || '').trim(),
    grade: Number(grade),
    subject: String(subject || '').trim(),
    periods: Number(periods) || 0,
    className,
    source: 'subject-excel-import',
  }
}

/**
 * 📦 專屬匯入規則物化器 (Materialize Imported Assignment Rules)
 * 僅根據傳入的 teachers 之 assignment_rules 物化分配，絕不執行 runSmartSubjectAssignment / Phase B fallback。
 *
 * @param {Object} params
 * @param {Array} params.classes 班級陣列
 * @param {Array} params.teachers 教師陣列
 * @param {Array} [params.confirmedHomeroomTeacherIds] 已確認導師 ID 陣列
 * @returns {{ success: boolean, classes: Array, assignedCount: number, assignmentLedger: ReadonlyArray, error: string|null }}
 */
export function materializeImportedAssignmentRules({
  classes = [],
  teachers = [],
  confirmedHomeroomTeacherIds = [],
} = {}) {
  if (!Array.isArray(classes) || !Array.isArray(teachers)) {
    return {
      success: false,
      classes: classes || [],
      assignedCount: 0,
      assignmentLedger: freezeAssignmentLedger(),
      error: '班級或教師資料格式不正確',
    }
  }

  // 1. 深拷貝輸入資料，確保若失敗時絕不污染呼叫端物件
  const clonedClasses = JSON.parse(JSON.stringify(classes))
  const clonedTeachers = JSON.parse(JSON.stringify(teachers))

  const eligibleTeachers = clonedTeachers.filter((t) =>
    isTeacherEligibleForRules(t, confirmedHomeroomTeacherIds)
  )

  // 2. 收集本次匯入所涉及的 (grade, subject) 組合
  const importedPairs = []
  eligibleTeachers.forEach((t) => {
    if (Array.isArray(t.assignment_rules)) {
      t.assignment_rules.forEach((rule) => {
        const g = Number(rule.grade)
        const s = String(rule.subject || '').trim()
        if (g > 0 && s) {
          importedPairs.push({ grade: g, subject: s })
        }
      })
    }
  })

  // 3. 在深拷貝上，針對本次匯入涉及的年級＋科目，重設既有 assignmentSource === 'subject-excel-import' 的需求
  // 嚴格保留 isLocked, 手動指定 (isAutoAssigned: false 或無 assignmentSource), 及 mixed-import
  const resetBaseIds = new Set()
  clonedClasses.forEach((cls) => {
    const clsGrade = getGradeFromClassName(cls.name, cls.grade)
    if (Array.isArray(cls.course_requirements)) {
      cls.course_requirements.forEach((req) => {
        const isTargetPair = importedPairs.some(
          (p) => p.grade === clsGrade && isSubjectMatch(req.subject, p.subject)
        )
        if (isTargetPair && req.assignmentSource === 'subject-excel-import' && !req.isLocked) {
          req.teacher = ''
          req.teacher_name = ''
          req.isAutoAssigned = false
          delete req.assignmentSource
          if (req.id && String(req.id).includes('_split_')) {
            resetBaseIds.add(String(req.id).split('_split_')[0])
          }
        }
      })
    }
  })

  // 將因本次匯入重設的 split chunks 重新合併為基底需求
  // 限制 consolidate 只針對本次 importedPairs 範圍內、且確實被重設（即之前是 assignmentSource === 'subject-excel-import'）所涉及的 baseId 相關 split chunks
  consolidateSplitRequirements(clonedClasses, {
    targetBaseIds: resetBaseIds,
    targetPairs: importedPairs,
  })

  // 4. 需求預檢擋寫 (Preflight Allocation Guard)
  const preflight = preflightValidateDemand(clonedClasses, eligibleTeachers, confirmedHomeroomTeacherIds)
  if (!preflight.valid) {
    return {
      success: false,
      classes, // 傳回未變更之原始 classes
      assignedCount: 0,
      assignmentLedger: freezeAssignmentLedger(),
      error: preflight.error,
    }
  }

  // 5. 執行 Exact Rules 物化
  let totalAssignedCount = 0
  const assignmentLedger = []

  const orderedRuleEntries = eligibleTeachers
    .flatMap((teacher, teacherIndex) => (Array.isArray(teacher.assignment_rules)
      ? teacher.assignment_rules.map((rule, ruleIndex) => ({ teacher, rule, teacherIndex, ruleIndex }))
      : []))
    .sort((left, right) => (
      getImportedRulePriority(left.rule) - getImportedRulePriority(right.rule) ||
      left.teacherIndex - right.teacherIndex ||
      left.ruleIndex - right.ruleIndex
    ))

  for (const { teacher: t, rule } of orderedRuleEntries) {
      const targetGrade = Number(rule.grade)
      const targetSubject = String(rule.subject || '').trim()
      const targetPeriods = Number(rule.periods) || 0
      if (targetGrade <= 0 || targetPeriods <= 0 || !targetSubject) continue

      // 班級規則優先順序：targetClassNames 是明確班級；否則 candidateClassNames 是批次候選；兩者皆無時為自然排序
      const targetClassNames = Array.isArray(rule.targetClassNames) && rule.targetClassNames.length > 0
        ? rule.targetClassNames
        : null
      const candidateClassNames = Array.isArray(rule.candidateClassNames) && rule.candidateClassNames.length > 0
        ? rule.candidateClassNames
        : null

      let candidateClasses = []
      if (targetClassNames) {
        candidateClasses = targetClassNames
          .map((name) =>
            clonedClasses.find(
              (c) => getGradeFromClassName(c.name, c.grade) === targetGrade && isClassNameMatch(c.name, name)
            )
          )
          .filter(Boolean)
      } else if (candidateClassNames) {
        candidateClasses = candidateClassNames
          .map((name) =>
            clonedClasses.find(
              (c) => getGradeFromClassName(c.name, c.grade) === targetGrade && isClassNameMatch(c.name, name)
            )
          )
          .filter(Boolean)
      } else {
        candidateClasses = clonedClasses
          .filter((c) => getGradeFromClassName(c.name, c.grade) === targetGrade)
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      }

      // 計算該 scope 範圍內該教師已滿足的節數作為起始 ruleAssigned
      let alreadyAssigned = 0
      candidateClasses.forEach((cls) => {
        const clsGrade = getGradeFromClassName(cls.name, cls.grade)
        if (clsGrade === targetGrade && Array.isArray(cls.course_requirements)) {
          cls.course_requirements.forEach((req) => {
            if (
              req.teacher &&
              req.teacher.trim() === t.name.trim() &&
              isSubjectMatch(req.subject, targetSubject)
            ) {
              alreadyAssigned = Math.round((alreadyAssigned + (Number(req.periods) || 0)) * 100) / 100
            }
          })
        }
      })

      let ruleAssigned = alreadyAssigned
      if (ruleAssigned >= targetPeriods - 1e-6) continue

      for (const cls of candidateClasses) {
        if (ruleAssigned >= targetPeriods - 1e-6) break
        if (!Array.isArray(cls.course_requirements)) continue

        const clsGrade = getGradeFromClassName(cls.name, cls.grade)
        if (clsGrade !== targetGrade) continue

        for (let i = 0; i < cls.course_requirements.length; i++) {
          if (ruleAssigned >= targetPeriods - 1e-6) break

          const req = cls.course_requirements[i]
          if (
            !req.isLocked &&
            (!req.teacher || req.teacher.trim() === '' || isReplaceableDefaultHomeroomRequirement(cls, req)) &&
            isSubjectApplicableToGrade(req.subject, clsGrade) &&
            isSubjectMatch(req.subject, targetSubject)
          ) {
            const needed = Math.round((targetPeriods - ruleAssigned) * 100) / 100
            const P = Number(req.periods) || 0

            if (P <= needed + 1e-6) {
              req.teacher = t.name
              req.teacher_name = t.name
              req.isAutoAssigned = true
              req.assignmentSource = 'subject-excel-import'
              ruleAssigned = Math.round((ruleAssigned + P) * 100) / 100
              totalAssignedCount = Math.round((totalAssignedCount + P) * 100) / 100
              assignmentLedger.push(createAssignmentLedgerEntry(t, targetGrade, targetSubject, P, cls.name))
            } else {
              // 拆分需求 (Splitting)
              const baseId = req.id ? String(req.id).split('_split_')[0] : `req_${Date.now()}`
              const chunk1 = {
                ...req,
                id: `${baseId}_split_${t.name}_1`,
                periods: needed,
                teacher: t.name,
                teacher_name: t.name,
                isAutoAssigned: true,
                assignmentSource: 'subject-excel-import',
              }
              const chunk2 = {
                ...req,
                id: `${baseId}_split_remainder_2`,
                periods: Math.round((P - needed) * 100) / 100,
                teacher: '',
                teacher_name: '',
                isAutoAssigned: false,
              }
              delete chunk2.assignmentSource
              cls.course_requirements.splice(i, 1, chunk1, chunk2)
              ruleAssigned = Math.round((ruleAssigned + needed) * 100) / 100
              totalAssignedCount = Math.round((totalAssignedCount + needed) * 100) / 100
              assignmentLedger.push(createAssignmentLedgerEntry(t, targetGrade, targetSubject, needed, cls.name))
              i++ // 跳過未分配的 remainder chunk
            }
          }
        }
      }

      // 6. 物化後檢驗該教師在規則範圍內指派節數是否完整達到 rule.periods
      if (ruleAssigned + 1e-6 < targetPeriods) {
        return {
          success: false,
          classes, // 傳回未變更之原始 classes
          assignedCount: 0,
          assignmentLedger: freezeAssignmentLedger(),
          error: `[需求不符] 教師「${t.name}」科目「${targetSubject}」要求指派 ${targetPeriods} 節，但實際僅可指派 ${ruleAssigned} 節`,
        }
      }
  }

  return {
    success: true,
    classes: clonedClasses,
    assignedCount: totalAssignedCount,
    assignmentLedger: freezeAssignmentLedger(assignmentLedger),
    error: null,
  }
}

/**
 * 💡 志願序層級計算
 */
function getGradePreferenceRank(teacher, grade) {
  const pref1 = teacher.pref_grade1 ?? teacher.gradePreferences?.[0] ?? null
  const pref2 = teacher.pref_grade2 ?? teacher.gradePreferences?.[1] ?? null
  const pref3 = teacher.pref_grade3 ?? teacher.gradePreferences?.[2] ?? null

  if (pref1 !== null && Number(pref1) === Number(grade)) return 1
  if (pref2 !== null && Number(pref2) === Number(grade)) return 2
  if (pref3 !== null && Number(pref3) === Number(grade)) return 3
  return 4
}

/**
 * ⚖️ 智慧尋找最佳教師 (Phase B Fallback Round-Robin)
 */
function findBestTeacher(subjectName, requiredPeriods, teachersList, loadTracker, quotaMap, grade) {
  let candidates = teachersList.filter(t => {
    if (t.type === 'homeroom') return false
    let expandedExpertise = []
    const rawExp = Array.isArray(t.expertiseSubjects) ? t.expertiseSubjects : (t.expertiseSubjects ? [t.expertiseSubjects] : [])
    rawExp.forEach(sub => {
      if (!sub) return
      const cleanSub = String(sub).replace(/["']/g, '')
      expandedExpertise.push(...cleanSub.split(/[、,,/]/).map(s => s.trim()).filter(Boolean))
    })
    return expandedExpertise.some(sub => isSubjectMatch(subjectName, sub))
  })

  candidates = candidates.filter(t => {
    const currentLoad = loadTracker[t.name] || 0
    const maxQuota = quotaMap[t.name]?.maxPeriods || 20
    return (currentLoad + requiredPeriods) <= maxQuota
  })

  candidates.sort((a, b) => {
    const rankA = getGradePreferenceRank(a, grade)
    const rankB = getGradePreferenceRank(b, grade)
    if (rankA !== rankB) return rankA - rankB

    const loadA = loadTracker[a.name] || 0
    const loadB = loadTracker[b.name] || 0
    if (loadA !== loadB) return loadA - loadB

    return String(a.name).localeCompare(String(b.name))
  })

  return candidates.length > 0 ? candidates[0] : null
}

/**
 * 🚀 智慧自動配課主流程
 */
export function runSmartSubjectAssignment(scheduleStore, confirmedHomeroomTeacherIds = []) {
  if (scheduleStore.pendingMixedPlans?.length > 0 || scheduleStore.hasPendingMixedPlans) {
    return {
      success: false,
      error: '尚有混合配課待確認，請先完成匯入確認。',
      processedCount: 0,
      assignedCount: 0,
      skippedCount: 0
    }
  }

  const teachers = scheduleStore.teachers || []
  const classes = scheduleStore.classes || []

  // 1. Preflight Validation
  const preflight = preflightValidateDemand(classes, teachers, confirmedHomeroomTeacherIds)
  if (!preflight.valid) {
    return {
      success: false,
      error: preflight.error,
      processedCount: 0,
      assignedCount: 0,
      skippedCount: 0
    }
  }

  // 2. Pre-pass Consolidation (Idempotency)
  consolidateSplitRequirements(classes)

  // 3. Phase A: Materialize Exact Rules
  const phaseAAssigned = materializeExactRules(classes, teachers, confirmedHomeroomTeacherIds)

  // 4. Phase B: Fallback Round-Robin for unruled requirements
  let processedCount = 0
  let phaseBAssigned = 0
  let skippedCount = 0

  const teacherQuotaMap = {}
  teachers.forEach(t => {
    const roleGroup = t.type || 'subject'
    const base = Number(t.base_periods || t.max_periods || (scheduleStore.schoolInfo?.periodDefaults?.[roleGroup] || 20))
    const reduction = Number(t.reduction || 0)
    const overtime = Number(t.overtime || 0)

    // Calculate used periods after Phase A
    let used = 0
    classes.forEach(c => {
      if (c.course_requirements) {
        c.course_requirements.forEach(r => {
          if (r.teacher && r.teacher.trim() === t.name.trim()) {
            used += Number(r.periods) || 0
          }
        })
      }
    })

    teacherQuotaMap[t.name] = {
      base, reduction, overtime,
      maxPeriods: base - reduction + overtime,
      used,
      remaining: Math.max(0, base - reduction + overtime - used)
    }
  })

  const teacherLoads = {}
  teachers.forEach(t => {
    teacherLoads[t.name] = teacherQuotaMap[t.name]?.used || 0
  })

  const unassignedTasks = []
  classes.forEach(cls => {
    if (!cls.course_requirements) return
    const grade = getGradeFromClassName(cls.name, cls.grade)
    cls.course_requirements.forEach(req => {
      if (
        req.defaultTeacher === 'subject' &&
        !req.isLocked &&
        (!req.teacher || req.teacher.trim() === '')
      ) {
        const periods = Number(req.periods) || 0
        const sub = req.subject || ''
        if (periods <= 0) return
        if (!isSubjectApplicableToGrade(sub, grade)) return

        unassignedTasks.push({
          clsName: cls.name,
          clsGrade: grade,
          subject: sub,
          periods,
          reqRef: req
        })
      }
    })
  })

  for (const task of unassignedTasks) {
    processedCount++
    const bestTeacher = findBestTeacher(task.subject, task.periods, teachers, teacherLoads, teacherQuotaMap, task.clsGrade)
    if (bestTeacher) {
      task.reqRef.teacher = bestTeacher.name
      task.reqRef.isAutoAssigned = true
      teacherLoads[bestTeacher.name] = (teacherLoads[bestTeacher.name] || 0) + task.periods
      teacherQuotaMap[bestTeacher.name].remaining = Math.max(0, teacherQuotaMap[bestTeacher.name].maxPeriods - teacherLoads[bestTeacher.name])
      teacherQuotaMap[bestTeacher.name].used = teacherLoads[bestTeacher.name]
      phaseBAssigned++
    } else {
      skippedCount++
    }
  }

  const totalAssigned = phaseAAssigned + phaseBAssigned
  scheduleStore.markScheduleDirty?.()

  return {
    success: true,
    successMsg: `智慧配課完成！成功指派 ${totalAssigned} 筆。`,
    processedCount,
    assignedCount: totalAssigned,
    skippedCount,
    classes: scheduleStore.classes || classes,
  }
}
