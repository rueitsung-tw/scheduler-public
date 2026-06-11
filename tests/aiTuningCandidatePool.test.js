import { describe, expect, it } from 'vitest'
import { buildAiTuningCandidatePool } from '../src/services/aiTuningCandidates.js'

describe('AI tuning candidate pool', () => {
  it('generates opaque candidateIds only for classes with actionable issueSlots', () => {
    const report = {
      classes: [
        {
          className: '3年1班',
          grade: 3,
          issueCount: 1,
          issueSlots: [{ day: 1, period: 1 }],
          slotRows: [
            {
              day: 1,
              period: 1,
              entries: [{ subject: '語文-英語', teacherName: '英語A' }],
              issues: [{ type: 'room', severity: 'hard', message: 'room conflict' }],
            },
            {
              day: 1,
              period: 2,
              entries: [{ subject: '國語', teacherName: '導師A' }],
              issues: [],
            },
          ],
        },
      ],
    }

    const result = buildAiTuningCandidatePool(report)
    expect(result.candidateMoves.length).toBeGreaterThan(0)
    expect(result.candidateMoves.every((move) => /^M-\d{6}$/.test(move.candidateId))).toBe(true)
  })

  it('skips slots whose only issues are non-actionable types', () => {
    const report = {
      classes: [
        {
          className: '5年1班',
          grade: 5,
          issueCount: 2,
          slotRows: [
            {
              day: 1,
              period: 1,
              entries: [{ subject: '音樂', teacherName: '音樂A' }],
              issues: [{ type: 'info', severity: 'low', message: 'informational only' }],
            },
            {
              day: 1,
              period: 2,
              entries: [{ subject: '國語', teacherName: '導師A' }],
              issues: [],
            },
          ],
        },
      ],
    }

    const result = buildAiTuningCandidatePool(report)
    // Only non-actionable issue type "info", so no candidate anchors produced
    expect(result.candidateMoves.length).toBe(0)
  })

  it('includes candidates when mixed actionable and non-actionable issues exist', () => {
    const report = {
      classes: [
        {
          className: '4年1班',
          grade: 4,
          issueCount: 2,
          slotRows: [
            {
              day: 2,
              period: 1,
              entries: [{ subject: '美勞', teacherName: '美勞A' }],
              issues: [
                { type: 'room', severity: 'hard', message: 'room overlap' },
                { type: 'info', severity: 'low', message: 'note' },
              ],
            },
            {
              day: 2,
              period: 2,
              entries: [{ subject: '數學', teacherName: '導師B' }],
              issues: [],
            },
          ],
        },
      ],
    }

    const result = buildAiTuningCandidatePool(report)
    expect(result.candidateMoves.length).toBeGreaterThan(0)
  })
})
