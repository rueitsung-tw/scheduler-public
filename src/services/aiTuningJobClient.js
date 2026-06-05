const DEFAULT_AI_TUNING_TIMEOUT_MS = 600000;
const DEFAULT_JOB_POLL_INTERVAL_MS = 3000;

function isAbortLikeError(error) {
  const message = String(error?.message || '').toLowerCase();
  return Boolean(
    error?.name === 'AbortError'
    || message.includes('aborted without reason')
    || message.includes('this operation was aborted')
    || message.includes('the operation was aborted')
  );
}

function detectTransportErrorCode(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('context size') || message.includes('available context size') || message.includes('tokens exceeds')) {
    return 'upstream_context_overflow';
  }
  if (
    message.includes('socket hang up')
    || message.includes('connection reset')
    || message.includes('closed connection')
    || message.includes('eof')
    || message.includes('econnreset')
  ) {
    return 'backend_closed_connection';
  }
  if (
    message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('fetch failed')
    || message.includes('enotfound')
    || message.includes('econnrefused')
  ) {
    return 'backend_unreachable';
  }
  if (isAbortLikeError(error)) {
    return 'upstream_timeout';
  }
  return 'unknown_error';
}

function createAiTuningError({ responseStatus = 0, responseData = null, fallbackError = null } = {}) {
  if (fallbackError && typeof fallbackError === 'object' && fallbackError.code) {
    return fallbackError;
  }

  const code = responseData?.code
    || fallbackError?.code
    || detectTransportErrorCode(fallbackError)
    || 'unknown_error';

  const message = responseData?.error
    || fallbackError?.message
    || 'AI 微調發生未知錯誤';

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

async function requestJson({
  apiBase,
  path,
  method = 'POST',
  payload,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
} = {}) {
  if (!apiBase) {
    throw createAiTuningError({
      responseStatus: 400,
      responseData: { code: 'settings_missing', error: 'AI API base URL 尚未設定' },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
    });

    const { responseText, data } = await parseResponseBody(response);

    if (!response.ok) {
      throw createAiTuningError({
        responseStatus: response.status,
        responseData: data,
        fallbackError: new Error(responseText || `HTTP ${response.status}`),
      });
    }

    return data;
  } catch (error) {
    throw createAiTuningError({
      fallbackError: isAbortLikeError(error)
        ? Object.assign(new Error('AI job request timeout'), { name: 'AbortError' })
        : error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function startAiTuningBackgroundJob({
  apiBase,
  report,
  reportMarkdown,
  scheduleEntries,
  scheduleContext,
  aiSettings,
  connectionSettings,
  focusStrategy = 'resource_first',
  maxIterations = 3,
  maxMovesPerRound = 3,
  tuningContext = null,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
} = {}) {
  return requestJson({
    apiBase,
    path: '/ai-timetable-tuning/jobs',
    payload: {
      report,
      reportMarkdown,
      scheduleEntries,
      scheduleContext,
      aiSettings,
      connectionSettings,
      focusStrategy,
      maxIterations,
      maxMovesPerRound,
      tuningContext,
    },
    timeoutMs,
  });
}

export async function listAiTuningBackgroundJobs({
  apiBase,
  limit = 12,
  timeoutMs = 15000,
} = {}) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Number(limit))) : 12;
  return requestJson({
    apiBase,
    path: `/ai-timetable-tuning/jobs?limit=${safeLimit}`,
    method: 'GET',
    timeoutMs,
  });
}

export async function getAiTuningBackgroundJob({
  apiBase,
  jobId,
  timeoutMs = 15000,
} = {}) {
  return requestJson({
    apiBase,
    path: `/ai-timetable-tuning/jobs/${encodeURIComponent(jobId)}`,
    method: 'GET',
    timeoutMs,
  });
}

export async function cancelAiTuningBackgroundJob({
  apiBase,
  jobId,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
} = {}) {
  return requestJson({
    apiBase,
    path: `/ai-timetable-tuning/jobs/${encodeURIComponent(jobId)}/cancel`,
    payload: { jobId },
    timeoutMs,
  });
}

export async function runAiTuningBackgroundJob({
  apiBase,
  report,
  reportMarkdown,
  scheduleEntries,
  scheduleContext,
  aiSettings,
  connectionSettings,
  focusStrategy = 'resource_first',
  maxIterations = 3,
  maxMovesPerRound = 3,
  tuningContext = null,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_JOB_POLL_INTERVAL_MS,
  onProgress = null,
} = {}) {
  const startResult = await startAiTuningBackgroundJob({
    apiBase,
    report,
    reportMarkdown,
    scheduleEntries,
    scheduleContext,
    aiSettings,
    connectionSettings,
    focusStrategy,
    maxIterations,
    maxMovesPerRound,
    tuningContext,
    timeoutMs,
  });

  const jobId = startResult.jobId;
  let latestSnapshot = startResult;

  if (typeof onProgress === 'function') {
    onProgress(startResult);
  }

  while (latestSnapshot.status === 'PENDING' || latestSnapshot.status === 'PROCESSING') {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    latestSnapshot = await getAiTuningBackgroundJob({
      apiBase,
      jobId,
      timeoutMs: Math.min(timeoutMs, 30000),
    });
    if (typeof onProgress === 'function') {
      onProgress(latestSnapshot);
    }
  }

  if (latestSnapshot.status === 'COMPLETED') {
    const finalResult = latestSnapshot.result || {};
    return {
      jobId,
      startResult,
      jobState: latestSnapshot,
      ...finalResult,
      previewSchedule: Array.isArray(finalResult.finalSchedule)
        ? finalResult.finalSchedule
        : (Array.isArray(finalResult.previewSchedule) ? finalResult.previewSchedule : []),
    };
  }

  if (latestSnapshot.status === 'CANCELLED') {
    return {
      jobId,
      cancelled: true,
      startResult,
      jobState: latestSnapshot,
      result: latestSnapshot.result || null,
    };
  }

  throw createAiTuningError({
    responseStatus: 500,
    responseData: latestSnapshot.result || {
      code: latestSnapshot.status || 'AI_TUNING_JOB_FAILED',
      error: latestSnapshot.progressMessage || 'AI 微調背景 job 失敗',
    },
  });
}

export function createAiTuningErrorForUi({ responseStatus = 0, responseData = null, fallbackError = null } = {}) {
  return createAiTuningError({ responseStatus, responseData, fallbackError });
}

