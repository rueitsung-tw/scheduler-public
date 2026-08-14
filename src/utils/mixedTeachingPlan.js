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

function isRoleInGroup(teacherType, roleGroup) {
  const isHomeroom = teacherType === 'homeroom'
  return roleGroup === 'homeroom' ? isHomeroom : !isHomeroom
}

function getTeacherIdentityKey(teacherId, teacherName) {
  return teacherId != null && String(teacherId).trim() !== ''
    ? `id:${String(teacherId)}`
    : `name:${normalizeTeacherName(teacherName)}`
}

function allocateNamedQuotas(quotas = [], availableBlocks = [], assignmentMap = new Map()) {
  const errors = []
  const blockByName = new Map(availableBlocks.map((block) => [block.className, block]))
  const assignedNames = new Set(assignmentMap.keys())
  const remainingQuotas = []

  for (const quota of quotas) {
    const explicitClassNames = Array.isArray(quota.allocatedClassNames) ? quota.allocatedClassNames : []
    const ownClass = explicitClassNames.length === 0 && quota.teacherType === 'homeroom'
      ? availableBlocks.find((block) => block.homeroomTeacherName === quota.teacherName && block.periods <= quota.periods)
      : null
    const allocatedClassNames = ownClass ? [ownClass.className] : explicitClassNames
    let allocatedPeriods = 0
    for (const className of allocatedClassNames) {
      const block = blockByName.get(className)
      if (!block) {
        errors.push(`系統找不到班級「${className}」對應的班級需求`)
        continue
      }
      if (assignedNames.has(className)) {
        errors.push(`班級「${className}」被重複指定授課教師`)
        continue
      }
      assignmentMap.set(className, quota)
      assignedNames.add(className)
      allocatedPeriods += block.periods
    }

    if (allocatedPeriods > quota.periods) {
      errors.push(`教師「${quota.teacherName}」指定班級節數超過匯入配額`)
      continue
    }
    if (allocatedPeriods < quota.periods) {
      remainingQuotas.push({ ...quota, periods: quota.periods - allocatedPeriods, allocatedClassNames: [] })
    }
  }

  if (errors.length > 0) return { success: false, assignmentMap, errors }

  const freeBlocks = availableBlocks.filter((block) => !assignedNames.has(block.className))
  const allocated = allocateClassesToQuotas(remainingQuotas, freeBlocks)
  if (!allocated.success) return { success: false, assignmentMap, errors: [] }

  for (const [className, quota] of allocated.assignmentMap) assignmentMap.set(className, quota)
  return { success: true, assignmentMap, errors: [] }
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
          teacherQuotasMap: new Map(), // teacher identity -> quota
        })
      }
      const group = groupedRules.get(key)
      const teacherId = teacher?.id ?? row.teacherId ?? null
      const teacherName = normalizeTeacherName(teacher?.name) || normalizeTeacherName(row.teacherName)
      const teacherKey = getTeacherIdentityKey(teacherId, teacherName)
      const currentPeriods = group.teacherQuotasMap.get(teacherKey)?.periods || 0
      const newPeriods = currentPeriods + Number(rule.periods || 0)

      group.teacherQuotasMap.set(teacherKey, {
        teacherId,
        teacherName,
        teacherType,
        periods: newPeriods,
      })

      if (!group.rawRuleItems) {
        group.rawRuleItems = []
      }
      group.rawRuleItems.push({
        teacherName,
        teacherId,
        teacherKey,
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

    const allQuotas = Array.from(teacherQuotasMap.values())
    const defaultRoleTeacherQuotas = allQuotas.filter((q) => isRoleInGroup(q.teacherType, defaultRoleGroup))
    const exceptionTeacherQuotas = allQuotas.filter((q) => isRoleInGroup(q.teacherType, exceptionRoleGroup))
    const namedTeacherQuotas = [...defaultRoleTeacherQuotas, ...exceptionTeacherQuotas]
    const defaultRoleNamedPeriods = defaultRoleTeacherQuotas.reduce((sum, q) => sum + q.periods, 0)
    const exceptionRoleNamedPeriods = exceptionTeacherQuotas.reduce((sum, q) => sum + q.periods, 0)
    const allNamedPeriods = defaultRoleNamedPeriods + exceptionRoleNamedPeriods

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

    if (allNamedPeriods > totalDemandPeriods) {
      blockers.push({
        key,
        grade,
        subject,
        cause: `${grade} 年級科目「${subject}」匯入節數（${allNamedPeriods} 堂）超過總需求（${totalDemandPeriods} 堂）`,
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
    const reservedMap = new Map() // className -> teacher identity
    const teacherClassMap = new Map() // teacher identity -> Set<className>
    let groupBlockerCause = null
    let hasTargetSpecs = false

    const hasAnySourceKind = rawRuleItems.some((item) => item.rule && item.rule.sourceKind)

    if (hasAnySourceKind) {
      hasTargetSpecs = true

      // Pass 1: Reserve class-specific targets first
      for (const item of rawRuleItems) {
        const { teacherKey, rule } = item
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
            if (prevTeacher !== teacherKey) {
              groupBlockerCause = `班級「${clsName}」科目「${subject}」指定標的與其他匯入分配衝突`
              break
            }
          }
          if (targetBlock.isLocked) {
            groupBlockerCause = `班級「${clsName}」科目「${subject}」已鎖定，無法套用匯入分配`
            break
          }

          reservedMap.set(clsName, teacherKey)
          if (!teacherClassMap.has(teacherKey)) teacherClassMap.set(teacherKey, new Set())
          teacherClassMap.get(teacherKey).add(clsName)
        }
        if (groupBlockerCause) break
      }

      // Pass 2: Reserve all-eligible targets
      if (!groupBlockerCause) {
        for (const item of rawRuleItems) {
          const { teacherKey, rule } = item
          if (!rule || rule.sourceKind !== 'all-eligible') continue
          const targets = Array.isArray(rule.targetClassNames) && rule.targetClassNames.length > 0
            ? rule.targetClassNames
            : classBlocks.map((b) => b.className)

          for (const clsName of targets) {
            const targetBlock = classBlocks.find((b) => b.className === clsName)
            if (!targetBlock) continue
            if (reservedMap.has(clsName)) {
              const prevTeacher = reservedMap.get(clsName)
              if (prevTeacher !== teacherKey) {
                groupBlockerCause = `班級「${clsName}」科目「${subject}」指定標的與其他匯入分配衝突`
                break
              }
            }
            if (targetBlock.isLocked) {
              groupBlockerCause = `班級「${clsName}」科目「${subject}」已鎖定，無法套用匯入分配`
              break
            }

            reservedMap.set(clsName, teacherKey)
            if (!teacherClassMap.has(teacherKey)) teacherClassMap.set(teacherKey, new Set())
            teacherClassMap.get(teacherKey).add(clsName)
          }
          if (groupBlockerCause) break
        }
      }

      // Pass 3: Reserve grade-batch targets from remaining unreserved candidates in natural class order
      if (!groupBlockerCause) {
        for (const item of rawRuleItems) {
          const { teacherKey, rule } = item
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
            reservedMap.set(clsName, teacherKey)
            if (!teacherClassMap.has(teacherKey)) teacherClassMap.set(teacherKey, new Set())
            teacherClassMap.get(teacherKey).add(clsName)
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
      for (const q of namedTeacherQuotas) {
        const assignedSet = teacherClassMap.get(getTeacherIdentityKey(q.teacherId, q.teacherName))
        if (assignedSet) {
          q.allocatedClassNames = Array.from(assignedSet)
        }
      }
    }

    const implicitDefaultPeriods = totalDemandPeriods - allNamedPeriods
    const defaultRolePeriods = defaultRoleNamedPeriods + implicitDefaultPeriods
    const homeroomPeriods = defaultRoleGroup === 'homeroom'
      ? defaultRolePeriods
      : exceptionRoleNamedPeriods
    const subjectAdminPeriods = defaultRoleGroup === 'subject-admin'
      ? defaultRolePeriods
      : exceptionRoleNamedPeriods
    const importedSubjectAdminPeriods = subjectAdminPeriods
    const importedHomeroomPeriods = homeroomPeriods
    const forcedExceptionClassNames = Array.from(new Set(
      exceptionTeacherQuotas.flatMap((quota) => Array.isArray(quota.allocatedClassNames) ? quota.allocatedClassNames : [])
    ))
    const forcedDefaultClassNames = Array.from(new Set(
      defaultRoleTeacherQuotas.flatMap((quota) => Array.isArray(quota.allocatedClassNames) ? quota.allocatedClassNames : [])
    ))

    // 建立 MixedTeachingPlan (僅當兩個角色群組各自承擔正節數時)
    if (homeroomPeriods > 0 && subjectAdminPeriods > 0) {
      plans.push({
        key,
        grade,
        subject,
        defaultTeacher: planDefaultTeacher,
        defaultRoleGroup,
        exceptionRoleGroup,
        totalDemandPeriods,
        importedPeriods: exceptionRoleNamedPeriods,
        importedSubjectAdminPeriods,
        importedHomeroomPeriods,
        defaultRolePeriods,
        homeroomPeriods,
        subjectAdminPeriods,
        defaultRoleTeacherQuotas,
        exceptionTeacherQuotas,
        namedTeacherQuotas,
        defaultRoleNamedPeriods,
        exceptionRoleNamedPeriods,
        allNamedPeriods,
        implicitDefaultPeriods,
        forcedExceptionClassNames,
        forcedDefaultClassNames,
        // 保留舊介面：混合視窗的手動例外班級仍以此配額為準。
        importedTeacherQuotas: exceptionTeacherQuotas,
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
  const requestedExceptionClassNames = exceptionClassNames ?? subjectAdminClassNames ?? []
  const namedTeacherQuotas = plan.namedTeacherQuotas ?? plan.importedTeacherQuotas ?? []
  const exceptionTeacherQuotas = plan.exceptionTeacherQuotas ?? plan.importedTeacherQuotas ?? []
  const defaultRoleTeacherQuotas = plan.defaultRoleTeacherQuotas ?? []
  const forcedExceptionClassNames = plan.forcedExceptionClassNames ?? Array.from(new Set(
    exceptionTeacherQuotas.flatMap((quota) => Array.isArray(quota.allocatedClassNames) ? quota.allocatedClassNames : [])
  ))
  const forcedDefaultClassNames = plan.forcedDefaultClassNames ?? Array.from(new Set(
    defaultRoleTeacherQuotas.flatMap((quota) => Array.isArray(quota.allocatedClassNames) ? quota.allocatedClassNames : [])
  ))
  // A fixed default-role target belongs to the default allocation even if a stale UI submits it as an exception.
  const targetExceptionClassNames = requestedExceptionClassNames.filter((name) => !forcedDefaultClassNames.includes(name))

  function buildAssignments(assignmentMap) {
    const assignments = []
    for (const block of plan.classBlocks) {
      const quota = assignmentMap.get(block.className)
      if (quota) {
        if (!quota.teacherName) return { error: `班級「${block.className}」未指定授課教師` }
        assignments.push({
          className: block.className,
          teacherName: quota.teacherName,
          teacherId: quota.teacherId ?? null,
          teacherType: quota.teacherType,
          periods: block.periods,
        })
        continue
      }

      if (plan.defaultRoleGroup === 'homeroom') {
        if (!block.homeroomTeacherName) return { error: `班級「${block.className}」未設定導師，無法分配導師混合節數` }
        assignments.push({
          className: block.className,
          teacherName: block.homeroomTeacherName,
          teacherId: null,
          teacherType: 'homeroom',
          periods: block.periods,
        })
        continue
      }

      return { error: `科任／行政剩餘 ${plan.implicitDefaultPeriods ?? block.periods} 堂未指定教師` }
    }
    return { assignments }
  }

  if (mode === 'auto') {
    const strategy = autoAllocation?.strategy === 'random' ? 'random' : 'class-order'
    const availableBlocks = strategy === 'random'
      ? shuffleClassBlocks(plan.classBlocks, autoAllocation?.seed)
      : plan.classBlocks
    const allocation = allocateNamedQuotas(namedTeacherQuotas, availableBlocks)

    if (!allocation.success) {
      return {
        valid: false,
        resolution: null,
        errors: allocation.errors.length > 0 ? allocation.errors : ['目前節數無法依每班完整課程節數分配，請檢查匯入資料。'],
      }
    }

    const built = buildAssignments(allocation.assignmentMap)
    if (built.error) return { valid: false, resolution: null, errors: [built.error] }

    return {
      valid: true,
      resolution: {
        mode: 'auto',
        subject: plan.subject,
        assignments: built.assignments,
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
    const effectiveExceptionClassNames = [
      ...forcedExceptionClassNames,
      ...targetExceptionClassNames.filter((name) => !forcedExceptionClassNames.includes(name)),
    ]
    const validClassMap = new Map(plan.classBlocks.map((b) => [b.className, b]))
    for (const name of effectiveExceptionClassNames) {
      if (!validClassMap.has(name)) {
        errors.push(`含有非該年級之無效班級「${name}」`)
      }
    }

    // 3. 節數加總檢查
    const selectedBlocks = effectiveExceptionClassNames.map((name) => validClassMap.get(name)).filter(Boolean)
    const selectedPeriods = selectedBlocks.reduce((sum, b) => sum + b.periods, 0)
    const targetImportedPeriods = plan.exceptionRoleNamedPeriods ?? plan.importedPeriods ?? plan.importedSubjectAdminPeriods ?? 0

    if (selectedPeriods < targetImportedPeriods) {
      const label = plan.defaultRoleGroup === 'homeroom' ? '科任／行政' : '導師'
      errors.push(`${label}分配節數不足匯入配額`)
    } else if (selectedPeriods > targetImportedPeriods) {
      const label = plan.defaultRoleGroup === 'homeroom' ? '科任／行政' : '導師'
      errors.push(`${label}分配節數超過匯入配額`)
    }

    // 4. 例外群組只從使用者指定的班級選取；預設群組分配其餘班級。
    const selectedNames = new Set(effectiveExceptionClassNames)
    const exceptionAllocation = allocateNamedQuotas(exceptionTeacherQuotas, selectedBlocks)
    const defaultBlocks = plan.classBlocks.filter((block) => !selectedNames.has(block.className))
    const defaultAllocation = allocateNamedQuotas(defaultRoleTeacherQuotas, defaultBlocks, exceptionAllocation.assignmentMap)
    if ((!exceptionAllocation.success || !defaultAllocation.success) && errors.length === 0) {
      errors.push('目前節數無法依每班完整課程節數分配，請檢查匯入資料。')
    }
    errors.push(...exceptionAllocation.errors, ...defaultAllocation.errors)

    if (errors.length > 0) {
      return { valid: false, resolution: null, errors }
    }

    const built = buildAssignments(defaultAllocation.assignmentMap)
    if (built.error) errors.push(built.error)
    if (errors.length > 0) return { valid: false, resolution: null, errors }

    return {
      valid: true,
      resolution: {
        mode: 'manual',
        subject: plan.subject,
        forcedExceptionClassNames,
        forcedDefaultClassNames,
        assignments: built.assignments,
      },
      errors: [],
    }
  }

  return { valid: false, resolution: null, errors: ['未知的模式'] }
}

function normalizeTeacherName(value) {
  return String(value || '').trim()
}

function findTeacherIdentity(row, teachers = []) {
  const rowId = row?.teacherId
  const rowName = normalizeTeacherName(row?.teacherName)
  const byId = rowId != null
    ? teachers.find((teacher) => String(teacher?.id) === String(rowId))
    : null
  const byName = rowName
    ? teachers.find((teacher) => normalizeTeacherName(teacher?.name) === rowName)
    : null
  const teacher = byId ?? byName
  return {
    teacherId: teacher?.id ?? rowId ?? null,
    teacherName: normalizeTeacherName(teacher?.name) || rowName,
  }
}

function isSameLedgerTeacher(entry, identity) {
  if (identity.teacherId != null && entry?.teacherId != null) {
    return String(entry.teacherId) === String(identity.teacherId)
  }
  return normalizeTeacherName(entry?.teacherName) === identity.teacherName
}

/**
 * 由已確認的混合配課決議建立「本次匯入」實際落班帳本。
 * 此帳本不讀取 classes，避免前次同名教師既有配課被誤算為本次匯入成果。
 */
export function buildMixedTeachingAssignmentLedger({ resolutions = [], teachers = [] } = {}) {
  if (!Array.isArray(resolutions)) return []

  return resolutions.flatMap((item) => {
    const resolution = item?.resolution || item
    const grade = Number(item?.grade ?? resolution?.grade)
    const subject = String(item?.subject || resolution?.subject || '').trim()
    if (!resolution || !Array.isArray(resolution.assignments) || grade <= 0 || !subject) return []

    return resolution.assignments
      .filter((assignment) => normalizeTeacherName(assignment?.teacherName) && Number(assignment?.periods) > 0)
      .map((assignment) => {
        const teacher = assignment.teacherId != null
          ? teachers.find((candidate) => String(candidate?.id) === String(assignment.teacherId))
          : teachers.find((candidate) => normalizeTeacherName(candidate?.name) === normalizeTeacherName(assignment.teacherName))
        return Object.freeze({
          teacherId: teacher?.id ?? assignment.teacherId ?? null,
          teacherName: normalizeTeacherName(assignment.teacherName),
          grade,
          subject,
          periods: Number(assignment.periods),
          className: assignment.className,
          source: 'mixed-import',
        })
      })
  })
}

/**
 * 檢核本次 Excel 所有具規則教師，是否真的以相同身分、年級、科目與節數落到班級。
 * 空白或「-」公式不會產生 parsed rule，故不在本檢核範圍。
 */
export function validateImportedTeacherAssignments({ parsedRows = [], teachers = [], assignmentLedger = [] } = {}) {
  const errors = []
  if (!Array.isArray(parsedRows)) return { valid: true, errors }
  const ledger = Array.isArray(assignmentLedger) ? assignmentLedger : []
  const expectedAssignments = []

  for (const row of parsedRows) {
    const identity = findTeacherIdentity(row, teachers)
    for (const rule of Array.isArray(row?.rules) ? row.rules : []) {
      const grade = Number(rule?.grade)
      const subject = String(rule?.systemSubject || rule?.subject || '').trim()
      const expectedPeriods = Number(rule?.periods) || 0
      if (grade <= 0 || !subject || expectedPeriods <= 0) continue

      const sameIdentity = (candidate) => (
        candidate.identity.teacherId != null && identity.teacherId != null
          ? String(candidate.identity.teacherId) === String(identity.teacherId)
          : candidate.identity.teacherName === identity.teacherName
      )
      const aggregate = expectedAssignments.find((candidate) => (
        sameIdentity(candidate) &&
        candidate.grade === grade &&
        isSubjectMatch(candidate.subject, subject)
      ))

      if (aggregate) {
        aggregate.expectedPeriods += expectedPeriods
      } else {
        expectedAssignments.push({ identity, grade, subject, expectedPeriods })
      }
    }
  }

  for (const { identity, grade, subject, expectedPeriods } of expectedAssignments) {
    const assignedPeriods = ledger
      .filter((entry) => (
        // 舊版 mixed ledger 沒有 status，仍視為已確認的落班資料；
        // reconciliation 衝突則尚未套用，不得計入匯入完成節數。
        (entry?.status == null || ['created', 'matched-existing', 'overwritten'].includes(entry.status)) &&
        isSameLedgerTeacher(entry, identity) &&
        Number(entry?.grade) === grade &&
        isSubjectMatch(entry?.subject, subject)
      ))
      .reduce((sum, entry) => sum + (Number(entry?.periods) || 0), 0)

    if (Math.abs(assignedPeriods - expectedPeriods) > 1e-6) {
      errors.push(`教師「${identity.teacherName}」${grade} 年級科目「${subject}」應配 ${expectedPeriods} 節，實際已配 ${assignedPeriods} 節`)
    }
  }

  return { valid: errors.length === 0, errors }
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
