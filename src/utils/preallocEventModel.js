/**
 * 通用預排事件資料模型
 *
 * 純邏輯層：不依賴任何 UI、store、網路。
 * 所有後續任務（Excel 解析、Store 整合、前端頁面）都以此為基礎。
 */

import { normalizeSubject } from './subjectCanonical.js'

/**
 * 產生事件骨架
 * @param {{ subject: string, sourceFileName: string, sourceKind: string }} opts
 * @returns {PreallocationEvent}
 */
export function createPreallocationEvent({ subject, sourceFileName, sourceKind }) {
  return {
    id: crypto.randomUUID(),
    subject: normalizeSubject(subject),
    sourceFileName: sourceFileName || '',
    sourceKind: sourceKind || 'excel',
    status: 'draft',
    allowAdjustment: false,
    createdAt: new Date().toISOString(),
    appliedAt: null,
    completedAt: null,
    slots: [],
    summary: {
      slotsApplied: 0,
      teachersCreated: 0,
      requirementsCreated: 0,
      manualLockedCount: 0,
      useClassroomCount: 0,
      blockers: 0,
      warnings: 0,
    },
  }
}

/**
 * 產生課次
 * @param {{ eventId: string, className: string, teacher: string, subject: string, day: number, period: number }} opts
 * @returns {PreallocationSlot}
 */
export function createPreallocationSlot({ eventId, className, teacher, subject, day, period, useClassroom = false, manualLocked = false }) {
  const slot = {
    id: crypto.randomUUID(),
    eventId,
    className,
    teacher,
    subject: normalizeSubject(subject),
    day,
    period,
    useClassroom: Boolean(useClassroom),
    manualLocked: Boolean(manualLocked),
  }
  return slot
}

/**
 * 驗證事件是否可套用（status==='draft' 且無 blocker）
 * @param {PreallocationEvent} event
 * @returns {boolean}
 */
export function canApplyPreallocationEvent(event) {
  if (event.status !== 'draft') return false
  if (Array.isArray(event._blockers) && event._blockers.length > 0) return false
  return true
}

/**
 * 判斷科目是否需要專科教室
 * @param {string} subject
 * @param {string} className
 * @param {object} schoolInfo
 * @returns {boolean}
 */
function needsSpecialRoom(subject, className, schoolInfo) {
  const subjectClassroomGrades = schoolInfo?.subjectClassroomGrades || {}
  const gradeNum = parseInt(String(className).match(/(\d+)年/)?.[1] || '0', 10)
  if (gradeNum === 0) return false
  const gradeKey = `${gradeNum}年級`
  const grades = subjectClassroomGrades[subject] || []
  return grades.includes(gradeKey)
}

/**
 * 檢查 classrooms 是否有對應專科教室
 * @param {string} subject
 * @param {Array} classrooms
 * @returns {boolean}
 */
function hasSpecialRoomConfigured(subject, classrooms) {
  if (!Array.isArray(classrooms)) return false
  return classrooms.some(c => c.subject === subject || c.name?.includes(subject))
}

/**
 * 計算套用計畫（pure，不修改輸入）
 * @param {PreallocationEvent} event
 * @param {Array} existingClasses
 * @param {object} schoolInfo
 * @returns {ApplyPlan}
 */
export function buildEventApplyPlan(event, existingClasses, schoolInfo) {
  const classMap = new Map()
  for (const cls of existingClasses) {
    classMap.set(cls.name, cls)
  }

  const blockers = []
  const warnings = []
  const teachersToCreateSet = new Set()
  const classUpdatesMap = new Map()
  const existingTeacherNames = new Set()

  // 收集既有教師名稱
  const allTeacherNames = new Set()
  for (const cls of existingClasses) {
    if (Array.isArray(cls.timetable)) {
      for (let d = 0; d < cls.timetable.length; d++) {
        for (let p = 0; p < (cls.timetable[d]?.length || 0); p++) {
          const cell = cls.timetable[d]?.[p]
          if (cell && cell.teacher_name) {
            allTeacherNames.add(cell.teacher_name)
          }
          if (cell && cell.teacher) {
            allTeacherNames.add(cell.teacher)
          }
        }
      }
    }
  }
  for (const name of allTeacherNames) {
    if (name) existingTeacherNames.add(name)
  }

  // 檢查未知教師
  const rejectedTeachers = event._rejectedTeachers || new Set()
  for (const slot of event.slots) {
    if (!existingTeacherNames.has(slot.teacher) && !teachersToCreateSet.has(slot.teacher)) {
      if (rejectedTeachers.has(slot.teacher)) {
        blockers.push({
          code: 'TEACHER_REJECTED',
          message: `教師「${slot.teacher}」已被拒絕，課次（${slot.className} 週${['一','二','三','四','五'][slot.day-1]} 第${slot.period}節）無法套用`,
        })
      } else {
        teachersToCreateSet.add(slot.teacher)
      }
    }
  }

  // 檢查班級存在
  for (const slot of event.slots) {
    if (!classMap.has(slot.className)) {
      blockers.push({
        code: 'CLASS_NOT_FOUND',
        message: `找不到班級「${slot.className}」`,
      })
    }
  }

  // 檢查時段範圍
  for (const slot of event.slots) {
    if (slot.day < 1 || slot.day > 5) {
      blockers.push({
        code: 'SLOT_INVALID_PERIOD',
        message: `班級「${slot.className}」的 day=${slot.day} 不在 1–5 範圍`,
      })
    }
    if (slot.period < 0 || slot.period > 8) {
      blockers.push({
        code: 'SLOT_INVALID_PERIOD',
        message: `班級「${slot.className}」的 period=${slot.period} 不在 0–8 範圍`,
      })
    }
  }

  // 檢查同班同時段重複
  const slotKeySet = new Set()
  for (const slot of event.slots) {
    const key = `${slot.className}-${slot.day}-${slot.period}`
    if (slotKeySet.has(key)) {
      blockers.push({
        code: 'SLOT_DUPLICATE',
        message: `班級「${slot.className}」週${['一','二','三','四','五'][slot.day-1]} 第${slot.period}節重複`,
      })
    }
    slotKeySet.add(key)
  }

  // 建立 teacher 占用索引（從既有 timetable）
  const teacherOccupancy = new Map() // `${day}-${period}-${teacher}` → className
  for (const cls of existingClasses) {
    if (!cls.timetable) continue
    // 支援陣列格式 timetable[d][p]
    if (Array.isArray(cls.timetable)) {
      for (let d = 0; d < cls.timetable.length; d++) {
        for (let p = 0; p < (cls.timetable[d]?.length || 0); p++) {
          const cell = cls.timetable[d]?.[p]
          if (cell && cell.teacher_name) {
            const key = `${d + 1}-${p}-${cell.teacher_name}`
            teacherOccupancy.set(key, cls.name)
          }
        }
      }
    } else {
      // 支援物件格式 timetable[day][period]
      for (const dayStr of Object.keys(cls.timetable)) {
        const dayRow = cls.timetable[dayStr]
        if (!dayRow) continue
        for (const periodStr of Object.keys(dayRow)) {
          const cell = dayRow[periodStr]
          if (cell && cell.teacher_name) {
            const key = `${dayStr}-${periodStr}-${cell.teacher_name}`
            teacherOccupancy.set(key, cls.name)
          }
        }
      }
    }
  }

  // 建立每班級的 timetable patch
  for (const slot of event.slots) {
    const cls = classMap.get(slot.className)
    if (!cls) continue

    if (!classUpdatesMap.has(slot.className)) {
      classUpdatesMap.set(slot.className, {
        timetablePatch: {},
        requirementToCreate: null,
      })
    }
    const update = classUpdatesMap.get(slot.className)

    const dayKey = String(slot.day)
    const periodKey = String(slot.period)

    if (!update.timetablePatch[dayKey]) {
      update.timetablePatch[dayKey] = {}
    }

    // 檢查既有課次是否 manualLocked
    const existingCell = Array.isArray(cls.timetable)
      ? cls.timetable[slot.day - 1]?.[slot.period - 1]
      : cls.timetable?.[slot.day]?.[slot.period]

    if (existingCell && existingCell.manualLocked === true) {
      blockers.push({
        code: 'MANUAL_LOCK_CONFLICT',
        message: `班級「${slot.className}」週${['一','二','三','四','五'][slot.day-1]} 第${slot.period}節已有人工鎖定課次`,
      })
    } else if (existingCell && existingCell.subject) {
      warnings.push({
        code: 'SLOT_OVERWRITE',
        message: `班級「${slot.className}」週${['一','二','三','四','五'][slot.day-1]} 第${slot.period}節將覆蓋既有「${existingCell.subject}」`,
      })
    }

    // 檢查教師衝突
    const teacherKey = `${slot.day}-${slot.period}-${slot.teacher}`
    const occupiedClass = teacherOccupancy.get(teacherKey)
    if (occupiedClass && occupiedClass !== slot.className) {
      warnings.push({
        code: 'TEACHER_CONFLICT',
        message: `教師「${slot.teacher}」在週${['一','二','三','四','五'][slot.day-1]} 第${slot.period}節已被「${occupiedClass}」佔用`,
      })
    }

    // 決定 lockMode
    let lockMode = 'hard'
    if (slot.manualLocked) {
      lockMode = 'hard'
    } else if (event.allowAdjustment === true) {
      lockMode = 'movable'
    }

    // 檢查專科教室
    if (!slot.useClassroom && needsSpecialRoom(slot.subject, slot.className, schoolInfo)) {
      const classrooms = schoolInfo?.classrooms || []
      if (!hasSpecialRoomConfigured(slot.subject, classrooms)) {
        warnings.push({
          code: 'SPECIAL_ROOM_MISSING_CONFIG',
          message: `科目「${slot.subject}」在「${slot.className}」需要專科教室，但系統尚未設定對應教室`,
        })
      }
    }

    update.timetablePatch[dayKey][periodKey] = {
      subject: slot.subject,
      teacher_name: slot.teacher,
      teacher: slot.teacher,
      isLocked: true,
      lockMode,
      lockOrigin: 'prealloc-event',
      preallocEventId: event.id,
      preallocSlotId: slot.id,
      useClassroom: slot.useClassroom || false,
      manualLocked: slot.manualLocked || false,
    }

    // 檢查課程需求
    const courseReqs = cls.course_requirements || []
    const hasReq = courseReqs.some(r => normalizeSubject(r.subject) === normalizeSubject(slot.subject))
    if (!hasReq) {
      update.requirementToCreate = {
        subject: slot.subject,
        periods_per_week: 0, // 由系統後續計算
      }
    }
  }

  // 轉換為陣列
  const classUpdates = []
  for (const [className, update] of classUpdatesMap) {
    classUpdates.push({ className, ...update })
  }

  return {
    classUpdates,
    teachersToCreate: [...teachersToCreateSet],
    blockers,
    warnings,
  }
}

/**
 * 原子性套用；有 blocker → throw Error，不修改原陣列
 * @param {Array} existingClasses
 * @param {ApplyPlan} applyPlan
 * @returns {Array} 新 classes[]
 */
export function applyEventPlanToClasses(existingClasses, applyPlan) {
  if (applyPlan.blockers.length > 0) {
    throw new Error('無法套用：存在阻擋錯誤 - ' + applyPlan.blockers.map(b => b.message).join('；'))
  }

  // 深拷貝 classes
  const newClasses = JSON.parse(JSON.stringify(existingClasses))
  const classMap = new Map()
  for (const cls of newClasses) {
    classMap.set(cls.name, cls)
  }

  for (const update of applyPlan.classUpdates) {
    const cls = classMap.get(update.className)
    if (!cls) continue

    // 確保 timetable 是物件格式
    if (!cls.timetable || Array.isArray(cls.timetable)) {
      // 如果既有是陣列格式，轉換為物件格式
      if (Array.isArray(cls.timetable)) {
        const objTimetable = {}
        for (let d = 0; d < cls.timetable.length; d++) {
          const dayKey = String(d + 1)
          objTimetable[dayKey] = {}
          if (Array.isArray(cls.timetable[d])) {
            for (let p = 0; p < cls.timetable[d].length; p++) {
              const periodKey = String(p + 1)
              objTimetable[dayKey][periodKey] = cls.timetable[d][p] || null
            }
          }
        }
        // 也保留 period 0 (早) 和 8 (午休)
        cls.timetable = objTimetable
      } else if (!cls.timetable) {
        cls.timetable = {}
      }
    }

    // 套用 patch
    for (const [dayKey, periods] of Object.entries(update.timetablePatch)) {
      if (!cls.timetable[dayKey]) {
        cls.timetable[dayKey] = {}
      }
      for (const [periodKey, cell] of Object.entries(periods)) {
        cls.timetable[dayKey][periodKey] = cell
      }
    }

    // 套用課程需求
    if (update.requirementToCreate) {
      if (!Array.isArray(cls.course_requirements)) {
        cls.course_requirements = []
      }
      // 檢查是否已存在
      const exists = cls.course_requirements.some(
        r => normalizeSubject(r.subject) === normalizeSubject(update.requirementToCreate.subject)
      )
      if (!exists) {
        cls.course_requirements.push({ ...update.requirementToCreate })
      }
    }
  }

  return newClasses
}

/**
 * 相容橋接：舊版 nativeLanguagePlan → PreallocationEvent
 * @param {object} nativePlan - 舊版本土語預排計畫
 * @param {string} subject - 科目名稱
 * @returns {PreallocationEvent}
 */
export function adaptNativePlanToEvent(nativePlan, subject) {
  const event = createPreallocationEvent({
    subject,
    sourceFileName: nativePlan.sourceFileName || 'native_language_import',
    sourceKind: 'native_language_fallback',
  })

  event.status = 'applied'
  event.appliedAt = nativePlan.appliedAt || new Date().toISOString()

  if (Array.isArray(nativePlan.entries)) {
    event.slots = nativePlan.entries.map((entry, i) => {
      return createPreallocationSlot({
        eventId: event.id,
        className: entry.className || entry.class_name || '',
        teacher: entry.teacher || entry.teacher_name || '',
        subject,
        day: entry.day || 1,
        period: entry.period ?? 1,
      })
    })
  }

  // 計算 summary
  event.summary = {
    slotsApplied: event.slots.length,
    teachersCreated: 0,
    requirementsCreated: 0,
    manualLockedCount: event.slots.filter(s => s.manualLocked).length,
    useClassroomCount: event.slots.filter(s => s.useClassroom).length,
    blockers: 0,
    warnings: 0,
  }

  return event
}