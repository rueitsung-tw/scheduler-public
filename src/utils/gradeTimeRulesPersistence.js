/**
 * gradeTimeRulesPersistence.js
 *
 * Pure persistence helpers for grade-time-rules settings.
 * Refactored for Task 2 to be strictly pure (no DB operations or Prisma dependencies).
 */

import {
  createDefaultGradeTimeRulesSettings,
  migrateLegacyCoPlanningSettings,
  normalizeGradeTimeRulesSettings,
} from './gradeTimeRules.js'

// Legacy keys to remove from ai_settings when gradeTimeRulesSettings is saved.
export const LEGACY_CO_PLANNING_KEYS = ['__schoolInfoCoPlanningSettings', 'coPlanningSettings']

/**
 * Parse a JSON string into a settings object, or pass through an already-parsed object.
 */
export function parseGradeTimeRulesSettings(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    return typeof value === 'object' ? value : null
  }
  if (value.length === 0) return null

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Serialize a settings object to a JSON string.
 */
export function serializeGradeTimeRulesSettings(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return ''
  return JSON.stringify(value)
}

/**
 * Guard: check if value is a valid grade-time-rules settings object.
 */
export function isGradeTimeRulesSettingsObject(value) {
  return value !== null && typeof value === 'object' && Array.isArray(value.rules)
}

/**
 * Extract legacy co-planning settings from aiSettings or schoolInfo.
 */
export function extractLegacyCoPlanningSettings(aiSettings = {}, schoolInfo = {}) {
  const legacy =
    schoolInfo?.coPlanningSettings ||
    aiSettings?.coPlanningSettings ||
    aiSettings?.__schoolInfoCoPlanningSettings ||
    null

  if (legacy && typeof legacy === 'object') {
    return legacy
  }
  return null
}

/**
 * Pure persistence preparation helper.
 *
 * Takes raw gradeTimeRulesSettings (or schoolInfo/aiSettings), normalizes canonical settings,
 * or migrates legacy co-planning settings if canonical is missing.
 * Cleans legacy co-planning keys from aiSettings.
 *
 * Returns next state object for DB update:
 * {
 *   gradeTimeRulesSettings: Object,
 *   cleanedAiSettings: Object,
 *   migrated: Boolean,
 *   migrationIssues: Array,
 * }
 */
export function prepareGradeTimeRulesPersistence(params = {}) {
  const { schoolInfo, aiSettings: originalAiSettings } = params
  const rawCanonical =
    params.gradeTimeRulesSettings !== undefined
      ? params.gradeTimeRulesSettings
      : schoolInfo?.gradeTimeRulesSettings

  const aiSettingsObj =
    originalAiSettings && typeof originalAiSettings === 'object'
      ? { ...originalAiSettings }
      : {}

  // 1. Check for canonical settings
  const hasCanonicalInput = rawCanonical !== undefined && rawCanonical !== null
  let canonicalModel = null

  if (hasCanonicalInput) {
    const parsed =
      typeof rawCanonical === 'string'
        ? parseGradeTimeRulesSettings(rawCanonical)
        : rawCanonical

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rules)) {
      canonicalModel = normalizeGradeTimeRulesSettings(parsed)
    }
  }

  // Build cleaned aiSettings with legacy keys removed
  const cleanedAiSettings = { ...aiSettingsObj }
  for (const key of LEGACY_CO_PLANNING_KEYS) {
    delete cleanedAiSettings[key]
  }

  // Canonical settings present -> canonical wins
  if (canonicalModel) {
    return {
      gradeTimeRulesSettings: canonicalModel,
      cleanedAiSettings,
      migrated: false,
      migrationIssues: [],
    }
  }

  // 2. Canonical absent -> check for legacy co-planning settings
  const legacy = extractLegacyCoPlanningSettings(aiSettingsObj, schoolInfo)
  if (legacy && legacy.enabled) {
    try {
      if (legacy.mode !== 'manual' && legacy.mode !== 'auto') {
        throw new Error(`Unsupported legacy mode: ${legacy.mode}`)
      }

      const migratedSettings = migrateLegacyCoPlanningSettings(legacy)
      const normalizedMigrated = normalizeGradeTimeRulesSettings(migratedSettings)

      if (!normalizedMigrated || !Array.isArray(normalizedMigrated.rules)) {
        throw new Error('Migration produced invalid settings')
      }

      return {
        gradeTimeRulesSettings: normalizedMigrated,
        cleanedAiSettings,
        migrated: true,
        migrationIssues: [],
      }
    } catch (err) {
      return {
        gradeTimeRulesSettings: createDefaultGradeTimeRulesSettings(),
        cleanedAiSettings: aiSettingsObj, // Keep original legacy keys when migration fails!
        migrated: false,
        migrationIssues: [
          {
            code: 'GRADE_TIME_RULE_MIGRATION_FAILED',
            severity: 'blocking',
            message: err?.message || 'Migration of legacy co-planning settings failed',
          },
        ],
      }
    }
  }

  // 3. Neither canonical nor enabled legacy -> default empty settings
  return {
    gradeTimeRulesSettings: createDefaultGradeTimeRulesSettings(),
    cleanedAiSettings,
    migrated: false,
    migrationIssues: [],
  }
}

/**
 * Server load resolution helper.
 * Determines the canonical gradeTimeRulesSettings to return when loading schedule data.
 *
 * 1. If SystemSetting.gradeTimeRulesSettings contains valid non-empty canonical rules, return normalized canonical.
 * 2. If SystemSetting.gradeTimeRulesSettings is empty (or holds default empty rules) AND legacy co-planning settings exist in ai_settings,
 *    migrate the legacy settings to canonical gradeTimeRulesSettings.
 * 3. Otherwise return default empty canonical gradeTimeRulesSettings.
 *
 * NEVER returns legacy co-planning settings object.
 */
export function resolveGradeTimeRulesServerLoad(params = {}) {
  const { gradeTimeRulesSettings: rawCanonical, aiSettings: rawAiSettings } = params

  const parsedAiSettings =
    typeof rawAiSettings === 'string'
      ? (() => {
          try {
            return JSON.parse(rawAiSettings)
          } catch {
            return {}
          }
        })()
      : rawAiSettings && typeof rawAiSettings === 'object'
      ? rawAiSettings
      : {}

  const parsedCanonical = parseGradeTimeRulesSettings(rawCanonical)

  // 1. If valid canonical settings with rules exist, use canonical
  if (parsedCanonical && isGradeTimeRulesSettingsObject(parsedCanonical)) {
    const normalized = normalizeGradeTimeRulesSettings(parsedCanonical)
    if (Array.isArray(normalized.rules) && normalized.rules.length > 0) {
      return {
        gradeTimeRulesSettings: normalized,
        source: 'canonical',
      }
    }
  }

  // 2. If canonical is missing or has 0 rules, check for legacy co-planning
  const legacy = extractLegacyCoPlanningSettings(parsedAiSettings)
  if (legacy && legacy.enabled) {
    try {
      if (legacy.mode !== 'manual' && legacy.mode !== 'auto') {
        throw new Error(`Unsupported legacy mode: ${legacy.mode}`)
      }
      const migrated = migrateLegacyCoPlanningSettings(legacy)
      const normalized = normalizeGradeTimeRulesSettings(migrated)
      if (normalized && Array.isArray(normalized.rules)) {
        return {
          gradeTimeRulesSettings: normalized,
          source: 'migrated_legacy',
        }
      }
    } catch {
      // Fallback on migration error to default canonical
    }
  }

  // 3. If parsedCanonical was present (even if 0 rules), return normalized version of it
  if (parsedCanonical && isGradeTimeRulesSettingsObject(parsedCanonical)) {
    return {
      gradeTimeRulesSettings: normalizeGradeTimeRulesSettings(parsedCanonical),
      source: 'canonical',
    }
  }

  // 4. Default fallback
  return {
    gradeTimeRulesSettings: createDefaultGradeTimeRulesSettings(),
    source: 'default',
  }
}

/**
 * Remove legacy co-planning keys from an aiSettings object.
 */
export function cleanLegacyCoPlanningKeys(aiSettings = {}) {
  if (!aiSettings || typeof aiSettings !== 'object') return {}
  const cleaned = { ...aiSettings }
  for (const key of LEGACY_CO_PLANNING_KEYS) {
    delete cleaned[key]
  }
  return cleaned
}
