import { getGradeFromClassName, isSubjectMatch } from './subjectAssignmentMaterializer.js'

/**
 * 自然排序比對函式
 */
function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'zh-TW', { numeric: true, sensitivity: 'base' })
}

function createSeededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function shuffleClassBlocks(classBlocks = [], seed) {
  const random = createSeededRandom(seed)
  const shuffled = [...classBlocks]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selectedIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[selectedIndex]] = [shuffled[selectedIndex], shuffled[index]]
  }
  return shuffled
}

/**
 * 依據配額嘗試將完整班級分配給匯入教師 (Backtracking)
 */
function allocateClassesToQuotas(quotas = [], availableBlocks = []) {
  const result = new Map() // className -> quota/teacher info

  function backtrack(quotaIdx, remainingBlocks) {
    if (quotaIdx >= quotas.length) {
      return true
    }

    const quota = quotas[quotaIdx]
    const targetPeriods = quota.periods

    // 尋求剩餘 blocks 的子集，使其 periods 加總為 targetPeriods
    const validSubsets = []

    function findSubsets(startIdx, currentSubset, currentSum) {
      if (currentSum === targetPeriods) {
        validSubsets.push([...currentSubset])
        return
      }
      if (currentSum > targetPeriods || startIdx >= remainingBlocks.length) {
        return
      }
      for (let i = startIdx; i < remainingBlocks.length; i++) {
        const block = remainingBlocks[i]
        currentSubset.push(block)
        findSubsets(i + 1, currentSubset, currentSum + block.periods)
        currentSubset.pop()
      }
    }

    findSubsets(0, [], 0)

    for (const subset of validSubsets) {
      const subsetNames = new Set(subset.map((b) => b.className))
      const nextRemaining = remainingBlocks.filter((b) => !subsetNames.has(b.className))

      for (const block of subset) {
        result.set(block.className, quota)
      }

      if (backtrack(quotaIdx + 1, nextRemaining)) {
        return true
      }

      for (const block of subset) {
        result.delete(block.className)
      }
    }

    return false
  }

  const success = backtrack(0, availableBlocks)
  return { success, assignmentMap: result }
}

/**
 * 建立純混合配課規劃
 *
 * @param {Object} params
 * @param {Array} params.parsedRows
 * @param {Array} params.teachers
 * @param {Array} params.classes
 * @returns {{ plans: Array, blockers: Array }}
 */
export function buildMixedTeachingPlans({ parsedRows = [], teachers = [], classes = [] }) {
  const teacherMap = new Map()
  for (const t of teachers) {
    if (t.id != null) teacherMap.set(String(t.id), t)
    if (t.name) teacherMap.set(t.name, t)
  }

  // 以 grade + normalizedSubject 聚合所有匯入規則
  const groupedRules = new Map() // key -> { grade, subject, teacherQuotasMap: Map }

  for (const row of parsedRows) {
    const teacher = teacherMap.get(String(row.teacherId)) ?? teacherMap.get(row.teacherName)
    const teacherType = teacher?.type || teacher?.teacherType || 'subject'

    const rules = row.rules || []
    for (const rule of rules) {
      const grade = Number(rule.grade)
      const subject = rule.systemSubject || rule.subject || ''
      if (!grade || !subject) continue

      const key = `${grade}::${subject}`
      if (!groupedRules.has(key)) {
        groupedRules.set(key, {
          grade,
          subject,
          teacherQuotasMap: new Map(), // teacherName -> quota
        })
      }
      const group = groupedRules.get(key)
      const currentPeriods = group.teacherQuotasMap.get(row.teacherName)?.periods || 0
      const newPeriods = currentPeriods + Number(rule.periods || 0)

      group.teacherQuotasMap.set(row.teacherName, {
        teacherId: teacher?.id ?? row.teacherId ?? null,
        teacherName: row.teacherName,
        teacherType,
        periods: newPeriods,
      })

      if (!group.rawRuleItems) {
        group.rawRuleItems = []
      }
      group.rawRuleItems.push({
        teacherName: row.teacherName,
        teacherId: teacher?.id ?? row.teacherId ?? null,
        teacherType,
        rule,
      })
    }
  }

  const plans = []
  const blockers = []

  for (const [key, group] of groupedRules.entries()) {
    const { grade, subject, teacherQuotasMap, rawRuleItems = [] } = group

    // 尋找相符班級及 course_requirements
    const classesInGrade = classes
      .filter((c) => getGradeFromClassName(c.name, c.grade) === grade)
      .sort((a, b) => naturalCompare(a.name, b.name))

    const classBlocks = []
    let totalDemandPeriods = 0
    let planDefaultTeacher = 'homeroom'
    let hasLockedClass = false

    for (const cls of classesInGrade) {
      const reqs = cls.course_requirements || []
      const req = reqs.find((r) => r.subject === subject || isSubjectMatch(r.subject, subject))

      if (req) {
        if (req.defaultTeacher) {
          planDefaultTeacher = req.defaultTeacher
        }
        if (req.isLocked) {
          hasLockedClass = cls.name
        }

        // 取得班導師名稱
        let homeroomTeacherName = cls.homeroom_teacher || cls.homeroomTeacher || ''
        if (!homeroomTeacherName) {
          const ht = teachers.find(
            (t) => (t.type === 'homeroom' || t.teacherType === 'homeroom') && (t.assignedClass === cls.name || t.assigned_class === cls.name)
          )
          if (ht) homeroomTeacherName = ht.name
        }

        const periods = Number(req.periods || 0)
        totalDemandPeriods += periods
        classBlocks.push({
          className: cls.name,
          periods,
          homeroomTeacherName,
          isLocked: Boolean(req.isLocked),
        })
      }
    }

    const isDefaultHomeroom = planDefaultTeacher !== 'subject' && planDefaultTeacher !== 'admin'
    const defaultRoleGroup = isDefaultHomeroom ? 'homeroom' : 'subject-admin'
    const exceptionRoleGroup = isDefaultHomeroom ? 'subject-admin' : 'homeroom'

    // 依據預設角色群組，篩選非預設群組 (例外群組) 的匯入教師配額
    const allQuotas = Array.from(teacherQuotasMap.values())
    const importedTeacherQuotas = allQuotas.filter((q) => {
      if (isDefaultHomeroom) {
        return q.teacherType !== 'homeroom'
      } else {
        return q.teacherType === 'homeroom'
      }
    })

    const totalImportedPeriods = importedTeacherQuotas.reduce((sum, q) => sum + q.periods, 0)

    // 檢查 Basic Blockers
    if (totalDemandPeriods === 0) {
      blockers.push({
        key,
        grade,
        subject,
        cause: `${grade} 年級科目「${subject}」沒有班級需求，但包含匯入節數`,
      })
      continue
    }

    if (totalImportedPeriods > totalDemandPeriods) {
      blockers.push({
        key,
        grade,
        subject,
        cause: `${grade} 年級科目「${subject}」匯入節數（${totalImportedPeriods} 堂）超過總需求（${totalDemandPeriods} 堂）`,
      })
      continue
    }

    if (hasLockedClass) {
      blockers.push({
        key,
        grade,
        subject,
        cause: `班級「${hasLockedClass}」科目「${subject}」已鎖定，無法套用匯入分配`,
      })
      continue
    }

    // 進行標的班級預約 (Pass 1: class-specific, Pass 2: all-eligible, Pass 3: grade-batch)
    const reservedMap = new Map() // className -> teacherName
    const teacherClassMap = new Map() // teacherName -> Set<className>
    let groupBlockerCause = null
    let hasTargetSpecs = false

    const hasAnySourceKind = rawRuleItems.some((item) => item.rule && item.rule.sourceKind)

    if (hasAnySourceKind) {
      hasTargetSpecs = true

      // Pass 1: Reserve class-specific targets first
      for (const item of rawRuleItems) {
        const { teacherName, rule } = item
        if (!rule || rule.sourceKind !== 'class-specific') continue
        const targets = Array.isArray(rule.targetClassNames) ? rule.targetClassNames : []

        for (const clsName of targets) {
          const targetBlock = classBlocks.find((b) => b.className === clsName)
          if (!targetBlock) {
            groupBlockerCause = `系統找不到班級代碼或名稱「${clsName}」對應的班級`
            break
          }
          if (reservedMap.has(clsName)) {
            const prevTeacher = reservedMap.get(clsName)
            if (prevTeacher !== teacherName) {
              groupBlockerCause = `班級「${clsName}」科目「${subject}」指定標的與其他匯入分配衝突`
              break
            }
          }
          if (targetBlock.isLocked) {
            groupBlockerCause = `班級「${clsName}」科目「${subject}」已鎖定，無法套用匯入分配`
            break
          }

          reservedMap.set(clsName, teacherName)
          if (!teacherClassMap.has(teacherName)) teacherClassMap.set(teacherName, new Set())
          teacherClassMap.get(teacherName).add(clsName)
        }
        if (groupBlockerCause) break
      }

      // Pass 2: Reserve all-eligible targets
      if (!groupBlockerCause) {
        for (const item of rawRuleItems) {
          const { teacherName, rule } = item
          if (!rule || rule.sourceKind !== 'all-eligible') continue
          const targets = Array.isArray(rule.targetClassNames) && rule.targetClassNames.length > 0
            ? rule.targetClassNames
            : classBlocks.map((b) => b.className)

          for (const clsName of targets) {
            const targetBlock = classBlocks.find((b) => b.className === clsName)
            if (!targetBlock) continue
            if (reservedMap.has(clsName)) {
              const prevTeacher = reservedMap.get(clsName)
              if (prevTeacher !== teacherName) {
                groupBlockerCause = `班級「${clsName}」科目「${subject}」指定標的與其他匯入分配衝突`
                break
              }
            }
            if (targetBlock.isLocked) {
              groupBlockerCause = `班級「${clsName}」科目「${subject}」已鎖定，無法套用匯入分配`
              break
            }

            reservedMap.set(clsName, teacherName)
            if (!teacherClassMap.has(teacherName)) teacherClassMap.set(teacherName, new Set())
            teacherClassMap.get(teacherName).add(clsName)
          }
          if (groupBlockerCause) break
        }
      }

      // Pass 3: Reserve grade-batch targets from remaining unreserved candidates in natural class order
      if (!groupBlockerCause) {
        for (const item of rawRuleItems) {
          const { teacherName, rule } = item
          if (!rule || rule.sourceKind !== 'grade-batch') continue
          const requiredCount = Number(rule.classCount || 0)
          if (requiredCount <= 0) continue

          let candidates = []
          if (Array.isArray(rule.candidateClassNames) && rule.candidateClassNames.length > 0) {
            candidates = rule.candidateClassNames.filter(
              (name) => !reservedMap.has(name) && classBlocks.some((b) => b.className === name)
            )
          } else {
            candidates = classBlocks.map((b) => b.className).filter((name) => !reservedMap.has(name))
          }

          candidates.sort(naturalCompare)

          if (candidates.length < requiredCount) {
            const reservedSpecificClass = Array.from(reservedMap.keys())[0]
            if (reservedSpecificClass) {
              groupBlockerCause = `班級「${reservedSpecificClass}」指定標的與批次配課衝突`
            } else {
              groupBlockerCause = `${grade} 年級科目「${subject}」剩餘可用班級數不足（需要 ${requiredCount} 班，剩餘 ${candidates.length} 班）`
            }
            break
          }

          const chosen = candidates.slice(0, requiredCount)
          for (const clsName of chosen) {
            reservedMap.set(clsName, teacherName)
            if (!teacherClassMap.has(teacherName)) teacherClassMap.set(teacherName, new Set())
            teacherClassMap.get(teacherName).add(clsName)
          }
        }
      }

      if (groupBlockerCause) {
        blockers.push({
          key,
          grade,
          subject,
          cause: groupBlockerCause,
        })
        continue
      }
    }

    if (hasTargetSpecs) {
      for (const q of importedTeacherQuotas) {
        const assignedSet = teacherClassMap.get(q.teacherName)
        if (assignedSet) {
          q.allocatedClassNames = Array.from(assignedSet)
        }
      }
    }

    const defaultRolePeriods = totalDemandPeriods - totalImportedPeriods
    const homeroomPeriods = isDefaultHomeroom ? defaultRolePeriods : totalImportedPeriods
    const importedSubjectAdminPeriods = isDefaultHomeroom ? totalImportedPeriods : 0
    const importedHomeroomPeriods = isDefaultHomeroom ? 0 : totalImportedPeriods

    // 建立 MixedTeachingPlan (僅當兩個角色群組各自承擔正節數時)
    if (totalImportedPeriods > 0 && defaultRolePeriods > 0) {
      plans.push({
        key,
        grade,
        subject,
        defaultTeacher: planDefaultTeacher,
        defaultRoleGroup,
        exceptionRoleGroup,
        totalDemandPeriods,
        importedPeriods: totalImportedPeriods,
        importedSubjectAdminPeriods,
        importedHomeroomPeriods,
        defaultRolePeriods,
        homeroomPeriods,
        importedTeacherQuotas,
        classBlocks,
        resolution: null,
      })
    }
  }

  return { plans, blockers }
}

/**
 * 解決並驗證混合配課方案 (Auto 或 Manual)
 *
 * @param {Object} plan
 * @param {Object} options
 * @param {string} options.mode - 'auto' | 'manual'
 * @param {Array<string>} [options.exceptionClassNames] - 手動模式指派給例外 (非預設) 角色群組之班級名稱
 * @param {Array<string>} [options.subjectAdminClassNames] - 別名 (相容)
 * @returns {{ valid: boolean, resolution: Object|null, errors: Array<string> }}
 */
export function resolveMixedTeachingPlan(
  plan,
  { mode = 'auto', exceptionClassNames, subjectAdminClassNames, autoAllocation } = {}
) {
  if (!plan) {
    return { valid: false, resolution: null, errors: ['無效的配課計畫'] }
  }

  const errors = []
  const targetExceptionClassNames = exceptionClassNames ?? subjectAdminClassNames ?? []

  if (mode === 'auto') {
    const hasPreAllocated = plan.importedTeacherQuotas?.some((q) => Array.isArray(q.allocatedClassNames))

    let success = false
    let assignmentMap = new Map()

    if (hasPreAllocated) {
      success = true
      for (const quota of plan.importedTeacherQuotas) {
        if (Array.isArray(quota.allocatedClassNames)) {
          for (const clsName of quota.allocatedClassNames) {
            assignmentMap.set(clsName, quota)
          }
        }
      }
    } else {
      const strategy = autoAllocation?.strategy === 'random' ? 'random' : 'class-order'
      const availableBlocks = strategy === 'random'
        ? shuffleClassBlocks(plan.classBlocks, autoAllocation?.seed)
        : plan.classBlocks
      const res = allocateClassesToQuotas(plan.importedTeacherQuotas, availableBlocks)
      success = res.success
      assignmentMap = res.assignmentMap
    }

    if (!success) {
      return {
        valid: false,
        resolution: null,
        errors: ['目前節數無法依每班完整課程節數分配，請檢查匯入資料。'],
      }
    }

    const assignments = []
    for (const block of plan.classBlocks) {
      const quota = assignmentMap.get(block.className)
      if (quota) {
        if (quota.teacherType === 'homeroom' && !quota.teacherName) {
          return {
            valid: false,
            resolution: null,
            errors: [`班級「${block.className}」未設定導師，無法分配導師混合節數`],
          }
        }
        assignments.push({
          className: block.className,
          teacherName: quota.teacherName,
          teacherType: quota.teacherType,
          periods: block.periods,
        })
      } else {
        if (plan.defaultRoleGroup === 'homeroom') {
          if (!block.homeroomTeacherName) {
            return {
              valid: false,
              resolution: null,
              errors: [`班級「${block.className}」未設定導師，無法分配導師混合節數`],
            }
          }
          assignments.push({
            className: block.className,
            teacherName: block.homeroomTeacherName,
            teacherType: 'homeroom',
            periods: block.periods,
          })
        } else {
          assignments.push({
            className: block.className,
            teacherName: '',
            teacherType: 'subject-admin',
            periods: block.periods,
          })
        }
      }
    }

    return {
      valid: true,
      resolution: {
        mode: 'auto',
        subject: plan.subject,
        assignments,
      },
      errors: [],
    }
  }

  if (mode === 'manual') {
    // 1. 重複班級檢查
    if (new Set(targetExceptionClassNames).size !== targetExceptionClassNames.length) {
      errors.push('選擇的班級包含重複項目')
    }

    // 2. 無效班級檢查
    const validClassMap = new Map(plan.classBlocks.map((b) => [b.className, b]))
    for (const name of targetExceptionClassNames) {
      if (!validClassMap.has(name)) {
        errors.push(`含有非該年級之無效班級「${name}」`)
      }
    }

    // 3. 節數加總檢查
    const selectedBlocks = targetExceptionClassNames.map((name) => validClassMap.get(name)).filter(Boolean)
    const selectedPeriods = selectedBlocks.reduce((sum, b) => sum + b.periods, 0)
    const targetImportedPeriods = plan.importedPeriods ?? plan.importedSubjectAdminPeriods ?? 0

    if (selectedPeriods < targetImportedPeriods) {
      const label = plan.defaultRoleGroup === 'homeroom' ? '科任／行政' : '導師'
      errors.push(`${label}分配節數不足匯入配額`)
    } else if (selectedPeriods > targetImportedPeriods) {
      const label = plan.defaultRoleGroup === 'homeroom' ? '科任／行政' : '導師'
      errors.push(`${label}分配節數超過匯入配額`)
    }

    // 4. 整班可換算性檢查
    const { success, assignmentMap } = allocateClassesToQuotas(plan.importedTeacherQuotas, selectedBlocks)
    if (!success && errors.length === 0) {
      errors.push('目前節數無法依每班完整課程節數分配，請檢查匯入資料。')
    }

    if (errors.length > 0) {
      return { valid: false, resolution: null, errors }
    }

    const assignments = []
    for (const block of plan.classBlocks) {
      const quota = assignmentMap.get(block.className)
      if (quota) {
        if (quota.teacherType === 'homeroom' && !quota.teacherName) {
          errors.push(`班級「${block.className}」未設定導師，無法分配導師混合節數`)
        } else {
          assignments.push({
            className: block.className,
            teacherName: quota.teacherName,
            teacherType: quota.teacherType,
            periods: block.periods,
          })
        }
      } else {
        if (plan.defaultRoleGroup === 'homeroom') {
          if (!block.homeroomTeacherName) {
            errors.push(`班級「${block.className}」未設定導師，無法分配導師混合節數`)
          } else {
            assignments.push({
              className: block.className,
              teacherName: block.homeroomTeacherName,
              teacherType: 'homeroom',
              periods: block.periods,
            })
          }
        } else {
          assignments.push({
            className: block.className,
            teacherName: '',
            teacherType: 'subject-admin',
            periods: block.periods,
          })
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, resolution: null, errors }
    }

    return {
      valid: true,
      resolution: {
        mode: 'manual',
        subject: plan.subject,
        assignments,
      },
      errors: [],
    }
  }

  return { valid: false, resolution: null, errors: ['未知的模式'] }
}

/**
 * 將已確認的混合配課決議不可變寫入班級 course_requirements
 *
 * @param {Array} classes
 * @param {Array} resolutions
 * @returns {Array} nextClasses
 */
export function applyResolvedMixedTeachingPlans(classes = [], resolutions = []) {
  if (!Array.isArray(classes)) return []

  // 深拷貝 classes 陣列及其內部 course_requirements，確保不可變 (Immutable)
  const nextClasses = classes.map((cls) => ({
    ...cls,
    course_requirements: Array.isArray(cls.course_requirements) ? cls.course_requirements.map((req) => ({ ...req })) : [],
  }))

  const assignmentMap = new Map() // className::subject -> assignment

  for (const resItem of resolutions) {
    const resolutionObj = resItem?.resolution || resItem
    if (!resolutionObj || !Array.isArray(resolutionObj.assignments)) continue

    const subject = resItem.subject || resolutionObj.subject

    for (const assign of resolutionObj.assignments) {
      const key = `${assign.className}::${subject}`
      assignmentMap.set(key, assign)
    }
  }

  for (const cls of nextClasses) {
    for (const req of cls.course_requirements) {
      // 比對科目名稱
      for (const [key, assign] of assignmentMap.entries()) {
        const [targetClass, targetSubject] = key.split('::')
        if (targetClass === cls.name && (req.subject === targetSubject || isSubjectMatch(req.subject, targetSubject))) {
          req.teacher = assign.teacherName
          req.teacher_name = assign.teacherName || ''
          req.isAutoAssigned = true
          req.assignmentSource = 'mixed-import'
        }
      }
    }
  }

  return nextClasses
}
