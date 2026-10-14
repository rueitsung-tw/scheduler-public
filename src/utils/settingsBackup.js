import { useScheduleStore } from '../stores/schedule'
import { createDefaultGradeTimeRulesSettings } from './gradeTimeRules.js'
import { prepareGradeTimeRulesPersistence } from './gradeTimeRulesPersistence.js'
import { normalizeTeacherClassProgressAiSettings } from './teacherClassProgressSettings.js'

const SCHEMA_VERSION = '1.1.0'

const DEFAULT_CLASSROOM_LIMITS = {
  '自然科學': 3,
  '語文-英語': 3,
  '音樂': 3,
  '美勞': 3,
  '體育': 6,
  '資訊': 1,
}

const DEFAULT_AI_SETTINGS = {
  enableTeacherContiguous: true,
  enableSubjectBalance: true,
  enableClassroomLimit: true,
  enableHomeroomPriority: true,
  enableSpecialRoomLimit: true,
}

const SEMESTER_SETTINGS_AI_TOGGLE_KEYS = [
  'naturalConsecutive',
  'swimmingCapEnabled',
  'artsClassEnabled',
  'grade12TuesdayAfternoonHomeroom',
  'homeroomBlockizationEnabled',
]
const SEMESTER_SETTINGS_AI_OBJECT_KEYS = ['qualityRules']

// Canonical subject keys for classroom normalization (mirrors store's normalizeRoomSubject)
const CANONICAL_SUBJECT_MAP = {
  '英語': '語文-英語',
  '自然': '自然科學',
  '科技-資訊': '資訊',
  '電腦': '資訊',
  '健康與體育': '體育',
  '本土語言': '本土語',
  '閩南語': '本土語',
  '客語': '本土語',
}

function normalizeClassroomSubject(subj) {
  if (!subj) return ''
  const s = String(subj).trim()
  return CANONICAL_SUBJECT_MAP[s] || s
}

export function buildExportPayload() {
  const store = useScheduleStore()

  // Clone classroomLimits so we don't mutate the reactive store object
  let classroomLimits = cloneDeep(store.schoolInfo.classroomLimits) || {}
  // Make sure all default subjects are represented
  Object.keys(DEFAULT_CLASSROOM_LIMITS).forEach((k) => {
    if (!(k in classroomLimits)) classroomLimits[k] = DEFAULT_CLASSROOM_LIMITS[k]
  })

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    nativeLanguagePreallocation: store.nativeLanguagePreallocation ?? null,
    // 🆕 匯出專科教室資料
    classrooms: (store.classrooms || []).map((r) => ({
      id: r.id,
      name: r.name,
      subject: r.subject,
      primaryTeacher: r.primaryTeacher || '',
      allowSharing: r.allowSharing !== undefined ? r.allowSharing : true,
      gradePreferences: Array.isArray(r.gradePreferences) ? [...r.gradePreferences] : [],
    })),
    schoolInfo: {
      academic_year: Number(store.schoolInfo.academic_year) || 0,
      semester: store.schoolInfo.semester || '上學期',
      gradeSettings: normalizeGradeSettings(store.schoolInfo.gradeSettings),
      alternativeMatrix: cloneDeep(store.schoolInfo.alternativeMatrix) || {},
      classExceptions: cloneDeep(store.schoolInfo.classExceptions) || [],
      classroomLimits,
      subjectClassroomGrades: cloneDeep(store.schoolInfo.subjectClassroomGrades) || {},
      gradeTimeRulesSettings: cloneDeep(store.schoolInfo.gradeTimeRulesSettings || createDefaultGradeTimeRulesSettings()),
    },
    standardDomainSettings: store.standardDomainSettings.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      periods: { ...s.periods },
      defaultTeacher: s.defaultTeacher || 'homeroom',
    })),
    aiSettings: (() => {
      const cleaned = cloneDeep(store.aiSettings) || { ...DEFAULT_AI_SETTINGS }
      delete cleaned.coPlanningSettings
      delete cleaned.__schoolInfoCoPlanningSettings
      return normalizeTeacherClassProgressAiSettings(cleaned)
    })(),
    // 🔒 完整匯出教師資料（包含志願序、專長、不可用時段等）
    teachers: store.teachers.map((t) => ({
      name: t.name,
      type: t.type,
      subjects: [...(t.subjects || [])],
      max_periods: Number(t.max_periods) || 0,
      reduction: Number(t.reduction) || 0,
      overtime: Number(t.overtime) || 0,
      gradePreferences: cloneDeep(t.gradePreferences) || [],
      expertiseSubjects: cloneDeep(t.expertiseSubjects) || [],
      expertise_allocations: cloneDeep(t.expertise_allocations) || {},
      pref_grade1: t.pref_grade1 ?? null,
      pref_grade2: t.pref_grade2 ?? null,
      pref_grade3: t.pref_grade3 ?? null,
      google_account: t.google_account || '',
      unavailable_slots: cloneDeep(t.unavailable_slots) || [],
    })),
    // 🔒 完整匯出班級資料（包含課程需求與課表）
    classes: (store.classes || []).map((c) => ({
      name: c.name,
      grade: c.grade || null,
      homeroom_teacher: c.homeroom_teacher || '',
      course_requirements: cloneDeep(c.course_requirements) || [],
      timetable: cloneDeep(c.timetable) || {},
    })),
  }
}

export function downloadExport(payload) {
  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const dateStr = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `系統設定備份_${dateStr}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function parseImportFile(text) {
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('JSON 格式錯誤，請檢查檔案內容')
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('JSON 必須為物件格式')
  }
  if (!payload.schemaVersion) {
    throw new Error('缺少 schemaVersion，非有效設定備份檔')
  }

  const prepared = prepareGradeTimeRulesPersistence({
    gradeTimeRulesSettings: payload.schoolInfo?.gradeTimeRulesSettings,
    schoolInfo: payload.schoolInfo,
    aiSettings: payload.aiSettings,
  })

  // Normalize with defaults for missing fields
  return {
    schoolInfo: normalizeSchoolInfo(payload.schoolInfo, prepared.gradeTimeRulesSettings),
    standardDomainSettings: payload.standardDomainSettings || [],
    aiSettings: normalizeAiSettings(prepared.cleanedAiSettings),
    teachers: Array.isArray(payload.teachers) ? payload.teachers : [],
    // 🔒 解析班級資料
    classes: Array.isArray(payload.classes) ? payload.classes : [],
    // 🆕 解析專科教室資料（舊版備份可能沒有，預設空陣列）
    classrooms: Array.isArray(payload.classrooms) ? payload.classrooms : [],
    // 🆕 解析本土語預排 metadata（舊版備份缺少時預設 null）
    nativeLanguagePreallocation: payload.nativeLanguagePreallocation ?? null,
  }
}

export function applyImport(data) {
  const store = useScheduleStore()

  // --- schoolInfo ---
  store.schoolInfo.academic_year = data.schoolInfo.academic_year
  store.schoolInfo.semester = data.schoolInfo.semester
  store.schoolInfo.gradeSettings = data.schoolInfo.gradeSettings
  store.schoolInfo.alternativeMatrix = data.schoolInfo.alternativeMatrix
  store.schoolInfo.classExceptions = data.schoolInfo.classExceptions
  store.schoolInfo.classroomLimits = data.schoolInfo.classroomLimits
  store.schoolInfo.subjectClassroomGrades = data.schoolInfo.subjectClassroomGrades || {}
  store.schoolInfo.gradeTimeRulesSettings = cloneDeep(data.schoolInfo.gradeTimeRulesSettings || createDefaultGradeTimeRulesSettings())
  delete store.schoolInfo.coPlanningSettings

  // --- standardDomainSettings ---
  if (data.standardDomainSettings.length > 0) {
    data.standardDomainSettings.forEach((entry) => {
      const existing = store.standardDomainSettings.find((s) => s.id === entry.id)
      if (existing) {
        existing.periods = { ...entry.periods }
        existing.defaultTeacher = entry.defaultTeacher || 'homeroom'
      } else {
        store.standardDomainSettings.push({
          id: entry.id,
          name: entry.name,
          color: entry.color || '#94a3b8',
          periods: { ...entry.periods },
          defaultTeacher: entry.defaultTeacher || 'homeroom',
        })
      }
    })
  }

  // --- aiSettings ---
  Object.assign(store.aiSettings, normalizeTeacherClassProgressAiSettings(data.aiSettings))

  // 🔒 完整還原教師資料（包含志願序、專長、不可用時段等）
  if (data.teachers.length > 0) {
    store.teachers.forEach((t) => {
      const match = data.teachers.find((m) => m.name === t.name)
      if (match) {
        t.max_periods = Number(match.max_periods) || 0
        t.reduction = Number(match.reduction) || 0
        t.overtime = Number(match.overtime) || 0
        if (match.type) t.type = match.type
        if (match.subjects) t.subjects = [...match.subjects]
        // 🔒 還原教師志願序與專長資料
        if (Array.isArray(match.gradePreferences)) t.gradePreferences = [...match.gradePreferences]
        if (match.expertiseSubjects !== undefined) t.expertiseSubjects = cloneDeep(match.expertiseSubjects)
        if (match.expertise_allocations !== undefined) t.expertise_allocations = cloneDeep(match.expertise_allocations)
        if (match.pref_grade1 !== null && match.pref_grade1 !== undefined) t.pref_grade1 = match.pref_grade1
        if (match.pref_grade2 !== null && match.pref_grade2 !== undefined) t.pref_grade2 = match.pref_grade2
        if (match.pref_grade3 !== null && match.pref_grade3 !== undefined) t.pref_grade3 = match.pref_grade3
        if (match.google_account) t.google_account = match.google_account
        if (Array.isArray(match.unavailable_slots)) t.unavailable_slots = [...match.unavailable_slots]
      }
    })
  }

  // 🔒 完整還原班級資料（包含課程需求與課表）
  if (data.classes.length > 0) {
    data.classes.forEach((importedClass) => {
      const existing = store.classes.find((c) => c.name === importedClass.name)
      if (existing) {
        // 更新既有班級
        if (importedClass.grade !== undefined && importedClass.grade !== null) existing.grade = importedClass.grade
        if (importedClass.homeroom_teacher) existing.homeroom_teacher = importedClass.homeroom_teacher
        if (Array.isArray(importedClass.course_requirements)) {
          existing.course_requirements = cloneDeep(importedClass.course_requirements)
        }
        if (importedClass.timetable && typeof importedClass.timetable === 'object') {
          existing.timetable = cloneDeep(importedClass.timetable)
        }
      } else {
        // 新增不存在的班級
        store.classes.push({
          name: importedClass.name,
          grade: importedClass.grade || null,
          homeroom_teacher: importedClass.homeroom_teacher || '',
          course_requirements: cloneDeep(importedClass.course_requirements) || [],
          timetable: cloneDeep(importedClass.timetable) || {},
        })
      }
    })
  }

  // 🆕 還原專科教室資料（僅當備份有 classrooms 且非空時才覆蓋）
  if (data.classrooms.length > 0) {
    const normalized = data.classrooms.map((room) => ({
      id: room.id || `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: room.name || '未命名教室',
      subject: normalizeClassroomSubject(room.subject),
      primaryTeacher: room.primaryTeacher || '',
      allowSharing: room.allowSharing !== undefined ? room.allowSharing : true,
      gradePreferences: Array.isArray(room.gradePreferences)
        ? room.gradePreferences.map((g) => Number(g) > 0 ? Number(g) : 0).filter((g) => g > 0)
        : [],
    }))

    // 用匯入的教室資料覆蓋現有資料
    store.classrooms.splice(0, store.classrooms.length, ...normalized)
  }
  // 舊版備份沒有 classrooms 時，不觸發任何操作，保留現有教室資料

  // 🆕 還原本土語預排 metadata
  store.nativeLanguagePreallocation = cloneDeep(data.nativeLanguagePreallocation ?? null)

  store.markScheduleDirty()
}

export function previewSemesterSettingsImport(data) {
  const store = useScheduleStore()
  const importedNames = new Set(
    (data.classrooms || []).map((room) => String(room.name || '').trim()),
  )
  const currentNames = new Set(
    (store.classrooms || []).map((room) => String(room.name || '').trim()),
  )
  return {
    classrooms: {
      added: [...importedNames].filter((name) => name && !currentNames.has(name)).length,
      overwritten: [...importedNames].filter((name) => name && currentNames.has(name)).length,
      removed: [...currentNames].filter((name) => name && !importedNames.has(name)).length,
    },
    available: {},
  }
}

export function applySemesterSettingsImport(data) {
  const store = useScheduleStore()
  const summary = previewSemesterSettingsImport(data)

  if (data.schoolInfo) {
    if (data.schoolInfo.alternativeMatrix) {
      store.schoolInfo.alternativeMatrix = cloneDeep(data.schoolInfo.alternativeMatrix)
    }
    if (data.schoolInfo.classroomLimits) {
      store.schoolInfo.classroomLimits = cloneDeep(data.schoolInfo.classroomLimits)
    }
    if (data.schoolInfo.subjectClassroomGrades) {
      store.schoolInfo.subjectClassroomGrades = cloneDeep(data.schoolInfo.subjectClassroomGrades)
    }
  }

  if (Array.isArray(data.standardDomainSettings)) {
    store.standardDomainSettings = cloneDeep(data.standardDomainSettings)
  }

  if (data.aiSettings) {
    const normalizedAiSettings = normalizeTeacherClassProgressAiSettings(data.aiSettings)
    SEMESTER_SETTINGS_AI_TOGGLE_KEYS.forEach((key) => {
      if (key in data.aiSettings) {
        store.aiSettings[key] = normalizedAiSettings[key]
      }
    })
    SEMESTER_SETTINGS_AI_OBJECT_KEYS.forEach((key) => {
      if (key in data.aiSettings) {
        store.aiSettings[key] = cloneDeep(normalizedAiSettings[key])
      }
    })
  }

  if (Array.isArray(data.classrooms) && data.classrooms.length > 0) {
    const currentRooms = store.classrooms || []
    const reconstructed = data.classrooms.map((room) => {
      const trimmedName = String(room.name || '').trim()
      const existingMatch = currentRooms.find((cr) => String(cr.name || '').trim() === trimmedName)
      return {
        id: existingMatch ? existingMatch.id : (room.id || `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        name: room.name || '未命名教室',
        subject: normalizeClassroomSubject(room.subject),
        primaryTeacher: '',
        allowSharing: room.allowSharing !== undefined ? room.allowSharing : true,
        gradePreferences: Array.isArray(room.gradePreferences)
          ? room.gradePreferences.map((g) => Number(g) > 0 ? Number(g) : 0).filter((g) => g > 0)
          : [],
      }
    })
    store.classrooms.splice(0, store.classrooms.length, ...reconstructed)
  }

  store.markScheduleDirty()
  return summary
}

/* ── Private helpers ── */

function normalizeGradeSettings(gs) {
  const result = {}
  for (let g = 1; g <= 6; g++) {
    result[g] = Number(gs?.[g]) || 0
  }
  return result
}

function normalizeSchoolInfo(si, gradeTimeRulesSettings) {
  if (!si || typeof si !== 'object') return buildDefaultSchoolInfo(gradeTimeRulesSettings)
  const base = {
    academic_year: Number(si.academic_year) || 0,
    semester: ['上學期', '下學期'].includes(si.semester) ? si.semester : '上學期',
    gradeSettings: normalizeGradeSettings(si.gradeSettings),
    alternativeMatrix: cloneDeep(si.alternativeMatrix) || {},
    classExceptions: cloneDeep(si.classExceptions) || [],
    classroomLimits: normalizeClassroomLimits(si.classroomLimits),
    subjectClassroomGrades: cloneDeep(si.subjectClassroomGrades) || {},
    gradeTimeRulesSettings: gradeTimeRulesSettings || createDefaultGradeTimeRulesSettings(),
  }
  delete base.coPlanningSettings
  return base
}

function buildDefaultSchoolInfo(gradeTimeRulesSettings) {
  return {
    academic_year: 0,
    semester: '上學期',
    gradeSettings: {},
    alternativeMatrix: {},
    classExceptions: [],
    classroomLimits: { ...DEFAULT_CLASSROOM_LIMITS },
    subjectClassroomGrades: {},
    gradeTimeRulesSettings: gradeTimeRulesSettings || createDefaultGradeTimeRulesSettings(),
  }
}

function normalizeClassroomLimits(cl) {
  const result = { ...DEFAULT_CLASSROOM_LIMITS }
  if (cl && typeof cl === 'object') {
    Object.entries(cl).forEach(([k, v]) => {
      result[k] = Number(v) >= 0 ? Number(v) : DEFAULT_CLASSROOM_LIMITS[k] || 0
    })
  }
  return result
}

function normalizeAiSettings(ai) {
  const defaults = { ...DEFAULT_AI_SETTINGS }
  const cleaned = !ai || typeof ai !== 'object' ? defaults : { ...defaults, ...ai, grade12AfternoonOff: true }
  delete cleaned.coPlanningSettings
  delete cleaned.__schoolInfoCoPlanningSettings
  return normalizeTeacherClassProgressAiSettings(cleaned)
}

function cloneDeep(v) {
  if (v === null || typeof v !== 'object') return v
  return JSON.parse(JSON.stringify(v))
}
