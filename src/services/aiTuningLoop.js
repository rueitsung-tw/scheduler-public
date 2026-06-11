import { createAiTuningErrorForUi } from './aiTuningClient.js';

const DEFAULT_AI_TUNING_TIMEOUT_MS = 600000;
const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_MAX_MOVES_PER_ROUND = 3;

function normalizeFocusStrategy(value) {
  return String(value || '').trim() === 'class_first' ? 'class_first' : 'resource_first';
}

function isTimeoutLikeError(error) {
  const message = String(error?.message || '').toLowerCase();
  return Boolean(
    error?.code === 'upstream_timeout'
    || error?.name === 'AbortError'
    || message.includes('aborted without reason')
    || message.includes('this operation was aborted')
    || message.includes('the operation was aborted')
    || message.includes('timeout')
  );
}

async function requestJson({ apiBase, path, payload, timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS } = {}) {
  if (!apiBase) {
    throw createAiTuningErrorForUi({
      responseStatus: 400,
      responseData: { code: 'settings_missing', error: 'AI API base URL 未設定' },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    clearTimeout(timeoutId);
    throw createAiTuningErrorForUi({ fallbackError: error });
  }

  clearTimeout(timeoutId);
  const responseText = await response.text();
  let data = {};

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { rawText: responseText };
    }
  }

  if (!response.ok) {
    throw createAiTuningErrorForUi({
      responseStatus: response.status,
      responseData: data,
      fallbackError: new Error(responseText || `HTTP ${response.status}`),
    });
  }

  return data;
}

export async function startAiTuningLoop({
  apiBase,
  report,
  reportMarkdown,
  scheduleEntries,
  scheduleContext,
  aiSettings,
  connectionSettings,
  focusStrategy = 'resource_first',
  maxIterations = DEFAULT_MAX_ITERATIONS,
  maxMovesPerRound = DEFAULT_MAX_MOVES_PER_ROUND,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
} = {}) {
  return requestJson({
    apiBase,
    path: '/ai-timetable-tuning/start',
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
    },
    timeoutMs,
  });
}

export async function stepAiTuningLoop({
  apiBase,
  sessionId,
  tuningContext = {},
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
} = {}) {
  return requestJson({
    apiBase,
    path: '/ai-timetable-tuning/step',
    payload: {
      sessionId,
      tuningContext,
    },
    timeoutMs,
  });
}

export async function finalizeAiTuningLoop({
  apiBase,
  sessionId,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
} = {}) {
  return requestJson({
    apiBase,
    path: '/ai-timetable-tuning/finalize',
    payload: {
      sessionId,
    },
    timeoutMs,
  });
}

export async function cancelAiTuningLoop({
  apiBase,
  sessionId,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
} = {}) {
  return requestJson({
    apiBase,
    path: '/ai-timetable-tuning/cancel',
    payload: {
      sessionId,
    },
    timeoutMs,
  });
}

export async function runAiTuningLoop({
  apiBase,
  report,
  reportMarkdown,
  scheduleEntries,
  scheduleContext,
  aiSettings,
  connectionSettings,
  focusStrategy = 'resource_first',
  maxIterations = DEFAULT_MAX_ITERATIONS,
  maxMovesPerRound = DEFAULT_MAX_MOVES_PER_ROUND,
  timeoutMs = DEFAULT_AI_TUNING_TIMEOUT_MS,
} = {}) {
  const normalizedFocusStrategy = normalizeFocusStrategy(focusStrategy);

  const runOnce = async ({
    currentReport = report,
    currentReportMarkdown = reportMarkdown,
    currentScheduleEntries = scheduleEntries,
    currentFocusStrategy = normalizedFocusStrategy,
    fallbackFromStrategy = null,
  } = {}) => {
    const startResult = await startAiTuningLoop({
      apiBase,
      report: currentReport,
      reportMarkdown: currentReportMarkdown,
      scheduleEntries: currentScheduleEntries,
      scheduleContext,
      aiSettings,
      connectionSettings,
      focusStrategy: currentFocusStrategy,
      maxIterations,
      maxMovesPerRound,
      timeoutMs,
    });

    const sessionId = startResult.sessionId;
    const steps = [];
    let latestResult = null;
    let shouldContinue = Boolean(startResult.shouldContinue);

    try {
      while (sessionId && shouldContinue && steps.length < maxIterations) {
        const tuningContext = {
          roundIndex: steps.length + 1,
          focusStrategy: currentFocusStrategy,
          maxIterations,
          maxMovesPerRound,
          previousIssueCount: latestResult?.loopState?.afterIssueCount
            ?? startResult.reportSummary?.issueCount
            ?? 0,
        };

        const stepResult = await stepAiTuningLoop({
          apiBase,
          sessionId,
          tuningContext,
          timeoutMs,
        });

        steps.push(stepResult);
        latestResult = stepResult;
        shouldContinue = Boolean(stepResult?.loopState?.shouldContinue);

        if (!shouldContinue) {
          break;
        }
      }

      const finalizeResult = await finalizeAiTuningLoop({
        apiBase,
        sessionId,
        timeoutMs,
      });

      const loopState = {
        ...(latestResult?.loopState || {}),
        ...(finalizeResult.loopState || {}),
        progress: latestResult?.loopState?.progress || finalizeResult.loopState?.progress || null,
        shouldContinue: latestResult?.loopState?.shouldContinue ?? false,
      };

      return {
        sessionId,
        startResult,
        steps,
        analysis: latestResult?.analysis || null,
        previewSchedule: Array.isArray(finalizeResult.finalSchedule)
          ? finalizeResult.finalSchedule
          : (latestResult?.previewSchedule || currentScheduleEntries || []),
        loopState: {
          ...loopState,
          fallbackFromStrategy,
        },
        history: finalizeResult.history || steps,
        report: finalizeResult.report || latestResult?.report || null,
        fallbackFromStrategy,
      };
    } catch (error) {
      if (sessionId) {
        try {
          await cancelAiTuningLoop({
            apiBase,
            sessionId,
            timeoutMs,
          });
        } catch {
          // ignore cleanup errors
        }
      }
      if (error && typeof error === 'object') {
        error.latestResult = latestResult;
        error.startResult = startResult;
        error.currentScheduleEntries = currentScheduleEntries;
      }
      throw error;
    }
  };

  try {
    return await runOnce({
      currentReport: report,
      currentReportMarkdown: reportMarkdown,
      currentScheduleEntries: scheduleEntries,
      currentFocusStrategy: normalizedFocusStrategy,
    });
  } catch (error) {
    if (normalizedFocusStrategy !== 'resource_first' || !isTimeoutLikeError(error)) {
      throw error;
    }

    const fallbackSourceResult = error?.latestResult || null;
    const fallbackReport = fallbackSourceResult?.report || report;
    const fallbackScheduleEntries = fallbackSourceResult?.previewSchedule || scheduleEntries;
    const fallbackReportMarkdown = fallbackSourceResult?.reportMarkdown || reportMarkdown;

    return runOnce({
      currentReport: fallbackReport,
      currentReportMarkdown: fallbackReportMarkdown,
      currentScheduleEntries: fallbackScheduleEntries,
      currentFocusStrategy: 'class_first',
      fallbackFromStrategy: 'resource_first',
    });
  }
}
