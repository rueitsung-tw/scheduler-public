/**
 * AI 微調預送出封包產生器
 *
 * 在不送出任何請求的情況下，產出一份與實際 request body 完全一致的 JSON 封包。
 * 用於除錯、驗證和手動回放。
 */

import { buildScheduleAiReport } from '../utils/scheduleAiReport.js';
import {
  buildAiTuningPromptBundle,
  selectAiTuningFocusPreview,
} from './aiTuningPrompt.js';

const BUNDLE_VERSION = '1.0.0';
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/**
 * AI_TUNING_PROMPT_LIMITS — 與 ScheduleView.vue 保持一致
 */
const AI_TUNING_PROMPT_LIMITS = {
  resource_first: 60000,
  class_first: 40000,
};

function getAiTuningPromptMaxChars(focusStrategy) {
  return (
    AI_TUNING_PROMPT_LIMITS[String(focusStrategy || '').trim()] ||
    AI_TUNING_PROMPT_LIMITS.resource_first
  );
}

/**
 * 計算來源資料摘要
 */
export function computeSourceSummary(scheduleContext) {
  const classes = scheduleContext?.classes || [];
  const teachers = scheduleContext?.teachers || [];
  const classrooms = scheduleContext?.classrooms || [];
  const constraints = [];

  // 從 classes 的 course_requirements 統計約束數
  classes.forEach((cls) => {
    if (Array.isArray(cls.course_requirements)) {
      constraints.push(...cls.course_requirements);
    }
  });

  return {
    totalClasses: classes.length,
    totalTeachers: teachers.length,
    totalResources: classrooms.length,
    totalConstraints: constraints.length,
    phase1Complete: !!scheduleContext?.engineMeta?.jobId,
  };
}

/**
 * 一致性驗證：檢查封包內部欄位是否自洽
 */
export function validateBundleConsistency(bundle) {
  const checks = [];

  // 1. tuningContext.promptMarkdown / request.body.promptMarkdown 與頂層 promptMarkdown 一致
  if (bundle.request?.body && bundle.promptMarkdown !== undefined) {
    const bodyVal =
      bundle.request.body?.tuningContext?.promptMarkdown
      ?? bundle.request.body.promptMarkdown
      ?? bundle.request.body.reportMarkdown;
    checks.push([
      bodyVal === bundle.promptMarkdown,
      'request.body.promptMarkdown ≠ top-level promptMarkdown',
    ]);
  }

  // 2. focusStrategy 為合法值
  const validStrategies = ['resource_first', 'class_first'];
  if (bundle.focusStrategy !== undefined) {
    checks.push([
      validStrategies.includes(bundle.focusStrategy),
      `Invalid focusStrategy: ${bundle.focusStrategy}`,
    ]);
  }

  // 3. generatedAt 存在且可解析
  if (bundle.generatedAt) {
    checks.push([
      !isNaN(Date.parse(bundle.generatedAt)),
      'Invalid generatedAt timestamp',
    ]);
  }

  // 4. bundleVersion 存在
  checks.push([
    typeof bundle.bundleVersion === 'string' && bundle.bundleVersion.length > 0,
    'Missing or empty bundleVersion',
  ]);

  // 5. connectionSettings 在頂層與 request.body 一致
  const topCs = bundle.connectionSettings;
  const bodyCs = bundle.request?.body?.connectionSettings;
  if (topCs && bodyCs) {
    checks.push([
      topCs.maxOutputTokens === bodyCs.maxOutputTokens,
      'connectionSettings.maxOutputTokens mismatch between top-level and request.body',
    ]);
    checks.push([
      topCs.disableThinking === bodyCs.disableThinking,
      'connectionSettings.disableThinking mismatch',
    ]);
    checks.push([
      topCs.temperature === bodyCs.temperature,
      'connectionSettings.temperature mismatch',
    ]);
  }

  // 6. runtimeDiagnostics 與 connectionSettings 一致
  const rd = bundle.runtimeDiagnostics;
  if (rd && topCs) {
    checks.push([
      rd.disableThinking === (topCs.disableThinking ?? true),
      'runtimeDiagnostics.disableThinking != connectionSettings.disableThinking',
    ]);
    checks.push([
      rd.maxOutputTokens === (topCs.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
      'runtimeDiagnostics.maxOutputTokens != connectionSettings.maxOutputTokens',
    ]);
  }

  const topPromptScope = bundle.promptScope;
  const bodyPromptScope = bundle.request?.body?.tuningContext?.promptScope;
  if (topPromptScope && bodyPromptScope) {
    checks.push([
      JSON.stringify(topPromptScope) === JSON.stringify(bodyPromptScope),
      'promptScope mismatch between top-level and request.body.tuningContext',
    ]);
  }

  const failures = checks.filter(([pass]) => !pass);
  if (failures.length > 0) {
    console.warn('[Bundle] Consistency check failed:', failures.map(([, msg]) => msg));
  }
  return failures.length === 0;
}

/**
 * JSON 檔案下載工具函式
 */
export function downloadJson(data, filename) {
  const content = JSON.stringify(data, null, 2);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * ISO 時間戳格式化為檔案安全字串
 */
function formatDate(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * 主入口：建立 AI 微調預送出封包
 *
 * @param {Object} scheduleData - 排課資料（含 classes, teachers, classrooms, schoolInfo, engineResult）
 * @param {Object} aiSettings   - AI 設定（來自 dataStore.aiSettings）
 * @param {Object} connectionSettings - AI 連線設定
 *   enabled, serviceType, apiUrl, model, systemPrompt,
 *   disableThinking, maxOutputTokens, temperature
 * @param {string} focusStrategy      - 'resource_first' | 'class_first'
 * @returns {Object} 封包 JSON 物件
 */
export function createSubmissionBundle(scheduleData, aiSettings, connectionSettings, focusStrategy = 'resource_first') {
  const { classes, teachers, classrooms, schoolInfo, engineResult } = scheduleData;

  // --- ① 產生 AI 報告 ---
  const reportArtifacts = buildScheduleAiReport({
    scheduleEntries: engineResult?.schedule || [],
    classes,
    teachers,
    classrooms,
    schoolInfo,
    aiSettings,
    engineMeta: {
      jobId: scheduleData.engineMeta?.jobId || null,
      status: scheduleData.engineMeta?.status || '',
      finishedAt: scheduleData.engineMeta?.finishedAt || null,
    },
  });

  const report = reportArtifacts.exportJson;
  const reportMarkdown = reportArtifacts.promptMarkdown || '';
  const exportMarkdown = reportArtifacts.exportMarkdown || '';

  // --- ② 建構排課上下文 ---
  const scheduleContext = {
    classes,
    teachers,
    classrooms,
    schoolInfo,
    engineMeta: {
      jobId: scheduleData.engineMeta?.jobId || null,
      status: scheduleData.engineMeta?.status || '',
      finishedAt: scheduleData.engineMeta?.finishedAt || null,
    },
  };

  // --- ③ 產生 prompt bundle（含 focus、budget、warnings）---
  const maxPromptChars = getAiTuningPromptMaxChars(focusStrategy);

  const focus = selectAiTuningFocusPreview({
    report,
    scheduleContext,
    focusStrategy,
  });

  const promptBundle = buildAiTuningPromptBundle({
    report,
    focus,
    tuningContext: {
      focusStrategy,
      maxMovesPerRound: 3,
    },
    maxPromptChars,
  });
  const compactPromptMarkdown = promptBundle?.promptMarkdown || reportMarkdown;
  const promptScope = promptBundle?.promptScope || null;
  const promptReport = promptBundle?.promptReport || null;

  // --- ④ 組裝 request body（與 runAiTuningBackgroundJob payload 一致）---
  const requestBody = {
    report,
    reportMarkdown,
    scheduleEntries: engineResult?.schedule || [],
    scheduleContext,
    aiSettings,
    connectionSettings,
    focusStrategy,
    maxIterations: 3,
    maxMovesPerRound: 3,
    tuningContext: {
      maxPromptChars,
      focusStrategy,
      promptRisk: promptBundle?.promptBudget || null,
      promptWarnings: promptBundle?.promptWarnings || [],
      promptMarkdown: compactPromptMarkdown,
      promptScope,
      promptReport,
      focus,
    },
  };

  // --- ⑤ runtime diagnostics ---
  const runtimeDiagnostics = {
    expectedEndpoint: connectionSettings?.apiUrl || '',
    expectedModel: connectionSettings?.model || '',
    disableThinking: connectionSettings?.disableThinking ?? true,
    maxOutputTokens: connectionSettings?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: connectionSettings?.temperature ?? 0,
    generatedFor: 'ai-timetable-tuning',
  };

  // --- ⑥ 填充 metadata ---
  const bundle = {
    bundleVersion: BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceSummary: computeSourceSummary(scheduleContext),
    report,
    promptMarkdown: compactPromptMarkdown,
    exportMarkdown,
    promptScope,
    promptReport,
    focusPreview: focus,
    request: {
      path: '/ai-timetable-tuning/jobs',
      method: 'POST',
      body: requestBody,
    },
    scheduleContext,
    aiSettings,
    connectionSettings,
    focusStrategy,
    runtimeDiagnostics,
    promptBudget: promptBundle?.promptBudget || null,
    promptWarnings: promptBundle?.promptWarnings || [],
  };

  // --- ⑦ 一致性驗證 ---
  validateBundleConsistency(bundle);

  return bundle;
}
