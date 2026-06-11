import { getSubjectGradeValidation } from './gradeSubjectUtils.js'
import { normalizeSubject } from './subjectCanonical.js'

function normalizeWeekTag(week) {
  const value = String(week || 'both').trim().toLowerCase()
  if (['odd', 'single', 'oddweek', '單', '單週'].includes(value)) return 'odd'
  if (['even', 'double', 'evenweek', '雙', '雙週'].includes(value)) return 'even'
  return 'both'
}

function getOccurrenceWeight(week) {
  return normalizeWeekTag(week) === 'both' ? 1 : 0.5
}

function getGradeFromClassInfo(classInfo = {}, className = '') {
  const numeric = Number(classInfo?.grade)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  const match = String(className || '').match(/(\d+)/)
  return match ? Number.parseInt(match[1], 10) : 0
}

function isVirtualTeacherName(name) {
  return ['虛擬', '外聘', '待排'].some((keyword) => String(name || '').includes(keyword))
}

function shouldSuppressTeacherConflict(teacher, classNames, classMap, aiSettings = {}) {
  if (!aiSettings?.artsClassEnabled || !isVirtualTeacherName(teacher)) return false
  return classNames.every((className) => classMap.get(String(className || '').trim())?.isArtsClass)
}

function gradeNeedsSpecialRoom(subject, grade, schoolInfo = {}) {
  const canonical = normalizeSubject(subject)
  const rawConfig = schoolInfo?.subjectClassroomGrades || {}
  const normalizedCfg = {}

  for (const [subjectKey, grades] of Object.entries(rawConfig)) {
    normalizedCfg[normalizeSubject(subjectKey)] = Array.isArray(grades)
      ? grades.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : []
  }

  if (canonical in normalizedCfg) {
    return normalizedCfg[canonical].includes(Number(grade))
  }

  if (['音樂', '美勞', '自然科學'].includes(canonical) && Number(grade) <= 2) {
    return false
  }

  return true
}

function configuredSpecialRoomSubjects(classrooms = [], classroomLimits = {}, schoolInfo = {}, fallbackLimits = {}) {
  const subjects = new Set()

  for (const room of classrooms) {
    const subject = normalizeSubject(room?.subject)
    if (subject) subjects.add(subject)
  }

  for (const subject of Object.keys(classroomLimits || {})) {
    const normalized = normalizeSubject(subject)
    if (normalized) subjects.add(normalized)
  }

  for (const subject of Object.keys(schoolInfo?.subjectClassroomGrades || {})) {
    const normalized = normalizeSubject(subject)
    if (normalized) subjects.add(normalized)
  }

  for (const subject of Object.keys(fallbackLimits || {})) {
    const normalized = normalizeSubject(subject)
    if (normalized) subjects.add(normalized)
  }

  return subjects
}

export function validateRepairHardConstraints(scheduleEntries = [], payloadData = {}) {
  const errors = []
  const schoolInfo = payloadData?.schoolInfo || {}
  const aiSettings = payloadData?.aiSettings || {}
  const classMap = new Map(
    (Array.isArray(payloadData?.classes) ? payloadData.classes : []).map((item) => [String(item?.name || '').trim(), item])
  )

  const teacherSlots = new Map()
  for (const entry of scheduleEntries) {
    const teacher = String(entry?.teacherName || '').trim()
    if (!teacher) continue
    const key = `${entry.day}-${entry.period}-${normalizeWeekTag(entry.week)}-${teacher}`
    if (teacherSlots.has(key)) {
      const existingClasses = teacherSlots.get(key)
      const conflictClasses = [...existingClasses, entry.className]
      if (shouldSuppressTeacherConflict(teacher, conflictClasses, classMap, aiSettings)) {
        existingClasses.push(entry.className)
        continue
      }
      errors.push(
        `Teacher conflict: ${teacher} at day ${entry.day} period ${entry.period} week ${normalizeWeekTag(entry.week)} in classes ${existingClasses.join(', ')} and ${entry.className}`
      )
      existingClasses.push(entry.className)
    } else {
      teacherSlots.set(key, [entry.className])
    }
  }

  const classrooms = Array.isArray(payloadData?.classrooms) ? payloadData.classrooms : []

  const actualRoomCount = new Map()
  for (const room of classrooms) {
    const subject = normalizeSubject(room?.subject)
    if (!subject) continue
    actualRoomCount.set(subject, (actualRoomCount.get(subject) || 0) + 1)
  }

  const normalizedLimits = new Map()
  for (const [subject, limit] of Object.entries(schoolInfo?.classroomLimits || {})) {
    const normalized = normalizeSubject(subject)
    const numeric = Number(limit)
    if (normalized && Number.isFinite(numeric)) {
      normalizedLimits.set(normalized, numeric)
    }
  }

  const fallbackLimits = {
    '自然科學': 2,
    '語文-英語': 2,
    '音樂': 2,
    '美勞': 2,
    '體育': 3,
    '資訊': 2,
  }

  const constrainedSubjects = configuredSpecialRoomSubjects(classrooms, schoolInfo?.classroomLimits, schoolInfo, fallbackLimits)
  const capacityCountBySubject = new Map()
  for (const subject of constrainedSubjects) {
    const count = actualRoomCount.get(subject) || normalizedLimits.get(subject) || fallbackLimits[subject] || 0
    capacityCountBySubject.set(subject, count)
  }

  const roomUsage = new Map()
  for (const entry of scheduleEntries) {
    const subject = normalizeSubject(entry?.subject)
    const className = String(entry?.className || '').trim()
    const classInfo = classMap.get(className) || {}
    const grade = getGradeFromClassInfo(classInfo, className)

    const validation = getSubjectGradeValidation(
      subject,
      grade,
      schoolInfo,
      payloadData?.standardDomainSettings || [],
    )
    if (!validation.allowed) {
      errors.push(
        `Grade-subject issue: ${className} day ${entry.day} period ${entry.period} subject=${subject} grade=${grade}`
      )
    }

    if (!subject || !constrainedSubjects.has(subject)) continue
    if (!gradeNeedsSpecialRoom(subject, grade, schoolInfo)) continue

    const usageKey = `${subject}|${entry.day}|${entry.period}|${normalizeWeekTag(entry.week)}`
    roomUsage.set(usageKey, (roomUsage.get(usageKey) || 0) + getOccurrenceWeight(entry.week))
  }

  for (const [usageKey, used] of roomUsage.entries()) {
    const [subject, day, period, week] = usageKey.split('|')
    const capacity = capacityCountBySubject.get(subject) || 0
    if (used > capacity) {
      errors.push(
        `Room overload: ${subject} at day ${day} period ${period} week ${week} usage=${used} capacity=${capacity}`
      )
    }
  }

  return errors
}
