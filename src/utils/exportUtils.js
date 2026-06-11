/**
 * ExportHubView 報表匯出工具函式庫
 * 根據《ExportHubView 報表中心轉型與格式規範V5》實作
 */

import * as XLSX from 'xlsx'
import { Document, Packer, Table, TableRow, TableCell, WidthType, TextRun, Paragraph, AlignmentType, PageBreak } from 'docx'
import { saveAs } from 'file-saver'
import { expandTimetableCellEntries, getOccurrenceWeight, normalizeWeekTag, splitTeacherNames } from './scheduleAiReport.js'
import { normalizeSubject } from './subjectCanonical.js'

/**
 * 取得導師姓名 (反查 ID → name)
 */
export function getHomeroomTeacherName(cls, teachers) {
  const htId = cls.homeroom_teacher_id || cls.homeroom_teacher
  if (!htId) return '未指定'
  const htObj = teachers.find(t => t.id === htId || String(t.id) === String(htId))
  return htObj ? htObj.name : htId
}

/**
 * 讀取 timetable 單元格，安全處理
 */
function getCell(timetable, day, period) {
  try {
    return timetable?.[day]?.[period] || null
  } catch {
    return null
  }
}

/**
 * 根據 cell 計算交替課標籤 (依 V5 規格)
 */
export function buildSubjectString(cell) {
  if (!cell) return ''
  let subjStr = cell?.subject || ''
  if (cell?.oddWeek || cell?.isAlternating === 'odd') subjStr += '*'
  if (cell?.evenWeek || cell?.isAlternating === 'even') subjStr += '#'
  return subjStr
}

/**
 * 格式 1: 教育部標準格式 (教師總表 - xlsx)
 * 展平格式：[班級名稱, req.subject, tName, req.periods, ...]
 */
export function exportMoEFormat(scheduleStore) {
  const { classes, teachers, standardDomainSettings } = scheduleStore

  // 依 standardDomainSettings 順序排列科目
  const subjectOrder = standardDomainSettings.map(s => s.name)

  // 表頭
  const headers = ['班級', '導師', '科目', '任課教師', '每週節數']

  const rows = [headers]

  classes.forEach(cls => {
    const htName = getHomeroomTeacherName(cls, teachers)

    // 建立科目→需求的 map
    const reqMap = {}
    ;(cls.course_requirements || []).forEach(req => {
      reqMap[req.subject] = req
    })

    // 依科目字典順序迭代
    subjectOrder.forEach(subj => {
      const req = reqMap[subj]
      if (req) {
        const tName = req.teacher_name || req.teacher || htName
        rows.push([cls.name, htName, subj, tName, req.periods || 0])
      }
    })
  })

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // 設定中文字元寬度
  ws['!cols'] = [
    { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '教師總表')
  XLSX.writeFile(wb, '教育部標準格式_教師總表.xlsx')
}

/**
 * 格式 2: 全校班級課表總表 (矩陣格式 - xlsx)
 * 5x7 矩陣，於第 4 節後插入午休列
 */
export function exportClassesTimetableXLSX(scheduleStore) {
  const { classes } = scheduleStore

  // 表頭：班級 + 5天 x 7節
  const headerRow = ['班級']
  const days = ['週一', '週二', '週三', '週四', '週五']
  for (let day = 1; day <= 5; day++) {
    for (let period = 1; period <= 7; period++) {
      headerRow.push(`${days[day - 1]}\n第${period}節`)
    }
  }

  const rows = [headerRow]

  classes.forEach(cls => {
    const row = [cls.name]

    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 7; period++) {
        const cell = getCell(cls.timetable, day, period)
        const subjStr = buildSubjectString(cell)
        const teacher = cell?.teacher || ''
        const cellContent = subjStr
          ? `${subjStr}\n${teacher}`
          : teacher || ''
        row.push(cellContent)
      }
    }

    rows.push(row)

    // 於第 4 節後插入午休列（在第 1-4 節與第 5-7 節之間作為視覺分隔）
    const lunchRow = ['']
    for (let i = 1; i <= 4; i++) lunchRow.push('午休')
    for (let i = 5; i <= 7; i++) lunchRow.push('午休')
    rows.push(lunchRow)
  })

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 10 }]
  for (let i = 0; i < 35; i++) ws['!cols'].push({ wch: 12 })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '班級課表')
  XLSX.writeFile(wb, '全校班級課表總表.xlsx')
}

/**
 * 格式 3: 專科教室課表 (docx)
 * 空間視角，含晨光時間、午休、打掃時間
 */
export async function exportClassroomTimetable(scheduleStore) {
  const { classrooms, classes, schoolInfo } = scheduleStore

  // 🔍 [防呆診斷] 專科教室匯出前資料快照
  console.group('[專科教室匯出] 資料診斷')
  console.log(`🏫 教室總數: ${(classrooms || []).length}`)
  console.log(`📚 班級總數: ${(classes || []).length}`)
  console.log(`🔑 有 primaryTeacher 的教室:`,
    (classrooms || []).filter(r => r.primaryTeacher).map(r => ({
      name: r.name,
      subject: r.subject,
      primaryTeacher: r.primaryTeacher
    }))
  )
  console.groupEnd()

  // 只處理有設定科目的專科教室
  const specialClassrooms = classrooms.filter(r => r.subject)

  if (specialClassrooms.length === 0) {
    alert('目前沒有設定專科教室，無法產出課表。')
    return
  }

  console.log('[專科教室匯出] ✅ 已改用不含百分比寬度的 docx 版型（解決 Word 無法開啟問題）')

  const days = ['週一', '週二', '週三', '週四', '週五']
  const periodTimes = {
    1: '8:40-9:25',
    2: '9:35-10:20',
    3: '10:30-11:15',
    4: '11:25-12:10',
    5: '13:25-14:10',
    6: '14:20-15:05',
    7: '15:15-16:00',
  }

  const docChildren = []

  specialClassrooms.forEach((room, roomIdx) => {
    if (roomIdx > 0) {
      // PageBreak 必須包在 Paragraph 內，否則 docx 函式庫會產生格式損壞
      docChildren.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      )
    }

    // 標題
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${room.name} 專科教室課表`,
            bold: true,
            size: 32,
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `負責教師：${room.primaryTeacher || '共享'}`,
            size: 24,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    )

    // 建立表格
    const tableRows = []

    // 表頭列（移除百分比寬度，改用 Word 自動排版）
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph('時段')],
          }),
          ...days.map(d =>
            new TableCell({
              children: [new Paragraph(d)],
            })
          ),
        ],
      })
    )

    // 8:00-8:40 晨光時間列
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('晨光時間\n8:00-8:40')] }),
          ...days.map(() =>
            new TableCell({ children: [new Paragraph('')] })
          ),
        ],
      })
    )

    // 第1-4節
    for (let period = 1; period <= 4; period++) {
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(`第${period}節\n${periodTimes[period]}`)],
            }),
            ...days.map((_, dayIdx) => {
              const day = dayIdx + 1
              const matched = findClassForCell(classes, room, day, period, schoolInfo)
              return new TableCell({
                children: [new Paragraph(matched || '')],
              })
            }),
          ],
        })
      )
    }

    // 第 4 節後加入「午休/口腔清潔」橫跨列
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('午休')] }),
          ...days.map(() =>
            new TableCell({ children: [new Paragraph('午休 / 口腔清潔')] })
          ),
        ],
      })
    )

    // 第5-7節
    for (let period = 5; period <= 7; period++) {
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(`第${period}節\n${periodTimes[period]}`)],
            }),
            ...days.map((_, dayIdx) => {
              const day = dayIdx + 1
              const matched = findClassForCell(classes, room, day, period, schoolInfo)
              return new TableCell({
                children: [new Paragraph(matched || '')],
              })
            }),
          ],
        })
      )
    }

    // 第 7 節後加入 15:35-15:50「打掃時間」列
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('打掃時間\n15:35-15:50')] }),
          ...days.map(() =>
            new TableCell({ children: [new Paragraph('')] })
          ),
        ],
      })
    )

    // 🔍 [防呆診斷] 計算此教室實際有匹配到的格子數
    let matchCount = 0
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 7; period++) {
        const result = findClassForCell(classes, room, day, period, schoolInfo)
        if (result) matchCount++
      }
    }
    console.log(`[專科教室匯出] 教室「${room.name}」匹配到 ${matchCount} 個格子`)
    if (matchCount === 0) {
      console.warn(`[專科教室匯出] ⚠️ 教室「${room.name}」一個格子都沒比對到！請確認 primaryTeacher(${room.primaryTeacher}) 與 subject(${room.subject}) 是否與班級課表一致。`)
    }

    docChildren.push(
      new Table({
        rows: tableRows,
        // 移除百分比寬度，改用 Word 自動排版（解決 Word 無法開啟的問題）
      })
    )
  })

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, '專科教室課表.docx')
}

// normalizeSubject is now imported from ./subjectCanonical.js (shared canonical mapping)

/**
 * 從班級名稱提取年級數字
 * "3年1班" → 3, "一年2班" → null（中文數字不支援）
 */
function extractGrade(className) {
  const match = String(className || '').match(/(\d+)年/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * 找出匹配教室的班級名稱
 * 採用寬鬆多層比對策略，降低對資料格式一致性的依賴：
 *   Layer 1: 優先以 cell.classroomId / cell.classroomName 直接對應（最精確）
 *   Layer 2: 正規化 subject 後比對，不強制要求 teacher 完全一致
 *   Layer 3: 若 room 無 subject，只以 teacher 名稱包含比對（模糊）
 */
function findClassForCell(classes, room, day, period, schoolInfo = null) {
  const matches = []
  const roomSubjectNorm = normalizeSubject(room.subject)

  classes.forEach(cls => {
    const cell = getCell(cls.timetable, day, period)
    if (!cell) return

    // --- Layer 1: 明確教室 ID 或名稱比對（最可靠，優先使用）---
    if (cell.classroomId && room.id && String(cell.classroomId) === String(room.id)) {
      matches.push(cls.name)
      return
    }
    if (cell.classroomName && room.name && cell.classroomName === room.name) {
      matches.push(cls.name)
      return
    }

    // --- Layer 2: 正規化科目比對 + 教師寬鬆比對 ---
    const cellSubjectNorm = normalizeSubject(cell?.subject)
    const subjectMatch = roomSubjectNorm
      ? (cellSubjectNorm === roomSubjectNorm || (cell?.subject && cell.subject.includes(room.subject)))
      : true // 若教室未設定科目，略過科目條件

    if (!subjectMatch) return

    // 教師比對：精確比對優先，再嘗試「包含」比對（應對名稱含空格等邊際情況）
    const cellTeacher = String(cell?.teacher || '').trim()
    const roomTeacher = String(room.primaryTeacher || '').trim()

    if (roomTeacher) {
      const teacherExact = cellTeacher === roomTeacher
      const teacherContains = roomTeacher.length > 0 &&
        (cellTeacher.includes(roomTeacher) || roomTeacher.includes(cellTeacher))
      if (teacherExact || teacherContains) {
        matches.push(cls.name)
      }
    } else {
      // 教室無 primaryTeacher，只以科目判斷 + 年級過濾
      if (!subjectMatch) return;

      // 套用 subjectClassroomGrades 過濾
      if (schoolInfo?.subjectClassroomGrades && roomSubjectNorm) {
        const grade = extractGrade(cls.name);
        if (grade !== null) {
          const gradesConfig = schoolInfo.subjectClassroomGrades;
          const matchedKey = Object.keys(gradesConfig).find(key =>
            normalizeSubject(key) === roomSubjectNorm
          );
          if (matchedKey && Array.isArray(gradesConfig[matchedKey])) {
            if (!gradesConfig[matchedKey].includes(grade)) {
              return; // 該年級不需使用此專科教室
            }
          }
        }
      }

      matches.push(cls.name)
    }
  })

  // 去重，避免同班級因多條件重複匹配
  return [...new Set(matches)].join(', ')
}

/**
 * 游泳匯出 helper：正規化科目字串
 */
function normalizeSwimmingSubject(subject) {
  if (!subject) return ''
  return String(subject).trim()
}

/**
 * 游泳匯出 helper：判定是否為游泳錨點節（體育）
 */
function isSwimAnchor(subject) {
  const s = normalizeSwimmingSubject(subject)
  return s.includes('體育')
}

/**
 * 游泳匯出 helper：判定是否為游泳夥伴節（導師區塊為主，健康當 fallback）
 */
function isSwimPartner(subject) {
  const s = normalizeSwimmingSubject(subject)
  return s === '導師區塊' || s.includes('健康')
}

/**
 * 格式 4: 游泳池使用課表 (docx)
 * 以 timetable 掃描為主，推導「體育 + 導師區塊」相鄰配對為游泳事件
 * 產出 [星期, 節次(時間), 班級] 列表並按時間排序
 */
export async function exportSwimmingSchedule(scheduleStore) {
  const { classes } = scheduleStore

  // 🔍 [防呆診斷] 游泳池匯出前資料快照
  console.group('[游泳匯出] 資料診斷')
  console.log(`📚 班級總數: ${(classes || []).length}`)
  console.groupEnd()

  const dayNames = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日']
  const periodTimes = {
    1: '8:40-9:25',
    2: '9:35-10:20',
    3: '10:30-11:15',
    4: '11:25-12:10',
    5: '13:25-14:10',
    6: '14:20-15:05',
    7: '15:15-16:00',
  }

  const swimmingEntries = new Set() // 用於去重，key = `${className}-${day}-${anchorPeriod}`
  const entryList = []

  // 以 timetable 掃描為主：找出「體育 + 導師區塊」相鄰配對
  classes.forEach(cls => {
    if (!cls.timetable) return

    const classSwimmingPairs = []

    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 6; period++) {
        const cell = getCell(cls.timetable, day, period)
        const nextCell = getCell(cls.timetable, day, period + 1)

        if (!cell || !nextCell) continue

        const subj = normalizeSwimmingSubject(cell.subject)
        const nextSubj = normalizeSwimmingSubject(nextCell.subject)

        let anchorPeriod = null

        // 正向：體育 + 夥伴節
        if (isSwimAnchor(subj) && isSwimPartner(nextSubj)) {
          anchorPeriod = period
        }
        // 反向：夥伴節 + 體育 → 錨點是體育（period+1）
        else if (isSwimPartner(subj) && isSwimAnchor(nextSubj)) {
          anchorPeriod = period + 1
        }

        if (anchorPeriod !== null) {
          const key = `${cls.name}-${day}-${anchorPeriod}`
          if (!swimmingEntries.has(key)) {
            swimmingEntries.add(key)
            classSwimmingPairs.push({ day, anchorPeriod })
            entryList.push({
              day,
              period: anchorPeriod,
              className: cls.name,
            })
          }
        }
      }
    }

    console.log(`[游泳匯出] ${cls.name} 掃到 ${classSwimmingPairs.length} 筆游泳配對`, classSwimmingPairs)
  })

  // 按星期、節次排序
  entryList.sort((a, b) => a.day - b.day || a.period - b.period)

  // 🔍 [防呆診斷] 游泳課最終抓到筆數
  console.log(`[游泳匯出] 最終抓到 ${entryList.length} 筆游泳課記錄`)
  if (entryList.length === 0) {
    console.warn('[游泳匯出] ⚠️ 沒有掃到「體育 + 導師區塊」相鄰配對！請確認課表結構是否符合規則。')
  }

  // 建立 Docx — [星期, 節次(時間), 班級]
  const docChildren = [
    new Paragraph({
      children: [
        new TextRun({
          text: '游泳池使用課表',
          bold: true,
          size: 32,
          alignment: AlignmentType.CENTER,
        }),
      ],
      spacing: { after: 200 },
    }),
  ]

  const tableRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph('星期')] }),
        new TableCell({ children: [new Paragraph('節次 (時間)')] }),
        new TableCell({ children: [new Paragraph('班級')] }),
      ],
    }),
  ]

  entryList.forEach(entry => {
    const timeLabel = entry.period ? periodTimes[entry.period] || '' : ''
    const periodLabel = entry.period
      ? `第${entry.period}節 (${timeLabel})`
      : '未定'

    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(dayNames[entry.day] || '未定')] }),
          new TableCell({ children: [new Paragraph(periodLabel)] }),
          new TableCell({ children: [new Paragraph(entry.className)] }),
        ],
      })
    )
  })

  docChildren.push(
    new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    })
  )

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, '游泳池使用課表.docx')
}

// ============================================================
// 格式 5: 直式全校班級課表總表 (XLSX)
// 版面：星期+節次為列，班級為欄，每年級獨立工作表
// 沿用現有 xlsx 技術棧，不引入新依賴
// ============================================================

/**
 * 從班級名稱（如「2年3班」）解析年級數字
 * 用於 cls.grade 為 null 時的 fallback
 */
function _gradeFromName(name) {
  const match = String(name ?? '').match(/^(\d+)年/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * 取今日日期字串，格式 YYYY-MM-DD
 */
function _getToday() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 組裝直式工作表的 AOA 資料、合併範圍與欄寬設定
 * @returns {{ aoa, merges, colWidths }}
 */
function _buildVerticalSheetData(classes, DAY_LABELS, PERIODS, LUNCH_AFTER) {
  const aoa    = []
  const merges = []
  const totalCols = classes.length + 2  // A=星期, B=節次, C 起=班級

  // ── 標題列（row index 0）──
  aoa.push(['星期', '節次', ...classes.map(c => c.name)])

  // ── 逐星期逐節次寫入 ──
  for (let dayIdx = 0; dayIdx < DAY_LABELS.length; dayIdx++) {
    const dayNum   = dayIdx + 1          // 1–5
    const dayLabel = DAY_LABELS[dayIdx]  // '一'–'五'
    const dayBlockStart = aoa.length     // 此星期區塊第一列的 0-based row index

    for (const period of PERIODS) {
      // 午休列：插在 LUNCH_AFTER 節之後、LUNCH_AFTER+1 節之前
      if (period === LUNCH_AFTER + 1) {
        const lunchRowIdx = aoa.length
        aoa.push(['', '午休', ...classes.map(() => '')])

        // 午休列：B 欄到最後班級欄合併
        merges.push({
          s: { r: lunchRowIdx, c: 1 },
          e: { r: lunchRowIdx, c: totalCols - 1 },
        })
      }

      // 讀取各班此節的科目文字
      const cellTexts = classes.map(cls => {
        const cell = cls.timetable?.[String(dayNum)]?.[String(period)]
        return buildSubjectString(cell)
      })

      aoa.push(['', String(period), ...cellTexts])
    }

    const dayBlockEnd = aoa.length - 1  // 此星期區塊最後一列的 0-based row index

    // A 欄（col 0）垂直合併：星期文字佔整個星期區塊
    aoa[dayBlockStart][0] = dayLabel
    merges.push({
      s: { r: dayBlockStart, c: 0 },
      e: { r: dayBlockEnd,   c: 0 },
    })
  }

  // ── 欄寬設定 ──
  const colWidths = [
    { wch: 5 },  // A: 星期
    { wch: 5 },  // B: 節次
    ...classes.map(() => ({ wch: 9 })),  // C 起: 各班
  ]

  return { aoa, merges, colWidths }
}

/**
 * 新增直式全校班級課表總表匯出
 * 版面：星期+節次為列，班級為欄，每年級獨立工作表
 * 沿用現有 xlsx 技術棧，不引入新依賴
 * @param {Object} scheduleStore - Pinia schedule store
 */
export function exportClassesTimetableVerticalXLSX(scheduleStore) {
  const DAY_LABELS  = ['一', '二', '三', '四', '五']
  const PERIODS     = [1, 2, 3, 4, 5, 6, 7]
  const LUNCH_AFTER = 4  // 第 4 節後插入午休列

  // ── grade fallback：cls.grade 若為 null/undefined，從班級名稱解析 ──
  const getGrade = (cls) =>
    cls.grade ?? _gradeFromName(cls.name)

  // ── 依年級分組 ──
  const gradeSet = [
    ...new Set(scheduleStore.classes.map(c => getGrade(c)))
  ].filter(g => g > 0).sort((a, b) => a - b)

  const wb = XLSX.utils.book_new()

  for (const grade of gradeSet) {
    const gradeClasses = scheduleStore.classes
      .filter(c => getGrade(c) === grade)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))

    const { aoa, merges, colWidths } = _buildVerticalSheetData(
      gradeClasses, DAY_LABELS, PERIODS, LUNCH_AFTER
    )

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!merges'] = merges
    ws['!cols']   = colWidths

    XLSX.utils.book_append_sheet(wb, ws, `${grade}年級`)
  }

  XLSX.writeFile(wb, `全校班級課表_直式_${_getToday()}.xlsx`)
}

// ============================================================
// Format 6: Subject Teacher Timetables (科任教師課表) - XLSX
// One sheet per subject category, columns = teachers, rows = day/period
// Cell content = class name(s), conflict cells marked with indicator
// ============================================================

/**
 * Map canonical subject names to display sheet names
 */
function _getSubjectCategoryDisplay(subject) {
  const map = {
    '社會': '社會科任',
    '自然科學': '自然科任',
    '語文-英語': '英文科任',
    '體育': '體育科任',
    '健康與體育': '體育科任',
    '音樂': '音樂科任',
    '美勞': '美勞科任',
    '資訊': '電腦科任',
    '本土語': '本語科任',
    '健康': '健康科任',
  }
  return map[subject] || subject + '科任'
}

/**
 * Build a map of normalized subject → ordered list of teacher names
 * by scanning course_requirements across all classes.
 */
function _buildSubjectTeacherMap(classes) {
  const map = {}
  for (const cls of classes) {
    for (const req of cls.course_requirements || []) {
      const subj = normalizeSubject(req.subject)
      if (!subj) continue
      const tName = (req.teacher_name || req.teacher || '').trim()
      if (!tName) continue
      if (!map[subj]) map[subj] = []
      if (!map[subj].includes(tName)) {
        map[subj].push(tName)
      }
    }
  }
  return map
}

/**
 * Scan all class timetables to find where a teacher teaches.
 * Returns { [day]: { [period]: [{ className, subject }] } }
 */
function _buildTeacherSchedule(teacherName, classes) {
  const schedule = {}
  const tName = String(teacherName).trim()

  for (const cls of classes) {
    if (!cls.timetable) continue
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 7; period++) {
        const cell = getCell(cls.timetable, day, period)
        if (!cell) continue
        const cellTeacher = String(cell.teacher || '').trim()
        if (cellTeacher === tName) {
          if (!schedule[String(day)]) schedule[String(day)] = {}
          if (!schedule[String(day)][String(period)]) {
            schedule[String(day)][String(period)] = []
          }
          schedule[String(day)][String(period)].push({
            className: cls.name,
            subject: normalizeSubject(cell.subject),
          })
        }
      }
    }
  }
  return schedule
}

/**
 * Export subject teacher timetables (科任教師課表)
 * Groups teachers by subject, one sheet per subject category.
 */
export function exportSubjectTeacherTimetablesLegacy(scheduleStore) {
  const { classes } = scheduleStore
  const schoolName = (scheduleStore.schoolInfo && scheduleStore.schoolInfo.name) || '學校名稱'

  // Step 1: Build subject → teachers map from course_requirements
  const subjectTeachers = _buildSubjectTeacherMap(classes)

  if (!Object.keys(subjectTeachers).length) {
    alert('沒有找到科任教師資料，請確認班級課程需求已設定。')
    return
  }

  // Step 2: Pre-compute all teacher schedules
  const allTeacherNames = new Set()
  for (const teachers of Object.values(subjectTeachers)) {
    teachers.forEach(n => allTeacherNames.add(n))
  }
  const teacherSchedules = {}
  for (const name of allTeacherNames) {
    teacherSchedules[name] = _buildTeacherSchedule(name, classes)
  }

  // Step 3: Build workbook — one sheet per subject
  const wb = XLSX.utils.book_new()
  const DAY_LABELS = ['一', '二', '三', '四', '五']
  const PERIODS = [1, 2, 3, 4, 5, 6, 7]

  // Sort subjects for consistent output order
  const subjectKeys = Object.keys(subjectTeachers).sort()

  for (const subject of subjectKeys) {
    const teachers = subjectTeachers[subject]
    if (!teachers || teachers.length === 0) continue

    const displaySubject = _getSubjectCategoryDisplay(subject)
    const colCount = teachers.length + 2 // A=星期, B=編號/教師, C+=teachers

    const aoa = []
    const merges = []

    // Row 0: School name (merged across all columns)
    aoa.push([schoolName, ...Array(colCount - 1).fill('')])
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } })

    // Row 1: Subject title (merged)
    aoa.push([displaySubject + '總課表', ...Array(colCount - 1).fill('')])
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } })

    // Row 2: Headers ["星期", "編號", "1", "2", ...]
    aoa.push(['星期', '編號', ...teachers.map((_, i) => String(i + 1))])

    // Row 3: Teacher names ["", "教師", name1, name2, ...]
    aoa.push(['', '教師', ...teachers])

    // Row 4: Period header ["", "節次"] + empty cells
    aoa.push(['', '節次', ...Array(teachers.length).fill('')])

    // Data rows: days × periods
    const totals = new Array(teachers.length).fill(0)

    for (let dayNum = 1; dayNum <= 5; dayNum++) {
      for (const period of PERIODS) {
        const row = []
        if (period === 1) {
          row.push(DAY_LABELS[dayNum - 1], String(period))
        } else {
          row.push('', String(period))
        }

        for (let tIdx = 0; tIdx < teachers.length; tIdx++) {
          const teacherName = teachers[tIdx]
          const entries =
            teacherSchedules[teacherName]?.[String(dayNum)]?.[String(period)] || []

          // Filter to this subject's assignments
          const matchingEntries = entries.filter(e => e.subject === subject)
          const conflictingEntries = entries.filter(e => e.subject !== subject)

          let cellContent = ''
          if (matchingEntries.length > 0) {
            const classNames = [...new Set(matchingEntries.map(e => e.className))]
            cellContent = classNames.join('/')
            totals[tIdx] += matchingEntries.length
          }

          // Mark conflict: teacher has different subject at same slot
          if (conflictingEntries.length > 0) {
            cellContent += '(⚠衝堂)'
          }

          row.push(cellContent)
        }

        aoa.push(row)
      }
    }

    // Total row
    aoa.push(['總計', '', ...totals.map(String)])

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!merges'] = merges
    ws['!cols'] = [{ wch: 4 }, { wch: 6 }, ...teachers.map(() => ({ wch: 8 }))]

    // Truncate sheet name to 31 chars (Excel limit)
    const sheetName = displaySubject.length > 31 ? displaySubject.slice(0, 31) : displaySubject
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  XLSX.writeFile(wb, `科任教師課表_${_getToday()}.xlsx`)
}
