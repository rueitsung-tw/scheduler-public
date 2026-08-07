import * as XLSX from 'xlsx'

const DAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }
const PERIOD_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 }
const RESERVED_HEADER = new Set(['星期', '節次', '編號', '教師', '合計', '總計'])

/**
 * 將原始班級代碼映射為班級名稱
 */
function mapClassCode(code, classesList) {
  if (!code) return null
  const s = String(code).trim()
  // 優先以 classesList 比對
  if (Array.isArray(classesList)) {
    const found = classesList.find(
      (c) => String(c.id) === s || (c.name && c.name === s) || (c.code && String(c.code) === s),
    )
    if (found) return found.name
  }
  // 次選正規表達式: "505" → "5年5班"（去除前導 0）
  const m = s.match(/^(\d)(\d{2})$/)
  if (m) {
    return `${m[1]}年${Number(m[2])}班`
  }
  return null
}

/**
 * 解析 Excel 預排課表
 */
export function parsePreallocationExcel(arrayBuffer, options = {}) {
  const {
    subject,
    fileName,
    classesList,
    allowMorningSession = false,
    allowNoonBreakSession = false,
  } = options

  let wb
  try {
    wb = XLSX.read(arrayBuffer, { type: 'buffer' })
  } catch (e) {
    throw new Error('無法讀取 Excel 檔案: ' + e.message)
  }

  // 工作表選擇
  const sheetName = wb.SheetNames.includes('預排課表') ? '預排課表' : wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) {
    throw new Error('Excel 檔案中找不到任何工作表')
  }

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })

  // 找到標題行: '星期', '節次', '教師'
  let dayCol = -1, dayRow = -1, periodCol = -1, periodRow = -1, teacherCol = -1, teacherRow = -1

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || []
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').trim()
      if (val === '星期' && dayCol === -1) {
        dayCol = c
        dayRow = r
      }
      if (val === '節次' && periodCol === -1) {
        periodCol = c
        periodRow = r
      }
      if (val === '教師' && teacherCol === -1) {
        teacherCol = c
        teacherRow = r
      }
    }
  }

  if (dayCol === -1) throw new Error('Excel 缺少「星期」欄位')
  if (periodCol === -1) throw new Error('Excel 缺少「節次」欄位')
  if (teacherCol === -1) throw new Error('Excel 缺少「教師」欄位')

  // 建立合併格映射 (row, col) → (mergeStartRow, mergeStartCol)
  const mergeMap = new Map()
  if (ws['!merges']) {
    for (const merge of ws['!merges']) {
      const sr = merge.s.r, sc = merge.s.c, er = merge.e.r, ec = merge.e.c
      for (let r = sr; r <= er; r++) {
        for (let c = sc; c <= ec; c++) {
          mergeMap.set(`${r},${c}`, `${sr},${sc}`)
        }
      }
    }
  }

  // 讀取教師行
  const teacherRowData = rows[teacherRow] || []
  const teachers = []
  for (let c = teacherCol + 1; c < teacherRowData.length; c++) {
    const val = String(teacherRowData[c] || '').trim()
    if (val && !RESERVED_HEADER.has(val)) {
      if (!teachers.includes(val)) {
        teachers.push(val)
      }
    }
  }

  if (teachers.length === 0) {
    throw new Error('Excel 中未找到任何教師')
  }

  // 資料行範圍
  const dataStartRow = Math.max(dayRow, periodRow, teacherRow) + 1
  const slots = []
  const parseErrors = []
  const parseWarnings = []
  const seenSlots = new Set() // className+day+period

  for (let r = dataStartRow; r < rows.length; r++) {
    const row = rows[r] || []

    // 取得節次 (periodCol)
    const periodVal = String(row[periodCol] || '').trim()

    // 總計 → 結束
    if (periodVal === '總計') break
    // 空格 → skip
    if (!periodVal) continue
    // '節次' → skip (表頭殘留)
    if (periodVal === '節次') continue

    // 早/午休
    let period = null
    if (periodVal === '早') {
      if (!allowMorningSession) continue
      period = 0
    } else if (periodVal === '午休') {
      if (!allowNoonBreakSession) continue
      period = 8
    } else {
      period = PERIOD_MAP[periodVal]
      if (period === undefined) {
        parseErrors.push({ code: 'INVALID_PERIOD', message: `無法解析節次: "${periodVal}"`, cellRef: `R${r + 1}C${periodCol + 1}` })
        continue
      }
    }

    // 取得星期 (dayCol)
    let dayKey = `${r},${dayCol}`
    let dayVal
    if (mergeMap.has(dayKey)) {
      const [mr, mc] = mergeMap.get(dayKey).split(',').map(Number)
      dayVal = String(rows[mr]?.[mc] || '').trim()
    } else {
      dayVal = String(row[dayCol] || '').trim()
    }

    // 如果格子是空的，嘗試從 teacherRow 列的同一行讀取
    if (!dayVal && dayRow < r) {
      // 查找最近的有效 day 值
      for (let rr = r - 1; rr >= dataStartRow; rr--) {
        let prevKey = `${rr},${dayCol}`
        let prevVal
        if (mergeMap.has(prevKey)) {
          const [mr, mc] = mergeMap.get(prevKey).split(',').map(Number)
          prevVal = String(rows[mr]?.[mc] || '').trim()
        } else {
          prevVal = String(rows[rr]?.[dayCol] || '').trim()
        }
        if (prevVal && !RESERVED_HEADER.has(prevVal)) {
          dayVal = prevVal
          break
        }
      }
    }

    if (!dayVal || RESERVED_HEADER.has(dayVal)) continue

    const day = DAY_MAP[dayVal]
    if (day === undefined) {
      parseErrors.push({ code: 'INVALID_DAY', message: `無法解析星期: "${dayVal}"`, cellRef: `R${r + 1}C${dayCol + 1}` })
      continue
    }

    // 遍歷每個教師欄位
    for (let c = teacherCol + 1; c < row.length; c++) {
      const cellVal = String(row[c] || '').trim()
      if (!cellVal) continue

      // 找出這個欄位對應的教師
      const teacher = teachers[c - teacherCol - 1]
      if (!teacher) continue

      // 班級代碼
      const classCode = cellVal
      const className = mapClassCode(classCode, classesList)

      if (!className) {
        parseErrors.push({ code: 'UNKNOWN_CLASS_CODE', message: `無法識別班級代碼: "${classCode}"`, cellRef: `R${r + 1}C${c + 1}` })
        continue
      }

      // 重複檢查
      const slotKey = `${className}-${day}-${period}`
      if (seenSlots.has(slotKey)) {
        parseErrors.push({ code: 'DUPLICATE_SLOT', message: `${className} 週${day} 第${period}節重複`, cellRef: `R${r + 1}C${c + 1}` })
        continue
      }
      seenSlots.add(slotKey)

      slots.push({
        className,
        teacher,
        day,
        period,
        raw: { classCode },
      })
    }
  }

  return {
    teachers,
    slots,
    parseErrors,
    parseWarnings,
  }
}