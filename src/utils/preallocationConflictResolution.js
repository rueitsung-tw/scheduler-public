function getCell(timetable, day, period) {
  if (!timetable) return null
  const dayIdx = day - 1
  const periodIdx = period - 1

  if (Array.isArray(timetable)) {
    return timetable[dayIdx]?.[periodIdx] || null
  }

  if (typeof timetable === 'object') {
    return timetable[day]?.[period] || timetable[dayIdx]?.[periodIdx] || null
  }

  return null
}

export function buildPreallocationConflictPlan(existingClass, importedEntries = []) {
  const className = existingClass?.name || importedEntries[0]?.className || '未知班級'
  const conflicts = []

  if (existingClass) {
    for (const entry of importedEntries) {
      // 1. 授課教師不一致衝突 (TEACHER_ASSIGNMENT)
      const existingReq = (existingClass.course_requirements || []).find(
        (r) => r.subject === entry.subject || (entry.subject === '語文-本土語' && r.subject === '本土語'),
      )
      const existingTeacher = existingReq?.teacher_name || existingReq?.teacher || ''
      if (existingTeacher && entry.teacher && existingTeacher !== entry.teacher) {
        conflicts.push({
          kind: 'TEACHER_ASSIGNMENT',
          className,
          subject: entry.subject,
          originalTeacher: existingTeacher,
          importedTeacher: entry.teacher,
        })
      }

      // 2. 時段內容 / 人工鎖定衝突 (TIMETABLE_CELL / MANUAL_LOCK)
      const slot = entry.originalSlot || { day: 1, period: 1 }
      const cell = getCell(existingClass.timetable, slot.day, slot.period)
      if (cell) {
        const cellSubject = cell.subject || cell.name || ''
        const cellTeacher = cell.teacher_name || cell.teacher || ''
        const isLocked = !!cell.isLocked

        if (cellSubject || cellTeacher || isLocked) {
          conflicts.push({
            kind: isLocked ? 'MANUAL_LOCK' : 'TIMETABLE_CELL',
            className,
            subject: entry.subject,
            slot,
            originalContent: cellSubject ? `${cellSubject}${cellTeacher ? ` (${cellTeacher})` : ''}` : '既有時段鎖定',
            importedContent: `${entry.subject} (${entry.teacher})`,
            isLocked,
          })
        }
      }
    }
  }

  return {
    className,
    importedEntries,
    conflicts,
    resolution: conflicts.length > 0 ? 'unresolved' : 'overwrite_imported_fields',
  }
}

export function canApplyPreallocationConflictPlan(plan) {
  if (!plan) return false

  if (Array.isArray(plan)) {
    return plan.every((p) => canApplyPreallocationConflictPlan(p))
  }

  if (plan.classPlans && Array.isArray(plan.classPlans)) {
    return plan.classPlans.every((p) => canApplyPreallocationConflictPlan(p))
  }

  if (plan.conflicts && plan.conflicts.length > 0) {
    return (
      plan.resolution === 'overwrite_imported_fields' ||
      plan.resolution === 'keep_existing_skip_import'
    )
  }

  return plan.resolution !== 'unresolved'
}

export function applyClassResolution(existingClass, plan) {
  if (!existingClass || !plan) return existingClass

  if (plan.resolution === 'keep_existing_skip_import') {
    // SKIPPED_BY_USER: 維持既有資料，跳過匯入
    return existingClass
  }

  const updated = JSON.parse(JSON.stringify(existingClass))

  if (!updated.course_requirements) {
    updated.course_requirements = []
  }

  if (!updated.timetable) {
    updated.timetable = Array.isArray(existingClass.timetable) ? [] : {}
  }

  const entries = plan.importedEntries || []

  // 清理階段：僅在 overwrite_imported_fields 時，清理本計畫要匯入之各科目的既有殘留時段
  if (plan.resolution === 'overwrite_imported_fields') {
    const importedSubjects = new Set(
      entries.map((e) => e.subject || '語文-本土語'),
    )

    const isMatchingSubject = (cellSubject, targetSubject) => {
      if (!cellSubject) return false
      if (cellSubject === targetSubject) return true
      if (
        (targetSubject === '語文-本土語' && cellSubject === '本土語') ||
        (targetSubject === '本土語' && cellSubject === '語文-本土語')
      ) {
        return true
      }
      return false
    }

    importedSubjects.forEach((targetSubj) => {
      if (Array.isArray(updated.timetable)) {
        for (let dIdx = 0; dIdx < updated.timetable.length; dIdx++) {
          if (Array.isArray(updated.timetable[dIdx])) {
            for (let pIdx = 0; pIdx < updated.timetable[dIdx].length; pIdx++) {
              const cell = updated.timetable[dIdx][pIdx]
              if (cell && isMatchingSubject(cell.subject, targetSubj)) {
                updated.timetable[dIdx][pIdx] = null
              }
            }
          }
        }
      } else if (typeof updated.timetable === 'object') {
        Object.keys(updated.timetable).forEach((dKey) => {
          if (updated.timetable[dKey] && typeof updated.timetable[dKey] === 'object') {
            Object.keys(updated.timetable[dKey]).forEach((pKey) => {
              const cell = updated.timetable[dKey][pKey]
              if (cell && isMatchingSubject(cell.subject, targetSubj)) {
                delete updated.timetable[dKey][pKey]
              }
            })
          }
        })
      }
    })
  }

  for (const entry of entries) {
    // 1. 更新 course_requirements
    const req = updated.course_requirements.find(
      (r) => r.subject === entry.subject || (entry.subject === '語文-本土語' && r.subject === '本土語'),
    )
    if (req) {
      req.teacher_name = entry.teacher
      req.teacher = entry.teacher
    } else {
      updated.course_requirements.push({
        subject: entry.subject || '語文-本土語',
        teacher_name: entry.teacher,
        teacher: entry.teacher,
      })
    }

    // 2. 更新 timetable
    const slot = entry.originalSlot || { day: 1, period: 1 }
    const day = slot.day
    const period = slot.period
    const dayIdx = day - 1
    const periodIdx = period - 1

    const newCell = {
      subject: entry.subject || '語文-本土語',
      teacher_name: entry.teacher,
      teacher: entry.teacher,
      isLocked: true,
      lockOrigin: 'native-language-import',
      lockMode: entry.lockMode || 'hard',
      protectedByPullout: !!entry.protectedByPullout,
    }

    if (Array.isArray(updated.timetable)) {
      while (updated.timetable.length <= dayIdx) {
        updated.timetable.push([])
      }
      while (updated.timetable[dayIdx].length <= periodIdx) {
        updated.timetable[dayIdx].push(null)
      }
      const existingCell = updated.timetable[dayIdx][periodIdx] || {}
      updated.timetable[dayIdx][periodIdx] = {
        ...existingCell,
        ...newCell,
      }
    } else if (typeof updated.timetable === 'object') {
      if (!updated.timetable[day]) {
        updated.timetable[day] = {}
      }
      const existingCell = updated.timetable[day][period] || {}
      updated.timetable[day][period] = {
        ...existingCell,
        ...newCell,
      }
    }
  }

  return updated
}
