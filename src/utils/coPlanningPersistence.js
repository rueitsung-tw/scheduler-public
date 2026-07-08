export const AI_SETTINGS_CO_PLANNING_KEY = '__schoolInfoCoPlanningSettings'

function normalizePersistedObject(value) {
  return value && typeof value === 'object' ? { ...value } : {}
}

export function buildPersistedAiSettings(aiSettings = {}, schoolInfo = {}) {
  const base = normalizePersistedObject(aiSettings)
  const coPlanningSettings =
    (schoolInfo && typeof schoolInfo === 'object' && schoolInfo.coPlanningSettings && typeof schoolInfo.coPlanningSettings === 'object'
      ? schoolInfo.coPlanningSettings
      : null)
    || (aiSettings && typeof aiSettings === 'object' && aiSettings.coPlanningSettings && typeof aiSettings.coPlanningSettings === 'object'
      ? aiSettings.coPlanningSettings
      : null)
    || (aiSettings && typeof aiSettings === 'object' && aiSettings[AI_SETTINGS_CO_PLANNING_KEY] && typeof aiSettings[AI_SETTINGS_CO_PLANNING_KEY] === 'object'
      ? aiSettings[AI_SETTINGS_CO_PLANNING_KEY]
      : null)

  delete base.coPlanningSettings

  if (coPlanningSettings) {
    base[AI_SETTINGS_CO_PLANNING_KEY] = coPlanningSettings
  } else {
    delete base[AI_SETTINGS_CO_PLANNING_KEY]
  }

  return base
}

export function extractPersistedScheduleSettings(rawAiSettings) {
  const parsed = normalizePersistedObject(rawAiSettings)
  const coPlanningSettings =
    (parsed[AI_SETTINGS_CO_PLANNING_KEY] && typeof parsed[AI_SETTINGS_CO_PLANNING_KEY] === 'object'
      ? parsed[AI_SETTINGS_CO_PLANNING_KEY]
      : null)
    || (parsed.coPlanningSettings && typeof parsed.coPlanningSettings === 'object'
      ? parsed.coPlanningSettings
      : null)

  delete parsed[AI_SETTINGS_CO_PLANNING_KEY]
  delete parsed.coPlanningSettings

  return {
    aiSettings: parsed,
    coPlanningSettings,
  }
}
