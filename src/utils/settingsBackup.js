import { useScheduleStore } from '../stores/schedule'

const SCHEMA_VERSION = '1.0.0'

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
    schoolInfo: {
      academic_year: Number(store.schoolInfo.academic_year) || 0,
      semester: store.schoolInfo.semester || '上學期',
      gradeSettings: normalizeGradeSettings(store.schoolInfo.gradeSettings),
      alternativeMatrix: cloneDeep(store.schoolInfo.alternativeMatrix) || {},
      classExceptions: cloneDeep(store.schoolInfo.classExceptions) || [],
      classroomLimits,
      subjectClassroomGrades: cloneDeep(store.schoolInfo.subjectClassroomGrades) || {},
    },
    standardDomainSettings: store.standardDomainSettings.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      periods: { ...s.periods },
      defaultTeacher: s.defaultTeacher || 'homeroom',
    })),
    aiSettings: cloneDeep(store.aiSettings) || { ...DEFAULT_AI_SETTINGS },
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
    // 🔒 完整匯出專科教室資料
    classrooms: (store.classrooms || []).map((room) => ({
      id: room.id,
      name: room.name,
      subject: room.subject,
      primaryTeacher: room.primaryTeacher || '',
      allowSharing: room.allowSharing !== false,
      gradePreferences: Array.isArray(room.gradePreferences)
        ? [...room.gradePreferences]
        : [],
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

  // Normalize with defaults for missing fields
  return {
    schoolInfo: normalizeSchoolInfo(payload.schoolInfo),
    standardDomainSettings: payload.standardDomainSettings || [],
    aiSettings: normalizeAiSettings(payload.aiSettings),
    teachers: Array.isArray(payload.teachers) ? payload.teachers : [],
    // 🔒 解析班級資料
    classes: Array.isArray(payload.classes) ? payload.classes : [],
    // 🔒 解析專科教室資料 — 保留是否有出現 classrooms 欄位的資訊
    hasClassrooms: Object.prototype.hasOwnProperty.call(payload, 'classrooms'),
    classrooms: Array.isArray(payload.classrooms) ? payload.classrooms : [],
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
  Object.assign(store.aiSettings, data.aiSettings)

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

  // 🔒 完整還原專科教室資料
  // 只有在備份檔明確包含 classrooms 欄位時才處理
  // 舊版備份沒有 classrooms → 不觸動現有教室資料
  if (data.hasClassrooms === true) {
    store.classrooms = data.classrooms.map((room) => ({
      id: room.id || generateClassroomId(),
      name: room.name || '',
      subject: normalizeClassroomSubject(room.subject),
      primaryTeacher: room.primaryTeacher || '',
      allowSharing: room.allowSharing !== false,
      gradePreferences: Array.isArray(room.gradePreferences) ? [...room.gradePreferences] : [],
    }))
  }

  store.markScheduleDirty()
}

/* ── Private helpers ── */

function normalizeGradeSettings(gs) {
  const result = {}
  for (let g = 1; g <= 6; g++) {
    result[g] = Number(gs?.[g]) || 0
  }
  return result
}

function normalizeSchoolInfo(si) {
  if (!si || typeof si !== 'object') return buildDefaultSchoolInfo()
  return {
    academic_year: Number(si.academic_year) || 0,
    semester: ['上學期', '下學期'].includes(si.semester) ? si.semester : '上學期',
    gradeSettings: normalizeGradeSettings(si.gradeSettings),
    alternativeMatrix: cloneDeep(si.alternativeMatrix) || {},
    classExceptions: cloneDeep(si.classExceptions) || [],
    classroomLimits: normalizeClassroomLimits(si.classroomLimits),
    subjectClassroomGrades: cloneDeep(si.subjectClassroomGrades) || {},
  }
}

function buildDefaultSchoolInfo() {
  return {
    academic_year: 0,
    semester: '上學期',
    gradeSettings: {},
    alternativeMatrix: {},
    classExceptions: [],
    classroomLimits: { ...DEFAULT_CLASSROOM_LIMITS },
    subjectClassroomGrades: {},
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
  if (!ai || typeof ai !== 'object') return defaults
  return {
    ...defaults,
    ...ai,
    grade12AfternoonOff: true,
  }
}

function cloneDeep(v) {
  if (v === null || typeof v !== 'object') return v
  return JSON.parse(JSON.stringify(v))
}

/**
 * 專科教室科目名稱 normalization — 與 schedule store 的 canonical mapping 保持一致
 */
function normalizeClassroomSubject(subj) {
  if (!subj) return ''
  const s = String(subj).trim()
  if (s === '英語') return '語文-英語'
  if (s === '自然') return '自然科學'
  if (s === '科技-資訊' || s === '電腦') return '資訊'
  if (s === '健康與體育') return '體育'
  if (s === '本土語言' || s === '閩南語' || s === '客語') return '本土語'
  return s
}

/**
 * 產生專科教室唯一 ID — 與 schedule store 的 addClassroom 一致
 */
function generateClassroomId() {
  return Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9)
}
