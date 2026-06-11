/**
 * AI 課表微調回應驗證純函式模組
 *
 * 集中處理 AI 回應內容抽取、JSON 解析、candidateId 驗證與診斷 details 組裝。
 * 供 server.js 與前端共用，確保錯誤分類一致。
 */

/**
 * 從 AI 上游回應中抽取 content, reasoningContent, finishReason
 * 支援 llama.cpp OpenAI-compatible 與多種回傳格式
 */
export function extractAssistantPayload(data) {
  if (!data || typeof data !== 'object') {
    return { content: '', reasoningContent: '', finishReason: '' };
  }

  const message = data?.choices?.[0]?.message;
  const content = message?.content
    ?? data?.choices?.[0]?.text
    ?? data?.message?.content
    ?? data?.message
    ?? data?.output
    ?? data?.content
    ?? data?.response
    ?? data?.rawText
    ?? '';

  return {
    content: String(content || ''),
    reasoningContent: String(
      message?.reasoning_content
      ?? data?.choices?.[0]?.reasoning_content
      ?? ''
    ),
    finishReason: String(data?.choices?.[0]?.finish_reason ?? ''),
  };
}

/**
 * 嘗試解析 AI 回應內容為 JSON
 * 回傳 { ok, value?, code?, error?, preview? }
 */
export function parseAiJsonContent(content) {
  const raw = String(content || '').trim();
  if (!raw) {
    return { ok: false, code: 'AI_UPSTREAM_OUTPUT_EMPTY', error: 'AI 回應為空' };
  }

  // 嘗試直接 parse
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    // 嘗試提取 ```json ... ``` 或 ``` ... ```
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        return { ok: true, value: JSON.parse(codeBlockMatch[1].trim()) };
      } catch {
        // fall through
      }
    }

    // 嘗試找到第一個 { 和最後一個 }
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const extractedJson = raw.slice(firstBrace, lastBrace + 1);
      try {
        return { ok: true, value: JSON.parse(extractedJson) };
      } catch {
        // fall through
      }
    }

    return {
      ok: false,
      code: 'AI_UPSTREAM_INVALID_JSON',
      error: `JSON parse failed at position ${raw.indexOf('?') >= 0 ? raw.indexOf('?') : 'unknown'}`,
      preview: raw.slice(0, 500),
    };
  }
}

/**
 * 建立 candidateMoves 的 byId index
 */
export function buildCandidateMoveIndex(report) {
  const byId = new Map();
  for (const candidate of Array.isArray(report?.candidateMoves) ? report.candidateMoves : []) {
    const candidateId = String(candidate?.candidateId || '').trim();
    if (candidateId) byId.set(candidateId, candidate);
  }
  return { byId };
}

/**
 * 取得報告中所有合法的 candidateId 陣列
 */
export function getReportCandidateIds(report) {
  const { byId } = buildCandidateMoveIndex(report);
  return [...byId.keys()];
}

/**
 * 檢查 prompt 候選池與驗證候選池的一致性。
 * 如果 promptLegalIds 中有 ID 不在 validationPool 裡，表示資料流有誤。
 *
 * @param {string[]} promptLegalIds - 提示詞中注入的 candidateId 列表
 * @param {Object} validationReport - 用於驗證的 report（含 candidateMoves）
 * @returns {{ ok: boolean, missingInValidation: string[], extraInValidation: string[], overlapCount: number }}
 */
export function validateCandidatePoolConsistency(promptLegalIds, validationReport) {
  const promptIds = Array.isArray(promptLegalIds) ? promptLegalIds : [];
  const validationIds = getReportCandidateIds(validationReport);
  const promptSet = new Set(promptIds);
  const validationSet = new Set(validationIds);

  // prompt 中有但 validation pool 沒有 → 資料流錯誤
  const missingInValidation = promptIds.filter((id) => !validationSet.has(id));
  // validation pool 中有但 prompt 沒給 → 不一定有問題（可能是裁剪），僅供診斷
  const extraInValidation = validationIds.filter((id) => !promptSet.has(id));
  const overlapCount = promptIds.filter((id) => validationSet.has(id)).length;

  return {
    ok: missingInValidation.length === 0,
    missingInValidation,
    extraInValidation,
    overlapCount,
    promptCount: promptIds.length,
    validationCount: validationIds.length,
  };
}

/**
 * 驗證 AI 選中的 candidateId 是否在合法候選池中
 * @param {Object} report - 含 candidateMoves 的報告物件
 * @param {Array} selectedMoves - AI 回傳的 selectedMoves 陣列
 * @param {Object} options - { allowPartial: boolean }
 * @returns {Object} { ok, shouldFail, validMoves, errors, invalidIds, legalIds, warning }
 */
export function validateAiCandidateSelections(report, selectedMoves, { allowPartial = true } = {}) {
  const { byId } = buildCandidateMoveIndex(report);
  const errors = [];
  const validMoves = [];
  const seenCandidateIds = new Set();

  for (const move of selectedMoves || []) {
    // 支援多種 candidateId 欄位名稱
    const candidateId = String(
      move?.candidateId ?? move?.id ?? move?.candidate ?? move ?? ''
    ).trim();

    if (!candidateId) {
      errors.push({ move, candidateId: '', reason: '缺少 candidateId' });
      continue;
    }

    const candidate = byId.get(candidateId);
    if (!candidate) {
      errors.push({ move, candidateId, reason: `候選池中找不到 candidateId: ${candidateId}` });
      continue;
    }

    // 去重
    if (seenCandidateIds.has(candidateId)) continue;
    seenCandidateIds.add(candidateId);

    validMoves.push({
      candidateId,
      className: String(candidate.className || '').trim(),
      from: candidate.from,
      to: candidate.to,
      reason: String(move?.reason ?? candidate?.reason ?? '').trim(),
      summaryText: String(candidate?.summaryText ?? '').trim(),
      impactSummary: candidate?.impactSummary ?? null,
    });
  }

  const invalidIds = errors.map((item) => item.candidateId || '?');
  const legalIds = [...byId.keys()];
  const hasOnlyInvalidMoves = errors.length > 0 && validMoves.length === 0;

  return {
    ok: errors.length === 0 || (allowPartial && validMoves.length > 0),
    shouldFail: hasOnlyInvalidMoves,
    validMoves,
    errors,
    invalidIds,
    legalIds,
    warning:
      errors.length > 0 && validMoves.length > 0
        ? `已忽略 ${errors.length} 筆非法 candidateId：${invalidIds.join(', ')}`
        : '',
  };
}

/**
 * 建立 AI 錯誤診斷 details 字串
 */
export function buildAiErrorDetails({
  content = '',
  reasoningContent = '',
  finishReason = '',
  selectedMoves = [],
  invalidIds = [],
  promptLegalIds = [],
  legalIds = [],
  extraInfo = '',
} = {}) {
  const parts = [];

  if (content) {
    parts.push(`content 長度 ${content.length}`);
  } else {
    parts.push('content 為空');
  }

  if (reasoningContent) {
    parts.push(`reasoning_content 長度 ${reasoningContent.length}`);
  }

  if (finishReason) {
    parts.push(`finish_reason=${finishReason}`);
  }

  if (invalidIds.length > 0) {
    parts.push(`無效: ${invalidIds.join(', ')}`);
  }

  if (Array.isArray(selectedMoves) && selectedMoves.length > 0) {
    const selectedPreview = selectedMoves.slice(0, 5).map((move) => {
      const candidateId = String(
        move?.candidateId ?? move?.id ?? move?.candidate ?? move ?? ''
      ).trim() || '?';
      const reason = String(move?.reason ?? '').trim();
      return reason ? `${candidateId}(${reason.slice(0, 60)})` : candidateId;
    });
    parts.push(`AI selectedMoves: ${selectedPreview.join(', ')}${selectedMoves.length > 5 ? ', ...' : ''}`);
  }

  if (promptLegalIds.length > 0) {
    parts.push(`prompt合法候選(${promptLegalIds.length}): ${promptLegalIds.slice(0, 20).join(', ')}${promptLegalIds.length > 20 ? ', ...' : ''}`);
  }

  if (legalIds.length > 0) {
    parts.push(`驗證合法候選(${legalIds.length}): ${legalIds.slice(0, 20).join(', ')}${legalIds.length > 20 ? ', ...' : ''}`);
  }

  if (promptLegalIds.length > 0 && legalIds.length > 0) {
    const validationIdSet = new Set(legalIds);
    const overlapCount = promptLegalIds.filter((id) => validationIdSet.has(id)).length;
    parts.push(`prompt/驗證候選交集: ${overlapCount}/${promptLegalIds.length}`);
  }

  if (extraInfo) {
    parts.push(extraInfo);
  }

  return parts.join(' | ');
}

/**
 * 正規化 AI summary 為可操作格式
 */
export function normalizeActionableSummary(analysis, report) {
  const summary = analysis?.summary;
  if (!summary) {
    return buildFallbackSummary(report);
  }

  // 如果已有 actionableItems，直接回傳
  if (Array.isArray(summary.actionableItems) && summary.actionableItems.length > 0) {
    return {
      text: String(summary.text || ''),
      confidence: summary.confidence ?? 0,
      actionableItems: summary.actionableItems,
    };
  }

  // 否則從 issues 建立 fallback
  return buildFallbackSummary(report);
}

/**
 * 從 report issues 建立 fallback 可操作摘要
 */
function buildFallbackSummary(report) {
  const issues = Array.isArray(report?.issues) ? report.issues : [];
  const actionableItems = issues.slice(0, 3).map((issue) => ({
    className: String(issue?.className || '').trim(),
    day: issue?.day ?? null,
    period: issue?.period ?? null,
    subject: String(issue?.subject || '').trim(),
    location: String(issue?.location || issue?.classroomName || '').trim(),
    problem: String(issue?.type || issue?.message || '').trim(),
    suggestedAction: '檢查專科教室容量、科任科目年級設定與可交換時段',
  }));

  return {
    text: `主要問題：AI 未提供可操作摘要。具體時段：請查看 issues 前 ${Math.min(issues.length, 3)} 筆。建議處理：先檢查專科教室容量、科任科目年級設定與可交換時段。`,
    confidence: 0,
    actionableItems,
  };
}
