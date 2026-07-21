import { describe, it, expect } from 'vitest'
import {
  buildAvailableSubjectCatalog,
  findSubjectCatalogEntry,
  enrichRequirementsWithMetadata,
  validateRequirementsAgainstCatalog,
  isSubjectApplicableToGrade,
  sanitizeRequirementsByGrade,
} from '../src/utils/gradeSubjectUtils'

// ─────────────────────────────────────────────
// buildAvailableSubjectCatalog
// ─────────────────────────────────────────────

describe('buildAvailableSubjectCatalog', () => {
  const mockStandardDomainSettings = [
    { name: '語文-國語', defaultTeacher: 'homeroom', periods: { 1: 8, 2: 8 } },
    { name: '數學', defaultTeacher: 'subject', periods: { 1: 6, 2: 6 } },
    { name: '自然科學', defaultTeacher: 'subject', periods: { 3: 4, 4: 4, 5: 4, 6: 4 } },
  ]

  const mockAlternativeMatrix = {
    '1': [{ subject: '主題課程', periods: 2, defaultTeacher: 'subject' }],
    '3': [{ subject: '校本探究', periods: 1, defaultTeacher: 'homeroom' }],
  }

  it('合併 standard + alternative, year 1', () => {
    const catalog = buildAvailableSubjectCatalog({
      grade: 1,
      standardDomainSettings: mockStandardDomainSettings,
      alternativeMatrix: mockAlternativeMatrix,
      currentRequirements: [],
    })

    expect(catalog).toHaveLength(3) // 國語, 數學, 主題課程
    expect(catalog.find(e => e.subject === '語文-國語')).toMatchObject({
      defaultTeacher: 'homeroom',
      source: 'standard',
      isLegacy: false,
    })
    expect(catalog.find(e => e.subject === '主題課程')).toMatchObject({
      defaultTeacher: 'subject',
      source: 'alternative',
      isLegacy: false,
    })
  })

  it('legacy 科目被補進 catalog 並標記 isLegacy', () => {
    const catalog = buildAvailableSubjectCatalog({
      grade: 1,
      standardDomainSettings: mockStandardDomainSettings,
      alternativeMatrix: mockAlternativeMatrix,
      currentRequirements: [
        { subject: '語文-國語' },
        { subject: '已刪除的舊課程' },
      ],
    })

    const legacy = catalog.find(e => e.subject === '已刪除的舊課程')
    expect(legacy).toBeTruthy()
    expect(legacy.isLegacy).toBe(true)
    expect(legacy.source).toBe('legacy')
    expect(legacy.defaultTeacher).toBe('subject') // fallback
  })

  it('legacy 科目優先沿用 req.defaultTeacher', () => {
    const catalog = buildAvailableSubjectCatalog({
      grade: 1,
      standardDomainSettings: mockStandardDomainSettings,
      alternativeMatrix: mockAlternativeMatrix,
      currentRequirements: [
        { subject: '舊課程A', defaultTeacher: 'homeroom' },
      ],
    })

    const entry = catalog.find(e => e.subject === '舊課程A')
    expect(entry.defaultTeacher).toBe('homeroom') // 優先沿用
    expect(entry.isLegacy).toBe(true)
  })

  it('standard 與 alternative 同名時 standard 優先', () => {
    const catalog = buildAvailableSubjectCatalog({
      grade: 1,
      standardDomainSettings: [
        { name: '主題課程', defaultTeacher: 'homeroom', periods: { 1: 2 } },
      ],
      alternativeMatrix: {
        '1': [{ subject: '主題課程', periods: 2, defaultTeacher: 'subject' }],
      },
      currentRequirements: [],
    })

    const entry = catalog.find(e => e.subject === '主題課程')
    expect(entry.source).toBe('standard') // standard 優先
    expect(entry.defaultTeacher).toBe('homeroom')
  })

  it('currentRequirements 中重複的 legacy 科目只出現一次', () => {
    const catalog = buildAvailableSubjectCatalog({
      grade: 1,
      standardDomainSettings: mockStandardDomainSettings,
      alternativeMatrix: mockAlternativeMatrix,
      currentRequirements: [
        { subject: '孤兒課程' },
        { subject: '孤兒課程' },
        { subject: '孤兒課程' },
      ],
    })

    const orphans = catalog.filter(e => e.subject === '孤兒課程')
    expect(orphans).toHaveLength(1)
  })

  it('年級不適用時 standard 科目不被包含', () => {
    const catalog = buildAvailableSubjectCatalog({
      grade: 1,
      standardDomainSettings: [
        { name: '自然科學', defaultTeacher: 'subject', periods: { 1: 0, 3: 4 } },
      ],
      alternativeMatrix: {},
      currentRequirements: [],
    })

    // 自然科學不適用 1 年級，且 periods[1]=0
    expect(catalog.find(e => e.subject === '自然科學')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────
// findSubjectCatalogEntry
// ─────────────────────────────────────────────

describe('findSubjectCatalogEntry', () => {
  it('找到存在的科目', () => {
    const catalog = [
      { subject: '數學', defaultTeacher: 'subject', source: 'standard', isLegacy: false },
    ]
    expect(findSubjectCatalogEntry('數學', catalog)).toEqual(catalog[0])
  })

  it('找不到時回傳 null', () => {
    expect(findSubjectCatalogEntry('不存在的科目', [])).toBeNull()
    expect(findSubjectCatalogEntry('', [])).toBeNull()
    expect(findSubjectCatalogEntry('數學', null)).toBeNull()
  })
})

// ─────────────────────────────────────────────
// enrichRequirementsWithMetadata
// ─────────────────────────────────────────────

describe('enrichRequirementsWithMetadata', () => {
  it('補齊缺少 defaultTeacher 的需求', () => {
    const catalog = [
      { subject: '語文-國語', defaultTeacher: 'homeroom', source: 'standard', isLegacy: false },
    ]
    const reqs = [{ subject: '語文-國語', periods: 8 }]

    const enriched = enrichRequirementsWithMetadata(reqs, catalog)
    expect(enriched[0].defaultTeacher).toBe('homeroom')
  })

  it('不覆蓋已有的 defaultTeacher', () => {
    const catalog = [
      { subject: '數學', defaultTeacher: 'subject', source: 'standard', isLegacy: false },
    ]
    const reqs = [{ subject: '數學', defaultTeacher: 'homeroom', periods: 6 }]

    const enriched = enrichRequirementsWithMetadata(reqs, catalog)
    expect(enriched[0].defaultTeacher).toBe('homeroom') // 不覆蓋
  })

  it('處理空陣列', () => {
    expect(enrichRequirementsWithMetadata([], [])).toEqual([])
    expect(enrichRequirementsWithMetadata(null, [])).toEqual([])
  })
})

// ─────────────────────────────────────────────
// validateRequirementsAgainstCatalog
// ─────────────────────────────────────────────

describe('validateRequirementsAgainstCatalog', () => {
  it('空白科目被標記為 empty issue', () => {
    const catalog = [
      { subject: '數學', defaultTeacher: 'subject', source: 'standard', isLegacy: false },
    ]
    const reqs = [{ subject: '' }, { subject: '數學' }]

    const result = validateRequirementsAgainstCatalog(reqs, catalog)
    expect(result.valid).toBe(false)
    expect(result.issues[0].issueType).toBe('empty')
  })

  it('所有科目都在 catalog 中時驗證通過', () => {
    const catalog = [
      { subject: '數學', defaultTeacher: 'subject', source: 'standard', isLegacy: false },
      { subject: '語文-國語', defaultTeacher: 'homeroom', source: 'standard', isLegacy: false },
    ]
    const reqs = [{ subject: '數學' }, { subject: '語文-國語' }]

    const result = validateRequirementsAgainstCatalog(reqs, catalog)
    expect(result.valid).toBe(true)
  })

  it('legacy 科目在 catalog 中所以驗證通過', () => {
    const catalog = [
      { subject: '數學', defaultTeacher: 'subject', source: 'standard', isLegacy: false },
      { subject: '舊課程', defaultTeacher: 'subject', source: 'legacy', isLegacy: true },
    ]
    const reqs = [{ subject: '數學' }, { subject: '舊課程' }]

    const result = validateRequirementsAgainstCatalog(reqs, catalog)
    expect(result.valid).toBe(true)
  })
})

// ─────────────────────────────────────────────
// 回歸測試: isSubjectApplicableToGrade
// ─────────────────────────────────────────────

describe('回歸測試: isSubjectApplicableToGrade', () => {
  it('生活課只適用於 1-2 年級', () => {
    expect(isSubjectApplicableToGrade('生活', 1)).toBe(true)
    expect(isSubjectApplicableToGrade('生活', 2)).toBe(true)
    expect(isSubjectApplicableToGrade('生活', 3)).toBe(false)
  })

  it('自然科學只適用於 3-6 年級', () => {
    expect(isSubjectApplicableToGrade('自然科學', 1)).toBe(false)
    expect(isSubjectApplicableToGrade('自然科學', 2)).toBe(false)
    expect(isSubjectApplicableToGrade('自然科學', 4)).toBe(true)
  })
})

// ─────────────────────────────────────────────
// 回歸測試: sanitizeRequirementsByGrade
// ─────────────────────────────────────────────

describe('回歸測試: sanitizeRequirementsByGrade', () => {
  it('移除不適用年級的科目', () => {
    const reqs = [
      { subject: '生活', periods: 10 },
      { subject: '自然科學', periods: 4 },
    ]
    const result = sanitizeRequirementsByGrade(reqs, 1)
    expect(result.requirements).toHaveLength(1)
    expect(result.requirements[0].subject).toBe('生活')
    expect(result.removed).toHaveLength(1)
  })
})
