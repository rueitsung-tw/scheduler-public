/**
 * Grade-Time Rules — Canonical JavaScript Contract (v2)
 *
 * Single source of truth for the unified grade-time rule model.
 * Replaces the old five/six-grade co-planning card.
 */

// --- Version -------------------------------------------------------------

export const GRADE_TIME_RULES_VERSION = 2

// --- Transient UI field whitelist ----------------------------------------

/**
 * These fields are UI-only and must not be persisted to the database.
 */
const TRANSIENT_FIELD_NAMES = new Set(['validationState', 'validationIssues', 'isDirty'])

/**
 * Remove transient UI fields from a single rule object.
 */
export function stripTransientRuleFields(rule) {
  if (!rule || typeof rule !== 'object') return rule
  const out = { ...rule }
  for (const key of TRANSIENT_FIELD_NAMES) {
    delete out[key]
  }
  // Also strip from nested candidateBlocks
  if (Array.isArray(out.candidateBlocks)) {
    out.candidateBlocks = out.candidateBlocks.map((b) => {
      const cleaned = { ...b }
      for (const key of TRANSIENT_FIELD_NAMES) {
        delete cleaned[key]
      }
      return cleaned
    })
  }
  return out
}

// --- Defaults ----------------------------------------------------------

export function createDefaultGradeTimeRulesSettings() {
  return {
    enabled: false,
    version: GRADE_TIME_RULES_VERSION,
    rules: [],
  }
}

// --- Normalizer (single rule) -------------------------------------------

/**
 * Normalize a single raw rule into canonical schema.
 * - Filters grades to 1-6 range
 * - Filters day to 1-5, periods to 1-7
 * - Forces co_planning purpose to require_teacher_type + subject
 * - Rejects candidate mode for general rules (falls back to fixed)
 * - Strips transient UI fields
 */
export function normalizeGradeTimeRule(raw) {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const r = stripTransientRuleFields({ ...raw })

  // Filter grades to valid range
  r.grades = (r.grades || [])
    .filter((g) => Number.isInteger(g) && g >= 1 && g <= 6)
    .sort((a, b) => a - b)

  if (!r.grades.length) {
    r.enabled = false
  }

  // Purpose-specific normalization
  if (r.purpose === 'co_planning') {
    // Co-planning always requires subject teacher
    r.ruleType = 'require_teacher_type'
    r.teacherType = 'subject'
  } else {
    // General rules cannot use candidate mode
    if (r.timeSelectionMode === 'candidate') {
      r.timeSelectionMode = 'fixed'
    }
  }

  // Day validation (1-5)
  if (r.day != null && (r.day < 1 || r.day > 5)) {
    r.enabled = false
  }

  // Periods validation (1-7)
  if (Array.isArray(r.periods)) {
    r.periods = r.periods
      .filter((p) => Number.isInteger(p) && p >= 1 && p <= 7)
      .sort((a, b) => a - b)
  }

  // Candidate blocks normalization
  if (Array.isArray(r.candidateBlocks)) {
    r.candidateBlocks = r.candidateBlocks.map((block) => ({
      ...stripTransientRuleFields(block),
      periods: (block.periods || [])
        .filter((p) => Number.isInteger(p) && p >= 1 && p <= 7)
        .sort((a, b) => a - b),
    }))
  }

  return r
}

// --- Normalizer (full settings) -----------------------------------------

/**
 * Normalize raw settings into a canonical shape.
 */
export function normalizeGradeTimeRulesSettings(raw) {
  if (!raw || !Array.isArray(raw.rules)) {
    return createDefaultGradeTimeRulesSettings()
  }

  const rules = raw.rules.map((rule) => normalizeGradeTimeRule(rule)).filter((r) => r !== null)

  // Return canonical shape without transient UI state
  return {
    enabled: !!raw.enabled,
    version: GRADE_TIME_RULES_VERSION,
    rules,
  }
}

// --- Summarizer ----------------------------------------------------------

/**
 * Return a human-readable summary string for a single rule.
 */
export function summarizeGradeTimeRule(rule) {
  if (!rule) return '(empty)'

  const gradeStr = rule.grades?.join(',') ?? '?'
  const purpose = rule.purpose ?? 'general'

  if (rule.timeSelectionMode === 'candidate') {
    const count = rule.candidateBlocks?.length ?? 0
    return `${purpose} | G${gradeStr} | ${count} candidate blocks`
  }

  const dayLabel = rule.day != null ? `W${rule.day}` : '?'
  const periodStr = rule.periods?.join('-') ?? '?'
  return `${purpose} | G${gradeStr} | ${dayLabel} P${periodStr}`
}

// --- Legacy Migration ---------------------------------------------------

const THRESHOLD_MAP = {
  soft_only: 'prefer',
  tolerant_90: 'at_least_90',
  strict_100: 'all',
}

/**
 * Migrate old co-planning settings to canonical grade-time rules.
 *
 * Manual mode -> one fixed rule per grade
 * Auto mode -> one candidate rule per grade (shared blocks)
 */
export function migrateLegacyCoPlanningSettings(legacy) {
  if (!legacy || !legacy.enabled || !Array.isArray(legacy.grades) || legacy.grades.length === 0) {
    return createDefaultGradeTimeRulesSettings()
  }

  const rules = []

  if (legacy.mode === 'manual') {
    // One fixed rule per grade with its own block
    for (const grade of legacy.grades) {
      const block = legacy.manualBlocks?.[String(grade)]
      if (!block) continue

      const periods = []
      for (let p = block.startPeriod; p < block.startPeriod + block.length; p += 1) {
        if (p >= 1 && p <= 7) periods.push(p)
      }

      const isValidDay = Number.isInteger(block.day) && block.day >= 1 && block.day <= 5
      const rule = {
        id: `co-planning-grade-${grade}`,
        enabled: isValidDay && periods.length > 0,
        purpose: 'co_planning',
        grades: [grade],
        timeSelectionMode: 'fixed',
        day: block.day,
        periods,
        ruleType: 'require_teacher_type',
        teacherType: 'subject',
        fulfillmentThreshold: THRESHOLD_MAP[legacy.coPlanningThresholdMode] || 'all',
      }

      rules.push(rule)
    }
  } else if (legacy.mode === 'auto') {
    // One candidate rule per grade, sharing the same blocks
    const blocks = (legacy.candidateBlocks || []).map((b) => {
      const periods = []
      for (let p = b.startPeriod; p < b.startPeriod + b.length; p += 1) {
        if (p >= 1 && p <= 7) periods.push(p)
      }
      return { day: b.day, periods }
    })

    for (const grade of legacy.grades) {
      rules.push({
        id: `co-planning-grade-${grade}`,
        enabled: blocks.length > 0,
        purpose: 'co_planning',
        grades: [grade],
        timeSelectionMode: 'candidate',
        candidateBlocks: blocks,
        ruleType: 'require_teacher_type',
        teacherType: 'subject',
        fulfillmentThreshold: THRESHOLD_MAP[legacy.coPlanningThresholdMode] || 'at_least_90',
      })
    }
  }

  return {
    enabled: rules.some((r) => r.enabled),
    version: GRADE_TIME_RULES_VERSION,
    rules,
  }
}

// --- Issue Severities Contract ---------------------------------------------

export const ISSUE_CODES = {
  GTR_INVALID_DAY_OR_PERIOD: 'blocking',
  GTR_DUPLICATE_RULE: 'blocking',
  GTR_REQUIRE_SUBJECT_CONFLICT: 'blocking',
  GTR_TEACHER_TYPE_CONFLICT: 'blocking',
  GTR_FIXED_LOCK_CONFLICT: 'blocking',
  GTR_SUBJECT_NOT_AVAILABLE_FOR_GRADE: 'blocking',
  GTR_EMPTY_CANDIDATE_BLOCKS: 'blocking',
  GTR_TEACHER_CAPACITY_RISK: 'warning',
  GTR_ROOM_CAPACITY_RISK: 'warning',
  GTR_THRESHOLD_CAPACITY_RISK: 'warning',
  GTR_PE_PERIOD_45_QUALITY_RISK: 'warning',
  GTR_PERIOD7_FLEXIBLE_QUALITY_RISK: 'warning',
  GRADE_TIME_RULE_MIGRATION_FAILED: 'blocking',
}

// --- Deterministic Conflict Detector ------------------------------------

/**
 * Detect deterministic conflict issues in grade-time rules.
 * Pure function returning an array of issue objects.
 */
export function detectDeterministicGradeTimeRuleIssues(rulesOrSettings, context = {}) {
  if (!rulesOrSettings) return []

  let rules = []
  if (Array.isArray(rulesOrSettings)) {
    rules = rulesOrSettings
  } else if (typeof rulesOrSettings === 'object' && Array.isArray(rulesOrSettings.rules)) {
    if (rulesOrSettings.enabled === false) return []
    rules = rulesOrSettings.rules
  }

  const activeRules = rules.filter((r) => r && r.enabled !== false)
  const issues = []

  // 1. Parameter & Day/Period Checks
  for (const r of activeRules) {
    if (r.timeSelectionMode === 'candidate') {
      if (r.purpose !== 'co_planning' || !Array.isArray(r.candidateBlocks) || r.candidateBlocks.length === 0) {
        issues.push({
          code: 'GTR_EMPTY_CANDIDATE_BLOCKS',
          severity: ISSUE_CODES.GTR_EMPTY_CANDIDATE_BLOCKS,
          message: `Rule ${r.id} in candidate mode requires candidate blocks and co_planning purpose`,
          ruleIds: [r.id],
        })
      }
    } else {
      // Fixed mode
      if (r.day == null || r.day < 1 || r.day > 5) {
        issues.push({
          code: 'GTR_INVALID_DAY_OR_PERIOD',
          severity: ISSUE_CODES.GTR_INVALID_DAY_OR_PERIOD,
          message: `Rule ${r.id} has invalid day ${r.day}`,
          ruleIds: [r.id],
          day: r.day,
        })
      }
      if (Array.isArray(r.periods)) {
        for (const p of r.periods) {
          if (p < 1 || p > 7) {
            issues.push({
              code: 'GTR_INVALID_DAY_OR_PERIOD',
              severity: ISSUE_CODES.GTR_INVALID_DAY_OR_PERIOD,
              message: `Rule ${r.id} has invalid period ${p}`,
              ruleIds: [r.id],
              day: r.day >= 1 && r.day <= 5 ? r.day : undefined,
              period: p,
            })
          }
        }
      }
    }
  }

  // 2. Duplicate Rules Check
  const seenMap = new Map()
  for (const r of activeRules) {
    const gradesKey = Array.isArray(r.grades) ? [...r.grades].sort().join(',') : ''
    const periodsKey = Array.isArray(r.periods) ? [...r.periods].sort().join(',') : ''
    const key = [
      r.purpose || 'general',
      r.timeSelectionMode || 'fixed',
      gradesKey,
      r.day,
      periodsKey,
      r.ruleType || '',
      r.subjectName || '',
      r.subjectCategory || '',
      r.teacherType || '',
      r.fulfillmentThreshold || '',
    ].join('|')

    if (seenMap.has(key)) {
      const prevId = seenMap.get(key)
      issues.push({
        code: 'GTR_DUPLICATE_RULE',
        severity: ISSUE_CODES.GTR_DUPLICATE_RULE,
        message: `Duplicate rule between ${prevId} and ${r.id}`,
        ruleIds: [prevId, r.id],
      })
    } else {
      seenMap.set(key, r.id)
    }
  }

  // 3. Time Slot Overlap & Conflict Check (Fixed Rules)
  const slotSubjectMap = new Map()
  const slotTeacherTypeMap = new Map()

  for (const r of activeRules) {
    if (r.timeSelectionMode === 'candidate') continue
    if (r.day < 1 || r.day > 5) continue
    const grades = Array.isArray(r.grades) ? r.grades : []
    const periods = Array.isArray(r.periods) ? r.periods : []

    for (const g of grades) {
      for (const p of periods) {
        if (p < 1 || p > 7) continue
        const slotKey = `${g}_${r.day}_${p}`

        // Subject requirement conflict
        if (r.ruleType === 'require_subject' && r.subjectName) {
          if (!slotSubjectMap.has(slotKey)) {
            slotSubjectMap.set(slotKey, { grade: g, day: r.day, period: p, items: [] })
          }
          slotSubjectMap.get(slotKey).items.push({ subjectName: r.subjectName, ruleId: r.id })
        }

        // Teacher type conflict
        if ((r.ruleType === 'require_teacher_type' || r.ruleType === 'forbid_teacher_type') && r.teacherType) {
          if (!slotTeacherTypeMap.has(slotKey)) {
            slotTeacherTypeMap.set(slotKey, { grade: g, day: r.day, period: p, items: [] })
          }
          slotTeacherTypeMap.get(slotKey).items.push({ ruleType: r.ruleType, teacherType: r.teacherType, ruleId: r.id })
        }
      }
    }
  }

  // Evaluate subject conflicts
  for (const { grade, day, period, items } of slotSubjectMap.values()) {
    const distinctSubjects = new Set(items.map((i) => i.subjectName))
    if (distinctSubjects.size > 1) {
      const affectedRuleIds = Array.from(new Set(items.map((i) => i.ruleId))).sort()
      issues.push({
        code: 'GTR_REQUIRE_SUBJECT_CONFLICT',
        severity: ISSUE_CODES.GTR_REQUIRE_SUBJECT_CONFLICT,
        message: `Conflicting subjects required for grade ${grade} at day ${day} period ${period}`,
        ruleIds: affectedRuleIds,
        grade,
        day,
        period,
      })
    }
  }

  // Evaluate teacher type conflicts
  for (const { grade, day, period, items } of slotTeacherTypeMap.values()) {
    const requiredTypes = new Set(items.filter((i) => i.ruleType === 'require_teacher_type').map((i) => i.teacherType))
    const forbiddenTypes = new Set(items.filter((i) => i.ruleType === 'forbid_teacher_type').map((i) => i.teacherType))
    const conflicts = Array.from(requiredTypes).filter((t) => forbiddenTypes.has(t))

    if (conflicts.length > 0) {
      const affectedRuleIds = Array.from(new Set(items.map((i) => i.ruleId))).sort()
      issues.push({
        code: 'GTR_TEACHER_TYPE_CONFLICT',
        severity: ISSUE_CODES.GTR_TEACHER_TYPE_CONFLICT,
        message: `Teacher type ${conflicts.join(',')} both required and forbidden for grade ${grade} at day ${day} period ${period}`,
        ruleIds: affectedRuleIds,
        grade,
        day,
        period,
      })
    }
  }

  // 4. Quality Soft Rules (Warnings)
  const peNames = new Set(['體育', '體育課', 'PE', 'pe'])
  const nonFlexibleCoreSubjects = new Set(['國語', '數學', '英語', '自然', '社會'])

  for (const r of activeRules) {
    if (r.timeSelectionMode === 'candidate') continue
    const isHard = r.enforcementMode === 'hard' || r.fulfillmentThreshold === 'all'
    if (!isHard) continue

    const grades = Array.isArray(r.grades) ? r.grades : []
    const periods = Array.isArray(r.periods) ? r.periods : []

    for (const g of grades) {
      for (const p of periods) {
        if (r.ruleType === 'require_subject' && peNames.has(r.subjectName) && (p === 4 || p === 5)) {
          issues.push({
            code: 'GTR_PE_PERIOD_45_QUALITY_RISK',
            severity: ISSUE_CODES.GTR_PE_PERIOD_45_QUALITY_RISK,
            message: `PE required at period ${p} for grade ${g}`,
            ruleIds: [r.id],
            grade: g,
            day: r.day,
            period: p,
          })
        }

        if (r.ruleType === 'require_subject' && nonFlexibleCoreSubjects.has(r.subjectName) && p === 7) {
          issues.push({
            code: 'GTR_PERIOD7_FLEXIBLE_QUALITY_RISK',
            severity: ISSUE_CODES.GTR_PERIOD7_FLEXIBLE_QUALITY_RISK,
            message: `Core subject ${r.subjectName} required at period 7 for grade ${g}`,
            ruleIds: [r.id],
            grade: g,
            day: r.day,
            period: 7,
          })
        }
      }
    }
  }

  return issues
}

// --- Force Blocking Rules to Draft ----------------------------------------

/**
 * Given settings and detected issues, disable any rule that has a blocking issue.
 * Preserves warning issues without disabling rules.
 * Pure function: returns a new settings object.
 */
export function forceBlockingRulesToDraft(settings, issues = []) {
  if (!settings || !Array.isArray(settings.rules)) return settings

  const blockingIssues = (issues || []).filter((i) => i && i.severity === 'blocking')
  if (blockingIssues.length === 0) return settings

  const blockedRuleIds = new Set(blockingIssues.flatMap((i) => i.ruleIds || []))

  const newRules = settings.rules.map((rule) => {
    if (rule && blockedRuleIds.has(rule.id)) {
      return { ...rule, enabled: false }
    }
    return rule
  })

  return {
    ...settings,
    rules: newRules,
  }
}
