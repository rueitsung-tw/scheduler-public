import { hasLocatableInfeasibleCandidate } from './aiInfeasibleAnalysisBundle.js'

const DEFAULT_MAX_PROMPT_CHARS = 120000

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim()
}

function collectReferencedClassNames(lines = []) {
  const names = new Set()
  const pattern = /(\d+年\d+班)/g
  ;(Array.isArray(lines) ? lines : []).forEach((line) => {
    const text = normalizeText(line)
    let match = pattern.exec(text)
    while (match) {
      names.add(match[1])
      match = pattern.exec(text)
    }
    pattern.lastIndex = 0
  })
  return Array.from(names)
}

function buildPayloadFocus(bundle = {}) {
  const payload = bundle?.payload && typeof bundle.payload === 'object' ? bundle.payload : {}
  const schoolInfo = payload.schoolInfo || {}
  const classes = Array.isArray(payload.classes) ? payload.classes : []
  const teachers = Array.isArray(payload.teachers) ? payload.teachers : []
  const classrooms = Array.isArray(payload.classrooms) ? payload.classrooms : []
  const referencedClassNames = collectReferencedClassNames([
    ...(Array.isArray(bundle.reportWarningLines) ? bundle.reportWarningLines : []),
    ...(Array.isArray(bundle.diagnosticWarnings) ? bundle.diagnosticWarnings.map((item) => item?.displayText || item?.message || '') : []),
  ])

  const referencedClasses = classes
    .filter((cls) => referencedClassNames.includes(String(cls?.name || '').trim()))
    .slice(0, 12)
    .map((cls) => ({
      name: cls?.name || '',
      grade: cls?.grade ?? null,
      courseRequirementCount: Array.isArray(cls?.course_requirements) ? cls.course_requirements.length : 0,
      courseRequirements: Array.isArray(cls?.course_requirements) ? cls.course_requirements : [],
    }))

  return {
    schoolInfo,
    referencedClassNames,
    referencedClasses,
    teacherCount: teachers.length,
    classroomCount: classrooms.length,
  }
}

export function buildPromptPayload(bundle = {}, maxPromptChars = DEFAULT_MAX_PROMPT_CHARS) {
  const resolvedStatusDetail = bundle.statusDetail !== undefined
    ? bundle.statusDetail
    : (bundle.promptInput?.evidenceSummary?.statusDetail ?? null)

  const resolvedErrorCodes = Array.isArray(bundle.errorCodes)
    ? bundle.errorCodes
    : (Array.isArray(bundle.promptInput?.evidenceSummary?.errorCodes)
        ? bundle.promptInput.evidenceSummary.errorCodes
        : [])

  const resolvedGradeTimeRuleIssues = Array.isArray(bundle.gradeTimeRuleIssues)
    ? bundle.gradeTimeRuleIssues
    : (Array.isArray(bundle.promptInput?.evidenceSummary?.gradeTimeRuleIssues)
        ? bundle.promptInput.evidenceSummary.gradeTimeRuleIssues
        : [])

  const resolvedErrorCodeIndex = Array.isArray(bundle.errorCodeIndex)
    ? bundle.errorCodeIndex
    : (Array.isArray(bundle.promptInput?.evidenceSummary?.errorCodeIndex)
        ? bundle.promptInput.evidenceSummary.errorCodeIndex
        : [])

  const resolvedValidationReport = bundle.validationReport !== undefined
    ? bundle.validationReport
    : (bundle.promptInput?.evidenceSummary?.validationReport ?? null)

  const resolvedValidationReportSource = resolvedValidationReport
    ? (bundle.validationReportSource
        || bundle.promptInput?.evidenceSummary?.validationReportSource
        || '未確認')
    : null

  const fullPayload = {
    bundleVersion: bundle.bundleVersion || '',
    generatedAt: bundle.generatedAt || '',
    kind: bundle.kind || '',
    job: bundle.job || {},
    statusDetail: resolvedStatusDetail,
    errorCodes: resolvedErrorCodes,
    gradeTimeRuleIssues: resolvedGradeTimeRuleIssues,
    errorCodeIndex: resolvedErrorCodeIndex,
    validationReport: resolvedValidationReport,
    validationReportSource: resolvedValidationReportSource,
    promptInput: bundle.promptInput || {},
    reportWarningLines: Array.isArray(bundle.reportWarningLines) ? bundle.reportWarningLines : [],
    diagnosticWarnings: Array.isArray(bundle.diagnosticWarnings) ? bundle.diagnosticWarnings : [],
    payloadSummary: bundle.payloadSummary || {},
    diagnosticSummary: bundle.diagnosticSummary || {},
    reportText: bundle.reportText || '',
    payload: bundle.payload || null,
    diagnosticJson: bundle.diagnosticJson || null,
    analysisContract: bundle.analysisContract || {},
  }

  const serializedFull = JSON.stringify(fullPayload, null, 2)
  if (serializedFull.length <= maxPromptChars) {
    return {
      payload: fullPayload,
      serialized: serializedFull,
      truncated: false,
      estimatedChars: serializedFull.length,
      maxPromptChars,
    }
  }

  const reducedPayload = {
    bundleVersion: fullPayload.bundleVersion,
    generatedAt: fullPayload.generatedAt,
    kind: fullPayload.kind,
    job: fullPayload.job,
    statusDetail: fullPayload.statusDetail,
    errorCodes: fullPayload.errorCodes,
    gradeTimeRuleIssues: fullPayload.gradeTimeRuleIssues,
    errorCodeIndex: fullPayload.errorCodeIndex,
    validationReport: fullPayload.validationReport,
    validationReportSource: fullPayload.validationReportSource,
    promptInput: fullPayload.promptInput,
    reportWarningLines: fullPayload.reportWarningLines.slice(0, 40),
    diagnosticWarnings: fullPayload.diagnosticWarnings.slice(0, 24),
    payloadSummary: fullPayload.payloadSummary,
    diagnosticSummary: fullPayload.diagnosticSummary,
    reportTextExcerpt: String(fullPayload.reportText || '').slice(0, 20000),
    payloadFocus: buildPayloadFocus(bundle),
    diagnosticJson: fullPayload.diagnosticJson,
    analysisContract: fullPayload.analysisContract,
    truncationNotice: '完整 bundle 超過 prompt 預算，已保留高訊號摘要、報告警示、相關班級 payload 片段與診斷摘要。',
  }

  const serializedReduced = JSON.stringify(reducedPayload, null, 2)
  return {
    payload: reducedPayload,
    serialized: serializedReduced,
    truncated: true,
    estimatedChars: serializedReduced.length,
    maxPromptChars,
  }
}

export function buildAiInfeasibleAnalysisSystemPrompt(bundle = {}, { baseSystemPrompt = '' } = {}) {
  const solverStatus = bundle?.job?.solverStatus || 'ERROR'
  const errorCodes = Array.isArray(bundle?.errorCodes) ? bundle.errorCodes : []
  const isTrustedInfeasibleWithEvidence = hasLocatableInfeasibleCandidate(solverStatus, errorCodes)

  const lines = []
  if (baseSystemPrompt) {
    lines.push(baseSystemPrompt)
  }

  lines.push('你是排課引擎診斷分析器，請只回傳 JSON。')

  if (isTrustedInfeasibleWithEvidence) {
    lines.push(
      '目前排課狀態為 INFEASIBLE。你的任務是根據 bundle 中已觀察到的候選警示、payload 與診斷證據，找出最值得優先排查的衝突原因，並提出可執行的修復建議。',
      '不要只重述所有警示，要排序並指出最值得先修的問題。',
      '遵守 confidence/source 上限：標註 possible 者不得宣稱已確認根因；來源為 report_file/shared_file 需保留來源可能未確認的界線；server_fallback 僅為通用提示，不得當作根因線索。',
      'rootCauses[].category 維持描述衝突類型（自由文字），不得以錯誤碼取代；錯誤碼僅能於 evidence 中引用。',
      '嚴格遵守 user prompt 中提供的 schema 與規則。'
    )
  } else {
    lines.push(
      `目前排課狀態為 ${solverStatus}，且無已確認的硬衝突子因。不得無條件將其視為 INFEASIBLE 硬衝突，亦不得編造子因或要求硬衝突根因。`,
      '狀態代碼（如 statusDetail）代表執行狀態，不是子因；不得把「執行失敗」寫成根因。',
      '若無可定位子因，必須輸出合法 unknown/low 佔位（summary.primaryCategory="unknown"、confidence="low"，並說明尚無可定位根因）。',
      '嚴格遵守 user prompt 中提供的 schema 與規則。'
    )
  }

  return lines.join('\n\n')
}

export function buildAiInfeasibleAnalysisPrompt(bundle = {}, { maxPromptChars = DEFAULT_MAX_PROMPT_CHARS } = {}) {
  const promptPayload = buildPromptPayload(bundle, maxPromptChars)
  const solverStatus = bundle?.job?.solverStatus || 'ERROR'
  const errorCodes = Array.isArray(bundle?.errorCodes) ? bundle.errorCodes : []
  const isTrustedInfeasibleWithEvidence = hasLocatableInfeasibleCandidate(solverStatus, errorCodes)

  const schemaExample = isTrustedInfeasibleWithEvidence ? {
    summary: {
      text: '高年級交替課與單一超額班級一起造成模型無解。',
      confidence: 'high',
      primaryCategory: 'class_overload',
      nextStep: '先修正 某班 總節數，再重跑並檢查交替課衝突是否仍存在。',
    },
    rootCauses: [
      {
        category: 'class_overload',
        confidence: 'high',
        message: '某班 需排節數超過該年級上限。',
        evidence: ['report: 某班 30 > 29', 'payload: 某班 course requirements summary'],
      },
    ],
    recommendations: [
      {
        priority: 'high',
        action: '先將超額班級的課程需求降回年級上限內。',
        rationale: '只要班級總節數先硬超上限，後續所有排程修補都無法成功。',
      },
    ],
    evidence: [
      {
        source: 'errorCodeIndex',
        detail: 'SCHE_VAL_ROOM_OVERLOAD: 某班 總節數超過可用上限',
      },
    ],
  } : {
    summary: { text: '尚無可定位根因。', confidence: 'low', primaryCategory: 'unknown', nextStep: '檢查本次錯誤紀錄。' },
    rootCauses: [{ category: 'unknown', confidence: 'low', message: '尚無可定位根因。', evidence: ['現有狀態與診斷紀錄'] }],
    recommendations: [{ priority: 'low', action: '檢查本次錯誤紀錄。', rationale: '目前沒有可定位子因證據。' }],
    evidence: [{ source: 'analysisContract', detail: '此示例只示範未定位回應，實際證據須引用現有資料。' }],
  }

  const taskDescription = isTrustedInfeasibleWithEvidence
    ? `請分析這份排課診斷 bundle（狀態：${solverStatus}），根據已觀察到的候選警示、payload 與診斷證據，排序並指出最值得優先排查的衝突原因，並提出可執行的修復建議。`
    : `請分析這份排課診斷 bundle（狀態：${solverStatus}），檢視目前執行狀態與診斷紀錄，並提出可執行的排查建議。`

  const conflictRule = isTrustedInfeasibleWithEvidence
    ? '8. 依據證據排序值得排查的候選衝突，不要只是重述所有警示。'
    : `8. 本任務狀態為 ${solverStatus} 或無候選子因代碼，不得要求硬衝突根因或編造子因，請如實依可信證據與狀態呈現。`

  const rules = [
    '1. confidence 只能是 low / medium / high。',
    '2. priority 只能是 low / medium / high。',
    '3. rootCauses、recommendations、evidence 都必須是陣列，且至少各有 1 筆。',
    '4. rootCauses[].category 繼續描述衝突類型（自由文字，例如 class_overload 或中文描述），不得以錯誤碼取代 category。狀態代碼是執行狀態，不是子因。',
    '5. 若 bundle.errorCodes 提供代碼，錯誤碼只能於 evidence 中引用穩定 code 與摘要（例如：{ "source": "errorCodeIndex", "detail": "SCHE_WARN_PERIOD_SHORTAGE: <userMessage>" }）。',
    '6. confidence 措辭不得高於 bundle evidence 標註：標 possible 者不得宣稱為確定根因；unknown 或來源未確認者不得升級為確定原因；source 為 report_file/shared_file 者須註明「來源可能未確認」；source 為 server_fallback 者為 server 產生的通用提示，不得當成根因線索。',
    '7. 若 bundle.errorCodes 為空或無可定位子成因，不得編造子因；legacy 缺欄位不能被解讀為已證明無根因。此時必須依規定輸出合法 unknown/low 佔位：summary.primaryCategory="unknown"、confidence="low"，並說明尚無可定位根因；不得將「執行失敗」寫成根因，亦不得捏造 statusDetail、代碼、來源或報告。',
    conflictRule,
  ]

  const userPrompt = [
    taskDescription,
    '只允許輸出 JSON，不要輸出 Markdown、說明文字或 reasoning。',
    '請完全符合以下 schema：',
    JSON.stringify(schemaExample, null, 2),
    '規則：',
    rules.join('\n'),
    '以下是 bundle JSON：',
    promptPayload.serialized,
  ].join('\n\n')

  return {
    userPrompt,
    promptBudget: {
      estimatedChars: promptPayload.estimatedChars,
      maxPromptChars: promptPayload.maxPromptChars,
      truncated: promptPayload.truncated,
      withinBudget: promptPayload.estimatedChars <= promptPayload.maxPromptChars,
    },
    promptPayload: promptPayload.payload,
  }
}

function normalizeConfidence(value, fallback = 'medium') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : fallback
}

function normalizePriority(value, fallback = 'medium') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : fallback
}

function normalizeStringArray(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => normalizeText(item))
    .filter(Boolean)
}

export function validateAiInfeasibleAnalysisResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI infeasible analysis 回應不是物件')
  }

  const rootCauses = (Array.isArray(parsed.rootCauses) ? parsed.rootCauses : [])
    .map((item) => {
      const message = normalizeText(item?.message)
      if (!message) return null
      return {
        category: normalizeText(item?.category) || 'generic_infeasible',
        confidence: normalizeConfidence(item?.confidence, 'medium'),
        message,
        evidence: normalizeStringArray(item?.evidence),
      }
    })
    .filter(Boolean)

  const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
    .map((item) => {
      const action = normalizeText(item?.action)
      if (!action) return null
      return {
        priority: normalizePriority(item?.priority, 'medium'),
        action,
        rationale: normalizeText(item?.rationale),
      }
    })
    .filter(Boolean)

  const evidence = (Array.isArray(parsed.evidence) ? parsed.evidence : [])
    .map((item) => {
      const detail = normalizeText(item?.detail)
      if (!detail) return null
      return {
        source: normalizeText(item?.source) || 'unknown',
        detail,
      }
    })
    .filter(Boolean)

  if (rootCauses.length === 0) {
    throw new Error('AI infeasible analysis 缺少 rootCauses')
  }
  if (recommendations.length === 0) {
    throw new Error('AI infeasible analysis 缺少 recommendations')
  }
  if (evidence.length === 0) {
    throw new Error('AI infeasible analysis 缺少 evidence')
  }

  const firstCause = rootCauses[0]
  const firstRecommendation = recommendations[0]
  const summaryInput = parsed.summary && typeof parsed.summary === 'object' ? parsed.summary : {}
  const summary = {
    text: normalizeText(summaryInput.text) || firstCause.message,
    confidence: normalizeConfidence(summaryInput.confidence, firstCause.confidence),
    primaryCategory: normalizeText(summaryInput.primaryCategory) || firstCause.category,
    nextStep: normalizeText(summaryInput.nextStep) || firstRecommendation.action,
  }

  return {
    summary,
    rootCauses,
    recommendations,
    evidence,
  }
}
