const DEFAULT_AI_INFEASIBLE_TIMEOUT_MS = 600000

function isAbortLikeError(error) {
  const message = String(error?.message || '').toLowerCase()
  return Boolean(
    error?.name === 'AbortError'
    || message.includes('aborted without reason')
    || message.includes('this operation was aborted')
    || message.includes('the operation was aborted')
  )
}

function createAiInfeasibleError({ responseStatus = 0, responseData = null, fallbackError = null } = {}) {
  if (fallbackError && typeof fallbackError === 'object' && fallbackError.code) {
    return fallbackError
  }

  const code = responseData?.code || fallbackError?.code || (isAbortLikeError(fallbackError) ? 'upstream_timeout' : 'unknown_error')
  const message = responseData?.error
    || fallbackError?.message
    || 'AI infeasible analysis 請求失敗'

  const error = new Error(message)
  error.code = code
  error.responseStatus = responseStatus
  error.responseData = responseData
  return error
}

async function parseResponseBody(response) {
  const responseText = await response.text()
  if (!responseText) {
    return { responseText, data: {} }
  }

  try {
    return { responseText, data: JSON.parse(responseText) }
  } catch {
    return { responseText, data: { rawText: responseText } }
  }
}

export async function runAiInfeasibleAnalysis({
  apiBase,
  jobId,
  bundle,
  connectionSettings,
  maxPromptChars = 120000,
  timeoutMs = DEFAULT_AI_INFEASIBLE_TIMEOUT_MS,
} = {}) {
  if (!apiBase) {
    throw createAiInfeasibleError({
      responseStatus: 400,
      responseData: { code: 'settings_missing', error: 'AI API 基底網址尚未設定' },
    })
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let response
  try {
    response = await fetch(`${apiBase}/ai-infeasible-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jobId,
        bundle,
        connectionSettings,
        maxPromptChars,
      }),
    })
  } catch (error) {
    clearTimeout(timeoutId)
    throw createAiInfeasibleError({ fallbackError: error })
  }

  clearTimeout(timeoutId)
  const { responseText, data } = await parseResponseBody(response)

  if (!response.ok) {
    throw createAiInfeasibleError({
      responseStatus: response.status,
      responseData: data,
      fallbackError: new Error(responseText || `HTTP ${response.status}`),
    })
  }

  return {
    responseText,
    responseData: data,
    analysis: data.analysis || null,
    bundle: data.bundle || null,
    promptBudget: data.promptBudget || null,
  }
}
