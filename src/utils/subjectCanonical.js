/**
 * 科目名稱正規化（canonical mapping）
 *
 * 這是整個系統唯一的 canonical subject mapping，所有模組應共用此份規則：
 * - scheduleAiReport.js (AI 報告科目比對)
 * - exportUtils.js (專科教室匯出匹配)
 * - useTimetableConflicts.js (衝堂檢測)
 * - ClassroomManagerView.vue (教室管理)
 *
 * 維護原則：
 * - 新增 mapping 時需同步更新下方的 REVERSE_MAP（反向查詢用）
 * - canonical form 優先使用系統 course_requirements 中的標準名稱
 */

/**
 * 正向映射：別名 → canonical name
 */
const CANONICAL_MAP = {
  // 英語系別統一
  '英語': '語文-英語',
  '英文': '語文-英語',
  '語文-英文': '語文-英語',

  // 自然科學統一
  '自然': '自然科學',

  // 音樂 / 美勞固定節統一
  '音樂_固定': '音樂',
  '美勞_固定': '美勞',

  // 資訊類統一
  '科技-資訊': '資訊',
  '電腦': '資訊',

  // 體育統一
  '健康與體育': '體育',

  // 本土語系別統一
  '本土語言': '本土語',
  '閩南語': '本土語',
  '客語': '本土語',
  '語文-本土語': '本土語',
}

/**
 * 反向映射：canonical name → [別名...]
 * 用於除錯與反向查詢
 */
const REVERSE_MAP = {}
Object.entries(CANONICAL_MAP).forEach(([alias, canonical]) => {
  if (!REVERSE_MAP[canonical]) REVERSE_MAP[canonical] = []
  REVERSE_MAP[canonical].push(alias)
})

/**
 * 將科目名稱正規化為 canonical form。
 * 如果輸入已經是 canonical name（不在 alias map 中），則原樣回傳。
 *
 * @param {string|undefined|null} subject - 原始科目名稱
 * @returns {string} canonical subject name，空值回傳 ''
 */
export function normalizeSubject(subject) {
  if (!subject) return ''
  const s = String(subject).trim()
  return CANONICAL_MAP[s] !== undefined ? CANONICAL_MAP[s] : s
}

/**
 * 判斷兩個科目名稱是否為同一個 canonical subject。
 *
 * @param {string|undefined|null} a
 * @param {string|undefined|null} b
 * @returns {boolean}
 */
export function isSameSubject(a, b) {
  return normalizeSubject(a) === normalizeSubject(b) && normalizeSubject(a) !== ''
}

/**
 * 取得所有 canonical mapping（用於除錯/測試）
 */
export function getCanonicalMap() {
  return { ...CANONICAL_MAP }
}

/**
 * 取得反向映射（用於除錯/測試）
 */
export function getReverseMap() {
  const copy = {}
  Object.entries(REVERSE_MAP).forEach(([k, v]) => {
    copy[k] = [...v]
  })
  return copy
}

/**
 * 判斷科目是否為音樂相關（含交替課標記）
 */
export function isMusicSubject(subject) {
  const s = normalizeSubject(subject).toLowerCase()
  return s.includes('音樂') || s.includes('music')
}

/**
 * 判斷科目是否為美勞相關（含交替課標記）
 */
export function isArtSubject(subject) {
  const s = normalizeSubject(subject).toLowerCase()
  return s.includes('美勞') || s.includes('art')
}

/**
 * 判斷科目是否為音樂/美勞交替課
 */
export function isMusicArtAlternating(subject) {
  const s = normalizeSubject(subject)
  return s.includes('音樂美勞') || s.includes('音樂_美勞') || s.includes('美勞音樂')
}

/**
 * 判斷科目是否為英語相關（canonical form）
 */
export function isEnglishSubject(subject) {
  return normalizeSubject(subject) === '語文-英語'
}

/**
 * 判斷科目是否為本土語相關（canonical form）
 */
export function isLocalLanguageSubject(subject) {
  return normalizeSubject(subject) === '本土語'
}
