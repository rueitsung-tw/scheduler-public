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
export function consolidateSplitRequirements(classes) {
  if (!Array.isArray(classes)) return

  classes.forEach(cls => {
    if (!Array.isArray(cls.course_requirements)) return

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
        newReqs.push({
          ...firstChunk,
          id: baseId,
          periods: totalPeriods,
          teacher: '',
          isAutoAssigned: false
        })
      }
    })

    cls.course_requirements = newReqs
  })
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

      if (targetGrade <= 0 || targetPeriods <= 0 || !targetSubject || !targetClassNames) continue

      let alreadyAssignedToT = 0
      let availableUnassignedPeriods = 0

      for (const targetName of targetClassNames) {
        const cls = classes.find(
          c => getGradeFromClassName(c.name, c.grade) === targetGrade && (c.name === targetName || String(c.name).replace(/班$/, '') === String(targetName).replace(/班$/, ''))
        )
        if (!cls) {
          return {
            valid: false,
            error: `[需求不符] 年級 ${targetGrade} 科目「${targetSubject}」指定標的班級「${targetName}」不存在`
          }
        }

        const reqs = cls.course_requirements || []
        const matchingReqs = reqs.filter(
          r => isSubjectMatch(r.subject, targetSubject) && isSubjectApplicableToGrade(r.subject, targetGrade)
        )

        if (matchingReqs.length === 0) {
          return {
            valid: false,
            error: `[需求不符] 班級「${targetName}」無科目「${targetSubject}」之課程需求`
          }
        }

        for (const req of matchingReqs) {
          const p = Number(req.periods) || 0
          if (req.teacher && req.teacher.trim() === t.name.trim()) {
            alreadyAssignedToT += p
          } else if (req.isLocked) {
            return {
              valid: false,
              error: `[需求不符] 班級「${targetName}」科目「${targetSubject}」已鎖定，無法套用匯入分配`
            }
          } else if (
            req.teacher &&
            req.teacher.trim() !== '' &&
            (!req.isAutoAssigned || req.assignmentSource === 'mixed-import')
          ) {
            return {
              valid: false,
              error: `[需求不符] 班級「${targetName}」科目「${targetSubject}」已指派給「${req.teacher}」，與「${t.name}」的匯入規則衝突`
            }
          } else {
            availableUnassignedPeriods += p
          }
        }
      }

      const neededPeriods = Math.max(0, targetPeriods - alreadyAssignedToT)
      if (neededPeriods > 0 && availableUnassignedPeriods < neededPeriods) {
        return {
          valid: false,
          error: `[需求不符] 班級「${targetClassNames.join('、')}」科目「${targetSubject}」可分派需求節數不足（需要 ${neededPeriods} 節，實際可用 ${availableUnassignedPeriods} 節）`
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
            (!req.teacher || req.teacher.trim() === '' || (req.isAutoAssigned && req.assignmentSource !== 'mixed-import')) &&
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

      // Collect eligible classes restricted to targetClassNames if present, otherwise sorted by natural class name
      const targetClassNames = Array.isArray(rule.targetClassNames) && rule.targetClassNames.length > 0
        ? rule.targetClassNames
        : null

      let sortedClasses = [...classes]
      if (targetClassNames) {
        sortedClasses = sortedClasses.filter(c =>
          targetClassNames.includes(c.name) ||
          targetClassNames.some(tn => String(tn).replace(/班$/, '') === String(c.name).replace(/班$/, ''))
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
            (!req.teacher || req.teacher.trim() === '') &&
            isSubjectApplicableToGrade(req.subject, clsGrade)
          ) {
            if (isSubjectMatch(req.subject, targetSubject)) {
              const needed = targetPeriods - ruleAssigned
              const P = Number(req.periods) || 0

              if (P <= needed) {
                // Fully assign this requirement
                req.teacher = t.name
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
                  isAutoAssigned: true
                }
                const chunk2 = {
                  ...req,
                  id: `${baseId}_split_remainder_2`,
                  periods: P - needed,
                  teacher: '',
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

