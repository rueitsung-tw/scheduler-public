/**
 * exportSwimmingSchedule 年級過濾修復測試
 *
 * 覆蓋：
 * - _resolveSwimmingGrade 透過 cls.name fallback 解析年級
 * - 僅匯出 4-6 年級的游泳配對
 * - grade 缺失時仍正確包含 4-6 年級
 * - grade 為字串時仍正確包含
 * - 體育 + 健康 fallback 配對不被破壞
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mock file-saver
// ============================================================
vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}))

// ============================================================
// Mock docx module
// We need to mock the constructors so we can inspect what text
// is passed to TableCell / Paragraph during export.
// ============================================================
const capturedCells = []

vi.mock('docx', () => {
  // In exportUtils, Paragraph is called as new Paragraph('text') (string arg)
  const Paragraph = vi.fn().mockImplementation(function (opts) {
    if (typeof opts === 'string') {
      this.text = opts
    } else {
      const tr = opts?.children?.[0]
      this.text = (tr && typeof tr === 'object' ? tr.text : '') || ''
    }
  })

  // TableCell receives { children: [Paragraph], ... }
  const TableCell = vi.fn().mockImplementation(function (opts) {
    const para = opts?.children?.[0]
    const text = (para && typeof para === 'object' ? para.text : '') || ''
    capturedCells.push(text)
  })

  const TableRow = vi.fn().mockImplementation(function () {})
  const Table = vi.fn().mockImplementation(function () {})
  const TextRun = vi.fn().mockImplementation(function (opts) {
    this.text = opts?.text || ''
  })
  const Document = vi.fn().mockImplementation(function () {})
  const WidthType = { PERCENTAGE: 'PERCENTAGE' }
  const AlignmentType = { CENTER: 'center' }
  const PageBreak = vi.fn().mockImplementation(function () {})

  const Packer = {
    toBlob: vi.fn().mockResolvedValue(new Blob(['mock-docx'])),
  }

  return {
    Paragraph,
    TableCell,
    TableRow,
    Table,
    TextRun,
    Document,
    WidthType,
    AlignmentType,
    PageBreak,
    Packer,
  }
})

// ============================================================
// Import after mocks are registered
// ============================================================
import { saveAs } from 'file-saver'
import * as DocxModule from 'docx'

async function getExportFn() {
  const mod = await import('../src/utils/exportUtils')
  return mod.exportSwimmingSchedule
}

// ============================================================
// Helpers
// ============================================================

function buildTimetableWithPair(day, anchorPeriod) {
  const tt = {}
  tt[String(day)] = {
    [String(anchorPeriod)]: { subject: '體育', teacher: '陳老師' },
    [String(anchorPeriod + 1)]: { subject: '導師區塊', teacher: '林老師' },
  }
  return tt
}

function buildTimetableWithHealthPair(day, anchorPeriod) {
  const tt = {}
  tt[String(day)] = {
    [String(anchorPeriod)]: { subject: '體育', teacher: '陳老師' },
    [String(anchorPeriod + 1)]: { subject: '健康', teacher: '林老師' },
  }
  return tt
}

function clearCaptured() {
  capturedCells.length = 0
  DocxModule.TableCell.mockClear()
  saveAs.mockClear()
}

/**
 * Extract the data rows (skip header row) from captured cells.
 * Each row has 3 cells: day, period, className.
 */
function extractDataRows() {
  const dataCells = capturedCells.slice(3)
  const rows = []
  for (let i = 0; i < dataCells.length; i += 3) {
    if (i + 2 < dataCells.length) {
      rows.push([dataCells[i], dataCells[i + 1], dataCells[i + 2]])
    }
  }
  return rows
}

// ============================================================
// Tests
// ============================================================
describe('exportSwimmingSchedule — grade filter', () => {
  beforeEach(() => {
    clearCaptured()
  })

  it('只匯出 4-6 年級：2年1班 不匯出，4年1班 匯出', async () => {
    const fn = await getExportFn()
    const store = {
      classes: [
        {
          name: '2年1班',
          grade: 2,
          timetable: buildTimetableWithPair(1, 3),
        },
        {
          name: '4年1班',
          grade: 4,
          timetable: buildTimetableWithPair(1, 5),
        },
      ],
    }

    await fn(store)
    const rows = extractDataRows()
    const classNames = rows.map(r => r[2])
    expect(classNames).toContain('4年1班')
    expect(classNames).not.toContain('2年1班')
  })

  it('grade 缺失但 name 可解析為 4 年級 → 仍會匯出', async () => {
    const fn = await getExportFn()
    const store = {
      classes: [
        {
          name: '4年1班',
          grade: undefined,
          timetable: buildTimetableWithPair(2, 4),
        },
      ],
    }

    await fn(store)
    const rows = extractDataRows()
    const classNames = rows.map(r => r[2])
    expect(classNames).toContain('4年1班')
  })

  it('grade 為字串 "6" → 仍會匯出', async () => {
    const fn = await getExportFn()
    const store = {
      classes: [
        {
          name: '6年1班',
          grade: '6',
          timetable: buildTimetableWithPair(3, 2),
        },
      ],
    }

    await fn(store)
    const rows = extractDataRows()
    const classNames = rows.map(r => r[2])
    expect(classNames).toContain('6年1班')
  })

  it('name 無法解析且 grade 缺失 → 不匯出', async () => {
    const fn = await getExportFn()
    const store = {
      classes: [
        {
          name: '藝才班',
          grade: null,
          timetable: buildTimetableWithPair(1, 3),
        },
      ],
    }

    await fn(store)
    const rows = extractDataRows()
    const classNames = rows.map(r => r[2])
    expect(classNames).not.toContain('藝才班')
  })

  it('體育 + 健康配對仍會匯出（不破壞既有 fallback）', async () => {
    const fn = await getExportFn()
    const store = {
      classes: [
        {
          name: '5年1班',
          grade: 5,
          timetable: buildTimetableWithHealthPair(4, 3),
        },
      ],
    }

    await fn(store)
    const rows = extractDataRows()
    const classNames = rows.map(r => r[2])
    expect(classNames).toContain('5年1班')
  })
})
