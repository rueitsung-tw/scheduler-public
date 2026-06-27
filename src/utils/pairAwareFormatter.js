/**
 * Pair-aware Formatter — 聚合視角的交替課格式化器
 *
 * 供聚合畫面與聚合匯出共用：
 * - 科任教師課表匯出（exportUtilsTeacherPatch.js）
 * - 專科教室 DOCX 匯出（exportUtils.js）
 *
 * Slash 格式條件：
 *   同年級、同 pairGroup、同 day/period、互補方向成立 → `410/404`
 *   否則回退為 `(單)/(雙)` 或原本標示
 */

/**
 * 判斷兩個班級名稱是否為同年級
 */
export function isSameGrade(classNameA, classNameB) {
  const gradeA = extractGrade(classNameA)
  const gradeB = extractGrade(classNameB)
  return gradeA !== null && gradeB !== null && gradeA === gradeB
}

/**
 * 從班級名稱提取年級數字
 */
export function extractGrade(className) {
  if (!className) return null
  const match = String(className).match(/(\d+)年/)
  return match ? Number.parseInt(match[1], 10) : null
}

/**
 * 將班級名稱轉換為配對短碼
 * - `4年10班` → `410`
 * - `4年4班` → `404`
 * - `3年8班` → `308`
 * - 不符合格式的 fallback 回原班名
 */
export function toClassPairCode(className) {
  if (!className) return className
  const match = String(className).match(/(\d+)年(\d+)班/)
  if (match) {
    const grade = match[1]
    const classNum = match[2].padStart(2, '0')
    return `${grade}${classNum}`
  }
  return className
}

/**
 * 從 schedule entries 建立 slot bucket
 * key: `${pairGroupId}_${day}_${period}` → [entry, ...]
 */
export function buildSlotBuckets(scheduleEntries) {
  const buckets = new Map()
  for (const entry of scheduleEntries || []) {
    if (!entry.pairGroupId) continue
    const key = `${entry.pairGroupId}_${entry.day}_${entry.period}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(entry)
  }
  return buckets
}

/**
 * 判斷是否符合 slash 合併條件
 *
 * 條件：
 *   1. 兩筆 entry 都有 pairGroupId 且相同
 *   2. 同年級
 *   3. 互補方向（一個 music-first，一個 art-first）
 */
export function isSlashEligible(entryA, entryB) {
  if (!entryA || !entryB) return false

  // ── 雙軌 subject 守門（2026-06-15 P1）──
  // slash 短碼只應用於「音樂美勞聚合視角」。
  // 若兩筆 entry 都有 subject，則檢查是否為音美相關科目。
  // 若任一筆 subject 缺值（如 findClassForCell 路徑 B），則不做科目限制（pass-through）。
  // 理由：findClassForCell 只收「有 classroomId/classroomName 配對」的 entry，
  //       它的 pairGroupId 本身已是音美群組的保證。
  const MUSIC_ART_SUBJECTS = ['音樂', '美勞', '音樂美勞']
  const subjA = (entryA.subject || '').trim()
  const subjB = (entryB.subject || '').trim()
  const bothHaveSubject = subjA.length > 0 && subjB.length > 0
  if (bothHaveSubject) {
    const isMusicArtA = MUSIC_ART_SUBJECTS.some(s => subjA.includes(s))
    const isMusicArtB = MUSIC_ART_SUBJECTS.some(s => subjB.includes(s))
    if (!isMusicArtA || !isMusicArtB) return false
  }

  // 同 pairGroup
  const gidA = entryA.pairGroupId
  const gidB = entryB.pairGroupId
  if (!gidA || !gidB || gidA !== gidB) return false

  // 同年級
  if (!isSameGrade(entryA.className, entryB.className)) return false

  // 互補方向
  const dirA = (entryA.pairDirection || '').toLowerCase()
  const dirB = (entryB.pairDirection || '').toLowerCase()

  // 一個 music-first，一個 art-first
  if ((dirA === 'music-first' && dirB === 'art-first') ||
      (dirA === 'art-first' && dirB === 'music-first')) {
    return true
  }

  // 若沒有 pairDirection 欄位，但有 week 互補（odd/even）也視為符合
  const weekA = entryA.week || ''
  const weekB = entryB.week || ''
  if ((weekA === 'odd' && weekB === 'even') || (weekA === 'even' && weekB === 'odd')) {
    return true
  }

  return false
}

/**
 * Pair-aware formatter — 輸入一組 entries（同一 slot），回傳格式化字串
 *
 * @param {Array} entries - 同一 (day, period) 下的所有 entry
 * @param {Object} options - 可選設定
 * @param {boolean} options.fallbackToParentheses - 不符合 slash 時是否使用 (單)/(雙)
 * @returns {string} 格式化後的字串
 */
export function formatPairedSlot(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return ''

  const { fallbackToParentheses = true } = options

  // 只有一筆，直接回傳班級名稱
  if (entries.length === 1) {
    return entries[0].className || ''
  }

  // 嘗試尋找符合 slash 條件的配對
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (isSlashEligible(entries[i], entries[j])) {
        // 按年級+班號排序，確保一致的顯示順序
        const pair = [entries[i], entries[j]].sort((a, b) => {
          return (a.className || '').localeCompare(b.className || '', 'zh-TW')
        })
        // 使用短碼格式: `4年10班/4年4班` → `410/404`
        const codeA = toClassPairCode(pair[0].className)
        const codeB = toClassPairCode(pair[1].className)
        return `${codeA}/${codeB}`
      }
    }
  }

  // 不符合 slash 條件，回退為傳統格式
  if (fallbackToParentheses) {
    return formatFallbackEntries(entries)
  }

  // 不回退時，直接用 / 連接班級名稱
  return entries.map(e => e.className || '').filter(Boolean).join('/')
}

/**
 * Fallback: 使用 (單)/(雙) 格式
 */
function formatFallbackEntries(entries) {
  const bothNames = [...new Set(
    entries.filter(e => e.week === 'both').map(e => e.className)
  )].filter(Boolean)

  const oddNames = [...new Set(
    entries.filter(e => e.week === 'odd').map(e => e.className)
  )].filter(Boolean)

  const evenNames = [...new Set(
    entries.filter(e => e.week === 'even').map(e => e.className)
  )].filter(Boolean)

  const parts = []
  if (bothNames.length > 0) parts.push(bothNames.join('/'))
  if (oddNames.length > 0) parts.push(`${oddNames.join('/')}(單)`)
  if (evenNames.length > 0) parts.push(`${evenNames.join('/')}(雙)`)

  return parts.join('\n') || entries.map(e => e.className || '').filter(Boolean).join('/')
}

/**
 * 檢查一組 entries 是否包含有效的 pair 配對
 */
export function hasValidPair(entries) {
  if (!Array.isArray(entries) || entries.length < 2) return false
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (isSlashEligible(entries[i], entries[j])) return true
    }
  }
  return false
}
