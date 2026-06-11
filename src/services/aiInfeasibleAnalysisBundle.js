const BUNDLE_VERSION = '0.1.0'

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim()
}

function normalizeDiagnosticWarning(item) {
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
  }
}

function normalizeDiagnosticWarnings(input) {
  if (!Array.isArray(input)) return []

  const seen = new Set()
  return input
    .map((item) => normalizeDiagnosticWarning(item))
    .filter((item) => {
      if (!item) return false
      const key = `${item.level}|${item.category}|${item.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
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

function buildAnalysisContract() {
  return {
    expectedOutputSchema: {
      rootCauses: [
        {
          category: 'class_overload',
          confidence: 'high',
          message: '3年5班總節數超過年級上限',
          evidence: ['report warning line', 'payload summary'],
        },
      ],
      recommendations: [
        '先修正超額班級的課程需求，再重新檢查交替課與專科資源衝突。',
      ],
      evidence: [
        'debug_infeasible_report.txt warning lines',
        'debug_payload.json summary',
        'diagnostic json summary',
      ],
    },
    guidance: [
      '優先找出造成 INFEASIBLE 的硬衝突，不要只重述所有警示。',
      '若證據不足，必須明確標註 low confidence，而不是過度推論。',
      '建議應可直接轉成排課設定修正或資料修補動作。',
    ],
  }
}

export function buildInfeasibleAnalysisBundle({
  jobId = '',
  jobStatus = 'FAILED',
  solverStatus = 'INFEASIBLE',
  error = '',
  reportText = '',
  diagnosticWarnings = [],
  payload = null,
  diagnosticJson = null,
  artifactPaths = {},
  generatedAt = new Date().toISOString(),
} = {}) {
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
      objective: '分析排課引擎為何出現 INFEASIBLE，並提出可執行的修復建議。',
      evidenceSummary: {
        reportWarningLines,
        diagnosticWarnings: normalizedWarnings.map((item) => ({
          level: item.level,
          category: item.category,
          message: item.message,
        })),
        payloadSummary,
        diagnosticSummary,
      },
    },
    analysisContract: buildAnalysisContract(),
  }
}
