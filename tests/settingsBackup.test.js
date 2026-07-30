import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useScheduleStore } from '../src/stores/schedule'
import { applyImport, buildExportPayload, parseImportFile } from '../src/utils/settingsBackup'

describe('settingsBackup with gradeTimeRulesSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('export includes gradeTimeRulesSettings and strips legacy co-planning keys', () => {
    const store = useScheduleStore()
    store.schoolInfo.gradeTimeRulesSettings = {
      enabled: true,
      version: 2,
      rules: [
        {
          id: 'rule-1',
          enabled: true,
          purpose: 'co_planning',
          grades: [5],
          timeSelectionMode: 'fixed',
          day: 1,
          periods: [1, 2],
        },
      ],
    }
    store.aiSettings.coPlanningSettings = { enabled: true }
    store.aiSettings.__schoolInfoCoPlanningSettings = { enabled: true }

    const exported = buildExportPayload()

    expect(exported.schoolInfo.gradeTimeRulesSettings).toBeDefined()
    expect(exported.schoolInfo.gradeTimeRulesSettings.rules).toHaveLength(1)
    expect(exported.schoolInfo.coPlanningSettings).toBeUndefined()
    expect(exported.aiSettings.coPlanningSettings).toBeUndefined()
    expect(exported.aiSettings.__schoolInfoCoPlanningSettings).toBeUndefined()
  })

  it('import normalizes canonical data and migrates legacy when canonical is absent', () => {
    const legacyPayload = {
      schemaVersion: '1.1.0',
      schoolInfo: {
        coPlanningSettings: {
          enabled: true,
          grades: [5, 6],
          mode: 'auto',
          candidateBlocks: [{ day: 1, startPeriod: 1, length: 2 }],
        },
      },
      aiSettings: {},
    }

    const parsed = parseImportFile(JSON.stringify(legacyPayload))

    expect(parsed.schoolInfo.gradeTimeRulesSettings).toBeDefined()
    expect(parsed.schoolInfo.gradeTimeRulesSettings.enabled).toBe(true)
    expect(parsed.schoolInfo.gradeTimeRulesSettings.rules).toHaveLength(2)
    expect(parsed.schoolInfo.coPlanningSettings).toBeUndefined()
    expect(parsed.aiSettings.coPlanningSettings).toBeUndefined()
  })

  it('repeated import does not produce duplicate rules', () => {
    const store = useScheduleStore()
    const payload = {
      schemaVersion: '1.1.0',
      schoolInfo: {
        gradeTimeRulesSettings: {
          enabled: true,
          version: 2,
          rules: [
            {
              id: 'rule-1',
              enabled: true,
              purpose: 'co_planning',
              grades: [5],
              timeSelectionMode: 'fixed',
              day: 1,
              periods: [1, 2],
            },
          ],
        },
      },
      aiSettings: {},
    }

    const parsed1 = parseImportFile(JSON.stringify(payload))
    applyImport(parsed1)
    expect(store.schoolInfo.gradeTimeRulesSettings.rules).toHaveLength(1)

    const parsed2 = parseImportFile(JSON.stringify(payload))
    applyImport(parsed2)
    expect(store.schoolInfo.gradeTimeRulesSettings.rules).toHaveLength(1)
  })
})
