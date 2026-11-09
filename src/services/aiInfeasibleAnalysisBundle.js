import schedulerCodes from '../../contracts/scheduler_error_codes.json' with { type: 'json' }
import gtrPresentations from '../../contracts/grade_time_rule_issue_presentations.json' with { type: 'json' }

const BUNDLE_VERSION = '0.1.0'
const candidateCodes = new Set([
  ...schedulerCodes.codes.filter((item) => ['input', 'validation', 'warning'].includes(item.category) && item.confidence !== 'unknown' && !item.reserved).map((item) => item.code),
  ...Object.keys(gtrPresentations.presentations),
])

export function hasLocatableInfeasibleCandidate(solverStatus, errorCodes) {
  return solverStatus === 'INFEASIBLE' && Array.isArray(errorCodes) && errorCodes.some((item) => (
    candidateCodes.has(item?.code)
    && ['determined', 'possible'].includes(item.confidence)
    && ['job_output', 'report_file', 'shared_file'].includes(item.source)
    && item.sourceRef && !['unknown', 'fallback'].includes(item.sourceRef.kind)
    && typeof item.sourceRef.kind === 'string' && item.sourceRef.kind.trim()
    && Number.isInteger(item.sourceRef.index) && item.sourceRef.index >= 0
    && Array.isArray(item.evidence) && item.evidence.some((evidence) => typeof evidence === 'string' && evidence.trim())
  ))
}

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim()
}

export function normalizeDiagnosticWarning(item) {
  if (!item) return null

  if (typeof item === 'string') {
    const message = normalizeText(item)
    if (!message) return null
    const levelMatch = message.match(/^\[(WARN|ERROR|ALERT)\]/i)
    const level = levelMatch ? levelMatch[1].toLowerCase() : 'warn'
    return {
      level,
      category: 'generic_warning',
      message: message.replace(/^\[(WARN|ERROR|ALERT)\]\s*/i, '').trim() || message,
      displayText: message,
    }
  }

  if (typeof item !== 'object') return null

  const message = normalizeText(item.message)
  if (!message) return null

  const level = String(item.level || 'warn').trim().toLowerCase() || 'warn'
  const category = String(item.category || 'generic_warning').trim() || 'generic_warning'
  const displayText = normalizeText(item.displayText || `[${level.toUpperCase()}] ${message}`)

  return {
    level,
    category,
    message,
    displayText,
    rawLine: normalizeText(item.rawLine),
    contextLine: normalizeText(item.contextLine),
    ...(item.code ? { code: normalizeText(item.code) } : {}),
    ...(item.source ? { source: normalizeText(item.source) } : {}),
    ...(item.sourceRef ? { sourceRef: item.sourceRef } : {}),
  }
}

export function normalizeDiagnosticWarnings(input) {
  if (!Array.isArray(input)) return []

  const seen = new Set()
  return input
    .map((item) => normalizeDiagnosticWarning(item))
    .filter((item) => {
      if (!item) return false
      const key = `${item.level}|${item.category}|${item.message}|${item.code || ''}|${item.source || ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function normalizeErrorCodeItem(item) {
  if (!item || typeof item !== 'object') return null
  const code = String(item.code || '').trim()
  if (!code) return null
  return {
    ...item,
    code,
    severity: String(item.severity || 'warning'),
    confidence: String(item.confidence || 'unknown'),
    source: item.source !== undefined ? item.source : null,
    sourceRef: item.sourceRef !== undefined ? item.sourceRef : null,
    userMessage: String(item.userMessage || item.message || ''),
    nextSteps: Array.isArray(item.nextSteps) ? item.nextSteps : [],
    evidence: Array.isArray(item.evidence) ? item.evidence : [],
  }
}

export function buildErrorCodeIndex(errorCodes = []) {
  if (!Array.isArray(errorCodes) || errorCodes.length === 0) {
    return []
  }

  const index = []
  for (const rawItem of errorCodes) {
    const item = normalizeErrorCodeItem(rawItem)
    if (!item) continue
    index.push({
      code: item.code,
      severity: item.severity,
      confidence: item.confidence,
      source: item.source,
      sourceRef: item.sourceRef,
      userMessage: item.userMessage,
      nextSteps: item.nextSteps,
      evidence: item.evidence,
    })
  }
  return index
}

function extractReportWarningLines(reportText) {
  return String(reportText || '')
    .split('\n')
    .map((line) => normalizeText(line))
    .filter((line) => (
      line
      && (
        /\[(WARN|ERROR|ALERT)\]/i.test(line)
        || line.includes('⚠️')
        || line.includes('❌')
        || line.includes('🚨')
      )
    ))
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      available: false,
      totalClasses: 0,
      totalTeachers: 0,
      totalClassrooms: 0,
      totalCourseRequirements: 0,
      gradeSettings: {},
      alternativeRuleCount: 0,
    }
  }

  const classes = Array.isArray(payload.classes) ? payload.classes : []
  const teachers = Array.isArray(payload.teachers) ? payload.teachers : []
  const classrooms = Array.isArray(payload.classrooms) ? payload.classrooms : []
  const schoolInfo = payload.schoolInfo || {}
  const gradeSettings = schoolInfo.gradeSettings && typeof schoolInfo.gradeSettings === 'object'
    ? schoolInfo.gradeSettings
    : {}
  const alternativeMatrix = schoolInfo.alternativeMatrix && typeof schoolInfo.alternativeMatrix === 'object'
    ? schoolInfo.alternativeMatrix
    : {}

  let totalCourseRequirements = 0
  classes.forEach((cls) => {
    if (Array.isArray(cls?.course_requirements)) {
      totalCourseRequirements += cls.course_requirements.length
    }
  })

  let alternativeRuleCount = 0
  Object.values(alternativeMatrix).forEach((items) => {
    if (Array.isArray(items)) alternativeRuleCount += items.length
  })

  return {
    available: true,
    totalClasses: classes.length,
    totalTeachers: teachers.length,
    totalClassrooms: classrooms.length,
    totalCourseRequirements,
    gradeSettings,
    alternativeRuleCount,
  }
}

function summarizeDiagnosticJson(diagnosticJson) {
  if (!diagnosticJson || typeof diagnosticJson !== 'object') {
    return {
      available: false,
    }
  }

  return {
    available: true,
    status: diagnosticJson.status || '',
    jobId: diagnosticJson.jobId || '',
    solverStatus: diagnosticJson.solverStatus || '',
    recommendation: diagnosticJson.recommendation || '',
    reportWarningCount: Number(diagnosticJson.reportWarningCount || 0),
    preRepairCapacityOverloadCount: diagnosticJson.preRepair?.capacityOverloadCount ?? null,
    postRepairCapacityOverloadCount: diagnosticJson.postRepair?.capacityOverloadCount ?? null,
    capacityOverloadDiff: diagnosticJson.delta?.capacityOverloadDiff ?? null,
  }
}

function buildAnalysisContract(hasCandidate, extra = {}) {
  return {
    expectedOutputSchema: {
      rootCauses: hasCandidate ? [
        {
          category: 'class_overload',
          confidence: 'high',
          message: '某班需排節數超過該年級上限',
          evidence: ['report warning line', 'payload summary'],
        },
      ] : [{ category: 'unknown', confidence: 'low', message: '尚無可定位根因。', evidence: ['現有狀態與診斷紀錄'] }],
      recommendations: hasCandidate ? [
        '先修正超額班級的課程需求，再重新檢查交替課與專科資源衝突。',
      ] : ['檢查本次錯誤紀錄。'],
      evidence: [
        'debug_infeasible_report.txt warning lines',
        'debug_payload.json summary',
        'diagnostic json summary',
      ],
    },
    guidance: [
      hasCandidate ? '依據候選證據排序值得排查的衝突，不要只重述所有警示。' : '尚無可定位子因時，以 unknown/low 呈現，不得編造根因。',
      '若證據不足，必須明確標註 low confidence，而不是過度推論。',
      '建議應可直接轉成排課設定修正或資料修補動作。',
    ],
    ...extra,
  }
}

export function buildInfeasibleAnalysisBundle(options = {}) {
  const {
    jobId = '',
    jobStatus = 'FAILED',
    solverStatus = 'INFEASIBLE',
    error = '',
    statusDetail = undefined,
    errorCodes = undefined,
    gradeTimeRuleIssues = undefined,
    validationReport = undefined,
    validationReportSource = undefined,
    reportText = '',
    diagnosticWarnings = [],
    payload = null,
    diagnosticJson = null,
    artifactPaths = {},
    analysisContract = null,
    generatedAt = new Date().toISOString(),
  } = options

  const hasErrorCodesInOptions = Object.prototype.hasOwnProperty.call(options, 'errorCodes') && options.errorCodes !== undefined
  const hasErrorCodesInDiagJson = Boolean(
    diagnosticJson
    && typeof diagnosticJson === 'object'
    && Object.prototype.hasOwnProperty.call(diagnosticJson, 'errorCodes')
    && diagnosticJson.errorCodes !== undefined
  )
  const originalErrorCodesPresent = hasErrorCodesInOptions || hasErrorCodesInDiagJson
  const errorCodeEvidenceState = originalErrorCodesPresent ? 'structured' : 'legacy_missing'

  const rawErrorCodes = hasErrorCodesInOptions
    ? errorCodes
    : (hasErrorCodesInDiagJson ? diagnosticJson.errorCodes : undefined)

  const normalizedErrorCodes = Array.isArray(rawErrorCodes)
    ? rawErrorCodes.map(normalizeErrorCodeItem).filter(Boolean)
    : []

  const errorCodeIndex = normalizedErrorCodes.length > 0
    ? buildErrorCodeIndex(normalizedErrorCodes)
    : []
  const hasCandidate = hasLocatableInfeasibleCandidate(solverStatus, normalizedErrorCodes)

  const rawStatusDetail = statusDetail !== undefined
    ? statusDetail
    : (diagnosticJson?.statusDetail ?? null)
  const resolvedStatusDetail = rawStatusDetail ?? null

  const rawGtrIssues = gradeTimeRuleIssues !== undefined
    ? gradeTimeRuleIssues
    : (diagnosticJson?.gradeTimeRuleIssues ?? [])
  const resolvedGradeTimeRuleIssues = Array.isArray(rawGtrIssues) ? rawGtrIssues : []

  const resolvedValidationReport = validationReport !== undefined
    ? validationReport
    : (diagnosticJson?.validationReport ?? null)

  let resolvedValidationReportSource = null
  if (resolvedValidationReport) {
    const rawSource = validationReportSource !== undefined
      ? validationReportSource
      : (diagnosticJson?.validationReportSource ?? null)
    resolvedValidationReportSource = rawSource || '未確認'
  }

  const finalAnalysisContract = {
    ...buildAnalysisContract(hasCandidate),
    ...(analysisContract || {}),
    errorCodeEvidenceState: analysisContract?.errorCodeEvidenceState || errorCodeEvidenceState,
  }

  const normalizedWarnings = normalizeDiagnosticWarnings(diagnosticWarnings)
  const reportWarningLines = extractReportWarningLines(reportText)
  const payloadSummary = summarizePayload(payload)
  const diagnosticSummary = summarizeDiagnosticJson(diagnosticJson)

  return {
    bundleVersion: BUNDLE_VERSION,
    generatedAt,
    kind: 'infeasible_analysis',
    job: {
      jobId,
      jobStatus,
      solverStatus,
      error: normalizeText(error),
    },
    statusDetail: resolvedStatusDetail,
    errorCodes: normalizedErrorCodes,
    gradeTimeRuleIssues: resolvedGradeTimeRuleIssues,
    errorCodeIndex,
    validationReport: resolvedValidationReport,
    validationReportSource: resolvedValidationReportSource,
    artifacts: {
      report: {
        available: Boolean(normalizeText(reportText)),
        path: artifactPaths.reportPath || '',
        warningCount: reportWarningLines.length,
      },
      payload: {
        available: Boolean(payload),
        path: artifactPaths.payloadPath || '',
      },
      diagnosticJson: {
        available: Boolean(diagnosticJson),
        path: artifactPaths.diagnosticJsonPath || '',
      },
    },
    reportText: String(reportText || ''),
    reportWarningLines,
    diagnosticWarnings: normalizedWarnings,
    payload,
    payloadSummary,
    diagnosticJson,
    diagnosticSummary,
    promptInput: {
      objective: hasCandidate ? '依據已觀察的候選證據分析衝突，並提出可執行的排查建議。' : '檢視排課狀態及實有證據，並提出可執行的排查建議。',
      evidenceSummary: {
        statusDetail: resolvedStatusDetail,
        errorCodes: normalizedErrorCodes,
        gradeTimeRuleIssues: resolvedGradeTimeRuleIssues,
        errorCodeIndex,
        validationReport: resolvedValidationReport,
        validationReportSource: resolvedValidationReportSource,
        reportWarningLines,
        diagnosticWarnings: normalizedWarnings.map((item) => ({
          level: item.level,
          category: item.category,
          message: item.message,
          ...(item.code ? { code: item.code } : {}),
          ...(item.source ? { source: item.source } : {}),
          ...(item.sourceRef ? { sourceRef: item.sourceRef } : {}),
        })),
        payloadSummary,
        diagnosticSummary,
      },
    },
    analysisContract: finalAnalysisContract,
  }
}
