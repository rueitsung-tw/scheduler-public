import { describe, expect, it } from 'vitest'
import {
  AI_SETTINGS_CO_PLANNING_KEY,
  buildPersistedAiSettings,
  extractPersistedScheduleSettings,
} from '../src/utils/coPlanningPersistence'

describe('coPlanning persistence helpers', () => {
  it('persists schoolInfo.coPlanningSettings into the hidden ai_settings key', () => {
    const persisted = buildPersistedAiSettings(
      { artsClassEnabled: true },
      {
        coPlanningSettings: {
          enabled: true,
          grades: [5, 6],
          mode: 'auto',
          candidateBlocks: [{ day: 2, startPeriod: 5, length: 2 }],
          manualBlocks: { '5': null, '6': null },
        },
      }
    )

    expect(persisted.artsClassEnabled).toBe(true)
    expect(persisted[AI_SETTINGS_CO_PLANNING_KEY]).toEqual({
      enabled: true,
      grades: [5, 6],
      mode: 'auto',
      candidateBlocks: [{ day: 2, startPeriod: 5, length: 2 }],
      manualBlocks: { '5': null, '6': null },
    })
  })

  it('falls back to legacy aiSettings.coPlanningSettings when schoolInfo is missing it', () => {
    const persisted = buildPersistedAiSettings(
      {
        artsClassEnabled: true,
        coPlanningSettings: {
          enabled: true,
          grades: [5],
          mode: 'manual',
          candidateBlocks: [],
          manualBlocks: { '5': { day: 3, startPeriod: 5, length: 2 }, '6': null },
        },
      },
      {}
    )

    expect(persisted.coPlanningSettings).toBeUndefined()
    expect(persisted[AI_SETTINGS_CO_PLANNING_KEY]).toEqual({
      enabled: true,
      grades: [5],
      mode: 'manual',
      candidateBlocks: [],
      manualBlocks: { '5': { day: 3, startPeriod: 5, length: 2 }, '6': null },
    })
  })

  it('extracts coPlanningSettings back out and leaves public ai settings clean', () => {
    const extracted = extractPersistedScheduleSettings({
      naturalConsecutive: true,
      [AI_SETTINGS_CO_PLANNING_KEY]: {
        enabled: true,
        grades: [6],
        mode: 'auto',
        candidateBlocks: [{ day: 4, startPeriod: 6, length: 2 }],
        manualBlocks: { '5': null, '6': null },
      },
    })

    expect(extracted.aiSettings).toEqual({ naturalConsecutive: true })
    expect(extracted.coPlanningSettings).toEqual({
      enabled: true,
      grades: [6],
      mode: 'auto',
      candidateBlocks: [{ day: 4, startPeriod: 6, length: 2 }],
      manualBlocks: { '5': null, '6': null },
    })
  })
})
