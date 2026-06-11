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

function buildPromptPayload(bundle = {}, maxPromptChars = DEFAULT_MAX_PROMPT_CHARS) {
  const fullPayload = {
    bundleVersion: bundle.bundleVersion || '',
    generatedAt: bundle.generatedAt || '',
    kind: bundle.kind || '',
    job: bundle.job || {},
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

export function buildAiInfeasibleAnalysisPrompt(bundle = {}, { maxPromptChars = DEFAULT_MAX_PROMPT_CHARS } = {}) {
  const promptPayload = buildPromptPayload(bundle, maxPromptChars)
  const schemaExample = {
    summary: {
      text: '高年級交替課與單一超額班級一起造成模型無解。',
      confidence: 'high',
      primaryCategory: 'class_overload',
      nextStep: '先修正 3年5班總節數，再重跑並檢查交替課衝突是否仍存在。',
    },
    rootCauses: [
      {
        category: 'class_overload',
        confidence: 'high',
        message: '3年5班需排節數超過該年級上限。',
        evidence: ['report: 3年5班 30 > 29', 'payload: 3年5班 course requirements summary'],
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
        source: 'debug_infeasible_report.txt',
        detail: '3年5班: 共需排 30 節課 (該年級上限: 29 節) [ERROR]',
      },
    ],
  }

  const userPrompt = [
    '請分析這份排課 INFEASIBLE bundle，找出最可能的根因並提出可執行修復建議。',
    '只允許輸出 JSON，不要輸出 Markdown、說明文字或 reasoning。',
    '請完全符合以下 schema：',
    JSON.stringify(schemaExample, null, 2),
    '規則：',
    '1. confidence 只能是 low / medium / high。',
    '2. priority 只能是 low / medium / high。',
    '3. rootCauses、recommendations、evidence 都必須是陣列，且至少各有 1 筆。',
    '4. 若證據不足，不可假裝確定，必須在 confidence 標 low 或 medium。',
    '5. 優先指出真正造成 INFEASIBLE 的硬衝突，不要只是重述所有警示。',
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
