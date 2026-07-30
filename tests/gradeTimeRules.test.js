import { describe, expect, it } from 'vitest'
import {
  createDefaultGradeTimeRulesSettings,
  normalizeGradeTimeRulesSettings,
  migrateLegacyCoPlanningSettings,
} from '../src/utils/gradeTimeRules'

describe('gradeTimeRules canonical contract', () => {
  it('defaults to disabled with no rules', () => {
    expect(createDefaultGradeTimeRulesSettings()).toEqual({
      enabled: false,
      version: 2,
      rules: [],
    })
  })

  it('normalizes a fixed general rule', () => {
    const result = normalizeGradeTimeRulesSettings({
      enabled: true,
      rules: [
        {
          id: 'g1-school-course',
          enabled: true,
          purpose: 'general',
          grades: [1],
          timeSelectionMode: 'fixed',
          day: 2,
          periods: [1],
          ruleType: 'require_subject',
          subjectName: '校本',
          enforcementMode: 'hard',
        },
      ],
    })

    expect(result.rules[0]).toMatchObject({
      grades: [1],
      day: 2,
      periods: [1],
      ruleType: 'require_subject',
      subjectName: '校本',
      enforcementMode: 'hard',
    })
  })

  it('rejects candidate mode for a general rule', () => {
    const result = normalizeGradeTimeRulesSettings({
      enabled: true,
      rules: [
        {
          purpose: 'general',
          grades: [3],
          timeSelectionMode: 'candidate',
          candidateBlocks: [{ day: 4, periods: [5, 6] }],
          ruleType: 'forbid_teacher_type',
          teacherType: 'subject',
        },
      ],
    })

    expect(result.rules[0].timeSelectionMode).toBe('fixed')
  })

  // ---- Migration tests ----

  it('migrates manual Grade 5 and 6 blocks into separate fixed rules', () => {
    const result = migrateLegacyCoPlanningSettings({
      enabled: true,
      grades: [5, 6],
      mode: 'manual',
      coPlanningThresholdMode: 'strict_100',
      manualBlocks: {
        5: { day: 5, startPeriod: 5, length: 2 },
        6: { day: 4, startPeriod: 5, length: 2 },
      },
    })

    expect(result.rules).toHaveLength(2)
    expect(result.rules[0]).toMatchObject({
      purpose: 'co_planning',
      grades: [5],
      timeSelectionMode: 'fixed',
      day: 5,
      periods: [5, 6],
      fulfillmentThreshold: 'all',
    })
    expect(result.rules[1].grades).toEqual([6])
  })

  it('migrates auto mode into one candidate rule per grade', () => {
    const result = migrateLegacyCoPlanningSettings({
      enabled: true,
      grades: [5, 6],
      mode: 'auto',
      coPlanningThresholdMode: 'tolerant_90',
      candidateBlocks: [
        { day: 4, startPeriod: 5, length: 2 },
        { day: 5, startPeriod: 5, length: 2 },
      ],
    })

    expect(result.rules).toHaveLength(2)
    expect(result.rules.every((rule) => rule.timeSelectionMode === 'candidate')).toBe(true)
    expect(result.rules.every((rule) => rule.fulfillmentThreshold === 'at_least_90')).toBe(true)
    expect(result.rules[0].candidateBlocks).toEqual([
      { day: 4, periods: [5, 6] },
      { day: 5, periods: [5, 6] },
    ])
  })

  it('maps threshold modes correctly', () => {
    const softResult = migrateLegacyCoPlanningSettings({
      enabled: true,
      grades: [5],
      mode: 'auto',
      coPlanningThresholdMode: 'soft_only',
      candidateBlocks: [{ day: 4, startPeriod: 5, length: 2 }],
    })
    expect(softResult.rules[0].fulfillmentThreshold).toBe('prefer')

    const tolerantResult = migrateLegacyCoPlanningSettings({
      enabled: true,
      grades: [5],
      mode: 'auto',
      coPlanningThresholdMode: 'tolerant_90',
      candidateBlocks: [{ day: 4, startPeriod: 5, length: 2 }],
    })
    expect(tolerantResult.rules[0].fulfillmentThreshold).toBe('at_least_90')

    const strictResult = migrateLegacyCoPlanningSettings({
      enabled: true,
      grades: [5],
      mode: 'auto',
      coPlanningThresholdMode: 'strict_100',
      candidateBlocks: [{ day: 4, startPeriod: 5, length: 2 }],
    })
    expect(strictResult.rules[0].fulfillmentThreshold).toBe('all')
  })

  it('returns canonical default for disabled legacy settings', () => {
    const result = migrateLegacyCoPlanningSettings({
      enabled: false,
      grades: [],
      mode: 'manual',
      manualBlocks: {},
    })
    expect(result).toEqual({
      enabled: false,
      version: 2,
      rules: [],
    })
  })

  it('returns canonical default for absent legacy settings', () => {
    const result = migrateLegacyCoPlanningSettings(null)
    expect(result).toEqual({
      enabled: false,
      version: 2,
      rules: [],
    })
  })

  it('produces stable ids for grade 5 and 6', () => {
    const result = migrateLegacyCoPlanningSettings({
      enabled: true,
      grades: [5, 6],
      mode: 'manual',
      coPlanningThresholdMode: 'strict_100',
      manualBlocks: {
        5: { day: 5, startPeriod: 5, length: 2 },
        6: { day: 4, startPeriod: 5, length: 2 },
      },
    })
    expect(result.rules[0].id).toBe('co-planning-grade-5')
    expect(result.rules[1].id).toBe('co-planning-grade-6')
  })

  it('is idempotent when called twice', () => {
    const legacy = {
      enabled: true,
      grades: [5],
      mode: 'manual',
      coPlanningThresholdMode: 'strict_100',
      manualBlocks: {
        5: { day: 5, startPeriod: 5, length: 2 },
      },
    }
    const r1 = migrateLegacyCoPlanningSettings(legacy)
    const r2 = migrateLegacyCoPlanningSettings(legacy)
    expect(r1).toEqual(r2)
  })

  it('handles invalid legacy block gracefully', () => {
    const result = migrateLegacyCoPlanningSettings({
      enabled: true,
      grades: [5],
      mode: 'manual',
      coPlanningThresholdMode: 'strict_100',
      manualBlocks: {
        5: { day: 99, startPeriod: 99, length: 2 },
      },
    })
    // Invalid block produces a rule that is disabled (draft)
    expect(result.rules[0].enabled).toBe(false)
  })

  it('normalizes grades to 1-6 range', () => {
    const result = normalizeGradeTimeRulesSettings({
      enabled: true,
      rules: [
        {
          id: 'test',
          enabled: true,
          purpose: 'general',
          grades: [0, 1, 5, 6, 7],
          timeSelectionMode: 'fixed',
          day: 2,
          periods: [1],
          ruleType: 'require_subject',
          subjectName: '校本',
          enforcementMode: 'hard',
        },
      ],
    })
    expect(result.rules[0].grades).toEqual([1, 5, 6])
  })

  it('normalizes day to 1-5 range and periods to 1-7 range', () => {
    const result = normalizeGradeTimeRulesSettings({
      enabled: true,
      rules: [
        {
          id: 'test',
          enabled: true,
          purpose: 'general',
          grades: [1],
          timeSelectionMode: 'fixed',
          day: 6,
          periods: [0, 1, 7, 8],
          ruleType: 'require_subject',
          subjectName: '校本',
          enforcementMode: 'hard',
        },
      ],
    })
    // Day 6 is out of range -> rule disabled
    expect(result.rules[0].enabled).toBe(false)
    // Periods filtered to valid range
    expect(result.rules[0].periods).toEqual([1, 7])
  })

  it('strips validationState and validationIssues from persisted data', () => {
    const result = normalizeGradeTimeRulesSettings({
      enabled: true,
      rules: [
        {
          id: 'test',
          enabled: true,
          purpose: 'general',
          grades: [1],
          timeSelectionMode: 'fixed',
          day: 2,
          periods: [1],
          ruleType: 'require_subject',
          subjectName: '校本',
          enforcementMode: 'hard',
        },
      ],
      validationState: 'valid',
      validationIssues: [],
    })
    expect(result.validationState).toBeUndefined()
    expect(result.validationIssues).toBeUndefined()
  })

  it('co_planning rule keeps candidate mode', () => {
    const result = normalizeGradeTimeRulesSettings({
      enabled: true,
      rules: [
        {
          id: 'cp-5',
          enabled: true,
          purpose: 'co_planning',
          grades: [5],
          timeSelectionMode: 'candidate',
          candidateBlocks: [{ day: 4, periods: [5, 6] }],
          ruleType: 'require_teacher_type',
          teacherType: 'subject',
          fulfillmentThreshold: 'prefer',
        },
      ],
    })
    expect(result.rules[0].timeSelectionMode).toBe('candidate')
    expect(result.rules[0].purpose).toBe('co_planning')
  })

  it('forces co_planning rule shape', () => {
    const result = normalizeGradeTimeRulesSettings({
      enabled: true,
      rules: [
        {
          id: 'cp-5',
          enabled: true,
          purpose: 'co_planning',
          grades: [5],
          timeSelectionMode: 'fixed',
          day: 4,
          periods: [5, 6],
          ruleType: 'require_subject', // wrong type for co_planning
          subjectName: '藝術',
        },
      ],
    })
    expect(result.rules[0].ruleType).toBe('require_teacher_type')
    expect(result.rules[0].teacherType).toBe('subject')
  })
})
