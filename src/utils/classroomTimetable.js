import { formatPairedSlot, hasValidPair } from './pairAwareFormatter.js'
import { expandTimetableCellEntries } from './scheduleAiReport.js'

function getCell(timetable, day, period) {
  try {
    return timetable?.[day]?.[period] || null
  } catch {
    return null
  }
}

export function collectRoomSlotMatches(classes, room, day, period) {
  const matches = []

  for (const cls of classes || []) {
    const cell = getCell(cls.timetable, day, period)
    if (!cell) continue

    const occurrences = expandTimetableCellEntries(cls.name, day, period, cell)
    for (const occ of occurrences) {
      const hasRoomIdMatch = occ.classroomId && room?.id && String(occ.classroomId) === String(room.id)
      const hasRoomNameMatch = occ.classroomName && room?.name && occ.classroomName === room.name
      if (!hasRoomIdMatch && !hasRoomNameMatch) continue

      matches.push({
        className: cls.name,
        week: occ.week || 'both',
        subject: occ.subject || '',
        pairGroupId: occ.pairGroupId || '',
        pairDirection: occ.pairDirection || '',
        label: `${cls.name}${occ.week === 'odd' ? '(單)' : occ.week === 'even' ? '(雙)' : ''}`,
      })
    }
  }

  return matches
}

export function formatRoomSlotMatches(
  matches,
  {
    conflictPrefix = '【衝堂】',
    separator = '\n',
    fallbackToParentheses = true,
  } = {},
) {
  if (!Array.isArray(matches) || matches.length === 0) return ''

  if (hasValidPair(matches)) {
    const pairedResult = formatPairedSlot(matches, { fallbackToParentheses })

    const pairedClassNames = new Set()
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        if (hasValidPair([matches[i], matches[j]])) {
          pairedClassNames.add(matches[i].className)
          pairedClassNames.add(matches[j].className)
        }
      }
    }

    const unpaired = matches.filter((item) => !pairedClassNames.has(item.className))
    if (unpaired.length > 0) {
      return [pairedResult, ...unpaired.map((item) => item.label)].join(separator)
    }

    return pairedResult
  }

  const uniqueLabels = [...new Set(matches.map((item) => item.label))]
  const bothCount = matches.filter((item) => item.week === 'both').length
  const oddCount = matches.filter((item) => item.week === 'odd').length
  const evenCount = matches.filter((item) => item.week === 'even').length
  const hasCollision =
    bothCount > 1 ||
    oddCount > 1 ||
    evenCount > 1 ||
    (bothCount > 0 && (oddCount > 0 || evenCount > 0))

  return hasCollision
    ? [conflictPrefix, ...uniqueLabels].join(separator)
    : uniqueLabels.join(separator)
}

export function formatRoomSlotAssignments(classes, room, day, period, options = {}) {
  return formatRoomSlotMatches(
    collectRoomSlotMatches(classes, room, day, period),
    options,
  )
}
