import { buildPreallocationConflictPlan } from './preallocationConflictResolution.js'

export function formatClassIdToName(classId, classesList = []) {
  if (!classId) return ''

  const rawStr = String(classId).trim()

  // 1. 於 classesList 比對 id 或 name，只有在 match.name 為非空字串時才能 return match.name
  const match = classesList.find(
    (c) => String(c.id).trim() === rawStr || String(c.name || '').trim() === rawStr,
  )
  if (match && typeof match.name === 'string' && match.name.trim() !== '') {
    return match.name.trim()
  }

  // 2. 轉為 501 -> 5年1班 格式
  const numMatch = rawStr.match(/^(\d)(\d{2})$/)
  if (numMatch) {
    const grade = parseInt(numMatch[1], 10)
    const clsNum = parseInt(numMatch[2], 10)
    return `${grade}年${clsNum}班`
  }

  return rawStr
}

export function parseNativeLanguagePreallocation(textOrObject) {
  let payload = textOrObject
  if (typeof textOrObject === 'string') {
    try {
      payload = JSON.parse(textOrObject)
    } catch {
      throw new Error('非有效本土語預排課表 JSON 格式錯誤')
    }
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !payload.canonical ||
    !payload.canonical.scheduleResult ||
    !Array.isArray(payload.canonical.scheduleResult.assignments)
  ) {
    throw new Error('非有效本土語預排課表：缺少 canonical.scheduleResult.assignments')
  }

  return payload
}

export function buildNativeLanguagePreallocationPlan(raw, existingClasses = [], options = {}) {
  const parsed = typeof raw === 'string' ? parseNativeLanguagePreallocation(raw) : raw

  const canonical = parsed.canonical || {}
  const teachers = canonical.teachers || []
  const classesList = canonical.classes || []
  const fixedPulloutBindings = canonical.fixedPulloutBindings || []
  const assignments = canonical.scheduleResult?.assignments || []

  const teacherMap = new Map()
  if (Array.isArray(teachers)) {
    teachers.forEach((t) => teacherMap.set(String(t.id), t.name || t.id))
  } else if (typeof teachers === 'object') {
    Object.entries(teachers).forEach(([id, t]) => {
      teacherMap.set(String(id), typeof t === 'string' ? t : t.name || id)
    })
  }

  const movableSet = new Set(options.movableEntryIds || [])

  const entries = []
  const warnings = []
  const errors = []

  // 僅讀取 language === '台語' 的資料
  const taiwaneseAssignments = assignments.filter((a) => a.language === '台語')

  for (const assignment of taiwaneseAssignments) {
    const rawClassIds = assignment.classIds || (assignment.classId ? [assignment.classId] : [])

    // 一律優先讀取 assignment.slot.day / assignment.slot.period
    const slotDay = assignment.slot ? assignment.slot.day : assignment.day
    const slotPeriod = assignment.slot ? assignment.slot.period : assignment.period
    const day = Number(slotDay) || 1
    const period = Number(slotPeriod) || 1

    for (const rawClassId of rawClassIds) {
      const className = formatClassIdToName(rawClassId, classesList)
      const teacherName = teacherMap.get(String(assignment.teacherId)) || assignment.teacherId || '未指定教師'

      // 檢查此班是否出現在非台語 fixedPulloutBindings
      const protectedByPullout = fixedPulloutBindings.some((binding) => {
        const bindingClassIdStr = String(binding.classId || '').trim()
        const targetClassIdStr = String(rawClassId).trim()
        const targetClassNameStr = String(className).trim()
        const isSameClass =
          bindingClassIdStr === targetClassIdStr ||
          formatClassIdToName(bindingClassIdStr, classesList) === targetClassNameStr

        return isSameClass && binding.language !== '台語'
      })

      const sourceLocked = !!assignment.locked
      const entryId =
        assignment.id ||
        `native:${assignment.teacherId}:${rawClassId}:${day}:${period}`

      // 其他母語綁定保護 或 來源強鎖 -> 強制 hard
      let lockMode = 'hard'
      if (!protectedByPullout && !sourceLocked) {
        if (movableSet.has(entryId)) {
          lockMode = 'movable'
        }
      }

      entries.push({
        id: entryId,
        className,
        subject: '語文-本土語',
        teacher: teacherName,
        originalSlot: {
          day,
          period,
        },
        lockMode,
        sourceLocked,
        protectedByPullout,
        protectionReason: protectedByPullout ? 'OTHER_NATIVE_PULL_OUT' : null,
      })
    }
  }

  // 依班級分組並進行班級與課程需求對照檢查
  const classEntriesMap = new Map()
  entries.forEach((e) => {
    if (!classEntriesMap.has(e.className)) {
      classEntriesMap.set(e.className, [])
    }
    classEntriesMap.get(e.className).push(e)
  })

  const classPlans = []
  const allConflicts = []

  classEntriesMap.forEach((classEntries, className) => {
    const existing = existingClasses.find((c) => c.name === className)

    if (!existing) {
      errors.push({
        code: 'CLASS_NOT_FOUND',
        className,
        message: `目標班級 ${className} 不存在`,
      })
    } else {
      const hasReq = (existing.course_requirements || []).some(
        (r) => r.subject === '語文-本土語' || r.subject === '本土語',
      )
      if (!hasReq) {
        errors.push({
          code: 'COURSE_REQUIREMENT_NOT_FOUND',
          className,
          subject: '語文-本土語',
          message: `目標班級 ${className} 缺少相容課程需求 語文-本土語`,
        })
      }
    }

    const classPlan = buildPreallocationConflictPlan(existing, classEntries)
    classPlans.push(classPlan)
    if (classPlan.conflicts && classPlan.conflicts.length > 0) {
      allConflicts.push(...classPlan.conflicts)
    }
  })

  const hardLockedCount = entries.filter((e) => e.lockMode === 'hard').length
  const movableCount = entries.filter((e) => e.lockMode === 'movable').length
  const protectedCount = entries.filter((e) => e.protectedByPullout).length

  return {
    source: {
      schemaVersion: parsed.schemaVersion || '1.0',
      sourceKind: parsed.source?.kind || 'native-language-scheduler',
    },
    entries,
    classPlans,
    conflicts: allConflicts,
    warnings,
    errors,
    summary: {
      imported: entries.length,
      hardLocked: hardLockedCount,
      movable: movableCount,
      protectedByPullout: protectedCount,
      skipped: 0,
      conflicts: allConflicts.length,
    },
  }
}
