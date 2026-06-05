const DEFAULT_AI_TUNING_TIMEOUT_MS = 600000;

function isAbortLikeError(error) {
  const message = String(error?.message || '').toLowerCase();
  return Boolean(
    error?.name === 'AbortError'
    || message.includes('aborted without reason')
    || message.includes('this operation was aborted')
    || message.includes('the operation was aborted')
  );
}

function createAiTuningError({ responseStatus = 0, responseData = null, fallbackError = null } = {}) {
  if (fallbackError && typeof fallbackError === 'object' && fallbackError.code) {
    return fallbackError;
  }

  const code = responseData?.code || fallbackError?.code || (isAbortLikeError(fallbackError) ? 'upstream_timeout' : 'unknown_error');
  const message = responseData?.error
    || fallbackError?.message
    || 'AI 微調請求失敗';

  const error = new Error(message);
  error.code = code;
  error.responseStatus = responseStatus;
  error.responseData = responseData;
  return error;
}

async function parseResponseBody(response) {
  const responseText = await response.text();
  if (!responseText) {
    return { responseText, data: {} };
  }

  try {
    return { responseText, data: JSON.parse(responseText) };
  } catch {
    return { responseText, data: { rawText: responseText } };
  }
}

export async function runAiTuningStep({
  apiBase,
  report,
  reportMarkdown,
  scheduleEntries,
  aiSettings,
  connectionSettings,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
  validateSwapMoves,
  applySwapMovesToScheduleEntries,
} = {}) {
  if (!apiBase) {
    throw createAiTuningError({
      responseStatus: 400,
      responseData: { code: 'settings_missing', error: 'AI API 基底網址尚未設定' },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${apiBase}/ai-timetable-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        report,
        reportMarkdown,
        scheduleEntries,
        aiSettings,
        connectionSettings,
      }),
    });
  } catch (error) {
    clearTimeout(timeoutId);
    throw createAiTuningError({ fallbackError: error });
  }

  clearTimeout(timeoutId);
  const { responseText, data } = await parseResponseBody(response);

  if (!response.ok) {
    throw createAiTuningError({
      responseStatus: response.status,
      responseData: data,
      fallbackError: new Error(responseText || `HTTP ${response.status}`),
    });
  }

  const analysis = data.analysis || data.result || data;
  const normalizedAnalysis = {
    ...analysis,
    swapMoves: Array.isArray(analysis?.swapMoves) ? analysis.swapMoves : [],
  };

  if (!validateSwapMoves || !applySwapMovesToScheduleEntries) {
    return {
      responseText,
      responseData: data,
      analysis: normalizedAnalysis,
      previewSchedule: Array.isArray(data.previewSchedule) ? data.previewSchedule : null,
    };
  }

  const validation = validateSwapMoves(scheduleEntries, normalizedAnalysis.swapMoves || []);
  if (validation.errors.length > 0) {
    throw createAiTuningError({
      responseStatus: 400,
      responseData: {
        code: 'invalid_move',
        error: validation.errors[0].reason || 'AI 建議包含無效的 swap move',
      },
    });
  }

  const applied = applySwapMovesToScheduleEntries(scheduleEntries, validation.validatedMoves);
  if (!applied.ok) {
    throw createAiTuningError({
      responseStatus: 400,
      responseData: {
        code: 'apply_failed',
        error: applied.errors?.[0]?.reason || '無法套用 AI swap moves',
      },
    });
  }

  return {
    responseText,
    responseData: data,
    analysis: {
      ...normalizedAnalysis,
      swapMoves: validation.validatedMoves,
    },
    previewSchedule: Array.isArray(data.previewSchedule) ? data.previewSchedule : applied.schedule,
  };
}

export function createAiTuningErrorForUi({ responseStatus = 0, responseData = null, fallbackError = null } = {}) {
  return createAiTuningError({ responseStatus, responseData, fallbackError });
}
