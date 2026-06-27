export { findClassForCell } from './exportUtils.js'

import * as XLSX from 'xlsx'
import { expandTimetableCellEntries, getOccurrenceWeight, normalizeSubject, splitTeacherNames } from './scheduleAiReport.js'
import { formatPairedSlot, hasValidPair } from './pairAwareFormatter.js'

function getCell(timetable, day, period) {
  try {
    return timetable?.[day]?.[period] || null
  } catch {
    return null
  }
}

function buildSubjectTeacherMap(classes) {
  const map = {}
  for (const cls of classes || []) {
    for (const req of cls.course_requirements || []) {
      const subj = normalizeSubject(req.subject)
      if (!subj) continue
      const tName = String(req.teacher_name || req.teacher || '').trim()
      if (!tName) continue
      if (!map[subj]) map[subj] = []
      if (!map[subj].includes(tName)) map[subj].push(tName)
    }
  }
  return map
}

function getSubjectCategoryDisplay(subject) {
  const map = {
    '數學': '數學課表',
    '自然': '自然課表',
    '英語': '英語課表',
    '音樂': '音樂課表',
    '美勞': '美勞課表',
    '體育': '體育課表',
    '資訊': '資訊課表',
    '社會': '社會課表',
    '國語': '國語課表',
  }
  return map[subject] || `${subject}課表`
}

function buildTeacherSchedule(teacherName, classes) {
  const schedule = {}
  const targetTeacher = String(teacherName || '').trim()

  for (const cls of classes || []) {
    if (!cls?.timetable) continue
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 7; period++) {
        const cell = getCell(cls.timetable, day, period)
        if (!cell) continue

        const occurrences = expandTimetableCellEntries(cls.name, day, period, cell)
        for (const entry of occurrences) {
          const teacherNames = entry.teacherNames?.length ? entry.teacherNames : splitTeacherNames(entry.teacherName || cell.teacher)
          if (!teacherNames.includes(targetTeacher)) continue

          if (!schedule[String(day)]) schedule[String(day)] = {}
          if (!schedule[String(day)][String(period)]) schedule[String(day)][String(period)] = []
          schedule[String(day)][String(period)].push({
            className: cls.name,
            subject: normalizeSubject(entry.subject),
            week: entry.week,
            pairGroupId: entry.pairGroupId || '',
            pairDirection: entry.pairDirection || '',
            teacherNames,
          })
        }
      }
    }
  }

  return schedule
}

function hasTeacherWeekConflict(entries) {
  const oddClasses = [...new Set((entries || [])
    .filter((entry) => entry.week === 'odd' || entry.week === 'both')
    .map((entry) => entry.className))]
  const evenClasses = [...new Set((entries || [])
    .filter((entry) => entry.week === 'even' || entry.week === 'both')
    .map((entry) => entry.className))]
  return oddClasses.length > 1 || evenClasses.length > 1
}

export function formatTeacherSubjectEntries(entries) {
  // Pair-aware: 若符合 slash 條件（同年級、同 pairGroup、互補方向），使用 `410/404` 格式
  if (hasValidPair(entries)) {
    return formatPairedSlot(entries, { fallbackToParentheses: true })
  }

  // Fallback: 傳統的 (單)/(雙) 格式
  const bothNames = [...new Set((entries || []).filter((entry) => entry.week === 'both').map((entry) => entry.className))]
  const oddNames = [...new Set((entries || []).filter((entry) => entry.week === 'odd').map((entry) => entry.className))]
  const evenNames = [...new Set((entries || []).filter((entry) => entry.week === 'even').map((entry) => entry.className))]
  const parts = []
  if (bothNames.length > 0) parts.push(bothNames.join('/'))
  if (oddNames.length > 0) parts.push(`${oddNames.join('/')}(單)`)
  if (evenNames.length > 0) parts.push(`${evenNames.join('/')}(雙)`)
  return parts.join('\n')
}

export function exportSubjectTeacherTimetables(scheduleStore) {
  const { classes = [] } = scheduleStore
  const schoolName = (scheduleStore.schoolInfo && scheduleStore.schoolInfo.name) || '學校'
  const subjectTeachers = buildSubjectTeacherMap(classes)

  if (!Object.keys(subjectTeachers).length) {
    alert('沒有可匯出的科任教師資料。')
    return
  }

  const allTeacherNames = new Set()
  for (const teachers of Object.values(subjectTeachers)) {
    teachers.forEach((name) => allTeacherNames.add(name))
  }

  const teacherSchedules = {}
  for (const name of allTeacherNames) {
    teacherSchedules[name] = buildTeacherSchedule(name, classes)
  }

  const wb = XLSX.utils.book_new()
  const DAY_LABELS = ['週一', '週二', '週三', '週四', '週五']
  const PERIODS = [1, 2, 3, 4, 5, 6, 7]

  for (const subject of Object.keys(subjectTeachers).sort()) {
    const teachers = subjectTeachers[subject]
    if (!teachers || teachers.length === 0) continue

    const displaySubject = getSubjectCategoryDisplay(subject)
    const colCount = teachers.length + 2
    const aoa = []
    const merges = []

    aoa.push([schoolName, ...Array(colCount - 1).fill('')])
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } })

    aoa.push([displaySubject, ...Array(colCount - 1).fill('')])
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } })

    aoa.push(['星期', '節次', ...teachers.map((_, i) => String(i + 1))])
    aoa.push(['', '教師', ...teachers])
    aoa.push(['', '週次', ...Array(teachers.length).fill('')])

    const totals = new Array(teachers.length).fill(0)

    for (let dayNum = 1; dayNum <= 5; dayNum++) {
      for (const period of PERIODS) {
        const row = [period === 1 ? DAY_LABELS[dayNum - 1] : '', String(period)]

        for (let tIdx = 0; tIdx < teachers.length; tIdx++) {
          const teacherName = teachers[tIdx]
          const entries = teacherSchedules[teacherName]?.[String(dayNum)]?.[String(period)] || []
          const matchingEntries = entries.filter((entry) => normalizeSubject(entry.subject) === subject)
          let finalContent = formatTeacherSubjectEntries(matchingEntries)

          if (hasTeacherWeekConflict(entries) && finalContent) {
            finalContent += '\n(⚠衝堂)'
          }

          if (matchingEntries.length > 0) {
            totals[tIdx] += matchingEntries.reduce((sum, entry) => sum + getOccurrenceWeight(entry.week), 0)
          }

          row.push(finalContent)
        }

        aoa.push(row)
      }
    }

    aoa.push(['總計', '', ...totals.map((value) => String(value))])

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!merges'] = merges
    ws['!cols'] = [{ wch: 8 }, { wch: 6 }, ...teachers.map(() => ({ wch: 10 }))]

    const sheetName = displaySubject.length > 31 ? displaySubject.slice(0, 31) : displaySubject
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  XLSX.writeFile(wb, `科任教師課表_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
