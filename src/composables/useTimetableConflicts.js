import { computed } from 'vue'
import {
  buildScheduleAiReport,
  expandTimetableCellEntries,
  flattenClassTimetablesToEntries,
  isExplicitRoomAssignment,
  normalizeSubject,
} from '../utils/scheduleAiReport.js'

function buildReport(scheduleStore) {
  return buildScheduleAiReport({
    scheduleEntries: flattenClassTimetablesToEntries(scheduleStore.classes || []),
    classes: scheduleStore.classes || [],
    teachers: scheduleStore.teachers || [],
    classrooms: scheduleStore.classrooms || [],
    schoolInfo: scheduleStore.schoolInfo || {},
    aiSettings: scheduleStore.aiSettings || {},
    engineMeta: { source: 'timetable-editor' },
  })
}

export function useTimetableConflicts(targetClass, scheduleStore) {
  const analysisReport = computed(() => buildReport(scheduleStore))

  const currentClassReport = computed(() => {
    if (!targetClass.value) return null
    return analysisReport.value.report.classes.find((item) => item.className === targetClass.value) || null
  })

  const specialClassroomUsage = computed(() => {
    if (!targetClass.value) return []

    const clsData = (scheduleStore.classes || []).find((c) => c.name === targetClass.value)
    if (!clsData) return []

    const requirements = clsData.course_requirements || []
    const allRooms = scheduleStore.classrooms || []
    const roomUsageMap = new Map()

    if (clsData.timetable) {
      for (let day = 1; day <= 5; day++) {
        for (let period = 1; period <= 7; period++) {
          const course = clsData.timetable[day]?.[period]
          const occurrences = expandTimetableCellEntries(clsData.name, day, period, course || {})
          for (const occ of occurrences) {
            if (!isExplicitRoomAssignment(occ)) continue
            const key = occ.locationKey
            if (!roomUsageMap.has(key)) {
              const roomDef = allRooms.find((room) =>
                String(room.id || '') === String(occ.classroomId || '') ||
                String(room.name || '') === String(occ.classroomName || '')
              )
              roomUsageMap.set(key, {
                subject: normalizeSubject(roomDef?.subject || occ.subject),
                classroomName: occ.locationLabel,
                classroomLabel: roomDef?.subject ? `${roomDef.subject}` : occ.locationLabel,
                teacher: requirements.find((req) => normalizeSubject(req.subject) === normalizeSubject(occ.subject))?.teacher_name ||
                  requirements.find((req) => normalizeSubject(req.subject) === normalizeSubject(occ.subject))?.teacher ||
                  '',
                usagePeriods: [],
                roomCapacity: roomDef ? 1 : 0,
              })
            }
            roomUsageMap.get(key).usagePeriods.push({
              day,
              period,
              week: occ.week,
              classroomName: occ.locationLabel,
            })
          }
        }
      }
    }

    return [...roomUsageMap.values()]
  })

  const conflictMap = computed(() => {
    const map = {}
    const classReport = currentClassReport.value
    if (!classReport) return map

    for (const slot of classReport.issueSlots || []) {
      map[`${slot.day}-${slot.period}`] = (slot.issues || []).map((issue) => ({
        type: issue.type,
        severity: issue.severity,
        message: issue.message,
      }))
    }

    return map
  })

  const requirementIssues = computed(() => currentClassReport.value?.requirementIssues || [])

  const getConflicts = (day, period) => conflictMap.value[`${day}-${period}`] || []

  return {
    analysisReport,
    currentClassReport,
    specialClassroomUsage,
    conflictMap,
    requirementIssues,
    getConflicts,
  }
}
