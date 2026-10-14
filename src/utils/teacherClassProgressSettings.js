/**
 * src/utils/teacherClassProgressSettings.js
 * Deep normalization and validation for qualityRules.teacherClassProgress
 */

export const DEFAULT_TEACHER_CLASS_PROGRESS = Object.freeze({
  enabled: false,
  incompleteRoundWeight: 10,
  waitingWeight: 5,
  visitPatternWeight: 5,
  teachers: [],
})

export function normalizeTeacherClassProgressConfig(tcp) {
  const src = tcp && typeof tcp === 'object' ? tcp : {}
  return {
    enabled: Boolean(src.enabled),
    incompleteRoundWeight: typeof src.incompleteRoundWeight === 'number' ? src.incompleteRoundWeight : DEFAULT_TEACHER_CLASS_PROGRESS.incompleteRoundWeight,
    waitingWeight: typeof src.waitingWeight === 'number' ? src.waitingWeight : DEFAULT_TEACHER_CLASS_PROGRESS.waitingWeight,
    visitPatternWeight: typeof src.visitPatternWeight === 'number' ? src.visitPatternWeight : DEFAULT_TEACHER_CLASS_PROGRESS.visitPatternWeight,
    teachers: Array.isArray(src.teachers) ? src.teachers.map((t) => ({
      teacherId: String(t.teacherId || ''),
      classOrder: Array.isArray(t.classOrder) ? t.classOrder.map(String) : [],
      weeklyLessons: Array.isArray(t.weeklyLessons) ? t.weeklyLessons.map((l) => ({
        classId: String(l.classId || ''),
        subject: String(l.subject || ''),
        lessons: Number(l.lessons || 0),
        week: l.week !== undefined ? l.week : 0,
      })) : [],
    })) : [],
  }
}

export function normalizeTeacherClassProgressAiSettings(aiSettings) {
  const base = aiSettings ? JSON.parse(JSON.stringify(aiSettings)) : {}
  const qualityRules = base.qualityRules || {}

  qualityRules.teacherClassProgress = normalizeTeacherClassProgressConfig(qualityRules.teacherClassProgress)

  base.qualityRules = qualityRules
  return base
}

export function validateTeacherClassProgress(config, { teacherIds = [], classIds = [] } = {}) {
  const raw = config && config.teacherClassProgress ? config.teacherClassProgress : config
  if (!raw) return []

  // An explicit disable skips validation (pre-v5 contract); a missing flag does not.
  if (raw.enabled === false) return []

  // Normalize first so validation always runs on canonical values.
  const tcp = normalizeTeacherClassProgressConfig(raw)
  const issues = []

  if (typeof tcp.incompleteRoundWeight === 'number' && tcp.incompleteRoundWeight < 0) {
    issues.push('incompleteRoundWeight must be non-negative')
  }
  if (typeof tcp.waitingWeight === 'number' && tcp.waitingWeight < 0) {
    issues.push('waitingWeight must be non-negative')
  }
  if (typeof tcp.visitPatternWeight === 'number' && tcp.visitPatternWeight < 0) {
    issues.push('visitPatternWeight must be non-negative')
  }

  const validWeeks = new Set([0, 1, 2, 'both', 'odd', 'even', 'single', 'double', null, ''])

  // Empty identity lists mean the caller has no identity context; unknown-ID
  // validation is skipped rather than claimed.
  const knownTeachers = teacherIds.length > 0 ? new Set(teacherIds.map(String)) : null
  const knownClasses = classIds.length > 0 ? new Set(classIds.map(String)) : null

  const teachers = tcp.teachers || []
  for (const t of teachers) {
    if (knownTeachers && !knownTeachers.has(t.teacherId)) {
      issues.push(`teacher ${t.teacherId} is not a known teacher`)
    }
    const seen = new Set()
    for (const c of t.classOrder || []) {
      if (seen.has(c)) {
        issues.push(`teacher ${t.teacherId} has duplicate class ${c}`)
      }
      seen.add(c)
      if (knownClasses && !knownClasses.has(c)) {
        issues.push(`teacher ${t.teacherId} references unknown class ${c}`)
      }
    }
    for (const l of t.weeklyLessons || []) {
      if (typeof l.lessons !== 'number' || l.lessons <= 0 || !Number.isInteger(l.lessons)) {
        issues.push(`weekly lesson for ${l.classId} must have lessons greater than zero`)
      }
      if (!validWeeks.has(l.week)) {
        issues.push(`weekly lesson for ${l.classId} has invalid week tag ${l.week}`)
      }
      if (knownClasses && !knownClasses.has(l.classId)) {
        issues.push(`weekly lesson for ${l.classId} references unknown class ${l.classId}`)
      }
    }
  }
  return issues
}
