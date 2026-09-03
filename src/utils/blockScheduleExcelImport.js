import * as XLSX from 'xlsx'

import { normalizeSubject } from './subjectCanonical.js'

const DAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5 }
const PERIOD_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7 }
const SUBJECT_ALIASES = {
  國: '語文-國語',
  國語: '語文-國語',
  國語文: '語文-國語',
  國1: '語文-國語',
  國2: '語文-國語',
  數: '數學',
  數1: '數學',
  數2: '數學',
}

function text(value) {
  return value == null ? '' : String(value).trim()
}

function cellRef(row, col) {
  return XLSX.utils.encode_cell({ r: row, c: col })
}

function addIssue(target, code, message, cell) {
  target.push({ code, message, cell, cellRef: cell })
}

function makeMergeLookup(worksheet) {
  const lookup = new Map()
  for (const merge of worksheet['!merges'] || []) {
    for (let row = merge.s.r; row <= merge.e.r; row++) {
      for (let col = merge.s.c; col <= merge.e.c; col++) {
        lookup.set(`${row}:${col}`, { row: merge.s.r, col: merge.s.c })
      }
    }
  }
  return lookup
}

function mergedCell(rows, mergeLookup, row, col) {
  const origin = mergeLookup.get(`${row}:${col}`)
  return text(origin ? rows[origin.row]?.[origin.col] : rows[row]?.[col])
}

function parseDay(value) {
  const day = DAY_MAP[value]
  return day === undefined ? null : day
}

function parsePeriod(value) {
  const period = PERIOD_MAP[value] ?? Number(value)
  return Number.isInteger(period) && period >= 1 && period <= 7 ? period : null
}

function resolveClass(code, classes) {
  const raw = text(code)
  const direct = classes.find((item) => item?.name === raw)
  if (direct) return direct

  const match = raw.match(/^(\d)(\d{2})$/)
  if (!match) return null
  const normalized = `${Number(match[1])}年${Number(match[2])}班`
  return classes.find((item) => item?.name === normalized) || null
}

function resolveClasses(rawList, classes, blockers, cell) {
  const codes = text(rawList).split(/[、,，/\s]+/).filter(Boolean)
  if (codes.length === 0) {
    addIssue(blockers, 'UNKNOWN_CLASS', '找不到班級清單', cell)
    return []
  }

  return codes.map((code) => {
    const classItem = resolveClass(code, classes)
    if (!classItem) addIssue(blockers, 'UNKNOWN_CLASS', `找不到班級「${code}」`, cell)
    return classItem
  }).filter(Boolean)
}

function resolveSubject(rawSubject) {
  const raw = text(rawSubject)
  const groupMatch = raw.match(/^(國|國語|數)([12])$/)
  const sourceGroup = groupMatch ? `${groupMatch[1] === '數' ? '數' : '國'}${groupMatch[2]}` : null
  return { targetSubject: normalizeSubject(SUBJECT_ALIASES[raw] || raw), sourceGroup }
}

function hasSubjectRequirement(classItem, targetSubject) {
  return (classItem.course_requirements || []).some(
    (requirement) => normalizeSubject(requirement?.subject) === targetSubject,
  )
}

function resolveTeacher(rawName, teachers, blockers, cell) {
  // Stage 1: Exact match against all teachers
  const exact = teachers.filter((t) => t?.name === rawName)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    addIssue(blockers, 'AMBIGUOUS_TEACHER', `教師「${rawName}」有多個符合項目`, cell)
    return null
  }

  // Stage 2: Suffix match (e.g. "文迪" → "謝文迪")
  const suffixMatches = teachers.filter((t) => t?.name?.endsWith(rawName))
  if (suffixMatches.length === 1) return suffixMatches[0]
  if (suffixMatches.length > 1) {
    addIssue(blockers, 'AMBIGUOUS_TEACHER', `教師「${rawName}」有多個符合項目`, cell)
    return null
  }

  // Stage 3: Contains match (only for single-character names, e.g. "謝" → "謝文迪")
  if (rawName.length === 1) {
    const includesMatches = teachers.filter((t) => t?.name?.includes(rawName))
    if (includesMatches.length === 1) return includesMatches[0]
    if (includesMatches.length > 1) {
      addIssue(blockers, 'AMBIGUOUS_TEACHER', `教師「${rawName}」有多個符合項目`, cell)
      return null
    }
  }

  addIssue(blockers, 'MISSING_TEACHER', `找不到教師「${rawName}」`, cell)
  return null
}

function parseLine(rawLine, options, blockers, warnings, cell) {
  let line = text(rawLine)
  if (!line) return null
  if (/\s*修正\s*$/.test(line)) {
    line = line.replace(/\s*修正\s*$/, '').trim()
    addIssue(warnings, 'CORRECTION_SUFFIX', '已忽略行尾「修正」註記', cell)
  }

  let sharedEventId = null
  const eventMatch = line.match(/(?:#([A-Za-z0-9_-]+)|\[(?:事件:|event:|id:)?([A-Za-z0-9_-]+)\])\s*$/)
  if (eventMatch) {
    sharedEventId = eventMatch[1] || eventMatch[2]
    line = line.replace(/(?:#([A-Za-z0-9_-]+)|\[(?:事件:|event:|id:)?([A-Za-z0-9_-]+)\])\s*$/, '').trim()
  }

  const arrow = line.match(/^((?:\d{3}|\d+年\d+班)(?:[、,，/\s]+(?:\d{3}|\d+年\d+班))*)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9-]*)\s*(?:→|->)\s*(.*)$/)
  if (arrow) {
    const projectName = text(arrow[3])
    if (!projectName) {
      addIssue(blockers, 'EMPTY_PROJECT', '專案名稱不可空白', cell)
      return null
    }
    const classItems = resolveClasses(arrow[1], options.classes, blockers, cell)
    return {
      classItems,
      rawSubject: arrow[2],
      sourceKind: 'gifted',
      sourceGroup: null,
      projectName,
      teacher: null,
      sharedEventId,
      classCodes: classItems.map((c) => c.name),
      pulloutLabelSubjectRaw: arrow[2],
      teacherRaw: null,
      deliveryCourseNameRaw: projectName,
      sourceSyntax: 'arrow',
    }
  }

  const learningCenter = line.match(/^((?:\d{3}|\d+年\d+班)(?:[、,，/\s]+(?:\d{3}|\d+年\d+班))*)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9-]*)\s*\(([^()]*)\)$/)
  if (!learningCenter) {
    addIssue(blockers, 'MALFORMED_LINE', `無法解析排課內容「${line}」`, cell)
    return null
  }

  const teacherName = text(learningCenter[3])
  if (!teacherName) {
    addIssue(blockers, 'MISSING_TEACHER', '缺少教師姓名', cell)
    return null
  }
  const classItems = resolveClasses(learningCenter[1], options.classes, blockers, cell)
  const teacher = resolveTeacher(teacherName, options.teachers, blockers, cell)
  return {
    classItems,
    rawSubject: learningCenter[2],
    sourceKind: 'learning_center',
    projectName: null,
    teacher,
    sharedEventId,
    classCodes: classItems.map((c) => c.name),
    pulloutLabelSubjectRaw: learningCenter[2],
    teacherRaw: teacherName,
    deliveryCourseNameRaw: null,
    sourceSyntax: 'learning_center',
  }
}

export function normalizePartialPulloutSemantic({
  parsedLine,
  sourceAnchor,
  classAnchorSubjects = {},
  entityName = '',
}) {
  const parsed = parsedLine || {}
  const rawSubj = parsed.pulloutLabelSubject || parsed.targetSubject || parsed.rawSubject || null
  const pulloutLabelSubject = rawSubj ? normalizeSubject(SUBJECT_ALIASES[rawSubj] || rawSubj) : null
  const teacherAssignmentMode = (parsed.sourceKind === 'gifted' || parsed.teacherAssignmentMode === 'center_pool')
    ? 'center_pool'
    : 'fixed'
  const deliveryCourseName = parsed.projectName || parsed.deliveryCourseName || null

  let classAnchorSubject = parsed.classAnchorSubject || null
  if (!classAnchorSubject && classAnchorSubjects && typeof classAnchorSubjects === 'object') {
    const classNames = parsed.classNames || parsed.targetClasses || parsed.classes || []
    if (classNames.length > 0 && classAnchorSubjects[classNames[0]]) {
      classAnchorSubject = classAnchorSubjects[classNames[0]]
    }
  }

  const day = sourceAnchor?.day != null ? Number(sourceAnchor.day) : null
  const period = sourceAnchor?.period != null ? Number(sourceAnchor.period) : null

  return {
    semanticVersion: 2,
    pulloutLabelSubject,
    classAnchorSubject,
    deliveryCourseName,
    participantGroupId: null,
    teacherAssignmentMode,
    teacher: parsed.teacher?.name || (typeof parsed.teacher === 'string' ? parsed.teacher : null),
    sourceAnchor: {
      workbookKind: 'block_schedule',
      workbookFingerprint: sourceAnchor?.workbookFingerprint || '',
      sheetName: sourceAnchor?.sheetName || '',
      cell: sourceAnchor?.cell || sourceAnchor?.cellRef || '',
      rawLine: sourceAnchor?.rawLine || sourceAnchor?.raw || '',
      day,
      period,
    },
    legalTimeWindow: (day && period) ? [{ day, period }] : [],
    timePolicy: 'legacy_hard',
    anchorPriority: null,
    classSubjectSynchronization: 'none',
  }
}

/**
 * Convert the block-schedule workbook into fixed pullout course definitions.
 */
export function parseBlockScheduleWorkbook(arrayBuffer, {
  classes = [],
  teachers = [],
  giftedUnitName,
  learningCenterName = '學習中心',
  classAnchorSubjects = {},
} = {}) {
  const entries = []
  const blockers = []
  const warnings = []
  let workbook
  try {
    workbook = XLSX.read(arrayBuffer, { type: 'array' })
  } catch (error) {
    throw new Error(`無法讀取區塊排課工作檔：${error.message}`)
  }

  const sheetName = workbook.SheetNames.find((name) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true })
    return rows.some((row) => row?.includes('星期')) && rows.some((row) => row?.includes('節次'))
  }) || workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) throw new Error('Excel 檔案中找不到任何工作表')

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true })
  const mergeLookup = makeMergeLookup(worksheet)
  let dayRow = -1
  let dayCol = -1
  let periodRow = -1
  let periodCol = -1

  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < (rows[row] || []).length; col++) {
      const value = text(rows[row][col])
      if (value === '星期' && dayCol === -1) [dayRow, dayCol] = [row, col]
      if (value === '節次' && periodCol === -1) [periodRow, periodCol] = [row, col]
    }
  }
  if (dayCol === -1 || periodCol === -1) {
    throw new Error('非有效區塊排課工作檔：缺少「星期」或「節次」欄位')
  }

  let currentDay = null
  const firstDataRow = Math.max(dayRow, periodRow) + 1
  for (let row = firstDataRow; row < rows.length; row++) {
    const dayValue = mergedCell(rows, mergeLookup, row, dayCol)
    const periodValue = mergedCell(rows, mergeLookup, row, periodCol)
    if (dayValue === '總計' || periodValue === '總計') break

    let day = currentDay
    if (dayValue) {
      day = parseDay(dayValue)
      if (day === null) addIssue(blockers, 'INVALID_DAY', `無法解析星期「${dayValue}」`, cellRef(row, dayCol))
      else currentDay = day
    }
    const period = parsePeriod(periodValue)
    if (periodValue && period === null) {
      addIssue(blockers, 'INVALID_PERIOD', `無法解析節次「${periodValue}」`, cellRef(row, periodCol))
    }
    const payloadColumns = (rows[row] || []).filter((value, col) => col !== dayCol && col !== periodCol)
    const hasPayload = payloadColumns.some((value) => text(value))
    if (hasPayload && day == null && !blockers.some((issue) => issue.cell === cellRef(row, dayCol) && issue.code === 'INVALID_DAY')) {
      addIssue(blockers, 'INVALID_DAY', '資料列缺少可辨識的星期', cellRef(row, dayCol))
    }
    if (hasPayload && period === null && !blockers.some((issue) => issue.cell === cellRef(row, periodCol) && issue.code === 'INVALID_PERIOD')) {
      addIssue(blockers, 'INVALID_PERIOD', '資料列缺少可辨識的節次', cellRef(row, periodCol))
    }

    for (let col = 0; col < (rows[row] || []).length; col++) {
      if (col === dayCol || col === periodCol) continue
      const rawCell = text(rows[row][col])
      if (!rawCell) continue
      const cell = cellRef(row, col)
      for (const rawLine of rawCell.split(/\r?\n/)) {
        const parsed = parseLine(rawLine, { classes, teachers }, blockers, warnings, cell)
        if (!parsed || parsed.classItems.length === 0) continue
        const { targetSubject, sourceGroup } = resolveSubject(parsed.rawSubject)
        const knownSubject = classes.some(
          (classItem) => hasSubjectRequirement(classItem, targetSubject),
        )
        const missingRequirement = parsed.classItems.find(
          (classItem) => !hasSubjectRequirement(classItem, targetSubject),
        )
        if (!targetSubject || !knownSubject) {
          addIssue(blockers, 'UNKNOWN_SUBJECT', `找不到系統科目「${targetSubject || parsed.rawSubject}」`, cell)
          continue
        }
        if (missingRequirement) {
          addIssue(blockers, 'MISSING_SUBJECT_REQUIREMENT', `班級「${missingRequirement?.name || ''}」沒有科目「${targetSubject || parsed.rawSubject}」`, cell)
          continue
        }
        if (parsed.sourceKind === 'learning_center' && !parsed.teacher) continue
        if (day === null || day == null || period === null) continue

        const classNames = parsed.classItems.map((classItem) => classItem.name)
        const v2Metadata = normalizePartialPulloutSemantic({
          parsedLine: {
            ...parsed,
            classNames,
            targetClasses: classNames,
            pulloutLabelSubject: targetSubject,
          },
          sourceAnchor: {
            sheetName,
            cell,
            rawLine: text(rawLine),
            day,
            period,
          },
          classAnchorSubjects,
          entityName: parsed.sourceKind === 'gifted' ? giftedUnitName : learningCenterName,
        })

        const course = {
          type: 'pullout',
          name: parsed.sourceKind === 'gifted' ? giftedUnitName : learningCenterName,
          sourceKind: parsed.sourceKind,
          sourceGroup: parsed.sourceKind === 'learning_center' ? sourceGroup : null,
          projectName: parsed.projectName,
          sharedEventId: parsed.sharedEventId || null,
          teacher: parsed.teacher?.name || null,
          teacherId: parsed.teacher?.id || null,
          classes: classNames,
          classNames,
          targetClasses: classNames,
          targetSubject,
          isAutoTime: false,
          isAutoClass: false,
          autoClassConfig: null,
          lockedSlots: [{ day, period }],
          ...v2Metadata,
        }

        const gateRes = evaluatePartialPulloutGate(course)
        if (gateRes && gateRes.status === 'BLOCKER') {
          blockers.push({
            cell,
            cellRef: cell,
            code: gateRes.code,
            message: gateRes.message,
          })
        }

        entries.push({ course, source: { cell, cellRef: cell, raw: text(rawLine) } })
      }
    }
  }

  return { entries, blockers, warnings, sheetName }
}

/**
 * Generate an identity fingerprint for a special course.
 * Learning center courses include teacher + sourceGroup; gifted courses do not include teacher.
 */
export function specialCourseImportIdentity(course) {
  const base = {
    name: course.name || '',
    subject: course.targetSubject || '',
    classes: [...(course.targetClasses || [])].sort(),
    slots: [...(course.lockedSlots || [])]
      .map(({ day, period }) => ({ day: Number(day), period: Number(period) }))
      .sort((a, b) => a.day - b.day || a.period - b.period),
    sourceKind: course.sourceKind || '',
    sharedEventId: course.sharedEventId || null,
  }
  if (course.sourceKind === 'learning_center') {
    return JSON.stringify({
      ...base,
      teacher: course.teacher || course.teacher_name || '',
      sourceGroup: course.sourceGroup || '',
    })
  }
  return JSON.stringify(base)
}

export function specialCourseImportIdentityWithoutSharedEventId(course) {
  const base = {
    name: course.name || '',
    subject: course.targetSubject || '',
    classes: [...(course.targetClasses || [])].sort(),
    slots: [...(course.lockedSlots || [])]
      .map(({ day, period }) => ({ day: Number(day), period: Number(period) }))
      .sort((a, b) => a.day - b.day || a.period - b.period),
    sourceKind: course.sourceKind || '',
  }
  if (course.sourceKind === 'learning_center') {
    return JSON.stringify({
      ...base,
      teacher: course.teacher || course.teacher_name || '',
      sourceGroup: course.sourceGroup || '',
    })
  }
  return JSON.stringify(base)
}

function entryKey(entry) {
  const c = entry?.course || {}
  const cell = entry?.source?.cell || entry?.source?.cellRef || ''
  const teacher = c.teacher || c.teacher_name || ''
  const sortedClasses = [...(c.targetClasses || [])].sort()
  const sortedSlots = [...(c.lockedSlots || [])]
    .map(({ day, period }) => ({ day: Number(day), period: Number(period) }))
    .sort((a, b) => a.day - b.day || a.period - b.period)
  return JSON.stringify([
    cell,
    c.name || '',
    c.sourceKind || '',
    c.sourceGroup || '',
    teacher,
    c.targetSubject || '',
    sortedClasses,
    sortedSlots,
  ])
}

export function findImplicitSharedEventCandidates(entries) {
  const groups = new Map()

  for (const entry of entries || []) {
    const course = entry?.course
    if (!course || course.sourceKind !== 'learning_center') continue
    if (course.sharedEventId) continue
    if (!course.lockedSlots || course.lockedSlots.length !== 1) continue

    const slot = course.lockedSlots[0]
    const day = Number(slot.day)
    const period = Number(slot.period)
    if (!day || !period) continue

    const name = text(course.name)
    const teacher = text(course.teacher || course.teacher_name)
    if (!name || !teacher) continue

    const groupKey = JSON.stringify([name, teacher, day, period])
    if (!groups.has(groupKey)) {
      groups.set(groupKey, [])
    }
    groups.get(groupKey).push(entry)
  }

  const candidates = []
  for (const [groupKey, groupEntries] of groups) {
    if (groupEntries.length < 2) continue

    const classArrays = groupEntries.map((e) => [...(e.course.targetClasses || [])].sort())
    const distinctClassArraysStr = new Set(classArrays.map((ca) => JSON.stringify(ca)))
    if (distinctClassArraysStr.size < 2) continue

    const name = text(groupEntries[0].course.name)
    const teacher = text(groupEntries[0].course.teacher || groupEntries[0].course.teacher_name)
    const day = Number(groupEntries[0].course.lockedSlots[0].day)
    const period = Number(groupEntries[0].course.lockedSlots[0].period)

    const classToEntries = new Map()
    let hasClassOverlap = false
    let hasMixedSubjectOverlap = false

    for (const entry of groupEntries) {
      const classes = entry.course.targetClasses || []
      const subj = entry.course.targetSubject || ''
      for (const cls of classes) {
        if (classToEntries.has(cls)) {
          hasClassOverlap = true
          const prevSubj = classToEntries.get(cls)
          if (prevSubj !== subj) {
            hasMixedSubjectOverlap = true
          }
        } else {
          classToEntries.set(cls, subj)
        }
      }
    }

    let confirmationBlocked = false
    let blockerMessage = null

    if (hasClassOverlap) {
      confirmationBlocked = true
      if (hasMixedSubjectOverlap) {
        blockerMessage = `共同事件包含重疊班級且指派不同科目，無法確認為共同事件`
      } else {
        blockerMessage = `共同事件包含重疊班級，無法確認為共同事件`
      }
    }

    const sortedEntries = [...groupEntries].sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
    const candidateEntryKeys = sortedEntries.map((e) => entryKey(e))
    const candidateKey = JSON.stringify([name, teacher, day, period, candidateEntryKeys])

    const rows = sortedEntries.map((e) => ({
      entryKey: entryKey(e),
      cell: e.source?.cell || e.source?.cellRef || '',
      targetSubject: e.course.targetSubject || '',
      targetClasses: [...(e.course.targetClasses || [])].sort(),
    }))

    candidates.push({
      key: candidateKey,
      entryKeys: candidateEntryKeys,
      entityName: name,
      teacher,
      day,
      period,
      rows,
      confirmationBlocked,
      blockerMessage,
    })
  }

  return candidates
}

export function materializeImplicitSharedEventDecisions(
  entries,
  candidates,
  decisions = {},
  idFactory = () => crypto.randomUUID()
) {
  const normDecisions = decisions instanceof Map ? Object.fromEntries(decisions) : (decisions || {})
  const confirmedEntryKeysToId = new Map()
  const legacyNullMigrationEntryKeys = new Set()

  for (const candidate of candidates || []) {
    const decision = normDecisions[candidate.key]
    if (decision === 'pending') {
      throw new Error(`Candidate decision is still pending for candidate key ${candidate.key}`)
    }
    if (candidate.confirmationBlocked && decision === 'confirm') {
      throw new Error(`Cannot confirm blocked candidate ${candidate.key}`)
    }

    if (decision === 'confirm') {
      const generatedId = idFactory(candidate)
      if (!generatedId) {
        throw new Error(`idFactory returned empty ID for candidate ${candidate.key}`)
      }
      for (const ek of candidate.entryKeys) {
        confirmedEntryKeysToId.set(ek, generatedId)
        legacyNullMigrationEntryKeys.add(ek)
      }
    }
  }

  const newEntries = (entries || []).map((entry) => {
    const ek = entryKey(entry)
    const clonedCourse = { ...entry.course }
    if (confirmedEntryKeysToId.has(ek)) {
      clonedCourse.sharedEventId = confirmedEntryKeysToId.get(ek)
    }
    return {
      ...entry,
      course: clonedCourse,
    }
  })

  return { entries: newEntries, legacyNullMigrationEntryKeys }
}

/**
 * Check if two courses have overlapping slots on shared classes.
 */
function hasSlotOverlap(a, b) {
  if (a.sharedEventId && b.sharedEventId && a.sharedEventId === b.sharedEventId) {
    return false
  }
  const aClasses = new Set(a.targetClasses || [])
  const bClasses = new Set(b.targetClasses || [])
  const sharedClasses = [...aClasses].filter((c) => bClasses.has(c))
  if (sharedClasses.length === 0) return false

  for (const slotA of a.lockedSlots || []) {
    for (const slotB of b.lockedSlots || []) {
      if (slotA.day === slotB.day && slotA.period === slotB.period) {
        return true
      }
    }
  }
  return false
}

/**
 * Build an import plan: classify incoming entries into replacements, appendable, and warnings.
 */
export function buildBlockScheduleImportPlan(
  entries,
  existingSpecialCourses = [],
  { legacyNullMigrationEntryKeys = new Set() } = {}
) {
  const appendable = []
  const replacements = []
  const blockers = []
  const warnings = []

  const sharedEventCandidates = findImplicitSharedEventCandidates(entries)

  // Collect any blockers from the parse results
  for (const entry of entries) {
    if (entry.blockers) {
      blockers.push(...entry.blockers)
    }
  }

  // Validate consistency of sharedEventId across incoming entries
  const sharedGroups = new Map()
  for (const entry of entries) {
    const eventId = entry.course?.sharedEventId
    if (eventId) {
      if (!sharedGroups.has(eventId)) sharedGroups.set(eventId, [])
      sharedGroups.get(eventId).push(entry)
    }
  }

  for (const [eventId, groupEntries] of sharedGroups) {
    if (groupEntries.length > 1) {
      const first = groupEntries[0].course
      const firstTeacher = first.teacher || first.teacher_name || ''
      const firstSlotsStr = JSON.stringify(
        (first.lockedSlots || [])
          .map((s) => ({ day: Number(s.day), period: Number(s.period) }))
          .sort((a, b) => a.day - b.day || a.period - b.period)
      )
      const firstType = `${first.type || ''}:${first.sourceKind || ''}:${first.name || ''}`

      for (let i = 1; i < groupEntries.length; i++) {
        const item = groupEntries[i].course
        const itemTeacher = item.teacher || item.teacher_name || ''
        const itemSlotsStr = JSON.stringify(
          (item.lockedSlots || [])
            .map((s) => ({ day: Number(s.day), period: Number(s.period) }))
            .sort((a, b) => a.day - b.day || a.period - b.period)
        )
        const itemType = `${item.type || ''}:${item.sourceKind || ''}:${item.name || ''}`
        const cell = groupEntries[i].source?.cellRef || groupEntries[i].source?.cell || ''

        if (firstTeacher !== itemTeacher) {
          addIssue(blockers, 'MISMATCHED_SHARED_EVENT_TEACHER', `共同事件「${eventId}」包含不一致的教師（「${firstTeacher}」與「${itemTeacher}」）`, cell)
        }
        if (firstSlotsStr !== itemSlotsStr) {
          addIssue(blockers, 'MISMATCHED_SHARED_EVENT_SLOTS', `共同事件「${eventId}」包含不一致的鎖定時段`, cell)
        }
        if (firstType !== itemType) {
          addIssue(blockers, 'MISMATCHED_SHARED_EVENT_TYPE', `共同事件「${eventId}」包含不一致的課程類型`, cell)
        }
      }

      // Check if the same class is assigned multiple distinct subjects within the same sharedEventId
      const classSubjectMap = new Map()
      for (const groupEntry of groupEntries) {
        const item = groupEntry.course
        const subj = item.targetSubject || item.subject || ''
        const classes = item.targetClasses || []
        const cell = groupEntry.source?.cellRef || groupEntry.source?.cell || ''
        for (const cls of classes) {
          if (classSubjectMap.has(cls)) {
            const prevSubj = classSubjectMap.get(cls)
            if (prevSubj !== subj) {
              addIssue(
                warnings,
                'MISMATCHED_SHARED_EVENT_SAME_CLASS_MULTI_SUBJECT',
                `共同事件「${eventId}」之班級「${cls}」同時被指派不同科目（「${prevSubj}」與「${subj}」），請確認是否為有效同班抽離`,
                cell
              )
            }
          } else {
            classSubjectMap.set(cls, subj)
          }
        }
      }
    }
  }

  // Track which existing IDs are already targeted by a replacement
  const replacedIds = new Set()

  for (const entry of entries) {
    const incoming = entry.course
    const incomingIdentity = specialCourseImportIdentity(incoming)
    const ek = entryKey(entry)
    const isLegacyNullMigration = legacyNullMigrationEntryKeys.has(ek)

    // Find all existing courses with matching identity
    const matchedExisting = []
    const matchedIds = new Set()

    for (const existing of existingSpecialCourses) {
      const existingIdentity = specialCourseImportIdentity(existing)
      let matches = false

      if (existingIdentity === incomingIdentity) {
        matches = true
      } else if (isLegacyNullMigration && (!existing.sharedEventId || existing.sharedEventId === '')) {
        const incomingNoId = specialCourseImportIdentityWithoutSharedEventId(incoming)
        const existingNoId = specialCourseImportIdentityWithoutSharedEventId(existing)
        if (incomingNoId === existingNoId) {
          matches = true
        }
      }

      if (matches && !matchedIds.has(existing.id)) {
        matchedExisting.push(existing)
        matchedIds.add(existing.id)
      }
    }

    if (matchedExisting.length > 0) {
      // Exact identity match — present all matches so the user can choose which to replace
      replacements.push({
        incomingEntry: entry,
        existingCandidates: matchedExisting,
      })
      for (const existing of matchedExisting) {
        replacedIds.add(existing.id)
      }
    } else {
      // No exact match — check for slot overlaps with non-replaced existing courses
      for (const existing of existingSpecialCourses) {
        if (replacedIds.has(existing.id)) continue

        if (hasSlotOverlap(incoming, existing)) {
          warnings.push({
            code: 'OVERLAPPING_LOCK_WARNING',
            message: `「${incoming.name || ''}」與既有「${existing.name || ''}」在部分班級時段重疊`,
            incomingCourse: incoming,
            existingCourse: existing,
          })
          break
        }
      }
      appendable.push(entry)
    }
  }

  return { appendable, replacements, blockers, warnings, sharedEventCandidates }
}

export function detectSourcePriorityConflicts(entries = [], classes = []) {
  const classReqMap = new Map()
  for (const cls of classes) {
    if (!cls?.name) continue
    const reqs = new Map()
    for (const req of cls.course_requirements || []) {
      if (!req?.subject) continue
      const normSubj = normalizeSubject(req.subject)
      const periods = Number(req.periods) || Number(req.periodCount) || Number(req.hours)
      if (periods > 0) {
        reqs.set(normSubj, periods)
      }
    }
    classReqMap.set(cls.name, reqs)
  }

  const groupMap = new Map()

  for (const entry of entries) {
    const course = entry?.course
    if (!course) continue
    if (course.isAutoTime === true) continue
    const lockedSlots = course.lockedSlots || []
    if (lockedSlots.length === 0) continue

    const targetClasses = course.targetClasses || course.classes || []
    const rawSubj = course.targetSubject || course.subject || ''
    if (!rawSubj) continue
    const normSubj = normalizeSubject(rawSubj)

    const sourceKind = course.sourceKind || 'unknown'
    const sourceName = course.name || ''
    const projectName = course.projectName || null
    const sourceKeyObj = { sourceKind, name: sourceName, projectName }
    const sourceKey = JSON.stringify(sourceKeyObj)

    for (const className of targetClasses) {
      const reqs = classReqMap.get(className)
      if (!reqs || !reqs.has(normSubj)) continue
      const reqPeriods = reqs.get(normSubj)

      const groupKey = `${className}::${normSubj}`
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          className,
          targetSubject: normSubj,
          requirementPeriods: reqPeriods,
          sourceEntriesMap: new Map(),
        })
      }

      const groupData = groupMap.get(groupKey)
      if (!groupData.sourceEntriesMap.has(sourceKey)) {
        groupData.sourceEntriesMap.set(sourceKey, {
          sourceKeyObj,
          sourceKey,
          entries: [],
        })
      }
      groupData.sourceEntriesMap.get(sourceKey).entries.push(entry)
    }
  }

  const conflicts = []

  for (const groupData of groupMap.values()) {
    const { className, targetSubject, requirementPeriods, sourceEntriesMap } = groupData

    if (sourceEntriesMap.size < 2) continue

    const allSlotsSet = new Set()
    const sourcesDetail = []

    for (const [sourceKey, { sourceKeyObj, entries: sourceEntries }] of sourceEntriesMap.entries()) {
      const sourceSlotsSet = new Set()
      const sourceCellsSet = new Set()
      const coursesDetail = []
      let teacherName = null

      for (const entry of sourceEntries) {
        const course = entry.course
        const cell = entry.source?.cell || entry.source?.cellRef || ''
        if (cell) sourceCellsSet.add(cell)

        const teacher = course.teacher || course.teacher_name || null
        if (teacher && !teacherName) teacherName = teacher

        const lockedSlots = course.lockedSlots || []
        for (const slot of lockedSlots) {
          if (!slot || slot.day == null || slot.period == null) continue
          const slotStr = `${slot.day}:${slot.period}`
          sourceSlotsSet.add(slotStr)
          allSlotsSet.add(slotStr)
        }

        coursesDetail.push({
          entryKey: entryKey(entry),
          sourceCell: cell,
          targetClasses: course.targetClasses || course.classes || [],
          targetSubject: course.targetSubject || course.subject || '',
          teacher,
          lockedSlots,
          sharedEventId: course.sharedEventId || null,
        })
      }

      const fixedSlots = Array.from(sourceSlotsSet)
        .map((str) => {
          const [d, p] = str.split(':').map(Number)
          return { day: d, period: p }
        })
        .sort((a, b) => a.day - b.day || a.period - b.period)

      sourcesDetail.push({
        sourceKey,
        sourceKind: sourceKeyObj.sourceKind,
        name: sourceKeyObj.name,
        projectName: sourceKeyObj.projectName,
        teacher: teacherName,
        sourceCells: Array.from(sourceCellsSet).sort(),
        fixedSlots,
        fixedSlotCount: fixedSlots.length,
        courses: coursesDetail,
      })
    }

    const totalFixedSlotCount = allSlotsSet.size

    if (totalFixedSlotCount > requirementPeriods) {
      sourcesDetail.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))

      conflicts.push({
        key: `${className}::${targetSubject}`,
        className,
        targetSubject,
        requirementPeriods,
        totalFixedSlotCount,
        overagePeriods: totalFixedSlotCount - requirementPeriods,
        sources: sourcesDetail,
      })
    }
  }

  conflicts.sort((a, b) => a.className.localeCompare(b.className) || a.targetSubject.localeCompare(b.targetSubject))

  return conflicts
}

export function evaluatePartialPulloutGate(course) {
  if (!course || course.semanticVersion < 2) return { status: 'OK' }

  const targetClasses = course.targetClasses || course.classes || []
  if (!targetClasses || targetClasses.length === 0) {
    return {
      status: 'BLOCKER',
      code: 'PULLOUT_TARGET_CLASSES_MISSING',
      message: '缺對應目標班級',
    }
  }

  const legalWindow = course.legalTimeWindow || course.lockedSlots || []
  if (!legalWindow || legalWindow.length === 0) {
    return {
      status: 'BLOCKER',
      code: 'PULLOUT_TIME_WINDOW_MISSING',
      message: '缺合法選時窗口與時段',
    }
  }

  const diagnostics = []
  if (course.teacherAssignmentMode === 'center_pool' && !course.teacher) {
    diagnostics.push('中心自行調配（未提供固定教師）')
  }
  if (!course.participantGroupId) {
    diagnostics.push('未提供抽離學生群組 ID')
  }

  return { status: 'OK', diagnostics }
}

