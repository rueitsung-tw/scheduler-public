/**
 * AI 敺株矽?撠??Ｙ??? *
 * ?其??隞颱?隢???瘜?嚗?箔?隞質?撖阡? request body 摰銝?渡? JSON 撠??? * ?冽?日??霅?????? */

import { buildScheduleAiReport } from '../utils/scheduleAiReport.js';
import {
  buildAiTuningPromptBundle,
  selectAiTuningFocusPreview,
} from './aiTuningPrompt';

const BUNDLE_VERSION = '1.0.0';

/**
 * AI_TUNING_PROMPT_LIMITS ????ScheduleView.vue 靽?銝?? */
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
 * 閮?靘?鞈???
 */
export function computeSourceSummary(scheduleContext) {
  const classes = scheduleContext?.classes || [];
  const teachers = scheduleContext?.teachers || [];
  const classrooms = scheduleContext?.classrooms || [];
  const constraints = [];

  // Collect any course requirements from classes
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
 * 銝?湔折?霅?瑼Ｘ撠??折甈??臬?芣晾
 */
export function validateBundleConsistency(bundle) {
  const checks = [];
  const addCheck = (pass, message) => {
    checks.push([Boolean(pass), message]);
  };

  addCheck(
    bundle.request?.body && bundle.promptMarkdown !== undefined
      ? bundle.request.body.promptMarkdown === bundle.promptMarkdown
      : true,
    'request.body.promptMarkdown does not match top-level promptMarkdown'
  );

  const validStrategies = ['resource_first', 'class_first'];
  addCheck(
    bundle.focusStrategy === undefined || validStrategies.includes(bundle.focusStrategy),
    `Invalid focusStrategy: ${bundle.focusStrategy}`
  );

  addCheck(
    !bundle.generatedAt || !Number.isNaN(Date.parse(bundle.generatedAt)),
    'Invalid generatedAt timestamp'
  );

  addCheck(
    typeof bundle.bundleVersion === 'string' && bundle.bundleVersion.length > 0,
    'Missing or empty bundleVersion'
  );

  const failures = checks.filter(([pass]) => !pass);
  if (failures.length > 0) {
    console.warn('[Bundle] Consistency check failed:', failures.map(([, msg]) => msg));
  }
  return failures.length === 0;
}

/**
 * JSON 瑼?銝?撌亙?賢?
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
 * ISO ???單撘??箸?獢??典?銝? */
function formatDate(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * 銝餃???撱箇? AI 敺株矽?撠?
 *
 * @param {Object} scheduleData - ?玨鞈?嚗 classes, teachers, classrooms, schoolInfo, engineResult嚗? * @param {Object} aiSettings   - AI 閮剖?嚗???dataStore.aiSettings嚗? * @param {Object} connectionSettings - AI ???閮剖?嚗nabled, serviceType, apiUrl, model, systemPrompt嚗? * @param {string} focusStrategy      - 'resource_first' | 'class_first'
 * @returns {Object} 撠? JSON ?拐辣
 */
export function createSubmissionBundle(scheduleData, aiSettings, connectionSettings, focusStrategy = 'resource_first') {
  const { classes, teachers, classrooms, schoolInfo, engineResult } = scheduleData;

  // --- ???Ｙ? AI ?勗? ---
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
  const promptMarkdown = reportArtifacts.promptMarkdown || '';
  const exportMarkdown = reportArtifacts.exportMarkdown || '';

  // --- ??撱箸??玨銝???---
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

  // --- ???Ｙ? prompt bundle嚗 focus?udget?arnings嚗?--
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

  // --- ??蝯? request body嚗? runAiTuningBackgroundJob payload 銝?湛?---
  const requestBody = {
    report,
    reportMarkdown: promptMarkdown,
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
    },
  };

  // --- ??憛怠? metadata ---
  const bundle = {
    bundleVersion: BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceSummary: computeSourceSummary(scheduleContext),
    report,
    promptMarkdown,
    exportMarkdown,
    request: {
      path: '/api/ai-timetable-analysis',
      method: 'POST',
      body: requestBody,
    },
    scheduleContext,
    aiSettings,
    connectionSettings,
    focusStrategy,
    promptBudget: promptBundle?.promptBudget || null,
    promptWarnings: promptBundle?.promptWarnings || [],
  };

  // --- ??銝?湔折?霅?---
  validateBundleConsistency(bundle);

  return bundle;
}

