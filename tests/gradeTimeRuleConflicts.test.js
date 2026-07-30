import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  detectDeterministicGradeTimeRuleIssues,
  forceBlockingRulesToDraft,
} from '../src/utils/gradeTimeRules.js'

describe('Grade Time Rule Deterministic Conflicts & Preflight', () => {
  it('detects conflicting subject requirements on same grade, day and period', () => {
    const rules = [
      {
        id: 'r1',
        enabled: true,
        grades: [3],
        day: 1,
        periods: [2],
        ruleType: 'require_subject',
        subjectName: '國語',
      },
      {
        id: 'r2',
        enabled: true,
        grades: [3],
        day: 1,
        periods: [2],
        ruleType: 'require_subject',
        subjectName: '數學',
      },
    ]

    const issues = detectDeterministicGradeTimeRuleIssues(rules)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('GTR_REQUIRE_SUBJECT_CONFLICT')
    expect(issues[0].severity).toBe('blocking')
    expect(issues[0].ruleIds).toEqual(['r1', 'r2'])
    expect(issues[0].grade).toBe(3)
    expect(issues[0].day).toBe(1)
    expect(issues[0].period).toBe(2)
  })

  it('detects require and forbid teacher type conflict on same grade, day and period', () => {
    const rules = [
      {
        id: 'r1',
        enabled: true,
        grades: [4],
        day: 2,
        periods: [3],
        ruleType: 'require_teacher_type',
        teacherType: 'subject',
      },
      {
        id: 'r2',
        enabled: true,
        grades: [4],
        day: 2,
        periods: [3],
        ruleType: 'forbid_teacher_type',
        teacherType: 'subject',
      },
    ]

    const issues = detectDeterministicGradeTimeRuleIssues(rules)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('GTR_TEACHER_TYPE_CONFLICT')
    expect(issues[0].severity).toBe('blocking')
    expect(issues[0].ruleIds).toEqual(['r1', 'r2'])
    expect(issues[0].grade).toBe(4)
    expect(issues[0].day).toBe(2)
    expect(issues[0].period).toBe(3)
  })

  it('detects duplicate rules', () => {
    const rules = [
      {
        id: 'r1',
        enabled: true,
        grades: [1],
        day: 2,
        periods: [1],
        ruleType: 'require_subject',
        subjectName: '校本',
      },
      {
        id: 'r2',
        enabled: true,
        grades: [1],
        day: 2,
        periods: [1],
        ruleType: 'require_subject',
        subjectName: '校本',
      },
    ]

    const issues = detectDeterministicGradeTimeRuleIssues(rules)
    expect(issues.some(i => i.code === 'GTR_DUPLICATE_RULE')).toBe(true)
    const dupIssue = issues.find(i => i.code === 'GTR_DUPLICATE_RULE')
    expect(dupIssue.severity).toBe('blocking')
    expect(dupIssue.ruleIds).toEqual(['r1', 'r2'])
  })

  it('detects invalid day or period', () => {
    const rules = [
      { id: 'r1', enabled: true, grades: [1], day: 6, periods: [1] },
      { id: 'r2', enabled: true, grades: [1], day: 1, periods: [8] },
    ]

    const issues = detectDeterministicGradeTimeRuleIssues(rules)
    expect(issues.filter(i => i.code === 'GTR_INVALID_DAY_OR_PERIOD')).toHaveLength(2)
    expect(issues[0].severity).toBe('blocking')
  })

  it('detects missing candidate blocks for candidate mode rules', () => {
    const rules = [
      {
        id: 'r1',
        enabled: true,
        purpose: 'co_planning',
        timeSelectionMode: 'candidate',
        grades: [5],
        candidateBlocks: [],
      },
    ]

    const issues = detectDeterministicGradeTimeRuleIssues(rules)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('GTR_EMPTY_CANDIDATE_BLOCKS')
    expect(issues[0].severity).toBe('blocking')
    expect(issues[0].ruleIds).toEqual(['r1'])
  })

  it('emits warning (not blocking) for hard PE at Period 4 or 5', () => {
    const rules = [
      {
        id: 'r-pe',
        enabled: true,
        enforcementMode: 'hard',
        grades: [5],
        day: 1,
        periods: [4],
        ruleType: 'require_subject',
        subjectName: '體育',
      },
    ]

    const issues = detectDeterministicGradeTimeRuleIssues(rules)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('GTR_PE_PERIOD_45_QUALITY_RISK')
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].ruleIds).toEqual(['r-pe'])
    expect(issues[0].grade).toBe(5)
    expect(issues[0].day).toBe(1)
    expect(issues[0].period).toBe(4)
  })

  it('emits warning (not blocking) for hard non-flexible core subject at Period 7', () => {
    const rules = [
      {
        id: 'r-p7',
        enabled: true,
        enforcementMode: 'hard',
        grades: [4],
        day: 3,
        periods: [7],
        ruleType: 'require_subject',
        subjectName: '數學',
      },
    ]

    const issues = detectDeterministicGradeTimeRuleIssues(rules)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('GTR_PERIOD7_FLEXIBLE_QUALITY_RISK')
    expect(issues[0].severity).toBe('warning')
  })

  it('forceBlockingRulesToDraft disables blocking rules but preserves warnings', () => {
    const settings = {
      enabled: true,
      rules: [
        { id: 'blocked-1', enabled: true, name: 'Conflict 1' },
        { id: 'warning-1', enabled: true, name: 'Quality Warning 1' },
        { id: 'valid-1', enabled: true, name: 'Valid Rule' },
      ],
    }

    const issues = [
      {
        code: 'GTR_REQUIRE_SUBJECT_CONFLICT',
        severity: 'blocking',
        ruleIds: ['blocked-1'],
        grade: 3,
        day: 1,
        period: 2,
      },
      {
        code: 'GTR_PE_PERIOD_45_QUALITY_RISK',
        severity: 'warning',
        ruleIds: ['warning-1'],
        grade: 5,
        day: 1,
        period: 4,
      },
    ]

    const safeSettings = forceBlockingRulesToDraft(settings, issues)

    // Must be pure - original untouched
    expect(settings.rules[0].enabled).toBe(true)

    // Blocked rule disabled
    expect(safeSettings.rules.find(r => r.id === 'blocked-1').enabled).toBe(false)

    // Warning rule remains enabled!
    expect(safeSettings.rules.find(r => r.id === 'warning-1').enabled).toBe(true)

    // Valid rule remains enabled!
    expect(safeSettings.rules.find(r => r.id === 'valid-1').enabled).toBe(true)
  })

  it('contract parity: every issue emitted exists in contracts/grade_time_rule_issue_codes.json', () => {
    const contractPath = path.resolve(__dirname, '../contracts/grade_time_rule_issue_codes.json')
    expect(fs.existsSync(contractPath)).toBe(true)
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))

    const rules = [
      {
        id: 'r1',
        enabled: true,
        enforcementMode: 'hard',
        grades: [5],
        day: 1,
        periods: [4],
        ruleType: 'require_subject',
        subjectName: '體育',
      },
      {
        id: 'r2',
        enabled: true,
        grades: [1],
        day: 2,
        periods: [1],
        ruleType: 'require_subject',
        subjectName: '校本',
      },
      {
        id: 'r3',
        enabled: true,
        grades: [1],
        day: 2,
        periods: [1],
        ruleType: 'require_subject',
        subjectName: '校本',
      },
      {
        id: 'r4',
        enabled: true,
        purpose: 'co_planning',
        timeSelectionMode: 'candidate',
        grades: [5],
        candidateBlocks: [],
      },
    ]

    const issues = detectDeterministicGradeTimeRuleIssues(rules)
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      expect(contract[issue.code]).toBeDefined()
      expect(issue.severity).toBe(contract[issue.code])
    }
  })
})
