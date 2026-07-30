import { describe, expect, it } from 'vitest'
import {
  extractLegacyCoPlanningSettings,
  isGradeTimeRulesSettingsObject,
  parseGradeTimeRulesSettings,
  prepareGradeTimeRulesPersistence,
  resolveGradeTimeRulesServerLoad,
  serializeGradeTimeRulesSettings,
} from '../src/utils/gradeTimeRulesPersistence'

describe('parse / serialize', () => {
  it('roundtrips a valid settings object', () => {
    const obj = { rules: [{ grade: '1', mode: 'auto' }] }
    expect(parseGradeTimeRulesSettings(serializeGradeTimeRulesSettings(obj))).toEqual(obj)
  })

  it('returns null for invalid JSON', () => {
    expect(parseGradeTimeRulesSettings('{bad}')).toBeNull()
  })

  it('serializes null to empty string', () => {
    expect(serializeGradeTimeRulesSettings(null)).toBe('')
  })
})

describe('isGradeTimeRulesSettingsObject', () => {
  it('accepts objects with rules array', () => {
    expect(isGradeTimeRulesSettingsObject({ rules: [] })).toBe(true)
  })

  it('rejects plain objects without rules', () => {
    expect(isGradeTimeRulesSettingsObject({})).toBe(false)
  })

  it('rejects null and non-objects', () => {
    expect(isGradeTimeRulesSettingsObject(null)).toBe(false)
    expect(isGradeTimeRulesSettingsObject('x')).toBe(false)
  })
})

describe('prepareGradeTimeRulesPersistence', () => {
  it('prefers an existing valid canonical model over legacy input', () => {
    const canonical = {
      enabled: true,
      version: 2,
      rules: [
        {
          id: 'rule-1',
          enabled: true,
          purpose: 'co_planning',
          grades: [5],
          timeSelectionMode: 'fixed',
          day: 2,
          periods: [3, 4],
          ruleType: 'require_teacher_type',
          teacherType: 'subject',
        },
      ],
    }

    const legacy = {
      enabled: true,
      grades: [5, 6],
      mode: 'auto',
      candidateBlocks: [{ day: 1, startPeriod: 1, length: 2 }],
    }

    const result = prepareGradeTimeRulesPersistence({
      gradeTimeRulesSettings: canonical,
      aiSettings: { coPlanningSettings: legacy },
    })

    expect(result.migrated).toBe(false)
    expect(result.migrationIssues).toHaveLength(0)
    expect(result.gradeTimeRulesSettings.rules).toHaveLength(1)
    expect(result.gradeTimeRulesSettings.rules[0].id).toBe('rule-1')
    expect(result.cleanedAiSettings.coPlanningSettings).toBeUndefined()
  })

  it('migrates the hidden ai settings co-planning key exactly once', () => {
    const legacy = {
      enabled: true,
      grades: [5, 6],
      mode: 'manual',
      manualBlocks: {
        '5': { day: 2, startPeriod: 1, length: 2 },
        '6': { day: 3, startPeriod: 3, length: 2 },
      },
    }

    const result = prepareGradeTimeRulesPersistence({
      aiSettings: { __schoolInfoCoPlanningSettings: legacy, otherSetting: true },
    })

    expect(result.migrated).toBe(true)
    expect(result.migrationIssues).toHaveLength(0)
    expect(result.gradeTimeRulesSettings.enabled).toBe(true)
    expect(result.gradeTimeRulesSettings.rules).toHaveLength(2)
    expect(result.cleanedAiSettings.__schoolInfoCoPlanningSettings).toBeUndefined()
    expect(result.cleanedAiSettings.otherSetting).toBe(true)
  })

  it('removes aiSettings.coPlanningSettings from cleanedAiSettings', () => {
    const legacy = {
      enabled: true,
      grades: [5],
      mode: 'manual',
      manualBlocks: { '5': { day: 1, startPeriod: 1, length: 2 } },
    }

    const result = prepareGradeTimeRulesPersistence({
      aiSettings: { coPlanningSettings: legacy, foo: 'bar' },
    })

    expect(result.cleanedAiSettings.coPlanningSettings).toBeUndefined()
    expect(result.cleanedAiSettings.foo).toBe('bar')
  })

  it('removes aiSettings.__schoolInfoCoPlanningSettings from cleanedAiSettings', () => {
    const legacy = {
      enabled: true,
      grades: [5],
      mode: 'manual',
      manualBlocks: { '5': { day: 1, startPeriod: 1, length: 2 } },
    }

    const result = prepareGradeTimeRulesPersistence({
      aiSettings: { __schoolInfoCoPlanningSettings: legacy },
    })

    expect(result.cleanedAiSettings.__schoolInfoCoPlanningSettings).toBeUndefined()
  })

  it('keeps legacy data when migrationIssues is non-empty', () => {
    const corruptLegacy = {
      enabled: true,
      grades: [5],
      mode: 'invalid_corrupt_mode',
    }

    const aiSettings = { coPlanningSettings: corruptLegacy, extra: 123 }

    const result = prepareGradeTimeRulesPersistence({ aiSettings })

    expect(result.migrated).toBe(false)
    expect(result.migrationIssues).toHaveLength(1)
    expect(result.migrationIssues[0].code).toBe('GRADE_TIME_RULE_MIGRATION_FAILED')
    expect(result.migrationIssues[0].severity).toBe('blocking')
    // Legacy keys kept in aiSettings when migration fails!
    expect(result.cleanedAiSettings.coPlanningSettings).toEqual(corruptLegacy)
    expect(result.cleanedAiSettings.extra).toBe(123)
  })

  it('does not persist validationState or warning confirmations', () => {
    const canonicalWithTransient = {
      enabled: true,
      version: 2,
      rules: [
        {
          id: 'rule-1',
          enabled: true,
          purpose: 'co_planning',
          grades: [5],
          timeSelectionMode: 'fixed',
          day: 2,
          periods: [3, 4],
          validationState: 'valid',
          validationIssues: ['issue'],
          isDirty: true,
        },
      ],
    }

    const result = prepareGradeTimeRulesPersistence({
      gradeTimeRulesSettings: canonicalWithTransient,
    })

    const rule = result.gradeTimeRulesSettings.rules[0]
    expect(rule.validationState).toBeUndefined()
    expect(rule.validationIssues).toBeUndefined()
    expect(rule.isDirty).toBeUndefined()
  })
})

describe('resolveGradeTimeRulesServerLoad', () => {
  it('case 1: dedicated column empty + legacy manual -> gets migrated canonical rules', () => {
    const legacyManual = {
      enabled: true,
      grades: [5, 6],
      mode: 'manual',
      manualBlocks: {
        '5': { day: 1, startPeriod: 1, length: 2 },
        '6': { day: 2, startPeriod: 3, length: 2 },
      },
    }

    const res = resolveGradeTimeRulesServerLoad({
      gradeTimeRulesSettings: '{}',
      aiSettings: { coPlanningSettings: legacyManual },
    })

    expect(res.source).toBe('migrated_legacy')
    expect(res.gradeTimeRulesSettings.rules).toHaveLength(2)
    expect(res.gradeTimeRulesSettings.rules[0].purpose).toBe('co_planning')
  })

  it('case 2: dedicated column empty + legacy auto -> gets migrated canonical rules', () => {
    const legacyAuto = {
      enabled: true,
      grades: [5, 6],
      mode: 'auto',
      candidateBlocks: [{ day: 4, startPeriod: 1, length: 2 }],
    }

    const res = resolveGradeTimeRulesServerLoad({
      gradeTimeRulesSettings: '',
      aiSettings: { __schoolInfoCoPlanningSettings: legacyAuto },
    })

    expect(res.source).toBe('migrated_legacy')
    expect(res.gradeTimeRulesSettings.rules).toHaveLength(2)
    expect(res.gradeTimeRulesSettings.rules[0].timeSelectionMode).toBe('candidate')
  })

  it('case 3: canonical column non-empty + legacy both present -> canonical takes precedence', () => {
    const canonical = {
      enabled: true,
      version: 2,
      rules: [
        {
          id: 'canon-1',
          enabled: true,
          purpose: 'general',
          grades: [2],
          timeSelectionMode: 'fixed',
          day: 1,
          periods: [2],
        },
      ],
    }
    const legacy = {
      enabled: true,
      grades: [5, 6],
      mode: 'manual',
      manualBlocks: { '5': { day: 1, startPeriod: 1, length: 2 } },
    }

    const res = resolveGradeTimeRulesServerLoad({
      gradeTimeRulesSettings: JSON.stringify(canonical),
      aiSettings: { coPlanningSettings: legacy },
    })

    expect(res.source).toBe('canonical')
    expect(res.gradeTimeRulesSettings.rules).toHaveLength(1)
    expect(res.gradeTimeRulesSettings.rules[0].id).toBe('canon-1')
  })

  it('case 4: legacy load followed by save clears legacy keys without data loss', () => {
    const legacy = {
      enabled: true,
      grades: [5, 6],
      mode: 'manual',
      manualBlocks: { '5': { day: 1, startPeriod: 1, length: 2 } },
    }
    const originalAi = { coPlanningSettings: legacy, keepThisOption: 'yes' }

    // 1. GET resolution
    const loadRes = resolveGradeTimeRulesServerLoad({
      gradeTimeRulesSettings: '{}',
      aiSettings: originalAi,
    })

    expect(loadRes.source).toBe('migrated_legacy')

    // 2. Save payload preparation
    const savePrep = prepareGradeTimeRulesPersistence({
      gradeTimeRulesSettings: loadRes.gradeTimeRulesSettings,
      aiSettings: originalAi,
    })

    expect(savePrep.gradeTimeRulesSettings.rules).toHaveLength(1)
    expect(savePrep.cleanedAiSettings.coPlanningSettings).toBeUndefined()
    expect(savePrep.cleanedAiSettings.keepThisOption).toBe('yes')
  })

  it('case 6: non-co-planning aiSettings fields are preserved during load resolution', () => {
    const aiSettings = { enableSubjectBalance: true, customProp: 42 }
    const res = resolveGradeTimeRulesServerLoad({
      gradeTimeRulesSettings: '{}',
      aiSettings,
    })

    expect(res.gradeTimeRulesSettings.rules).toHaveLength(0)
  })
})
