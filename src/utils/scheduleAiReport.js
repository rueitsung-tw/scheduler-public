import { buildAiTuningCandidatePool } from '../services/aiTuningCandidates.js'
import { normalizeSubject } from './subjectCanonical.js'
import { getSubjectGradeValidation } from './gradeSubjectUtils.js'

const EMPTY_CELL = '--'

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function cloneEntries(entries) {
  return JSON.parse(JSON.stringify(entries || []))
}

function buildSlotKey(day, period) {
  return `${day}-${period}`
}

function buildSlotWeekKey(day, period, week) {
  return `${day}-${period}-${week}`
}

export function getGradeFromClassName(className) {
  const match = String(className || '').match(/(\d+)/)
  return match ? Number.parseInt(match[1], 10) : 0
}

// re-export normalizeSubject so that external consumers (e.g. useTimetableConflicts)
// continue to work without changing their import paths.
export { normalizeSubject } from './subjectCanonical.js'

export function normalizeTeacher(teacher) {
  if (!teacher) return ''
  return String(teacher).trim()
}

export function splitTeacherNames(teacher) {
  return String(teacher || '')
    .split('/')
    .map((name) => normalizeTeacher(name))
    .filter(Boolean)
}

export function normalizeWeekTag(week, fallback = 'both') {
  const value = String(week || '').trim().toLowerCase()
  if (value === 'odd' || value === 'single' || value === 'oddweek' || value === '單' || value === '單週') return 'odd'
  if (value === 'even' || value === 'double' || value === 'evenweek' || value === '雙' || value === '雙週') return 'even'
  if (value === 'both') return 'both'
  return fallback
}

export function getOccurrenceWeight(week) {
  return normalizeWeekTag(week) === 'both' ? 1 : 0.5
}

function isMusicSubject(subject) {
  const s = normalizeSubject(subject).toLowerCase()
  return s.includes('音樂') || s.includes('music') || s.includes('單')
}

function isArtSubject(subject) {
  const s = normalizeSubject(subject).toLowerCase()
  return s.includes('美勞') || s.includes('art') || s.includes('雙')
}

function isHomeroomLocationName(name) {
  const value = normalizeSubject(name)
  if (!value) return true
  return (
    value === '原班教室' ||
    value === '班級教室' ||
    value === 'homeroom' ||
    value === 'classroom' ||
    value.includes('原班') ||
    value.includes('班級教室')
  )
}

export function getLocationInfo(entry = {}) {
  const classroomId = entry.classroomId ?? entry.roomId ?? ''
  const classroomName = normalizeSubject(entry.classroomName || entry.roomName || '')

  if (classroomId || (classroomName && !isHomeroomLocationName(classroomName))) {
    const keyValue = classroomId ? String(classroomId) : classroomName
    return {
      classroomId: classroomId || '',
      classroomName,
      locationType: 'room',
      locationKey: `room:${keyValue}`,
      locationLabel: classroomName || keyValue,
    }
  }

  return {
    classroomId: '',
    classroomName: classroomName || '',
    locationType: 'homeroom',
    locationKey: 'homeroom',
    locationLabel: '原班教室',
  }
}

export function isExplicitRoomAssignment(entry) {
  return getLocationInfo(entry).locationType === 'room'
}

function buildOccurrence({
  className,
  day,
  period,
  week,
  subject,
  teacher,
  classroomId,
  classroomName,
  isAlternating = false,
  pairGroupId = '',
  pairPartnerClass = '',
  pairRole = '',
  pairDirection = '',
}) {
  const teacherNames = splitTeacherNames(teacher)
  const locationInfo = getLocationInfo({ classroomId, classroomName })

  return {
    className: String(className || '').trim(),
    day: toNumber(day, 0),
    period: toNumber(period, 0),
    week: normalizeWeekTag(week),
    subject: normalizeSubject(subject),
    teacherName: teacherNames.join(' / '),
    teacherNames,
    classroomId: locationInfo.classroomId,
    classroomName: locationInfo.classroomName,
    locationType: locationInfo.locationType,
    locationKey: locationInfo.locationKey,
    locationLabel: locationInfo.locationLabel,
    isAlternating: Boolean(isAlternating),
    pairGroupId: pairGroupId || '',
    pairPartnerClass: pairPartnerClass || '',
    pairRole: pairRole || '',
    pairDirection: pairDirection || '',
  }
}

function isCompatibleAlternatingRoomPair(a, b) {
  if (!a || !b) return false
  if (!a.pairGroupId || !b.pairGroupId) return false
  return String(a.pairGroupId) === String(b.pairGroupId)
}

export function expandTimetableCellEntries(className, day, period, cell = {}) {
  if (!cell || (!normalizeSubject(cell.subject) && !cell.oddWeek && !cell.evenWeek && !normalizeTeacher(cell.teacher))) {
    return []
  }

  const baseProps = {
    className,
    day,
    period,
    classroomId: cell.classroomId,
    classroomName: cell.classroomName,
    isAlternating: Boolean(cell.isAlternating || cell.oddWeek || cell.evenWeek),
    pairGroupId: cell.pairGroupId || '',
    pairPartnerClass: cell.pairPartnerClass || '',
    pairRole: cell.pairRole || '',
    pairDirection: cell.pairDirection || '',
  }

  if (cell.oddWeek || cell.evenWeek) {
    const occurrences = []
    if (cell.oddWeek) {
      occurrences.push(buildOccurrence({
        ...baseProps,
        week: 'odd',
        subject: cell.oddWeek.subject || cell.subject,
        teacher: cell.oddWeek.teacher || cell.teacher,
      }))
    }
    if (cell.evenWeek) {
      occurrences.push(buildOccurrence({
        ...baseProps,
        week: 'even',
        subject: cell.evenWeek.subject || cell.subject,
        teacher: cell.evenWeek.teacher || cell.teacher,
      }))
    }
    return occurrences
  }

  return [
    buildOccurrence({
      ...baseProps,
      week: cell.week || 'both',
      subject: cell.subject,
      teacher: cell.teacher || cell.teacherName,
    }),
  ]
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
}

function formatCell(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return EMPTY_CELL

  if (entries.length === 1) {
    const item = entries[0]
    const subject = normalizeSubject(item.subject) || EMPTY_CELL
    const teacher = item.teacherNames?.length
      ? item.teacherNames.join(' / ')
      : normalizeTeacher(item.teacherName || item.teacher)
    return teacher ? `${subject}<br>${teacher}` : subject
  }

  if (isAlternatingPair(entries)) {
    const subjectText = entries
      .map((entry) => normalizeSubject(entry.subject))
      .filter(Boolean)
      .join(' / ')
    const teacherText = entries
      .map((entry) => {
        if (Array.isArray(entry.teacherNames) && entry.teacherNames.length > 0) {
          return entry.teacherNames.join(' / ')
        }
        return normalizeTeacher(entry.teacherName || entry.teacher)
      })
      .filter(Boolean)
      .join(' / ')
    return teacherText ? `${subjectText}<br>${teacherText}` : subjectText
  }

  return entries
    .map((entry) => {
      const subject = normalizeSubject(entry.subject) || EMPTY_CELL
      const teacher = Array.isArray(entry.teacherNames) && entry.teacherNames.length > 0
        ? entry.teacherNames.join(' / ')
        : normalizeTeacher(entry.teacherName || entry.teacher)
      return teacher ? `${subject} (${teacher})` : subject
    })
    .join('<br>')
}

function isAlternatingPair(entries) {
  if (!Array.isArray(entries) || entries.length < 2) return false
  const pairGroupId = entries[0]?.pairGroupId
  if (pairGroupId && entries.every((entry) => entry?.pairGroupId === pairGroupId)) {
    return true
  }
  const subjects = entries.map((entry) => normalizeSubject(entry.subject))
  return subjects.some(isMusicSubject) && subjects.some(isArtSubject)
}

function getRequirementTeacher(req) {
  return normalizeTeacher(req?.teacher_name || req?.teacher)
}

function isTeachablePeriod(grade, day, period) {
  if (period <= 4) return true
  if (grade === 1 || grade === 2) return day === 2
  if (grade === 3 || grade === 4) return day === 1 || day === 2 || day === 4
  return day !== 3
}

function isRoomCapacityExempt(subject, className, schoolInfo) {
  const grade = getGradeFromClassName(className)
  const normalizedSubject = normalizeSubject(subject)
  if (!normalizedSubject) return false

  const classroomGradesConfig = schoolInfo?.subjectClassroomGrades || {}
  const matchedKey = Object.keys(classroomGradesConfig).find(
    (key) => normalizedSubject.includes(key) || key.includes(normalizedSubject)
  )

  if (matchedKey) {
    const allowedGrades = classroomGradesConfig[matchedKey] || []
    return !allowedGrades.includes(grade)
  }

  // 英語是否使用專科教室由 schoolInfo.subjectClassroomGrades 決定
  // 不再硬編碼排除 1 年級，避免與 standardDomainSettings/course_requirements 脫鉤

  const isMusicArtScience =
    normalizedSubject.includes('音樂') ||
    normalizedSubject.includes('美勞') ||
    normalizedSubject.includes('自然') ||
    normalizedSubject.includes('資訊')

  if (isMusicArtScience && grade <= 2) return true

  return false
}

/** 判斷是否為導師負責的核心科目（語文-國語、數學）*/
function isHomeroomCoreRequirement(required = {}) {
  const subject = normalizeSubject(required.subject)
  const defaultTeacher = String(required.defaultTeacher || '').trim()
  return defaultTeacher === 'homeroom' && ['語文-國語', '國語', '數學'].includes(subject)
}

/** 當導師核心科目排課節數為 0 時，抑制需求差異假阳性 */
function shouldSuppressRequirementDelta(required = {}, scheduled = 0) {
  return isHomeroomCoreRequirement(required) && Number(scheduled) === 0
}

function getScheduledCountValue(scheduledCountMap, subject) {
  if (!subject) return 0
  if (scheduledCountMap instanceof Map) {
    return scheduledCountMap.get(subject) || 0
  }
  if (scheduledCountMap && typeof scheduledCountMap === 'object') {
    return Number(scheduledCountMap[subject]) || 0
  }
  return 0
}

function isEarlyGradeHealthRequirement(required = {}, classData = {}) {
  const subject = normalizeSubject(required.subject)
  const grade = Number(classData?.grade) || getGradeFromClassName(classData?.name || classData?.className || '')
  return subject === '健康' && grade > 0 && grade <= 2
}

function shouldSuppressAiRequirementDelta(required = {}, scheduled = 0, scheduledCountMap = new Map(), classData = {}) {
  if (shouldSuppressRequirementDelta(required, scheduled)) return true

  const defaultTeacher = String(required.defaultTeacher || '').trim()
  const hasHomeroomBlock = getScheduledCountValue(scheduledCountMap, '導師區塊') > 0
  if (!hasHomeroomBlock) return false

  if (defaultTeacher === 'homeroom') return true

  return isEarlyGradeHealthRequirement(required, classData)
}

function buildRequirementSuppressionReason(required = {}, scheduledCountMap = new Map(), classData = {}) {
  if (shouldSuppressRequirementDelta(required, 0)) {
    return '導師核心科目缺漏由既有抑制規則忽略'
  }

  const defaultTeacher = String(required.defaultTeacher || '').trim()
  if (defaultTeacher === 'homeroom' && getScheduledCountValue(scheduledCountMap, '導師區塊') > 0) {
    return '已偵測導師區塊，導師科目缺漏不納入 AI 微調警示'
  }

  if (isEarlyGradeHealthRequirement(required, classData) && getScheduledCountValue(scheduledCountMap, '導師區塊') > 0) {
    return '低年級健康課缺漏視為導師區塊後續手動調整，不納入 AI 微調警示'
  }

  return ''
}

/** 判斷教師名稱是否為虛擬/外聘教師 */
function isVirtualTeacherName(name) {
  return ['虛擬', '外聘', '待排'].some((keyword) => String(name || '').includes(keyword))
}

/** 當藝才班模式開啟且為虛擬教師時，抑制教師衝突 */
function shouldSuppressTeacherConflict(teacher, classData, aiSettings = {}) {
  return Boolean(aiSettings?.artsClassEnabled && classData?.isArtsClass && isVirtualTeacherName(teacher))
}

function getAllowedGradesForSubject(subject, schoolInfo) {
  const validation = getSubjectGradeValidation(subject, 1, schoolInfo)
  return Array.isArray(validation.allowedGrades) ? validation.allowedGrades : null
}

function isSubjectAllowedForGrade(subject, grade, schoolInfo) {
  return getSubjectGradeValidation(subject, grade, schoolInfo).allowed
}

function buildRequirementMap(classData) {
  const map = new Map()
  for (const req of classData?.course_requirements || []) {
    const subject = normalizeSubject(req.subject)
    if (!subject) continue
    map.set(subject, {
      subject,
      periods: toNumber(req.periods, 0),
      teacher: getRequirementTeacher(req),
      defaultTeacher: req.defaultTeacher || '',
    })
  }
  return map
}

function normalizeScheduleEntries(entries) {
  const normalized = []
  for (const entry of entries || []) {
    const className = String(entry.className || entry.class || '').trim()
    const day = toNumber(entry.day, 0)
    const period = toNumber(entry.period, 0)
    if (!className || !day || !period) continue
    normalized.push(
      ...expandTimetableCellEntries(className, day, period, {
        ...entry,
        className,
        day,
        period,
      })
    )
  }
  return normalized
}

export function flattenClassTimetablesToEntries(classes) {
  const entries = []
  for (const classData of classes || []) {
    const className = String(classData.name || '').trim()
    const timetable = classData?.timetable || {}
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 7; period++) {
        const cell = timetable?.[day]?.[period] || timetable?.[String(day)]?.[String(period)]
        if (!cell) continue
        entries.push(...expandTimetableCellEntries(className, day, period, cell))
      }
    }
  }
  return entries
}

function buildScheduledEntriesIndex(scheduleEntries) {
  const bySlotWeek = new Map()
  const byTeacherSlotWeek = new Map()

  for (const entry of normalizeScheduleEntries(scheduleEntries)) {
    const slotWeekKey = buildSlotWeekKey(entry.day, entry.period, entry.week)
    if (!bySlotWeek.has(slotWeekKey)) bySlotWeek.set(slotWeekKey, [])
    bySlotWeek.get(slotWeekKey).push(entry)

    for (const teacher of entry.teacherNames || splitTeacherNames(entry.teacherName)) {
      const teacherKey = `${teacher}|${slotWeekKey}`
      if (!byTeacherSlotWeek.has(teacherKey)) byTeacherSlotWeek.set(teacherKey, [])
      byTeacherSlotWeek.get(teacherKey).push(entry)
    }
  }

  return { bySlotWeek, byTeacherSlotWeek, normalizedEntries: normalizeScheduleEntries(scheduleEntries) }
}

function analyzeClassTimetable(classData, context) {
  const { bySlotWeek, classroomCapacityMap, schoolInfo, aiSettings, classSlotEntryMap } = context
  const className = String(classData.name || '').trim()
  const grade = getGradeFromClassName(className)
  const requirementMap = buildRequirementMap(classData)
  const issueSlots = []
  const slotRows = []
  const scheduledCountMap = new Map()
  const requirementIssues = []
  const rawRequirementIssues = []
  const suppressedRequirementIssues = []

  for (let day = 1; day <= 5; day++) {
    for (let period = 1; period <= 7; period++) {
      const slotKey = `${className}|${day}|${period}`
      const rawCell = classData?.timetable?.[day]?.[period] || classData?.timetable?.[String(day)]?.[String(period)]
      const fallbackEntries = expandTimetableCellEntries(className, day, period, rawCell)
      const entries = cloneEntries(classSlotEntryMap?.get(slotKey) || fallbackEntries)
      const issues = []

      const subjects = [...new Set(entries.map((entry) => normalizeSubject(entry.subject)).filter(Boolean))]
      const weekBuckets = new Map()
      for (const entry of entries) {
        const weekKey = normalizeWeekTag(entry.week)
        if (!weekBuckets.has(weekKey)) weekBuckets.set(weekKey, [])
        weekBuckets.get(weekKey).push(entry)
        const subject = normalizeSubject(entry.subject)
        if (subject) {
          scheduledCountMap.set(subject, (scheduledCountMap.get(subject) || 0) + getOccurrenceWeight(entry.week))
        }
      }

      const hasExplicitRoom = entries.some((entry) => isExplicitRoomAssignment(entry))
      const teacherIssueKeys = new Set()
      const roomIssueKeys = new Set()

      for (const [week, weekEntries] of weekBuckets.entries()) {
        if (weekEntries.length > 1 && !isAlternatingPair(weekEntries)) {
          issues.push({
            type: 'multi_assignment',
            severity: 'hard',
            message: `第 ${day} 天第 ${period} 節存在多筆課程配置，請檢查是否為誤排。`,
          })
        }

        const slotWeekEntries = bySlotWeek.get(buildSlotWeekKey(day, period, week)) || []

        for (const entry of weekEntries) {
          for (const teacher of entry.teacherNames?.length ? entry.teacherNames : splitTeacherNames(entry.teacherName)) {
            if (shouldSuppressTeacherConflict(teacher, classData, aiSettings)) {
              continue
            }
            const clashes = slotWeekEntries.filter(
              (other) => other.className !== className && (other.teacherNames || []).includes(teacher)
            )
            if (clashes.length > 0) {
              const issueKey = `teacher|${day}|${period}|${week}|${teacher}`
              if (!teacherIssueKeys.has(issueKey)) {
                teacherIssueKeys.add(issueKey)
                issues.push({
                  type: 'teacher',
                  severity: 'hard',
                  message: `教師 ${teacher} 於第 ${day} 天第 ${period} 節同時出現在 ${[...new Set(clashes.map((item) => item.className))].join('、')}。`,
                })
              }
            }
          }

          if (isExplicitRoomAssignment(entry)) {
            const clashes = slotWeekEntries.filter((other) => {
              if (other.className === className) return false
              if (!isExplicitRoomAssignment(other)) return false
              return other.locationKey === entry.locationKey
            })
            const hasRealCollision = clashes.some((other) => !isCompatibleAlternatingRoomPair(entry, other))
            if (hasRealCollision) {
              const issueKey = `room|${day}|${period}|${week}|${entry.locationKey}`
              if (!roomIssueKeys.has(issueKey)) {
                roomIssueKeys.add(issueKey)
                issues.push({
                  type: 'room',
                  severity: 'hard',
                  message: `教室 ${entry.locationLabel} 於第 ${day} 天第 ${period} 節同時被 ${[...new Set(clashes.map((item) => item.className))].join('、')} 使用。`,
                })
              }
            }
          }
        }
      }

      if (!hasExplicitRoom) {
        for (const subject of subjects) {
          if (!isSubjectAllowedForGrade(subject, grade, schoolInfo)) {
            const allowedGrades = getAllowedGradesForSubject(subject, schoolInfo) || []
            issues.push({
              type: 'grade',
              severity: 'hard',
              message: `科目 ${subject} 不適用於 ${grade} 年級，允許年級：${allowedGrades.join('、') || '無'}`,
            })
          }

          const capacity = classroomCapacityMap.get(subject) || 0
          if (capacity <= 0) continue
          const slotWeekCounts = []
          for (const [week] of weekBuckets.entries()) {
            const slotWeekEntries = bySlotWeek.get(buildSlotWeekKey(day, period, week)) || []
            slotWeekCounts.push(
              ...slotWeekEntries.filter((entry) => {
                return (
                  normalizeSubject(entry.subject) === subject &&
                  !isRoomCapacityExempt(subject, entry.className, schoolInfo)
                )
              })
            )
          }
          const used = slotWeekCounts.reduce((sum, entry) => sum + getOccurrenceWeight(entry.week), 0)
          if (used > capacity) {
            issues.push({
              type: 'room',
              severity: 'hard',
              message: `科目 ${subject} 同時使用需求為 ${used}，超過教室容量 ${capacity}。`,
            })
          }
        }
      } else {
        for (const subject of subjects) {
          if (!isSubjectAllowedForGrade(subject, grade, schoolInfo)) {
            const allowedGrades = getAllowedGradesForSubject(subject, schoolInfo) || []
            issues.push({
              type: 'grade',
              severity: 'hard',
              message: `科目 ${subject} 不適用於 ${grade} 年級，允許年級：${allowedGrades.join('、') || '無'}`,
            })
          }
        }
      }

      if (issues.length > 0) {
        issueSlots.push({
          day,
          period,
          entries: cloneEntries(entries),
          issues,
        })
      }

      slotRows.push({
        day,
        period,
        teachable: isTeachablePeriod(grade, day, period),
        entries: cloneEntries(entries),
        display: formatCell(entries),
        issues,
      })
    }
  }

  for (const [subject, required] of requirementMap.entries()) {
    const scheduled = scheduledCountMap.get(subject) || 0
    const delta = Math.round((scheduled - required.periods) * 100) / 100
    if (delta !== 0) {
      const issue = {
        subject,
        required: required.periods,
        scheduled,
        delta,
        teacher: required.teacher,
        defaultTeacher: required.defaultTeacher || '',
        severity: 'hard',
        message: delta < 0
          ? `少了 ${Math.abs(delta)} 節`
          : `多了 ${Math.abs(delta)} 節`,
      }

      rawRequirementIssues.push(issue)

      if (shouldSuppressAiRequirementDelta(required, scheduled, scheduledCountMap, classData)) {
        suppressedRequirementIssues.push({
          ...issue,
          suppressionReason: buildRequirementSuppressionReason(required, scheduledCountMap, classData),
        })
      } else {
        requirementIssues.push(issue)
      }
    }
  }

  const topSubjects = [...scheduledCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([subject, count]) => ({ subject, count }))

  return {
    className,
    grade,
    requirementMap: Object.fromEntries(requirementMap.entries()),
    rawRequirementIssues,
    suppressedRequirementIssues,
    requirementIssues,
    issueSlots,
    slotRows,
    scheduledCountMap: Object.fromEntries(scheduledCountMap.entries()),
    topSubjects,
    rawIssueCount: issueSlots.length + rawRequirementIssues.length,
    suppressedRequirementIssueCount: suppressedRequirementIssues.length,
    issueCount: issueSlots.length + requirementIssues.length,
  }
}

function buildTeacherLoadReport(classes, teachers, normalizedEntries) {
  const loadMap = new Map()
  const teacherClasses = new Map()

  for (const entry of normalizedEntries || []) {
    const weight = getOccurrenceWeight(entry.week)
    for (const teacher of entry.teacherNames || splitTeacherNames(entry.teacherName)) {
      loadMap.set(teacher, (loadMap.get(teacher) || 0) + weight)
      if (!teacherClasses.has(teacher)) teacherClasses.set(teacher, new Set())
      teacherClasses.get(teacher).add(entry.className)
    }
  }

  const report = []
  for (const teacher of teachers || []) {
    const name = normalizeTeacher(teacher.name)
    if (!name) continue
    const base = toNumber(teacher.base_periods ?? teacher.max_periods ?? 20, 20)
    const reduction = toNumber(teacher.reduction, 0)
    const overtime = toNumber(teacher.overtime, 0)
    const maxPeriods = base - reduction + overtime
    const used = loadMap.get(name) || 0
    const overload = used - maxPeriods

    report.push({
      name,
      used,
      maxPeriods,
      overload,
      classes: [...(teacherClasses.get(name) || [])].sort(),
      severity: overload > 0 ? 'hard' : 'info',
    })
  }

  return report.sort((a, b) => b.overload - a.overload)
}

function buildIssueDedupKey(issue) {
  switch (issue.type) {
    case 'teacher':
      // 教師衝堂：同一位老師在同一時段（含 week）只算 1 筆
      // message 格式: "教師 {name} 於第 {day} 天第 {period} 節同時出現在..."
      return `teacher|${issue.day}|${issue.period}|${issue.week || ''}|${issue._dedupTeacher || ''}`
    case 'room':
      // 教室衝堂：同一間教室在同一時段只算 1 筆
      return `room|${issue.day}|${issue.period}|${issue.week || ''}|${issue._dedupLocation || ''}`
    case 'multi_assignment':
      // 多課程配置：同班級同時段只算 1 筆
      return `multi|${issue.className}|${issue.day}|${issue.period}`
    case 'grade':
      // 年級不適用：已天然唯一（每個 classReport 內不會重複）
      return `grade|${issue.className}|${issue.day}|${issue.period}|${issue._dedupSubject || ''}`
    case 'requirement':
      // 需求差異：已在 classReport 層級天然唯一
      return `requirement|${issue.className}|${issue.subject || ''}`
    default:
      return `${issue.type}|${issue.className}|${issue.day}|${issue.period}`
  }
}

function deduplicateIssues(rawIssues) {
  const seen = new Set()
  const deduplicated = []
  const byType = new Map()

  for (const issue of rawIssues) {
    const key = buildIssueDedupKey(issue)
    if (!seen.has(key)) {
      seen.add(key)
      deduplicated.push(issue)
      byType.set(issue.type, (byType.get(issue.type) || 0) + 1)
    }
  }

  return { deduplicated, byType }
}

function buildIssueIndex(classReports) {
  const rawIssues = []

  // Extract teacher name and location info from message for dedup keys
  const teacherNameRegex = /教師\s+(\S+)/
  const roomNameRegex = /教室\s+(\S+)/

  for (const classReport of classReports) {
    for (const issue of classReport.issueSlots) {
      for (const detail of issue.issues) {
        const baseIssue = {
          className: classReport.className,
          day: issue.day,
          period: issue.period,
          ...detail,
        }

        // Attach dedup metadata based on message content
        if (detail.type === 'teacher') {
          const match = detail.message.match(teacherNameRegex)
          baseIssue._dedupTeacher = match ? match[1] : ''
          // Extract week from the slot entries if available
          baseIssue.week = issue.entries?.[0]?.week || 'both'
        } else if (detail.type === 'room') {
          const match = detail.message.match(roomNameRegex)
          baseIssue._dedupLocation = match ? match[1] : ''
          baseIssue.week = issue.entries?.[0]?.week || 'both'
        } else if (detail.type === 'grade') {
          // Extract subject from message: "科目 {subject} 不適用於..."
          const subjectMatch = detail.message.match(/科目\s+(\S+)/)
          baseIssue._dedupSubject = subjectMatch ? subjectMatch[1] : ''
        }

        rawIssues.push(baseIssue)
      }
    }
    for (const issue of classReport.requirementIssues) {
      rawIssues.push({
        className: classReport.className,
        type: 'requirement',
        severity: issue.severity,
        subject: issue.subject,
        message: `${issue.subject} ${issue.message}`,
        required: issue.required,
        scheduled: issue.scheduled,
        delta: issue.delta,
        teacher: issue.teacher,
      })
    }
  }

  const { deduplicated, byType } = deduplicateIssues(rawIssues)

  return { raw: rawIssues, deduplicated, byType }
}

function buildSwapCandidates(classReports) {
  return classReports.map((classReport) => {
    const issueSlotSet = new Set(
      classReport.issueSlots.map((slot) => buildSlotKey(slot.day, slot.period))
    )

    const candidates = classReport.slotRows
      .filter((slot) => slot.entries.length > 0)
      .map((slot) => ({
        day: slot.day,
        period: slot.period,
        teachable: slot.teachable,
        issue: issueSlotSet.has(buildSlotKey(slot.day, slot.period)),
        subject: slot.entries.map((entry) => normalizeSubject(entry.subject)).join(' / '),
        teacher: slot.entries.map((entry) => entry.teacherName || (entry.teacherNames || []).join(' / ')).join(' / '),
        entries: cloneEntries(slot.entries),
      }))
      .sort((a, b) => Number(b.issue) - Number(a.issue) || Number(b.teachable) - Number(a.teachable) || a.day - b.day || a.period - b.period)

    return {
      className: classReport.className,
      grade: classReport.grade,
      candidates,
    }
  })
}

function renderClassMatrix(classReport) {
  const header = ['節次', '週一', '週二', '週三', '週四', '週五']
  const rows = [header]

  for (let period = 1; period <= 7; period++) {
    const row = [`第 ${period} 節`]
    for (let day = 1; day <= 5; day++) {
      const slot = classReport.slotRows.find((item) => item.day === day && item.period === period)
      const issueMark = slot && slot.issues.length > 0 ? ' ⚠' : ''
      row.push(`${slot ? slot.display : EMPTY_CELL}${issueMark}`)
    }
    rows.push(row)
  }

  return rows
}

function renderMarkdownTable(rows) {
  if (!rows || rows.length === 0) return ''
  const [header, ...body] = rows
  const lines = [
    `| ${header.map(escapeMarkdown).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ]
  for (const row of body) {
    lines.push(`| ${row.map(escapeMarkdown).join(' | ')} |`)
  }
  return lines.join('\n')
}

function renderIssueClassSection(classReport) {
  const lines = []
  lines.push(`### ${classReport.className}`)
  lines.push('')

  if (classReport.requirementIssues.length > 0) {
    lines.push('課程需求差異')
    for (const issue of classReport.requirementIssues) {
      lines.push(`- ${issue.subject}: 需求 ${issue.required}，已排 ${issue.scheduled}，${issue.message}`)
    }
    lines.push('')
  }

  if (classReport.issueSlots.length > 0) {
    lines.push('衝突時段')
    for (const issue of classReport.issueSlots) {
      const issueText = issue.issues.map((item) => item.message).join('；')
      lines.push(`- 第 ${issue.day} 天第 ${issue.period} 節：${issueText}`)
    }
    lines.push('')
  }

  lines.push(renderMarkdownTable(renderClassMatrix(classReport)))
  lines.push('')
  return lines.join('\n')
}

function buildScheduledEntriesReport(entries) {
  return normalizeScheduleEntries(entries)
}

function buildGroupedEntries(entries) {
  const grouped = new Map()
  for (const entry of entries || []) {
    const key = `${entry.className}|${entry.day}|${entry.period}|${entry.week}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(entry)
  }
  return grouped
}

function buildClassSlotEntryMap(entries) {
  const byClassSlot = new Map()
  for (const entry of entries || []) {
    const key = `${entry.className}|${entry.day}|${entry.period}`
    if (!byClassSlot.has(key)) byClassSlot.set(key, [])
    byClassSlot.get(key).push(entry)
  }
  return byClassSlot
}

function buildMergedScheduleEntries(scheduleEntries, classes) {
  const explicitEntries = buildScheduledEntriesReport(scheduleEntries)
  const timetableEntries = flattenClassTimetablesToEntries(classes)
  const explicitGroups = buildGroupedEntries(explicitEntries)
  const timetableGroups = buildGroupedEntries(timetableEntries)
  const mergedGroups = new Map(timetableGroups)

  for (const [key, entries] of explicitGroups.entries()) {
    mergedGroups.set(key, entries)
  }

  const mergedEntries = [...mergedGroups.values()].flat()
  return {
    mergedEntries,
    classSlotEntryMap: buildClassSlotEntryMap(mergedEntries),
  }
}

export function buildScheduleAiReport({
  scheduleEntries = [],
  classes = [],
  teachers = [],
  classrooms = [],
  schoolInfo = {},
  aiSettings = {},
  engineMeta = {},
}) {
  // Explicit schedule entries override timetable-derived entries for the same class/slot/week.
  const { mergedEntries, classSlotEntryMap } = buildMergedScheduleEntries(scheduleEntries, classes)

  const classroomCapacityMap = new Map()
  for (const room of classrooms || []) {
    const subject = normalizeSubject(room.subject)
    if (!subject) continue
    classroomCapacityMap.set(subject, (classroomCapacityMap.get(subject) || 0) + 1)
  }

  const { bySlotWeek } = buildScheduledEntriesIndex(mergedEntries)
  const classReports = (classes || []).map((classData) =>
    analyzeClassTimetable(classData, {
      bySlotWeek,
      classroomCapacityMap,
      schoolInfo,
      aiSettings,
      classSlotEntryMap,
    })
  )

  const { raw: rawIssues, deduplicated: dedupedIssues, byType: _byType } = buildIssueIndex(classReports)
  const teacherLoads = buildTeacherLoadReport(classes, teachers, mergedEntries)
  const swapCandidates = buildSwapCandidates(classReports)
  const suppressedRequirementIssueCount = classReports.reduce(
    (sum, classReport) => sum + (classReport.suppressedRequirementIssueCount || 0),
    0
  )
  const { candidatePool, candidateMoves } = buildAiTuningCandidatePool({
    classes: classReports,
    summary: {
      issueCount: dedupedIssues.length,
    },
  })
  const issueClasses = classReports.filter((classReport) => classReport.issueCount > 0)
  const rawIssueClasses = classReports.filter((classReport) => (classReport.rawIssueCount || 0) > 0)

  const summary = {
    totalClasses: classes.length,
    totalEntries: mergedEntries.length,
    issueClassCount: issueClasses.length,
    rawIssueClassCount: rawIssueClasses.length,
    issueCount: dedupedIssues.length,
    rawIssueCount: rawIssues.length + suppressedRequirementIssueCount,
    suppressedRequirementIssueCount,
    teacherOverloadCount: teacherLoads.filter((item) => item.overload > 0).length,
    teacherOverloadTotal: teacherLoads
      .filter((item) => item.overload > 0)
      .reduce((sum, item) => sum + item.overload, 0),
    issueSlotCount: rawIssues.filter((item) => item.day && item.period).length,
    generatedAt: new Date().toISOString(),
  }

  const report = {
    version: '2026-06-04',
    generatedAt: summary.generatedAt,
    engineMeta,
    summary,
    classes: classReports,
    issues: rawIssues,
    teacherLoads,
    swapCandidates,
    candidatePool,
    candidateMoves,
    rawSchedule: mergedEntries,
    schoolInfo,
    aiSettings,
  }

  return {
    report,
    exportMarkdown: buildScheduleAiMarkdown(report),
    promptMarkdown: buildScheduleAiPromptMarkdown(report),
    exportJson: report,
  }
}

export function buildScheduleAiMarkdown(report) {
  const lines = []
  lines.push(`# 課表衝突分析報告`)
  lines.push('')
  lines.push(`- 產生時間：${report.generatedAt}`)
  lines.push(`- 班級數：${report.summary.totalClasses}`)
  lines.push(`- 排課筆數：${report.summary.totalEntries}`)
  lines.push(`- 有問題班級：${report.summary.issueClassCount}`)
  lines.push(`- 問題總數：${report.summary.issueCount}`)
  lines.push(`- 已抑制導師缺漏：${report.summary.suppressedRequirementIssueCount || 0}`)
  lines.push(`- 教師超載數：${report.summary.teacherOverloadCount}`)
  lines.push('')

  lines.push('## 摘要')
  lines.push(renderMarkdownTable([
    ['項目', '數值'],
    ['班級數', String(report.summary.totalClasses)],
    ['排課筆數', String(report.summary.totalEntries)],
    ['有問題班級', String(report.summary.issueClassCount)],
    ['問題總數', String(report.summary.issueCount)],
    ['原始問題總數', String(report.summary.rawIssueCount)],
    ['已抑制導師缺漏', String(report.summary.suppressedRequirementIssueCount || 0)],
    ['教師超載數', String(report.summary.teacherOverloadCount)],
    ['教師超載總量', String(report.summary.teacherOverloadTotal)],
  ]))
  lines.push('')

  lines.push('## 問題列表')
  if (report.issues.length === 0) {
    lines.push('- 未偵測到衝突')
  } else {
    for (const issue of report.issues.slice(0, 80)) {
      const location = issue.day && issue.period ? `第 ${issue.day} 天第 ${issue.period} 節` : ''
      const subject = issue.subject ? ` / ${issue.subject}` : ''
      lines.push(`- ${issue.className} ${location}${subject}：${issue.message}`)
    }
  }
  lines.push('')

  lines.push('## 需要關注的班級')
  for (const classReport of report.classes) {
    if (classReport.issueCount <= 0) continue
    lines.push(renderIssueClassSection(classReport))
  }

  return lines.join('\n')
}

export function buildScheduleAiPromptMarkdown(report) {
  const lines = []
  lines.push('# AI 調整提示')
  lines.push('')
  lines.push('請根據以下報告找出可交換的時段，優先消除教師衝突與教室衝突。')
  lines.push('')
  lines.push('## 摘要')
  lines.push(`- 班級數：${report.summary.totalClasses}`)
  lines.push(`- 問題班級：${report.summary.issueClassCount}`)
  lines.push(`- 問題總數：${report.summary.issueCount}`)
  lines.push(`- 已抑制導師缺漏：${report.summary.suppressedRequirementIssueCount || 0}`)
  lines.push(`- 教師超載數：${report.summary.teacherOverloadCount}`)
  lines.push('')

  lines.push('## 問題片段')
  for (const issue of report.issues.slice(0, 80)) {
    const location = issue.day && issue.period ? `第 ${issue.day} 天第 ${issue.period} 節` : ''
    lines.push(`- ${issue.className} ${location}：${issue.message}`)
  }
  lines.push('')

  lines.push('## 輸出格式')
  lines.push('```json')
  lines.push('{')
  lines.push('  "summary": { "text": "簡短結論", "confidence": 0.0 },')
  lines.push('  "issues": [],')
  lines.push('  "swapMoves": [],')
  lines.push('  "warnings": []')
  lines.push('}')
  lines.push('```')

  return lines.join('\n')
}

export function validateSwapMoves(scheduleEntries, swapMoves) {
  const normalizedEntries = buildScheduledEntriesReport(scheduleEntries)
  const errors = []
  const validatedMoves = []

  for (const move of swapMoves || []) {
    const className = String(move.className || '').trim()
    const fromDay = toNumber(move.from?.day, 0)
    const fromPeriod = toNumber(move.from?.period, 0)
    const toDay = toNumber(move.to?.day, 0)
    const toPeriod = toNumber(move.to?.period, 0)

    if (!className || !fromDay || !fromPeriod || !toDay || !toPeriod) {
      errors.push({ move, reason: '缺少 className / from / to' })
      continue
    }

    if (fromDay === toDay && fromPeriod === toPeriod) {
      errors.push({ move, reason: '來源與目標時段相同' })
      continue
    }

    const fromEntries = normalizedEntries.filter(
      (entry) => entry.className === className && entry.day === fromDay && entry.period === fromPeriod
    )
    const toEntries = normalizedEntries.filter(
      (entry) => entry.className === className && entry.day === toDay && entry.period === toPeriod
    )

    if (fromEntries.length === 0 || toEntries.length === 0) {
      errors.push({ move, reason: '找不到可交換的課表內容' })
      continue
    }

    validatedMoves.push({
      className,
      from: { day: fromDay, period: fromPeriod },
      to: { day: toDay, period: toPeriod },
      reason: String(move.reason || '').trim(),
    })
  }

  return { errors, validatedMoves }
}

export function applySwapMovesToScheduleEntries(scheduleEntries, swapMoves) {
  const { errors, validatedMoves } = validateSwapMoves(scheduleEntries, swapMoves)
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      schedule: cloneEntries(scheduleEntries),
    }
  }

  const cloned = cloneEntries(scheduleEntries).map((entry) => ({
    ...entry,
    className: String(entry.className || entry.class || '').trim(),
    day: toNumber(entry.day, 0),
    period: toNumber(entry.period, 0),
  }))

  for (const move of validatedMoves) {
    const fromEntries = cloned.filter(
      (entry) =>
        entry.className === move.className &&
        entry.day === move.from.day &&
        entry.period === move.from.period
    )
    const toEntries = cloned.filter(
      (entry) =>
        entry.className === move.className &&
        entry.day === move.to.day &&
        entry.period === move.to.period
    )

    for (const entry of fromEntries) {
      entry.day = move.to.day
      entry.period = move.to.period
    }
    for (const entry of toEntries) {
      entry.day = move.from.day
      entry.period = move.from.period
    }
  }

  return {
    ok: true,
    errors: [],
    schedule: cloned,
  }
}
