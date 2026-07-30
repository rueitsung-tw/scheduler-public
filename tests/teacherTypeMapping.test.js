import { describe, expect, it } from 'vitest'
import { normalizeTeacherTypeLabel } from '../src/components/CsvImport.vue'

describe('CSV teacher type mapping', () => {
  it.each([
    ['特教', 'special_ed_resource'],
    ['特教老師', 'special_ed_resource'],
    ['特教資源', 'special_ed_resource'],
  ])('maps %s to special_ed_resource', (label, expected) => {
    expect(normalizeTeacherTypeLabel(label)).toBe(expected)
  })

  it.each([
    ['special', 'subject'],
    ['特殊', 'subject'],
    ['專科', 'subject'],
    ['專任', 'subject'],
    ['', 'subject'],
  ])('keeps legacy or specialist value %p out of special-ed resources', (label, expected) => {
    expect(normalizeTeacherTypeLabel(label)).toBe(expected)
  })

  it('maps homeroom correctly', () => {
    expect(normalizeTeacherTypeLabel('導師')).toBe('homeroom')
  })

  it('maps admin correctly', () => {
    expect(normalizeTeacherTypeLabel('行政')).toBe('admin')
  })

  it('defaults unknown values to subject', () => {
    expect(normalizeTeacherTypeLabel('未知類型')).toBe('subject')
    expect(normalizeTeacherTypeLabel(null)).toBe('subject')
    expect(normalizeTeacherTypeLabel(undefined)).toBe('subject')
  })
})