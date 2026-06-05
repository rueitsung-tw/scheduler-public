/**
 * 科目名稱正規化工具
 *
 * 所有模組（scheduleAiReport、exportUtils、useTimetableConflicts、ScheduleView）
 * 必須共用此單一 canonical key，避免「英語 vs 語文-英語」、「本土語 vs 閩南語」等誤報。
 *
 * Canonical key 規則：
 * - 英語 / 英文 / 語文-英語 → 語文-英語
 * - 本土語言 / 閩南語 / 客語 / 語文-本土語 / 本土語 → 本土語
 * - 健康 / 健康教育 / 健教 / 導師區塊 → 各自獨立
 */

/**
 * 將科目名稱轉換為 canonical key。
 * @param {string} name - 原始科目名稱
 * @returns {string|null} canonical key，若無法識別則回傳 trim 後的原文
 */
export function normalizeSubject(name) {
  if (!name || typeof name !== 'string') return ''

  const trimmed = name.trim().replace(/[\s\u00A0]+/g, '')
  if (!trimmed) return ''

  // 英語系別統一
  if (['英語', '英文', '語文-英語'].includes(trimmed)) {
    return '語文-英語'
  }

  // 自然科學統一
  if (trimmed === '自然') {
    return '自然科學'
  }

  // 資訊統一
  if (['科技-資訊', '電腦'].includes(trimmed)) {
    return '資訊'
  }

  // 體育統一
  if (trimmed === '健康與體育') {
    return '體育'
  }

  // 本土語系別統一
  if (['本土語言', '閩南語', '客語', '語文-本土語', '本土語'].includes(trimmed)) {
    return '本土語'
  }

  // 導師區塊統一（確保衝堂判定可正確排除）
  if (trimmed === '導師課間' || trimmed === '導師') {
    return '導師區塊'
  }

  return trimmed
}

/**
 * 判斷兩個科目名稱是否為同一個 canonical subject。
 */
export function isSameSubject(a, b) {
  const na = normalizeSubject(a)
  const nb = normalizeSubject(b)
  return na === nb && na !== ''
}

/**
 * 將 canonical key 轉換回人類可讀的顯示名稱（用於報告與 UI）。
 */
export function canonicalToDisplay(canonical) {
  if (!canonical) return ''
  const map = {
    '語文-英語': '英語',
    '本土語': '本土語',
  }
  return map[canonical] || canonical
}
