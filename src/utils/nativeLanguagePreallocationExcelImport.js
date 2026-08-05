import * as XLSX from 'xlsx'

function getCellRef(colIndex, rowIndex) {
  let colStr = ''
  let c = colIndex
  while (c >= 0) {
    colStr = String.fromCharCode((c % 26) + 65) + colStr
    c = Math.floor(c / 26) - 1
  }
  return `${colStr}${rowIndex + 1}`
}

const DAY_MAP = {
  一: 1,
  1: 1,
  '1': 1,
  二: 2,
  2: 2,
  '2': 2,
  三: 3,
  3: 3,
  '3': 3,
  四: 4,
  4: 4,
  '4': 4,
  五: 5,
  5: 5,
  '5': 5,
}

const PERIOD_MAP = {
  一: 1,
  1: 1,
  '1': 1,
  二: 2,
  2: 2,
  '2': 2,
  三: 3,
  3: 3,
  '3': 3,
  四: 4,
  4: 4,
  '4': 4,
  五: 5,
  5: 5,
  '5': 5,
  六: 6,
  6: 6,
  '6': 6,
  七: 7,
  7: 7,
  '7': 7,
}

export function parseNativeLanguagePreallocationExcel(arrayBuffer, options = {}) {
  if (!arrayBuffer) {
    throw new Error('未提供有效 Excel 檔案內容')
  }

  let workbook
  try {
    const isBuffer = typeof Buffer !== 'undefined' && Buffer.isBuffer(arrayBuffer)
    workbook = XLSX.read(arrayBuffer, { type: isBuffer ? 'buffer' : 'array' })
  } catch {
    throw new Error('無法讀取 Excel 檔案，請確認檔案格式是否正確')
  }

  if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Excel 檔案無有效工作表')
  }

  const sheetName = workbook.SheetNames.includes('預排課表')
    ? '預排課表'
    : workbook.SheetNames[0]

  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) {
    throw new Error(`找不到工作表「${sheetName}」`)
  }

  const rowMatrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true })

  let dayCol = -1
  let dayRow = -1
  let periodCol = -1
  let periodRow = -1
  let teacherRow = -1
  let teacherCol = -1

  for (let r = 0; r < rowMatrix.length; r++) {
    const row = rowMatrix[r]
    if (!Array.isArray(row)) continue
    for (let c = 0; c < row.length; c++) {
      const val = row[c] != null ? String(row[c]).trim() : ''
      if (val === '星期' && dayCol === -1) {
        dayCol = c
        dayRow = r
      }
      if (val === '節次' && periodCol === -1) {
        periodCol = c
        periodRow = r
      }
      if (val === '教師' && teacherRow === -1) {
        teacherRow = r
        teacherCol = c
      }
    }
  }

  if (dayCol === -1) {
    throw new Error('非有效 Excel 預排課表格式：缺少「星期」欄位')
  }
  if (teacherRow === -1 || teacherCol === -1) {
    throw new Error('非有效 Excel 預排課表格式：缺少「教師」列')
  }
  if (periodCol === -1) {
    throw new Error('非有效 Excel 預排課表格式：缺少「節次」欄位')
  }

  const teacherRowData = rowMatrix[teacherRow] || []
  const teachers = []
  const reservedHeaderWords = new Set(['星期', '節次', '編號', '教師', '合計', '總計'])
  for (let c = teacherCol + 1; c < teacherRowData.length; c++) {
    if (c === dayCol || c === periodCol) continue
    const val = teacherRowData[c]
    const name = val != null ? String(val).trim() : ''
    if (name && !reservedHeaderWords.has(name)) {
      teachers.push({
        id: `excel-teacher-${teachers.length + 1}`,
        name,
        col: c,
      })
    }
  }

  if (teachers.length === 0) {
    throw new Error('非有效 Excel 預排課表格式：未找到任何教師姓名')
  }

  const assignments = []
  let currentDay = null
  const headerEndRow = Math.max(dayRow, periodRow, teacherRow)

  for (let r = headerEndRow + 1; r < rowMatrix.length; r++) {
    const row = rowMatrix[r]
    if (!Array.isArray(row)) continue

    const isTotalRow = row.some((cell) => cell != null && String(cell).trim() === '總計')
    if (isTotalRow) {
      break
    }

    const dayCellRaw = row[dayCol]
    const dayCellStr = dayCellRaw != null ? String(dayCellRaw).trim() : ''

    if (dayCellStr !== '') {
      if (dayCellStr === '總計') {
        break
      }
      if (dayCellStr === '星期' || dayCellStr === '教師') {
        continue
      }
      const mappedDay = DAY_MAP[dayCellStr]
      if (mappedDay !== undefined) {
        currentDay = mappedDay
      } else {
        const cellRef = getCellRef(dayCol, r)
        throw new Error(`工作表「${sheetName}」儲存格 ${cellRef}：無效星期「${dayCellStr}」，僅接受 一 至 五`)
      }
    }

    const periodCellRaw = row[periodCol]
    const periodCellStr = periodCellRaw != null ? String(periodCellRaw).trim() : ''

    if (
      periodCellStr === '' ||
      periodCellStr === '早' ||
      periodCellStr === '午休' ||
      periodCellStr === '節次'
    ) {
      continue
    }

    if (periodCellStr === '總計') {
      break
    }

    const mappedPeriod = PERIOD_MAP[periodCellStr]
    if (mappedPeriod === undefined) {
      const cellRef = getCellRef(periodCol, r)
      throw new Error(`工作表「${sheetName}」儲存格 ${cellRef}：無效節次「${periodCellStr}」，僅接受 一 至 七`)
    }

    if (currentDay === null) {
      const cellRef = getCellRef(periodCol, r)
      throw new Error(`工作表「${sheetName}」儲存格 ${cellRef}：資料列先於星期`)
    }

    for (const t of teachers) {
      const cellVal = row[t.col]
      if (cellVal != null) {
        const rawStr = String(cellVal).trim()
        if (rawStr !== '') {
          const classIds = rawStr.split(/[,\s/]+/).map((s) => s.trim()).filter(Boolean)
          for (const classIdStr of classIds) {
            assignments.push({
              id: `excel:${currentDay}:${mappedPeriod}:${classIdStr}:${t.id}`,
              language: '台語',
              teacherId: t.id,
              classId: classIdStr,
              slot: { day: currentDay, period: mappedPeriod },
              locked: false,
            })
          }
        }
      }
    }
  }

  return {
    schemaVersion: '1.0',
    source: {
      kind: 'excel-template',
      fileName: options.fileName || '',
    },
    canonical: {
      teachers: teachers.map((t) => ({ id: t.id, name: t.name })),
      classes: [],
      fixedPulloutBindings: [],
      scheduleResult: {
        assignments,
      },
    },
  }
}
