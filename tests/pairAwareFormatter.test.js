/**
 * 2026-06-15: 音美同年級配對改造 — Formatter 顯示層回歸測試
 *
 * 覆蓋：
 * - toClassPairCode() 短碼轉換
 * - formatPairedSlot() slash 格式 (410/404)
 * - hasValidPair() 配對判斷
 * - isSlashEligible() 條件檢查
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  toClassPairCode,
  formatPairedSlot,
  hasValidPair,
  isSlashEligible,
  extractGrade,
  isSameGrade,
} from '../src/utils/pairAwareFormatter'

// ============================================================
// toClassPairCode
// ============================================================
describe('toClassPairCode', () => {
  it('4年10班 → 410', () => {
    expect(toClassPairCode('4年10班')).toBe('410')
  })

  it('4年4班 → 404', () => {
    expect(toClassPairCode('4年4班')).toBe('404')
  })

  it('3年8班 → 308', () => {
    expect(toClassPairCode('3年8班')).toBe('308')
  })

  it('1年1班 → 101', () => {
    expect(toClassPairCode('1年1班')).toBe('101')
  })

  it('6年12班 → 612', () => {
    expect(toClassPairCode('6年12班')).toBe('612')
  })

  it('不符合格式時 fallback 回原班名', () => {
    expect(toClassPairCode('藝才班')).toBe('藝才班')
    expect(toClassPairCode('一班')).toBe('一班')
    expect(toClassPairCode(null)).toBe(null)
    expect(toClassPairCode('')).toBe('')
  })
})

// ============================================================
// extractGrade
// ============================================================
describe('extractGrade', () => {
  it('4年10班 → 4', () => {
    expect(extractGrade('4年10班')).toBe(4)
  })

  it('3年8班 → 3', () => {
    expect(extractGrade('3年8班')).toBe(3)
  })

  it('null → null', () => {
    expect(extractGrade(null)).toBeNull()
  })
})

// ============================================================
// isSameGrade
// ============================================================
describe('isSameGrade', () => {
  it('同年級回傳 true', () => {
    expect(isSameGrade('4年10班', '4年4班')).toBe(true)
  })

  it('不同年級回傳 false', () => {
    expect(isSameGrade('3年8班', '5年4班')).toBe(false)
  })
})

// ============================================================
// isSlashEligible
// ============================================================
describe('isSlashEligible', () => {
  it('同年級 + 同 pairGroup + 互補方向 → true', () => {
    const a = { className: '4年10班', pairGroupId: 'g1', pairDirection: 'music-first' }
    const b = { className: '4年4班', pairGroupId: 'g1', pairDirection: 'art-first' }
    expect(isSlashEligible(a, b)).toBe(true)
  })

  it('不同年級 → false', () => {
    const a = { className: '3年8班', pairGroupId: 'g1', pairDirection: 'music-first' }
    const b = { className: '5年4班', pairGroupId: 'g1', pairDirection: 'art-first' }
    expect(isSlashEligible(a, b)).toBe(false)
  })

  it('不同 pairGroup → false', () => {
    const a = { className: '4年10班', pairGroupId: 'g1', pairDirection: 'music-first' }
    const b = { className: '4年4班', pairGroupId: 'g2', pairDirection: 'art-first' }
    expect(isSlashEligible(a, b)).toBe(false)
  })

  it('方向不互補 → false', () => {
    const a = { className: '4年10班', pairGroupId: 'g1', pairDirection: 'music-first' }
    const b = { className: '4年4班', pairGroupId: 'g1', pairDirection: 'music-first' }
    expect(isSlashEligible(a, b)).toBe(false)
  })

  it('week odd/even 互補也視為符合', () => {
    const a = { className: '4年10班', pairGroupId: 'g1', week: 'odd' }
    const b = { className: '4年4班', pairGroupId: 'g1', week: 'even' }
    expect(isSlashEligible(a, b)).toBe(true)
  })

  it('健/s 交替課（subject 含值）不應輸出 slash 短碼', () => {
    const a = { className: '4年10班', subject: '健/s', pairGroupId: 'g1', pairDirection: 'music-first' }
    const b = { className: '4年4班', subject: '健/s', pairGroupId: 'g1', pairDirection: 'art-first' }
    expect(isSlashEligible(a, b)).toBe(false)
    const result = formatPairedSlot([a, b], { fallbackToParentheses: true })
    expect(result).not.toMatch(/^\d{3}\/\d{3}$/)
  })

  it('音樂/美勞（week-specific 展開後）應輸出 slash 短碼', () => {
    const a = { className: '4年10班', subject: '音樂', pairGroupId: 'g1', pairDirection: 'music-first' }
    const b = { className: '4年4班', subject: '美勞', pairGroupId: 'g1', pairDirection: 'art-first' }
    expect(isSlashEligible(a, b)).toBe(true)
    const result = formatPairedSlot([a, b], { fallbackToParentheses: true })
    expect(result).toMatch(/^\d{3}\/\d{3}$/)
  })

  it('findClassForCell 路徑（subject 缺值）同年級音美 pair 仍應輸出 slash 短碼', () => {
    const a = { className: '4年10班', pairGroupId: 'g1', pairDirection: 'music-first' }
    const b = { className: '4年4班', pairGroupId: 'g1', pairDirection: 'art-first' }
    expect(isSlashEligible(a, b)).toBe(true)
    const result = formatPairedSlot([a, b], { fallbackToParentheses: true })
    expect(result).toMatch(/^\d{3}\/\d{3}$/)
  })

  it('s/社 交替課（subject 含值）不應輸出 slash 短碼', () => {
    const a = { className: '5年1班', subject: 's/社', pairGroupId: 'g2', pairDirection: 'music-first' }
    const b = { className: '5年2班', subject: 's/社', pairGroupId: 'g2', pairDirection: 'art-first' }
    expect(isSlashEligible(a, b)).toBe(false)
  })

  it('音樂美勞_交替（subject 含值）應輸出 slash 短碼', () => {
    const a = { className: '4年10班', subject: '音樂美勞_交替', pairGroupId: 'g1', pairDirection: 'music-first' }
    const b = { className: '4年4班', subject: '音樂美勞_交替', pairGroupId: 'g1', pairDirection: 'art-first' }
    expect(isSlashEligible(a, b)).toBe(true)
    const result = formatPairedSlot([a, b], { fallbackToParentheses: true })
    expect(result).toMatch(/^\d{3}\/\d{3}$/)
  })
})

// ============================================================
// formatPairedSlot — slash short code 格式
// ============================================================
describe('formatPairedSlot', () => {
  it('同年級 + 同 pairGroup + 互補方向 → 410/404', () => {
    const entries = [
      { className: '4年10班', pairGroupId: 'g1', pairDirection: 'music-first' },
      { className: '4年4班', pairGroupId: 'g1', pairDirection: 'art-first' },
    ]
    expect(formatPairedSlot(entries)).toBe('410/404')
  })

  it('跨年級但同 pairGroup → 不應輸出 410/404，應 fallback (單)/(雙)', () => {
    const entries = [
      { className: '3年8班', pairGroupId: 'g1', week: 'odd' },
      { className: '5年4班', pairGroupId: 'g1', week: 'even' },
    ]
    // 不同年級 → isSlashEligible 回傳 false → fallback
    const result = formatPairedSlot(entries, { fallbackToParentheses: true })
    expect(result).not.toBe('308/504')
    expect(result).toContain('(單)')
    expect(result).toContain('(雙)')
  })

  it('同年級但方向不互補 → 不應使用 short slash pair', () => {
    const entries = [
      { className: '4年10班', pairGroupId: 'g1', pairDirection: 'music-first' },
      { className: '4年4班', pairGroupId: 'g1', pairDirection: 'music-first' },
    ]
    // 方向相同 → isSlashEligible 回傳 false → fallback
    const result = formatPairedSlot(entries, { fallbackToParentheses: true })
    expect(result).not.toBe('410/404')
  })

  it('空陣列回傳空字串', () => {
    expect(formatPairedSlot([])).toBe('')
  })

  it('單筆 entry 直接回傳班名', () => {
    const entries = [{ className: '4年10班' }]
    expect(formatPairedSlot(entries)).toBe('4年10班')
  })
})

// ============================================================
// hasValidPair
// ============================================================
describe('hasValidPair', () => {
  it('同年級 + 同 pairGroup + 互補方向 → true', () => {
    const entries = [
      { className: '4年10班', pairGroupId: 'g1', pairDirection: 'music-first' },
      { className: '4年4班', pairGroupId: 'g1', pairDirection: 'art-first' },
    ]
    expect(hasValidPair(entries)).toBe(true)
  })

  it('不同年級 → false', () => {
    const entries = [
      { className: '3年8班', pairGroupId: 'g1', pairDirection: 'music-first' },
      { className: '5年4班', pairGroupId: 'g1', pairDirection: 'art-first' },
    ]
    expect(hasValidPair(entries)).toBe(false)
  })

  it('少於兩筆 → false', () => {
    expect(hasValidPair([{ className: '4年10班' }])).toBe(false)
    expect(hasValidPair([])).toBe(false)
  })
})

// ============================================================
// formatTeacherSubjectEntries (exportUtilsTeacherPatch.js)
// ============================================================
describe('formatTeacherSubjectEntries', () => {
  let formatTeacherSubjectEntries
  beforeAll(async () => {
    const mod = await import('../src/utils/exportUtilsTeacherPatch')
    formatTeacherSubjectEntries = mod.formatTeacherSubjectEntries
  })

  it('同年級 + 同 pairGroup + 互補方向 → 410/404', () => {
    const entries = [
      { className: '4年10班', week: 'odd', pairGroupId: 'g1', pairDirection: 'music-first', subject: '音樂美勞_交替' },
      { className: '4年4班', week: 'even', pairGroupId: 'g1', pairDirection: 'art-first', subject: '音樂美勞_交替' },
    ]
    expect(formatTeacherSubjectEntries(entries)).toBe('410/404')
  })

  it('跨年級 → fallback (單)/(雙)', () => {
    const entries = [
      { className: '3年8班', week: 'odd', pairGroupId: 'g1', pairDirection: 'music-first', subject: '音樂美勞_交替' },
      { className: '5年4班', week: 'even', pairGroupId: 'g1', pairDirection: 'art-first', subject: '音樂美勞_交替' },
    ]
    const result = formatTeacherSubjectEntries(entries)
    expect(result).not.toBe('308/504')
    expect(result).toContain('(單)')
    expect(result).toContain('(雙)')
  })

  it('方向不互補 → fallback (無 week, 同 direction)', () => {
    // 沒有 week odd/even 互補，且 pairDirection 相同 → isSlashEligible 回傳 false
    const entries = [
      { className: '4年10班', pairGroupId: 'g1', pairDirection: 'music-first', subject: '音樂美勞_交替' },
      { className: '4年4班', pairGroupId: 'g1', pairDirection: 'music-first', subject: '音樂美勞_交替' },
    ]
    const result = formatTeacherSubjectEntries(entries)
    expect(result).not.toBe('410/404')
  })

  it('空陣列回傳空字串', () => {
    expect(formatTeacherSubjectEntries([])).toBe('')
  })

  it('單筆 entry 直接回傳班名', () => {
    const entries = [
      { className: '4年10班', week: 'both', pairGroupId: '', pairDirection: '', subject: '音樂' },
    ]
    expect(formatTeacherSubjectEntries(entries)).toBe('4年10班')
  })
})

// ============================================================
// findClassForCell (exportUtils.js)
// ============================================================
describe('findClassForCell', () => {
  let findClassForCell
  beforeAll(async () => {
    const mod = await import('../src/utils/exportUtils')
    findClassForCell = mod.findClassForCell
  })

  it('同年級互補 pair → 410/404', () => {
    const classes = [
      {
        name: '4年10班',
        timetable: {
          '1': {
            '3': {
              subject: '音樂美勞_交替',
              teacher: '張老師',
              pairGroupId: 'g1',
              pairDirection: 'music-first',
              week: 'odd',
              classroomName: '音樂教室A',
            },
          },
        },
      },
      {
        name: '4年4班',
        timetable: {
          '1': {
            '3': {
              subject: '音樂美勞_交替',
              teacher: '張老師',
              pairGroupId: 'g1',
              pairDirection: 'art-first',
              week: 'even',
              classroomName: '音樂教室A',
            },
          },
        },
      },
    ]
    const room = { id: '', name: '音樂教室A' }
    const result = findClassForCell(classes, room, 1, 3)
    expect(result).toBe('410/404')
  })

  it('跨年級 → 不使用 short slash pair', () => {
    const classes = [
      {
        name: '3年8班',
        timetable: {
          '1': {
            '3': {
              subject: '音樂美勞_交替',
              teacher: '張老師',
              pairGroupId: 'g1',
              pairDirection: 'music-first',
              week: 'odd',
              classroomName: '音樂教室A',
            },
          },
        },
      },
      {
        name: '5年4班',
        timetable: {
          '1': {
            '3': {
              subject: '音樂美勞_交替',
              teacher: '張老師',
              pairGroupId: 'g1',
              pairDirection: 'art-first',
              week: 'even',
              classroomName: '音樂教室A',
            },
          },
        },
      },
    ]
    const room = { id: '', name: '音樂教室A' }
    const result = findClassForCell(classes, room, 1, 3)
    expect(result).not.toBe('308/504')
  })

  it('無匹配時回傳空字串', () => {
    const classes = [
      {
        name: '4年10班',
        timetable: {
          '1': {
            '3': {
              subject: '國語',
              teacher: '林老師',
              classroomName: '四年十班',
            },
          },
        },
      },
    ]
    const room = { id: '', name: '音樂教室A' }
    expect(findClassForCell(classes, room, 1, 3)).toBe('')
  })
})
