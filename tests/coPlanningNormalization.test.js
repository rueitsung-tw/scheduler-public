/**
 * [2026-06-29] Behavior verification tests for normalizeCoPlanningSettings
 *
 * These tests import the real production normalizer from src/utils/coPlanningSettings.js
 * to verify the algorithm handles残缺/illegal DB data correctly.
 */
import { describe, it, expect } from 'vitest'
import { normalizeCoPlanningSettings } from '../src/utils/coPlanningSettings'

describe('normalizeCoPlanningSettings', () => {
  it('returns defaults for null input', () => {
    const result = normalizeCoPlanningSettings(null)
    expect(result).toEqual({
      enabled: false,
      grades: [5, 6],
      mode: 'auto',
      candidateBlocks: [],
      manualBlocks: { '5': null, '6': null },
    })
  })

  it('returns defaults for undefined input', () => {
    const result = normalizeCoPlanningSettings(undefined)
    expect(result.enabled).toBe(false)
    expect(result.manualBlocks).toHaveProperty('5')
    expect(result.manualBlocks).toHaveProperty('6')
  })

  it('returns defaults for non-object input (string)', () => {
    const result = normalizeCoPlanningSettings('garbage')
    expect(result.enabled).toBe(false)
    expect(result.grades).toEqual([5, 6])
  })

  it('returns defaults for non-object input (number)', () => {
    const result = normalizeCoPlanningSettings(42)
    expect(result.mode).toBe('auto')
  })

  it('normalizes enabled to boolean', () => {
    expect(normalizeCoPlanningSettings({ enabled: 1 }).enabled).toBe(true)
    expect(normalizeCoPlanningSettings({ enabled: 0 }).enabled).toBe(false)
    expect(normalizeCoPlanningSettings({ enabled: 'true' }).enabled).toBe(true)
    expect(normalizeCoPlanningSettings({ enabled: null }).enabled).toBe(false)
  })

  it('filters grades to only 5 and 6', () => {
    const result = normalizeCoPlanningSettings({ grades: [1, 3, 5, 6, 7] })
    expect(result.grades).toEqual([5, 6])
  })

  it('defaults grades to [5,6] when empty', () => {
    const result = normalizeCoPlanningSettings({ grades: [] })
    expect(result.grades).toEqual([5, 6])
  })

  it('defaults grades to [5,6] when missing', () => {
    const result = normalizeCoPlanningSettings({})
    expect(result.grades).toEqual([5, 6])
  })

  it('normalizes mode to auto or manual', () => {
    expect(normalizeCoPlanningSettings({ mode: 'manual' }).mode).toBe('manual')
    expect(normalizeCoPlanningSettings({ mode: 'auto' }).mode).toBe('auto')
    expect(normalizeCoPlanningSettings({ mode: 'invalid' }).mode).toBe('auto')
    expect(normalizeCoPlanningSettings({ mode: null }).mode).toBe('auto')
    expect(normalizeCoPlanningSettings({}).mode).toBe('auto')
  })

  it('filters invalid candidateBlocks', () => {
    const input = {
      candidateBlocks: [
        { day: 1, startPeriod: 5, length: 2 },    // valid
        { day: 6, startPeriod: 5, length: 2 },    // invalid: day > 5
        { day: 1, startPeriod: 4, length: 2 },    // invalid: startPeriod not 5 or 6
        { day: 3, startPeriod: 6, length: 2 },    // valid
        null,                                       // invalid
        'garbage',                                   // invalid
        { day: 0, startPeriod: 5 },                // invalid: day < 1
      ],
    }
    const result = normalizeCoPlanningSettings(input)
    expect(result.candidateBlocks).toHaveLength(2)
    expect(result.candidateBlocks[0]).toEqual({ day: 1, startPeriod: 5, length: 2 })
    expect(result.candidateBlocks[1]).toEqual({ day: 3, startPeriod: 6, length: 2 })
  })

  it('normalizes candidateBlock types to numbers', () => {
    const input = {
      candidateBlocks: [
        { day: '2', startPeriod: '5' },  // string values
      ],
    }
    const result = normalizeCoPlanningSettings(input)
    expect(result.candidateBlocks[0].day).toBe(2)
    expect(result.candidateBlocks[0].startPeriod).toBe(5)
    expect(result.candidateBlocks[0].length).toBe(2)
  })

  it('handles non-array candidateBlocks', () => {
    const result = normalizeCoPlanningSettings({ candidateBlocks: 'not-an-array' })
    expect(result.candidateBlocks).toEqual([])
  })

  it('guarantees manualBlocks has both 5 and 6 keys', () => {
    // Only '5' present
    const r1 = normalizeCoPlanningSettings({
      manualBlocks: { '5': { day: 1, startPeriod: 5, length: 2 } }
    })
    expect(r1.manualBlocks).toHaveProperty('5')
    expect(r1.manualBlocks).toHaveProperty('6')
    expect(r1.manualBlocks['6']).toBeNull()

    // Only '6' present
    const r2 = normalizeCoPlanningSettings({
      manualBlocks: { '6': { day: 2, startPeriod: 6, length: 2 } }
    })
    expect(r2.manualBlocks['5']).toBeNull()
    expect(r2.manualBlocks['6']).toEqual({ day: 2, startPeriod: 6, length: 2 })
  })

  it('rejects invalid manualBlocks values', () => {
    const input = {
      manualBlocks: {
        '5': { day: 10, startPeriod: 5 },  // invalid: day > 5
        '6': { day: 2, startPeriod: 3 },    // invalid: startPeriod not 5 or 6
      },
    }
    const result = normalizeCoPlanningSettings(input)
    expect(result.manualBlocks['5']).toBeNull()
    expect(result.manualBlocks['6']).toBeNull()
  })

  it('handles missing manualBlocks', () => {
    const result = normalizeCoPlanningSettings({})
    expect(result.manualBlocks).toEqual({ '5': null, '6': null })
  })

  it('handles non-object manualBlocks', () => {
    const result = normalizeCoPlanningSettings({ manualBlocks: 'garbage' })
    expect(result.manualBlocks).toEqual({ '5': null, '6': null })
  })

  it('full integration: complex残缺 input produces valid output', () => {
    const input = {
      enabled: 1,
      grades: [5, 6, 99],
      mode: 'MANUAL',  // should become 'auto' (case sensitive)
      candidateBlocks: [
        { day: 3, startPeriod: 5 },
        null,
        { day: 1, startPeriod: 7 },  // invalid
      ],
      manualBlocks: {
        '5': { day: 2, startPeriod: 6, length: 2 },
        // '6' missing
      },
    }
    const result = normalizeCoPlanningSettings(input)

    expect(result.enabled).toBe(true)
    expect(result.grades).toEqual([5, 6])
    expect(result.mode).toBe('auto')  // 'MANUAL' !== 'manual'
    expect(result.candidateBlocks).toHaveLength(1)
    expect(result.candidateBlocks[0]).toEqual({ day: 3, startPeriod: 5, length: 2 })
    expect(result.manualBlocks['5']).toEqual({ day: 2, startPeriod: 6, length: 2 })
    expect(result.manualBlocks['6']).toBeNull()
  })
})

describe('candidateBlock field validation', () => {
  // These tests verify the validation rules used by the normalizer
  const isValidDay = (d) => Number(d) >= 1 && Number(d) <= 5
  const isValidStartPeriod = (p) => [5, 6].includes(Number(p))

  it('rejects day = 0', () => expect(isValidDay(0)).toBe(false))
  it('rejects day = 6', () => expect(isValidDay(6)).toBe(false))
  it('accepts day = 1..5', () => {
    for (let d = 1; d <= 5; d++) expect(isValidDay(d)).toBe(true)
  })

  it('rejects startPeriod = 4', () => expect(isValidStartPeriod(4)).toBe(false))
  it('rejects startPeriod = 7', () => expect(isValidStartPeriod(7)).toBe(false))
  it('accepts startPeriod = 5', () => expect(isValidStartPeriod(5)).toBe(true))
  it('accepts startPeriod = 6', () => expect(isValidStartPeriod(6)).toBe(true))
})