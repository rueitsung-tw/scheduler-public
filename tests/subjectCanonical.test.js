/**
 * 回歸測試：科目名稱正規化
 *
 * 對應 20260605-5 計畫 Step 1-1
 * 驗證「語文-英語」與「英語」「英文」等別名能正確對齊到同一個 canonical form。
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeSubject,
  isSameSubject,
  getCanonicalMap,
  isEnglishSubject,
  isLocalLanguageSubject,
} from '../src/utils/subjectCanonical.js'

describe('normalizeSubject', () => {
  it('將英語系別名統一為 語文-英語', () => {
    expect(normalizeSubject('英語')).toBe('語文-英語')
    expect(normalizeSubject('英文')).toBe('語文-英語')
    expect(normalizeSubject('語文-英文')).toBe('語文-英語')
    // canonical form 本身不被轉換
    expect(normalizeSubject('語文-英語')).toBe('語文-英語')
  })

  it('將本土語系別名統一為 本土語', () => {
    expect(normalizeSubject('本土語言')).toBe('本土語')
    expect(normalizeSubject('閩南語')).toBe('本土語')
    expect(normalizeSubject('客語')).toBe('本土語')
    expect(normalizeSubject('語文-本土語')).toBe('本土語')
    // canonical form 本身不被轉換
    expect(normalizeSubject('本土語')).toBe('本土語')
  })

  it('將自然統一為 自然科學', () => {
    expect(normalizeSubject('自然')).toBe('自然科學')
    expect(normalizeSubject('自然科學')).toBe('自然科學')
  })

  it('將資訊系別名統一為 資訊', () => {
    expect(normalizeSubject('科技-資訊')).toBe('資訊')
    expect(normalizeSubject('電腦')).toBe('資訊')
  })

  it('將健康與體育統一為 體育', () => {
    expect(normalizeSubject('健康與體育')).toBe('體育')
    expect(normalizeSubject('體育')).toBe('體育')
  })

  it('對空值回傳空字串', () => {
    expect(normalizeSubject(undefined)).toBe('')
    expect(normalizeSubject(null)).toBe('')
    expect(normalizeSubject('')).toBe('')
    expect(normalizeSubject('   ')).toBe('')
  })

  it('對不在 mapping 中的科目原樣回傳', () => {
    expect(normalizeSubject('數學')).toBe('數學')
    expect(normalizeSubject('國語')).toBe('國語')
    expect(normalizeSubject('音樂')).toBe('音樂')
    expect(normalizeSubject('美勞')).toBe('美勞')
  })
})

describe('isSameSubject', () => {
  it('英語系別名互相判定為相同', () => {
    expect(isSameSubject('英語', '英文')).toBe(true)
    expect(isSameSubject('語文-英語', '英語')).toBe(true)
    expect(isSameSubject('英文', '語文-英文')).toBe(true)
  })

  it('本土語系別名互相判定為相同', () => {
    expect(isSameSubject('閩南語', '客語')).toBe(true)
    expect(isSameSubject('本土語言', '語文-本土語')).toBe(true)
  })

  it('不同科目判定為不相同', () => {
    expect(isSameSubject('英語', '數學')).toBe(false)
    expect(isSameSubject('音樂', '美勞')).toBe(false)
  })

  it('空值處理', () => {
    expect(isSameSubject(null, '英語')).toBe(false)
    expect(isSameSubject('', '')).toBe(false)
  })
})

describe('isEnglishSubject', () => {
  it('正確識別所有英語系科目', () => {
    expect(isEnglishSubject('英語')).toBe(true)
    expect(isEnglishSubject('英文')).toBe(true)
    expect(isEnglishSubject('語文-英語')).toBe(true)
    expect(isEnglishSubject('數學')).toBe(false)
  })
})

describe('isLocalLanguageSubject', () => {
  it('正確識別所有本土語系科目', () => {
    expect(isLocalLanguageSubject('閩南語')).toBe(true)
    expect(isLocalLanguageSubject('客語')).toBe(true)
    expect(isLocalLanguageSubject('本土語言')).toBe(true)
    expect(isLocalLanguageSubject('本土語')).toBe(true)
    expect(isLocalLanguageSubject('英語')).toBe(false)
  })
})

describe('getCanonicalMap', () => {
  it('回傳不可變的 copy', () => {
    const map1 = getCanonicalMap()
    const map2 = getCanonicalMap()
    expect(map1).not.toBe(map2)
    expect(map1).toEqual(map2)
  })
})

/**
 * ═══════════════════════════════════════════════════
 * 回歸測試核心場景：AI 報告中「語文-英語」vs「英語」比對
 * ═══════════════════════════════════════════════════
 */
describe('AI 報告科目比對回歸測試', () => {
  it('course_requirement 為「語文-英語」，課表排入「英語」時應判定為已排課', () => {
    const requirementSubject = '語文-英語'
    const timetableSubject = '英語'

    // 修復前：直接字串比較 → 不相等 → scheduledCount = 0
    // 修復後：使用 normalizeSubject → 相等 → scheduledCount >= 1
    expect(isSameSubject(requirementSubject, timetableSubject)).toBe(true)
  })

  it('course_requirement 為「本土語」，課表排入「閩南語」時應判定為已排課', () => {
    const requirementSubject = '本土語'
    const timetableSubject = '閩南語'

    expect(isSameSubject(requirementSubject, timetableSubject)).toBe(true)
  })

  it('course_requirement 為「本土語言」，課表排入「客語」時應判定為已排課', () => {
    expect(isSameSubject('本土語言', '客語')).toBe(true)
  })
})
