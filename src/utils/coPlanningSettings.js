/**
 * [2026-06-29] coPlanningSettings normalizer (v2)
 *
 * 強化版：不僅補齊 key，還會過濾非法 block、正規化每個 block shape。
 *
 * Input: raw object from DB or UI (may be null/undefined/non-object)
 *
 * Output shape:
 *   enabled: boolean
 *   grades: [5, 6] 或子集
 *   mode: 'auto' | 'manual'
 *   candidateBlocks: array of { day: 1..5, startPeriod: 5|6, length: 2 }
 *   manualBlocks: { '5': Block|null, '6': Block|null }
 */

const DEFAULT_CO_PLANNING_SETTINGS = {
  enabled: false,
  grades: [5, 6],
  mode: 'auto',
  candidateBlocks: [],
  manualBlocks: { '5': null, '6': null },
}

/**
 * 檢查 candidateBlock / manualBlock 是否合法
 * day: 1..5, startPeriod: 5 or 6
 */
function isValidBlock(b) {
  if (!b || typeof b !== 'object') return false
  const day = Number(b.day)
  const startPeriod = Number(b.startPeriod)
  if (day < 1 || day > 5) return false
  if (startPeriod !== 5 && startPeriod !== 6) return false
  return true
}

/**
 * 正規化單一 block，確保 day/startPeriod 是 number，length 固定為 2
 */
function normalizeBlock(b) {
  return {
    day: Number(b.day),
    startPeriod: Number(b.startPeriod),
    length: 2,
  }
}

export function normalizeCoPlanningSettings(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CO_PLANNING_SETTINGS }
  }

  // 1. Normalize enabled — must be boolean
  const enabled = Boolean(raw.enabled)

  // 2. Normalize grades — only allow 5 and 6
  let grades = Array.isArray(raw.grades) ? raw.grades : []
  grades = grades.filter(g => g === 5 || g === 6)
  if (grades.length === 0) grades = [5, 6]

  // 3. Normalize mode — only 'auto' or 'manual'
  const mode = (raw.mode === 'manual') ? 'manual' : 'auto'

  // 4. Normalize candidateBlocks — filter invalid, normalize each block
  const candidateBlocks = Array.isArray(raw.candidateBlocks)
    ? raw.candidateBlocks.filter(isValidBlock).map(normalizeBlock)
    : []

  // 5. Normalize manualBlocks — guarantee '5' and '6' keys; validate each value
  const rawMB = raw.manualBlocks
  const manualBlocks = { '5': null, '6': null }
  if (rawMB && typeof rawMB === 'object') {
    if (rawMB['5'] != null && isValidBlock(rawMB['5'])) {
      manualBlocks['5'] = normalizeBlock(rawMB['5'])
    }
    if (rawMB['6'] != null && isValidBlock(rawMB['6'])) {
      manualBlocks['6'] = normalizeBlock(rawMB['6'])
    }
  }

  return {
    enabled,
    grades,
    mode,
    candidateBlocks,
    manualBlocks,
  }
}