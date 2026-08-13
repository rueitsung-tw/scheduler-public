<template>
  <div class="schedule-container">
    <h2>{{ dataStore.schoolInfo.name || '' }}智慧排課引擎</h2>

    <div class="control-panel">
      <button
        @click="startEngine"
        :disabled="dataStore.engineStatus === 'PROCESSING'"
        class="start-btn"
      >
        {{ dataStore.engineStatus === 'PROCESSING' ? '🚀 引擎運算中...' : '▶️ 啟動排課引擎' }}
      </button>
      <button @click="resetState" class="reset-btn">重置狀態</button>
    </div>

    <!-- 進度監控區塊 -->
    <div v-if="dataStore.engineStatus === 'PROCESSING' || dataStore.enginePollingActive" class="progress-panel">
      <div class="progress-header">
        <span class="phase-badge" :class="phaseClass">{{ phaseLabel }}</span>
        <span class="pulse-indicator"></span>
      </div>

      <div class="progress-details">
        <div class="detail-row">
          <span class="label">任務 ID</span>
          <span class="value">{{ dataStore.engineJobId || 'N/A' }}</span>
        </div>
        <div class="detail-row">
          <span class="label">目前階段</span>
          <span class="value">{{ dataStore.enginePhase || '等待中' }}</span>
        </div>
        <div class="detail-row">
          <span class="label">最新訊息</span>
          <span class="value message">{{ dataStore.engineMessage || '...' }}</span>
        </div>
        <div class="detail-row">
          <span class="label">已運行時間</span>
          <span class="value time">{{ dataStore.formatElapsed(dataStore.engineElapsedSeconds) }}</span>
        </div>
        <div class="detail-row">
          <span class="label">開始時間</span>
          <span class="value">{{ dataStore.engineStartedAt ? new Date(dataStore.engineStartedAt).toLocaleString('zh-TW') : '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="label">最後更新</span>
          <span class="value">{{ dataStore.engineLastUpdated ? new Date(dataStore.engineLastUpdated).toLocaleTimeString('zh-TW') : '-' }}</span>
        </div>
        <div class="detail-row" v-if="dataStore.engineNetworkRetry > 0">
          <span class="label">網路重試</span>
          <span class="value warning">#{{ dataStore.engineNetworkRetry }}</span>
        </div>
      </div>

      <div class="progress-note">
        ℹ️ 引擎正在後端執行中，頁面刷新後會自動恢復監控。請勿點擊「重置狀態」。
      </div>
    </div>

    <!-- 錯誤狀態區塊 -->
    <div v-if="dataStore.engineStatus === 'ERROR'" class="error-panel">
      <h3>❌ 排課失敗</h3>
      <div class="error-details">
        <p><strong>錯誤原因：</strong>{{ dataStore.engineErrorMessage }}</p>
        <p v-if="dataStore.enginePhase"><strong>失敗階段：</strong>{{ dataStore.enginePhase }}</p>
        <p v-if="dataStore.engineStartedAt">
          <strong>已運行：</strong>{{ dataStore.formatElapsed(dataStore.engineElapsedSeconds) }}
        </p>
        <p v-if="dataStore.engineFinishedAt">
          <strong>失敗時間：</strong>{{ new Date(dataStore.engineFinishedAt).toLocaleString('zh-TW') }}
        </p>
      </div>
      <div class="error-actions">
        <button v-if="hasEngineDiagnosticWarnings" @click="showAiModal = true" class="ai-diagnosis-btn">💡 查看排課警示摘要</button>
        <button v-if="hasEngineDiagnosticWarnings" @click="openAiDiagnosisModal" class="ai-deep-analysis-btn" :disabled="isAiInfeasibleAnalyzing">
          {{ isAiInfeasibleAnalyzing ? 'AI 深度分析中…' : '🧠 執行 AI 深度分析' }}
        </button>
        <button @click="resetState" class="retry-btn">🔄 重置後重試</button>
      </div>
    </div>

    <!-- 🔍 排課診斷警示 Modal -->
    <div v-if="showAiModal" class="modal-overlay" @click.self="showAiModal = false">
      <div class="ai-modal-content">
        <div class="ai-modal-header">
          <h3>💡 排課失敗診斷</h3>
          <button class="modal-close-btn" @click="showAiModal = false">✕</button>
        </div>
        <div class="ai-modal-body">
          <p class="ai-modal-intro">以下僅顯示系統從失敗診斷中辨識出的警示訊息：</p>
          <ul class="ai-analysis-list">
            <li v-for="(item, index) in dataStore.engineDiagnosticWarnings" :key="index">{{ item }}</li>
          </ul>
          <p v-if="!hasEngineDiagnosticWarnings" class="ai-empty">
            目前沒有可辨識的診斷警示。
          </p>

          <div class="ai-deep-analysis-panel">
            <div class="ai-deep-analysis-header">
              <div>
                <h4>AI 深度分析</h4>
                <p>把診斷 bundle 送進模型，整理成根因、建議與證據摘要。</p>
              </div>
              <div class="ai-deep-analysis-actions">
                <button @click="requestAiInfeasibleAnalysis" class="ai-deep-analysis-btn" :disabled="isAiInfeasibleAnalyzing">
                  {{ isAiInfeasibleAnalyzing ? '分析中…' : '重新分析' }}
                </button>
                <button @click="downloadInfeasibleBundle" class="secondary-btn" :disabled="isDownloadingInfeasibleBundle">
                  {{ isDownloadingInfeasibleBundle ? '下載中…' : '下載 infeasible bundle' }}
                </button>
              </div>
            </div>

            <p v-if="aiInfeasiblePromptBudgetSummary" class="ai-deep-analysis-budget">
              {{ aiInfeasiblePromptBudgetSummary }}
            </p>

            <div v-if="hasAiInfeasibleError" class="ai-error-box" :class="`ai-error-box--${aiInfeasibleError.code || 'unknown'}`">
              <strong class="ai-error-title">{{ aiInfeasibleError.title }}</strong>
              <p class="ai-error-message">{{ aiInfeasibleError.message }}</p>
              <div v-if="aiInfeasibleError.steps?.length" class="ai-error-steps">
                <strong>建議下一步</strong>
                <ol>
                  <li v-for="(step, index) in aiInfeasibleError.steps" :key="index">{{ step }}</li>
                </ol>
              </div>
              <details v-if="aiInfeasibleError.details" class="ai-error-details">
                <summary>技術細節</summary>
                <pre>{{ aiInfeasibleError.details }}</pre>
              </details>
            </div>

            <div v-if="aiInfeasibleAnalysis" class="ai-deep-analysis-result">
              <div class="ai-deep-analysis-summary">
                <strong>{{ aiInfeasibleAnalysis.summary?.text || 'AI 已完成分析' }}</strong>
                <p>
                  信心：{{ aiInfeasibleAnalysis.summary?.confidence || '-' }}
                  ｜主分類：{{ aiInfeasibleAnalysis.summary?.primaryCategory || '-' }}
                </p>
                <p v-if="aiInfeasibleAnalysis.summary?.nextStep">建議先做：{{ aiInfeasibleAnalysis.summary.nextStep }}</p>
              </div>

              <div class="ai-deep-analysis-section">
                <h5>可能根因</h5>
                <ul class="ai-deep-analysis-items">
                  <li v-for="(item, index) in aiInfeasibleAnalysis.rootCauses || []" :key="`cause-${index}`">
                    <strong>{{ item.category }}</strong>
                    <span>｜信心 {{ item.confidence }}</span>
                    <p>{{ item.message }}</p>
                    <p v-if="item.evidence?.length" class="ai-deep-analysis-evidence">證據：{{ item.evidence.join('；') }}</p>
                  </li>
                </ul>
              </div>

              <div class="ai-deep-analysis-section">
                <h5>修復建議</h5>
                <ul class="ai-deep-analysis-items">
                  <li v-for="(item, index) in aiInfeasibleAnalysis.recommendations || []" :key="`recommendation-${index}`">
                    <strong>{{ item.priority }}</strong>
                    <p>{{ item.action }}</p>
                    <p v-if="item.rationale" class="ai-deep-analysis-rationale">{{ item.rationale }}</p>
                  </li>
                </ul>
              </div>

              <div class="ai-deep-analysis-section">
                <h5>證據摘要</h5>
                <ul class="ai-deep-analysis-items">
                  <li v-for="(item, index) in aiInfeasibleAnalysis.evidence || []" :key="`evidence-${index}`">
                    <strong>{{ item.source }}</strong>
                    <p>{{ item.detail }}</p>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        <div class="ai-modal-footer">
          <button @click="showAiModal = false" class="modal-close-full-btn">關閉</button>
        </div>
      </div>
    </div>

    <div v-if="dataStore.engineStatus === 'COMPLETED' && dataStore.engineResult" class="result-panel">
      <h3>✅ 排課完成！</h3>

      <!-- 🆕 Movable Locks Review Panel (當需要審核且有移位課程時顯示) -->
      <MovableLocksReviewPanel />

      <div class="result-summary">
        <p v-if="dataStore.engineResult.status"><strong>演算法狀態：</strong>{{ dataStore.engineResult.status }}</p>
        <p v-if="dataStore.engineResult.total_penalty !== undefined"><strong>總扣分 (Penalty)：</strong>{{ dataStore.engineResult.total_penalty }} 分</p>
        <p v-if="dataStore.engineResult.time_seconds"><strong>運算耗時：</strong>{{ dataStore.engineResult.time_seconds }} 秒</p>
        <p><strong>總運行時間：</strong>{{ dataStore.formatElapsed(dataStore.engineElapsedSeconds) }}</p>
        <p v-if="dataStore.engineFinishedAt"><strong>完成時間：</strong>{{ new Date(dataStore.engineFinishedAt).toLocaleString('zh-TW') }}</p>
      </div>
            <div class="result-actions">
        <div class="ai-tuning-toolbar">
          <label class="ai-tuning-field">
            <span>修復策略</span>
            <select v-model="aiTuningFocusStrategy">
              <option value="resource_first">專科教室優先</option>
              <option value="class_first">單班優先</option>
            </select>
          </label>
          <p class="ai-tuning-helper">{{ aiTuningFocusLabel }}</p>
        </div>
        <button
          @click="applyAiPreviewAndGoToEditor"
          class="apply-btn"
          :disabled="!dataStore.canApplyScheduleResult || undefined"
          :title="applyButtonTitle || undefined"
        >
          {{ applyButtonText }}
        </button>
        <button @click="downloadAiMarkdown" class="secondary-btn">匯出 Markdown</button>
        <button @click="downloadAiJson" class="secondary-btn">匯出 JSON</button>
        <button
          @click="downloadSubmissionBundle"
          class="secondary-btn"
          :disabled="(!dataStore.canDownloadSubmissionBundle || isGeneratingBundle) || undefined"
          :title="submissionBundleButtonTitle || undefined"
        >
          {{ submissionBundleButtonText }}
        </button>
        <button @click="requestAiTuning" class="ai-tune-btn" :disabled="isAiTuning">
          {{ isAiTuning ? 'AI 分析中…' : '送交 AI 微調' }}
        </button>
      </div>

      <div v-if="hasAiTuningError" class="ai-error-box" :class="`ai-error-box--${aiTuningError.code || 'unknown'}`">
        <strong class="ai-error-title">{{ aiTuningError.title }}</strong>
        <p class="ai-error-message">{{ aiTuningError.message }}</p>
        <div v-if="aiTuningError.steps?.length" class="ai-error-steps">
          <strong>建議下一步</strong>
          <ol>
            <li v-for="(step, index) in aiTuningError.steps" :key="index">{{ step }}</li>
          </ol>
        </div>
        <details v-if="aiTuningError.details" class="ai-error-details">
          <summary>技術細節</summary>
          <pre>{{ aiTuningError.details }}</pre>
        </details>
      </div>

      <div v-if="aiTuningResult" class="ai-tuning-panel">
        <h4>AI 建議結果</h4>
        <p v-if="aiTuningResult.summary?.globalOverview" class="ai-tuning-summary">
          {{ aiTuningResult.summary.globalOverview }}
        </p>
        <p v-if="aiTuningResult.summary?.focusOverview" class="ai-tuning-summary">
          {{ aiTuningResult.summary.focusOverview }}
        </p>
        <p v-if="!aiTuningResult.summary?.globalOverview && !aiTuningResult.summary?.focusOverview" class="ai-tuning-summary">
          {{ aiTuningResult.summary?.text || aiTuningResult.summary || 'AI 已回傳調整建議' }}
        </p>
        <p v-if="aiTuningResult.confidence !== undefined" class="ai-tuning-confidence">
          信心分數：{{ aiTuningResult.confidence }}
        </p>

        <!-- Actionable Items from AI summary -->
        <div v-if="aiTuningResult.summary?.actionableItems?.length" class="ai-tuning-actionable">
          <strong>可操作項目</strong>
          <ul>
            <li v-for="(item, index) in aiTuningResult.summary.actionableItems" :key="index" class="ai-tuning-actionable-item">
              {{ getDayLabel(item.day) }}第{{ item.period }}節｜{{ item.className }}｜{{ item.subject }}｜{{ item.location || '未指定' }}｜{{ item.problem }}
              <span v-if="item.suggestedAction" class="ai-tuning-actionable-suggestion">｜建議：{{ item.suggestedAction }}</span>
            </li>
          </ul>
        </div>
        <div v-if="aiTuningResult.loopState" class="ai-tuning-loop-state">
          <strong>迴圈狀態</strong>
          <p>
            第 {{ aiTuningResult.loopState.iteration || 0 }} 輪，
            最佳問題數 {{ aiTuningResult.loopState.bestIssueCount ?? '-' }}，
            進度 {{ aiTuningResult.loopState.progress || 'pending' }}
          </p>
        </div>
        <div v-if="aiTuningResult.loopState?.focus" class="ai-tuning-focus">
          <strong>本輪焦點</strong>
          <p v-if="aiTuningResult.loopState.focus.focusType === 'resource'">
            專科資源：{{ aiTuningResult.loopState.focus.subject || '未指定' }}
          </p>
          <p v-else>
            班級：{{ aiTuningResult.loopState.focus.className || '未指定' }}
          </p>
          <p v-if="aiTuningResult.loopState.focus.reason">{{ aiTuningResult.loopState.focus.reason }}</p>
        </div>
        <div v-if="aiTuningJobState" class="ai-tuning-job-state">
          <strong>背景任務進度</strong>
          <p>狀態：{{ aiTuningJobState.status || 'UNKNOWN' }} / {{ aiTuningJobState.progressPhase || 'UNKNOWN' }}</p>
          <p>訊息：{{ aiTuningJobState.progressMessage || '無' }}</p>
          <p v-if="aiTuningJobState.result?.fallbackState">
            已從 {{ aiTuningJobState.result.fallbackState.from === 'resource_first' ? '專科教室優先' : aiTuningJobState.result.fallbackState.from }}
            逾時後切換為 {{ aiTuningJobState.result.fallbackState.to === 'class_first' ? '單班優先' : aiTuningJobState.result.fallbackState.to }}
          </p>
          <p v-if="aiTuningJobState.result?.loopState">
            第 {{ aiTuningJobState.result.loopState.iteration || 0 }} 輪，
            最佳問題數 {{ aiTuningJobState.result.loopState.bestIssueCount ?? '-' }}
          </p>
          <p v-if="aiTuningJobState.result?.loopState?.focus">
            焦點：
            <span v-if="aiTuningJobState.result.loopState.focus.focusType === 'resource'">
              專科資源 {{ aiTuningJobState.result.loopState.focus.subject || '未指定' }}
            </span>
            <span v-else>
              班級 {{ aiTuningJobState.result.loopState.focus.className || '未指定' }}
            </span>
          </p>
        </div>
        <p v-if="aiTuningResult.fallbackFromStrategy" class="ai-tuning-fallback-note">
          已在 {{ aiTuningResult.fallbackFromStrategy === 'resource_first' ? '專科教室優先' : aiTuningResult.fallbackFromStrategy }} 逾時後，自動切換為單班優先。
        </p>
        <div v-if="aiTuningResult.warnings?.length" class="ai-tuning-warnings">
          <strong>警告</strong>
          <ul>
            <li v-for="(warning, index) in aiTuningResult.warnings" :key="index">{{ warning }}</li>
          </ul>
        </div>
        <div v-if="aiTuningResult.selectedMoves?.length" class="ai-tuning-moves">
          <strong>AI 建議交換（候選池）</strong>
          <ul>
            <li v-for="(move, index) in aiTuningResult.selectedMoves" :key="index" class="ai-tuning-move-item">
              <span class="ai-tuning-move-id">{{ move.candidateId }}</span>
              <span class="ai-tuning-move-summary">
                {{ move.summaryText || buildMoveFallbackLabel(move) }}
              </span>
              <span v-if="move.reason" class="ai-tuning-move-reason">（{{ move.reason }}）</span>
            </li>
          </ul>
        </div>
        <details v-if="aiTuningResult.swapMoves?.length" class="ai-tuning-debug">
          <summary>Debug: swapMoves ({{ aiTuningResult.swapMoves.length }})</summary>
          <ul>
            <li v-for="(move, index) in aiTuningResult.swapMoves" :key="'swap-' + index">
              {{ move.className || '?' }}：星期{{ move.from?.day }} 第{{ move.from?.period }}節 → 星期{{ move.to?.day }} 第{{ move.to?.period }}節
              <span v-if="move.reason">（{{ move.reason }}）</span>
            </li>
          </ul>
        </details>
      </div>

      <section class="ai-tuning-history-panel">
        <div class="ai-tuning-history-panel__header">
          <h4>背景 job 歷史紀錄</h4>
          <button @click="refreshAiTuningJobHistory" class="secondary-btn" :disabled="aiTuningHistoryLoading">
            {{ aiTuningHistoryLoading ? '載入中...' : '重新整理' }}
          </button>
          <button
            v-if="aiTuningJobCanCancel"
            @click="cancelCurrentAiTuningJob"
            class="secondary-btn ai-tuning-cancel-btn"
            :disabled="isCancellingAiTuningJob"
          >
            {{ isCancellingAiTuningJob ? '取消中...' : '取消背景 job' }}
          </button>
        </div>
        <p class="ai-tuning-prompt-preview">提示詞預估：{{ aiTuningPromptPreviewSummary }}</p>
        <div v-if="aiTuningJobState" class="ai-tuning-progress ai-tuning-progress--compact">
          <div class="ai-tuning-progress__track">
            <div class="ai-tuning-progress__fill" :style="{ width: `${aiTuningJobProgressPercent}%` }"></div>
          </div>
          <div class="ai-tuning-progress__meta">
            <span>{{ aiTuningJobProgressPercent }}%</span>
            <span>{{ formatJobStatusLabel(aiTuningJobState.status) }} / {{ aiTuningJobState.progressPhase || 'QUEUED' }}</span>
          </div>
        </div>
        <p v-if="aiTuningHistoryError" class="ai-tuning-history-error">
          歷史紀錄載入失敗：{{ aiTuningHistoryError.message }}
        </p>
        <p v-else-if="!aiTuningHistoryLoading && aiTuningHistory.length === 0" class="ai-tuning-history-empty">
          目前沒有可顯示的背景 job。
        </p>
        <div v-else class="ai-tuning-history-list">
          <details v-for="item in aiTuningHistory" :key="item.jobId" class="ai-tuning-history-item">
            <summary class="ai-tuning-history-summary">
              <span class="ai-tuning-history-id">{{ item.jobId }}</span>
              <span class="ai-tuning-history-status" :class="`ai-tuning-history-status--${String(item.status || '').toLowerCase()}`">
                {{ formatJobStatusLabel(item.status) }}
              </span>
              <span class="ai-tuning-history-meta">{{ formatJobSummaryLabel(item) }}</span>
            </summary>
            <div class="ai-tuning-history-body">
              <p>開始：{{ item.startedAt ? new Date(item.startedAt).toLocaleString('zh-TW') : '-' }}</p>
              <p>結束：{{ item.finishedAt ? new Date(item.finishedAt).toLocaleString('zh-TW') : '-' }}</p>
              <p>策略：{{ formatFallbackLabel(item.summary?.focusStrategy) }}</p>
              <p>Fallback：{{ item.summary?.fallbackFromStrategy ? `${formatFallbackLabel(item.summary.fallbackFromStrategy)} → ${formatFallbackLabel(item.summary.fallbackToStrategy)}` : '無' }}</p>
              <p>最佳問題數：{{ item.summary?.bestIssueCount ?? '-' }}</p>
              <p v-if="item.resultSummary?.analysisSummary?.text">摘要：{{ item.resultSummary.analysisSummary.text }}</p>
              <p v-if="item.resultSummary?.analysisSummary?.confidence !== undefined">信心：{{ item.resultSummary.analysisSummary.confidence }}</p>
              <p v-if="item.resultSummary?.historyTail?.length">最近輪次：{{ item.resultSummary.historyTail.length }}</p>
            </div>
          </details>
        </div>
      </section>

      <pre class="json-box">{{ JSON.stringify(aiPreviewSchedule || dataStore.engineResult.schedule, null, 2) }}</pre>
    </div>

    <!-- IDLE 狀態提示 -->
    <div v-if="dataStore.engineStatus === 'IDLE'" class="idle-panel">
      <p>🟢 引擎待命中，點擊「啟動排課引擎」開始排課。</p>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import MovableLocksReviewPanel from '../components/MovableLocksReviewPanel.vue';
import { useAiStore } from '../stores/aiSettings';
import { useScheduleStore } from '../stores/schedule';
import { useRouter } from 'vue-router';
import { isSubjectApplicableToGrade } from '../utils/gradeSubjectUtils';
import {
  buildScheduleAiReport,
} from '../utils/scheduleAiReport.js';
import {
  cancelAiTuningBackgroundJob,
  listAiTuningBackgroundJobs,
  runAiTuningBackgroundJob,
} from '../services/aiTuningJobClient';
import {
  buildAiTuningPromptBundle,
  selectAiTuningFocusPreview,
} from '../services/aiTuningPrompt';
import { createSubmissionBundle, downloadJson } from '../services/aiTuningSubmissionBundle';
import { runAiInfeasibleAnalysis } from '../services/aiInfeasibleAnalysisClient';

const dataStore = useScheduleStore();
const aiStore = useAiStore();
const router = useRouter();

const hasBlockingMovableLocksReview = computed(() => {
  return !dataStore.canApplyScheduleResult;
});

const applyButtonText = computed(() => {
  if (dataStore.hasRejectedMovableLockReviews) {
    return '⛔ 微調審核已拒絕（不可直接套用）';
  }
  if (!dataStore.canApplyScheduleResult) {
    return '🔒 待審核微調鎖定課（暫無法直接套用）';
  }
  return '套用此課表並前往編輯器';
});

const applyButtonTitle = computed(() => {
  if (dataStore.hasRejectedMovableLockReviews) {
    return '包含已拒絕的鎖定課微調建議，此排課結果不可直接套用';
  }
  if (!dataStore.canApplyScheduleResult) {
    return '包含待審核的鎖定課微調建議，需完成審核後才能套用';
  }
  return '';
});

const submissionBundleButtonText = computed(() => {
  if (dataStore.hasRejectedMovableLockReviews) {
    return '⛔ 微調審核已拒絕（不可下載預送出封包）';
  }
  if (!dataStore.canDownloadSubmissionBundle) {
    return '🔒 待審核微調鎖定課（暫無法下載預送出封包）';
  }
  if (isGeneratingBundle.value) {
    return '產生中…';
  }
  return '下載預送出封包';
});

const submissionBundleButtonTitle = computed(() => {
  if (dataStore.hasRejectedMovableLockReviews) {
    return '包含已拒絕的鎖定課微調建議，此排課結果不可直接下載';
  }
  if (!dataStore.canDownloadSubmissionBundle) {
    return '包含待審核的鎖定課微調建議，需完成審核後才能下載';
  }
  return '';
});
const API_BASE = (() => {
  const configuredBase = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (configuredBase) {
    try {
      const parsed = new URL(configuredBase, window.location.origin);
      const isLocalhostTarget = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (!isLocalhostTarget || parsed.origin === window.location.origin) {
        return parsed.toString().replace(/\/$/, '');
      }
    } catch {
      return configuredBase.replace(/\/$/, '');
    }
  }

  return '/api';
})();
const AI_TUNING_PROMPT_LIMITS = {
  resource_first: 60000,
  class_first: 40000,
};

const getAiTuningPromptMaxChars = (focusStrategy) => (
  AI_TUNING_PROMPT_LIMITS[String(focusStrategy || '').trim()] || AI_TUNING_PROMPT_LIMITS.resource_first
);

// ?? AI 閮箸 Modal ?批
const showAiModal = ref(false);
const isAiTuning = ref(false);
const isGeneratingBundle = ref(false);
const aiTuningError = ref(null);
const aiTuningResult = ref(null);
const isAiInfeasibleAnalyzing = ref(false);
const isDownloadingInfeasibleBundle = ref(false);
const aiInfeasibleError = ref(null);
const aiInfeasibleAnalysis = ref(null);
const aiInfeasibleBundle = ref(null);
const aiInfeasiblePromptBudget = ref(null);
const aiPreviewSchedule = ref(null);
const aiTuningJobState = ref(null);
const aiTuningHistory = ref([]);
const aiTuningHistoryLoading = ref(false);
const aiTuningHistoryError = ref(null);
const isCancellingAiTuningJob = ref(false);
const aiTuningPromptPreview = ref(null);
const aiTuningFocusStrategy = ref('resource_first');

const hasAiTuningError = computed(() => Boolean(aiTuningError.value?.message));
const hasEngineDiagnosticWarnings = computed(() => dataStore.engineDiagnosticWarnings.length > 0);
const hasAiInfeasibleError = computed(() => Boolean(aiInfeasibleError.value?.message));
const aiTuningFocusLabel = computed(() => (
  aiTuningFocusStrategy.value === 'class_first'
    ? '目前策略：單班優先，先從問題最多的班級開始。'
    : '目前策略：專科教室優先，先從最稀缺資源追蹤連鎖衝突。'
));
const aiInfeasiblePromptBudgetSummary = computed(() => {
  const budget = aiInfeasiblePromptBudget.value;
  if (!budget) return '';
  const status = budget.withinBudget ? 'Prompt 安全' : 'Prompt 過大';
  return `${status} / 約 ${Number(budget.estimatedChars || 0).toLocaleString('zh-TW')} chars / 上限 ${Number(budget.maxPromptChars || 0).toLocaleString('zh-TW')}${budget.truncated ? ' / 已自動縮編' : ''}`;
});

const aiTuningPromptPreviewSummary = computed(() => {
  const preview = aiTuningPromptPreview.value;
  if (!preview) return '尚未預估';
  const chars = preview.promptBudget?.estimatedChars ?? 0;
  const maxChars = preview.promptBudget?.maxPromptChars ?? getAiTuningPromptMaxChars(aiTuningFocusStrategy.value);
  const status = preview.promptBudget?.withinBudget ? '安全' : '過大';
  return `${status} / 約 ${chars.toLocaleString('zh-TW')} chars / 上限 ${maxChars.toLocaleString('zh-TW')}`;
});

const aiTuningJobCanCancel = computed(() => {
  const status = String(aiTuningJobState.value?.status || '').toUpperCase();
  return ['PENDING', 'PROCESSING', 'ANALYZING', 'FALLBACKING'].includes(status);
});

const aiTuningJobProgressPercent = computed(() => {
  const state = aiTuningJobState.value;
  if (!state) return 0;
  const status = String(state.status || '').toUpperCase();
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') return 100;
  const loopState = state.result?.loopState || {};
  const totalIterations = Number(loopState.maxIterations || state.payload?.maxIterations || 0) || 3;
  const iteration = Number(loopState.iteration || 0);
  const ratio = totalIterations > 0 ? iteration / totalIterations : 0;
  const phaseMap = {
    PENDING: 8,
    PROCESSING: Math.max(15, Math.min(85, Math.round(ratio * 100))),
    ANALYZING: Math.max(25, Math.min(90, Math.round(ratio * 100))),
    FALLBACKING: Math.max(45, Math.min(92, Math.round(ratio * 100))),
  };
  return phaseMap[status] || Math.max(10, Math.min(95, Math.round(ratio * 100)));
});

const formatJobStatusLabel = (value) => {
  const status = String(value || '').toUpperCase();
  const map = {
    PENDING: '排隊中',
    PROCESSING: '處理中',
    ANALYZING: '分析中',
    FALLBACKING: '策略切換中',
    COMPLETED: '完成',
    FAILED: '失敗',
    CANCELLED: '已取消',
  };
  return map[status] || status || 'UNKNOWN';
};

const formatFallbackLabel = (strategy) => {
  const normalized = String(strategy || '').trim();
  if (normalized === 'resource_first') return '專科教室優先';
  if (normalized === 'class_first') return '單班優先';
  return normalized || '-';
};

const formatJobSummaryLabel = (item) => {
  const summary = item?.summary || {};
  const fallback = summary.fallbackFromStrategy ? `，fallback：${formatFallbackLabel(summary.fallbackFromStrategy)}` : '';
  const bestIssueCount = summary.bestIssueCount ?? '-';
  const iterations = summary.totalIterations ?? 0;
  return `最佳問題數 ${bestIssueCount}，${iterations} 輪${fallback}`;
};

const refreshAiTuningJobHistory = async () => {
  aiTuningHistoryLoading.value = true;
  aiTuningHistoryError.value = null;
  try {
    const result = await listAiTuningBackgroundJobs({
      apiBase: API_BASE,
      limit: 10,
    });
    aiTuningHistory.value = Array.isArray(result.jobs) ? result.jobs : [];
  } catch (error) {
    aiTuningHistoryError.value = buildAiTuningError({ fallbackError: error });
  } finally {
    aiTuningHistoryLoading.value = false;
  }
};

const buildAiTuningPromptPreview = () => {
  if (!aiReportJson.value || !dataStore.engineResult?.schedule) {
    return null;
  }

  const maxPromptChars = getAiTuningPromptMaxChars(aiTuningFocusStrategy.value);

  const focus = selectAiTuningFocusPreview({
    report: aiReportJson.value,
    scheduleContext: {
      classes: dataStore.classes,
      teachers: dataStore.teachers,
      classrooms: dataStore.classrooms,
      schoolInfo: dataStore.schoolInfo,
      engineMeta: {
        jobId: dataStore.engineJobId,
        status: dataStore.engineStatus,
        finishedAt: dataStore.engineFinishedAt,
      },
    },
    focusStrategy: aiTuningFocusStrategy.value,
  });

  return {
    focus,
    ...buildAiTuningPromptBundle({
      report: aiReportJson.value,
      focus,
      tuningContext: {
        focusStrategy: aiTuningFocusStrategy.value,
        maxMovesPerRound: 3,
      },
      maxPromptChars,
    }),
  };
};

const AI_TUNING_ERROR_GUIDES = {
  no_report: {
    title: '沒有可分析的排課結果',
    message: '目前沒有可供 AI 分析的排課結果。',
    steps: [
      '先確認排課引擎已經完成，且畫面上已出現完整課表結果。',
      '如果剛重整頁面，請先等待結果載入完成，再重新送交 AI 微調。',
    ],
  },
  settings_missing: {
    title: 'AI 連線設定尚未完成',
    message: '目前 AI 設定不完整，無法送出微調請求。',
    steps: [
      '前往 AI 設定頁確認服務類型、API URL、模型名稱與啟用狀態。',
      '儲存設定後，重新回到此頁再試一次。',
    ],
  },
  backend_404: {
    title: '找不到 AI 微調 API',
    message: '前端已送出請求，但後端沒有找到這條 API 路由。',
    steps: [
      '確認後端服務目前正在執行，且載入的是最新版 server.js。',
      '檢查 `.env` 的 `VITE_API_BASE_URL` 是否指向正確的 `/api` 入口。',
      '確認後端是否有註冊 `/api/ai-timetable-analysis`。',
    ],
  },
  upstream_error: {
    title: 'AI 上游回應異常',
    message: '後端已把請求送到 AI 服務，但上游模型服務回傳了錯誤。',
    steps: [
      '到 AI 設定頁確認 API URL 是否真的指向可用的模型服務。',
      '確認 service type 與該 API 的格式相符，例如 Ollama、LM Studio 或 llama.cpp。',
      '如果模型剛啟動，先等它載入完成後再重試。',
    ],
  },
  ai_disabled: {
    title: 'AI 功能尚未啟用',
    message: '後端回覆目前 AI 功能還沒有開啟。',
    steps: [
      '到 AI 設定頁把「啟用 AI」打開並儲存。',
      '確認資料庫中的 AI 設定已同步到後端。',
    ],
  },
  ai_tuning_context_missing: {
    title: '缺少 AI 閉環上下文',
    message: '目前缺少可重算的班級、教師或教室上下文，無法啟動閉環。',
    steps: [
      '確認前端在送出 AI 微調時已一併帶上 classes、teachers、classrooms 與 schoolInfo。',
      '若是舊資料來源，先重新進行一次完整排課再送交 AI 微調。',
    ],
  },
  ai_tuning_session_not_found: {
    title: 'AI 微調 session 已失效',
    message: '後端找不到這個 AI 微調 session，可能已過期或被取消。',
    steps: [
      '重新按一次「送交 AI 微調」建立新 session。',
      '如果一直發生，檢查後端是否在途中重啟，導致記憶體中的 session 消失。',
    ],
  },
  ai_tuning_session_not_running: {
    title: 'AI 微調 session 無法繼續',
    message: '此 session 目前不是 running 狀態，無法再執行 step。',
    steps: [
      '重新建立一個新的 AI 微調 session。',
      '檢查是否已經 finalize 或 cancel 了同一個 session。',
    ],
  },
  ai_tuning_max_iterations_reached: {
    title: '已達 AI 微調最大輪次',
    message: '目前迴圈已達設定的最大輪次，系統停止繼續修正。',
    steps: [
      '若仍有明顯衝突，可以提高最大輪次，但要留意逾時風險。',
      '也可以縮小修復焦點，例如改成單班或單一專科教室先修。',
    ],
  },
  ai_tuning_start_failed: {
    title: 'AI 微調啟動失敗',
    message: '建立閉環 session 時發生錯誤。',
    steps: [
      '先確認排課結果與 AI 設定都已完整載入。',
      '重新送交一次 AI 微調。',
    ],
  },
  ai_tuning_step_failed: {
    title: 'AI 微調步驟失敗',
    message: '目前這一輪 AI 修復無法繼續執行。',
    steps: [
      '檢查上方技術細節，確認是資料缺失、上游錯誤或 move 驗證失敗。',
      '必要時重新建立 session 從第一輪開始。',
    ],
  },
  ai_tuning_finalize_failed: {
    title: 'AI 微調無法完成套用',
    message: 'session 結束時無法取得可用的最終結果。',
    steps: [
      '確認 AI 至少完成一輪 step，且沒有中途 cancel。',
      '重新執行一次 AI 微調流程。',
    ],
  },
  ai_tuning_cancel_failed: {
    title: 'AI 微調取消失敗',
    message: '系統嘗試取消 session，但後端沒有正常完成清理。',
    steps: [
      '可直接重新整理頁面，通常不會影響正式課表資料。',
      '如果後端持續保留舊 session，請讓工程人員檢查記憶體 session 管理。',
    ],
  },
  upstream_timeout: {
    title: 'AI 分析逾時',
    message: 'AI 模型推理時間超過目前上限。',
    steps: [
      '先縮小分析範圍，例如只針對衝突較多的班級重新分析。',
      '確認本地模型服務目前可正常回應，沒有卡住或記憶體不足。',
      '若經常發生，建議改成分批分析或背景任務。',
    ],
  },
  upstream_context_overflow: {
    title: 'AI 上下文超限',
    message: '這輪焦點摘要仍太大，已超出模型可接受的上下文範圍。',
    steps: [
      '先縮小修復範圍，盡量改用單班優先或更小的專科焦點。',
      '若班級/資源涉及太多，先拆成多輪背景 job，再逐步修正。',
      '若手動餵給 WebUI，請勿直接貼完整報告，改貼背景 job 歷史摘要或單輪焦點結果。',
    ],
  },
  backend_closed_connection: {
    title: '後端連線被中斷',
    message: '請求有送出，但後端在回應前斷線或關閉連線。',
    steps: [
      '先確認遠端 Ubuntu 上的後端程序是否仍在執行。',
      '檢查 llama.cpp server 是否有崩潰、重啟或被其他請求塞住。',
      '若常發生在 resource_first，建議先切回 class_first 再試。',
    ],
  },
  request_timeout: {
    title: 'AI 請求逾時',
    message: '請求在等待期限內沒有完成，因此被前端中止。',
    steps: [
      '先確認模型是否正在運算、卡在排隊，或上下文過大導致回應太慢。',
      '若是大範圍修復，先縮焦點或改用背景 job 的單班模式。',
      '必要時再提高 timeout，但更重要的是減少單輪輸入規模。',
    ],
  },
  invalid_move: {
    title: 'AI 建議不可直接套用',
    message: '模型回傳的 swap move 沒有通過驗證，為避免破壞總節數與限制，系統已擋下。',
    steps: [
      '先檢查報告中的衝突班級與時段，確認 AI 是否理解正確。',
      '重新匯出報告再送交一次，讓模型看到最新課表狀態。',
      '如果同樣發生，請把回傳內容交給工程人員檢查提示詞與約束規則。',
    ],
  },
  candidate_pool_mismatch: {
    title: 'AI 候選池資料不一致',
    message: '這不是使用者手動排課錯誤，而是送給 AI 的 candidateId 清單與後端驗證用候選池不一致。',
    steps: [
      '下載預送出封包，檢查 promptLegalCandidateIds 與 report.candidateMoves 是否來自同一份候選池。',
      '查看下方技術細節中的「prompt/驗證候選交集」；若為 0/N，優先回報為系統資料流問題。',
      '同時確認 AI 回傳的 selectedMoves 是否只使用 prompt 中列出的 candidateId。',
      '請勿手動套用 AI 建議；候選池重新同步或重新產生封包後再執行 AI 微調。',
    ],
  },
  apply_failed: {
    title: 'AI 建議無法套用',
    message: 'AI 回傳的調整內容無法寫回課表。',
    steps: [
      '確認課表資料沒有在分析期間被其他操作更新。',
      '重新執行一次 AI 微調，避免使用過期的課表快照。',
    ],
  },
  backend_unreachable: {
    title: '無法連上排課後端',
    message: '前端找不到可用的後端服務，或連線被中斷。',
    steps: [
      '確認後端服務是否已啟動，且可以正常接收 `/api` 請求。',
      '如果是開發模式，檢查 Vite proxy 與 `VITE_API_BASE_URL` 是否一致。',
    ],
  },
  upstream_output_empty: {
    title: 'AI 回應內容為空',
    message: '本地模型可能把輸出 token 用在 thinking/reasoning，導致正式 content 為空。',
    steps: [
      '確認 AI 設定頁已啟用「停用 Thinking 模式」。',
      '將最大輸出 token 提高到 4096 或以上。',
      '確認 API URL 使用完整 OpenAI-compatible chat completions 端點。',
    ],
  },
  upstream_output_truncated: {
    title: 'AI 回應被截斷',
    message: '本地模型在完成 JSON 前達到輸出 token 上限。',
    steps: [
      '提高最大輸出 token，例如 4096、8192。',
      '減少本次預送出的候選交換資料量。',
      '確認模型回應只輸出 JSON，不輸出解釋文字。',
    ],
  },
  upstream_invalid_json: {
    title: 'AI 回應不是有效 JSON',
    message: '本地模型有回應內容，但格式不是系統可解析的 JSON。',
    steps: [
      '將 temperature 設為 0。',
      '確認 System Prompt 要求只回傳 JSON。',
      '如果模型輸出包含 reasoning 或說明文字，請啟用停用 Thinking 模式。',
    ],
  },
  unknown_error: {
    title: 'AI 微調失敗',
    message: '發生未知錯誤，請先查看下方技術細節。',
    steps: [
      '先重試一次，確認是否只是暫時性的連線或模型忙碌。',
      '若持續失敗，請把技術細節貼給工程人員追查。',
    ],
  },
};

const AI_TUNING_ERROR_CODE_MAP = {
  AI_REPORT_MISSING: 'no_report',
  AI_DISABLED: 'ai_disabled',
  AI_API_URL_MISSING: 'settings_missing',
  AI_UPSTREAM_ERROR: 'upstream_error',
  AI_UPSTREAM_CONTEXT_OVERFLOW: 'upstream_context_overflow',
  AI_UPSTREAM_TIMEOUT: 'upstream_timeout',
  AI_TUNING_PROMPT_TOO_LARGE: 'upstream_context_overflow',
  AI_INVALID_SWAP_MOVE: 'invalid_move',
  AI_INVALID_CANDIDATE_MOVE: 'invalid_move',
  AI_TUNING_CANDIDATE_POOL_MISMATCH: 'candidate_pool_mismatch',
  AI_ANALYSIS_FAILED: 'unknown_error',
  AI_TUNING_CONTEXT_MISSING: 'ai_tuning_context_missing',
  AI_TUNING_SESSION_NOT_FOUND: 'ai_tuning_session_not_found',
  AI_TUNING_SESSION_NOT_RUNNING: 'ai_tuning_session_not_running',
  AI_TUNING_MAX_ITERATIONS_REACHED: 'ai_tuning_max_iterations_reached',
  AI_TUNING_START_FAILED: 'ai_tuning_start_failed',
  AI_TUNING_STEP_FAILED: 'ai_tuning_step_failed',
  AI_TUNING_FINALIZE_FAILED: 'ai_tuning_finalize_failed',
  AI_TUNING_CANCEL_FAILED: 'ai_tuning_cancel_failed',
  AI_TUNING_JOB_START_FAILED: 'ai_tuning_start_failed',
  AI_TUNING_JOB_STATUS_FAILED: 'backend_unreachable',
  AI_TUNING_JOB_HISTORY_FAILED: 'backend_unreachable',
  AI_TUNING_JOB_CANCEL_FAILED: 'ai_tuning_cancel_failed',
  AI_TUNING_JOB_NOT_FOUND: 'ai_tuning_session_not_found',
  AI_TUNING_CANCELLED: 'ai_tuning_cancel_failed',
  AI_TUNING_FAILED: 'ai_tuning_step_failed',
  AI_UPSTREAM_OUTPUT_EMPTY: 'upstream_output_empty',
  AI_UPSTREAM_OUTPUT_TRUNCATED: 'upstream_output_truncated',
  AI_UPSTREAM_INVALID_JSON: 'upstream_invalid_json',
  AI_INFEASIBLE_BUNDLE_MISSING: 'no_report',
  AI_INFEASIBLE_PROMPT_TOO_LARGE: 'upstream_context_overflow',
  AI_INFEASIBLE_INVALID_RESPONSE: 'upstream_invalid_json',
  AI_INFEASIBLE_ANALYSIS_FAILED: 'unknown_error',
};

const isAbortLikeError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.name === 'AbortError'
    || message.includes('aborted without reason')
    || message.includes('this operation was aborted')
    || message.includes('the operation was aborted')
  );
};

const normalizeAiTuningErrorCode = (value) => {
  const code = String(value || '').trim();
  const mappedCode = AI_TUNING_ERROR_CODE_MAP[code] || code;
  return Object.prototype.hasOwnProperty.call(AI_TUNING_ERROR_GUIDES, mappedCode) ? mappedCode : 'unknown_error';
};

const extractAiTuningErrorMessage = (responseData, fallbackError) => {
  const messageParts = [
    responseData?.error,
    responseData?.details,
    responseData?.message,
    fallbackError?.message,
  ].filter(Boolean);
  return messageParts.join(' | ').trim();
};

const buildAiTuningError = ({ responseStatus = null, responseData = null, fallbackError = null, noReport = false }) => {
  let code = 'unknown_error';
  const combinedMessage = extractAiTuningErrorMessage(responseData, fallbackError);
  const rawText = String(responseData?.rawText || '').trim();

  if (noReport) {
    code = 'no_report';
  } else if (isAbortLikeError(fallbackError)) {
    code = 'request_timeout';
  } else if (responseData?.code || responseData?.errorCode) {
    code = normalizeAiTuningErrorCode(responseData.code || responseData.errorCode);
  } else if (responseStatus === 404) {
    code = 'backend_404';
  } else if (responseStatus === 400 && /AI 功能尚未啟用/.test(combinedMessage)) {
    code = 'ai_disabled';
  } else if (responseStatus === 400 && /API URL 尚未設定/.test(combinedMessage)) {
    code = 'settings_missing';
  } else if (responseStatus === 413 || /context size|available context size|tokens exceeds|prompt too large/i.test(combinedMessage)) {
    code = 'upstream_context_overflow';
  } else if (/closed connection|socket hang up|connection reset|eof|econnreset/i.test(combinedMessage)) {
    code = 'backend_closed_connection';
  } else if (/Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(combinedMessage)) {
    code = 'backend_unreachable';
  } else if (responseStatus === 502 && /逾時/.test(combinedMessage)) {
    code = 'upstream_timeout';
  } else if (/無效 move|invalid move|swap move/i.test(combinedMessage)) {
    code = 'invalid_move';
  } else if (/無法套用/.test(combinedMessage)) {
    code = 'apply_failed';
  } else if (!combinedMessage && rawText) {
    code = responseStatus === 404 ? 'backend_404' : 'unknown_error';
  }

  const guide = AI_TUNING_ERROR_GUIDES[code] || AI_TUNING_ERROR_GUIDES.unknown_error;
  const details = [
    responseStatus != null ? `HTTP ${responseStatus}` : '',
    `code: ${code}`,
    combinedMessage,
    rawText && rawText !== combinedMessage ? rawText : '',
  ].filter(Boolean).join('\n');

  return {
    code,
    title: guide.title,
    message: guide.message,
    steps: guide.steps,
    details,
  };
};

let timerId = null;

const resetState = () => {
  dataStore.resetEngineState();
  clearAiTuningState();
  clearAiInfeasibleState();
};

// 頁面載入時自動恢復輪詢
onMounted(async () => {
  await aiStore.loadFromApi().catch(() => {});
  const resumed = await dataStore.resumePolling();
  await refreshAiTuningJobHistory();
  if (resumed) {
    console.log('🔄 已自動恢復排課任務監控');
  }

  // 🌟 [BugFix] 獨立的 UI 計時器：僅在組件存活且有活躍任務時運行，讓秒數平滑跳動
  timerId = setInterval(() => {
    const isActiveJob = dataStore.engineStatus === 'PROCESSING' || dataStore.enginePollingActive;
    if (isActiveJob && dataStore.engineStartedAt) {
      const startMs = new Date(dataStore.engineStartedAt).getTime();
      if (!isNaN(startMs)) {
        dataStore.engineElapsedSeconds = Math.floor((Date.now() - startMs) / 1000);
      }
    }
  }, 1000);
});

onUnmounted(() => {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
});

// 階段對應的 UI class
const phaseClass = computed(() => {
  const phase = dataStore.enginePhase;
  if (!phase) return '';
  const map = {
    QUEUED: 'phase-queued',
    PROCESSING: 'phase-processing',
    SOLVING: 'phase-solving',
    REPAIRING: 'phase-repairing',
    FINALIZING: 'phase-finalizing',
    COMPLETED: 'phase-completed',
    FAILED: 'phase-failed'
  };
  return map[phase] || '';
});

// 階段對應的中文標籤
const phaseLabel = computed(() => {
  const phase = dataStore.enginePhase;
  if (!phase) return '';
  const map = {
    QUEUED: '⏳ 已排隊',
    PROCESSING: '📝 準備中',
    SOLVING: '🧠 求解中',
    REPAIRING: '🔧 AI 優化中',
    FINALIZING: '📦 讀取結果',
    COMPLETED: '✅ 完成',
    FAILED: '❌ 失敗'
  };
  return map[phase] || phase;
});

/**
 * 🚀 啟動排課引擎（含終極防護網）
 * 在送出給 Python 之前，強制清洗前端記憶體中的資料：
 * 1. 刪除殘留的「藝術」科目，拆分為「音樂」與「美勞」
 * 2. 根據教師專長分配音樂/美勞老師
 * 3. 保留 1.5 節原始數據，直接傳送給後端（Phase 1 修改）
 * 4. 🔒 雙層防護：過濾 periods <= 0 與年級不適用科目
 */
const startEngine = async () => {
  clearAiInfeasibleState();
  // --- 🚨 送出前防呆檢查 ---
  const errors = [];
  const teacherLoad = {};

  // 輔助函式：從班級名稱提取年級數字
  const getGradeFromClassName = (className) => {
    const match = String(className).match(/(\d+)\s*(年|grade)/i) || String(className).match(/^(\d)/);
    return match ? parseInt(match[1], 10) : 1;
  };

  // 🔒 啟動前過濾：移除 periods <= 0 與年級不適用的科目（不視為錯誤）
  let filteredCount = 0;
  dataStore.classes.forEach(c => {
    if (!c.course_requirements) return;
    const grade = getGradeFromClassName(c.name);
    const originalLength = c.course_requirements.length;
    c.course_requirements = c.course_requirements.filter(req => {
      // 0 節不配課
      if ((Number(req.periods) || 0) <= 0) {
        return false;
      }
      // 年級適用性檢查
      if (!isSubjectApplicableToGrade(req.subject, grade)) {
        return false;
      }
      return true;
    });
    filteredCount += (originalLength - c.course_requirements.length);
  });

  // 統計各老師需求（使用過濾後的資料）
  dataStore.classes.forEach(c => {
    c.course_requirements?.forEach(req => {
      if (!req.teacher) {
        errors.push(`❌ ${c.name} 的「${req.subject}」沒有指定教師！`);
      } else {
        const tName = req.teacher.trim();
        teacherLoad[tName] = (teacherLoad[tName] || 0) + parseFloat(req.periods || 0);
      }
    });
  });

  // 檢查教師配額
  dataStore.teachers.forEach(t => {
    const load = teacherLoad[t.name] || 0;
    const max = Number(t.base_periods || t.max_periods || 20) - Number(t.reduction || 0) + Number(t.overtime || 0);
    if (load > max) {
      errors.push(`🚨 教師超載：${t.name} (上限 ${max} 節，卻被排了 ${load} 節)`);
    }
  });

  if (filteredCount > 0) {
    console.log(`🔒 [啟動前過濾] 已移除 ${filteredCount} 筆 periods<=0 或年級不適用的課程需求`);
  }

  if (errors.length > 0) {
    alert("⚠️ 排課資料有誤，已攔截：\n" + errors.slice(0, 10).join('\n') + (errors.length > 10 ? '\n...等更多錯誤' : ''));
    return; // 終止執行
  }
  // --- 防呆檢查結束 ---

  // ============================================================================
  // 🧹 前置清洗與拆分（P0 Hotfix：不再靜默寫回 DB）
  // ============================================================================
  //
  // 重要原則：
  // 1. 低年級移除誤塞的音樂/美勞/藝術是「安全清洗」——可以寫回 DB
  // 2. 中高年級拆分藝術/健康與體育是「結構性變更」——可能產生空白 teacher
  // 3. 拆分後若產生空白 teacher，必須攔截、不同步、不送引擎
  // ============================================================================

  let hasSafeCleanup = false;    // 低年級移除誤塞科目
  let hasSplit = false;          // 中高年級拆分
  const splitErrors = [];        // 拆分後驗證失敗的錯誤清單

  dataStore.classes.forEach(cls => {
    if (!cls.course_requirements) return;

    // 🔍 判斷該班級的年級
    const gradeMatch = cls.name.match(/(\d+)年/);
    const grade = gradeMatch ? parseInt(gradeMatch[1]) : 1;

    // ==========================================
    // 🧹 1. 處理音樂與美勞 (分年級邏輯)
    // ==========================================
    if (grade === 1 || grade === 2) {
      // 🚨 低年級大掃除：強制殺掉之前被誤塞進資料庫的音樂、美勞、藝術
      // 這是「安全清洗」——移除錯誤資料，不會產生新問題
      for (let i = cls.course_requirements.length - 1; i >= 0; i--) {
        const subj = cls.course_requirements[i].subject;
        if (subj === '音樂' || subj === '美勞' || subj === '藝術') {
          cls.course_requirements.splice(i, 1);
          hasSafeCleanup = true;
        }
      }
    } else {
      // ✅ 中高年級 (3~6年級)：拆分「藝術」為音樂/美勞
      const artIndex = cls.course_requirements.findIndex(r => r.subject && r.subject.trim() === '藝術');
      if (artIndex !== -1) {
        const oldTeacherName = cls.course_requirements[artIndex].teacher;
        const teacherObj = dataStore.teachers.find(t => t.name === oldTeacherName);
        const exps = teacherObj?.expertiseSubjects || [];
        const hasMusicExpertise = exps.includes('音樂');
        const hasArtExpertise = exps.includes('美勞');

        // 🔒 拆分前驗證：老師是否具備對應專長
        if (!hasMusicExpertise || !hasArtExpertise) {
          const missing = [];
          if (!hasMusicExpertise) missing.push('音樂');
          if (!hasArtExpertise) missing.push('美勞');
          splitErrors.push(
            `🚨 ${cls.name} 的「藝術」老師「${oldTeacherName || '未指定'}」不具備 ${missing.join('、')} 專長，` +
            `無法拆分為「音樂」與「美勞」。請先指派具對應專長的老師。`
          );
        }

        // 即使驗證失敗，仍記錄拆分狀態（用於後續統一處理）
        hasSplit = true;
      }
    }

    // ==========================================
    // 🧹 2. 處理健康與體育拆分
    // ==========================================
    const hpIndex = cls.course_requirements.findIndex(r => r.subject && r.subject.trim() === '健康與體育');
    if (hpIndex !== -1) {
      const homeroomTeacher = cls.homeroom_teacher;

      // 🔒 拆分前驗證：必須有導師
      if (!homeroomTeacher || homeroomTeacher.trim() === '') {
        splitErrors.push(
          `🚨 ${cls.name} 沒有設定導師（homeroom_teacher），` +
          `無法將「健康與體育」拆分為「體育」與「健康」。請先設定導師。`
        );
      }

      hasSplit = true;
    }
  });

  // 🔒 若拆分驗證失敗，阻擋啟動並提示
  if (splitErrors.length > 0) {
    alert(
      "⛔ 排課啟動前發現資料問題，無法繼續：\n\n" +
      splitErrors.join('\n') +
      "\n\n請修正上述問題後再試。系統不會將錯誤資料寫入資料庫。"
    );
    return;
  }

  // ✅ 驗證通過後，才實際執行拆分
  if (hasSplit) {
    dataStore.classes.forEach(cls => {
      if (!cls.course_requirements) return;

      // 拆分藝術 → 音樂 + 美勞
      const artIndex = cls.course_requirements.findIndex(r => r.subject && r.subject.trim() === '藝術');
      if (artIndex !== -1) {
        const oldTeacherName = cls.course_requirements[artIndex].teacher;
        cls.course_requirements.splice(artIndex, 1);
        const teacherObj = dataStore.teachers.find(t => t.name === oldTeacherName);
        const exps = teacherObj?.expertiseSubjects || [];
        const musicTeacher = exps.includes('音樂') ? oldTeacherName : '';
        const artTeacher = exps.includes('美勞') ? oldTeacherName : '';
        cls.course_requirements.push({ subject: '音樂', periods: 1.5, teacher: musicTeacher });
        cls.course_requirements.push({ subject: '美勞', periods: 1.5, teacher: artTeacher });
      }

      // 拆分健康與體育 → 體育 + 健康
      const hpIndex = cls.course_requirements.findIndex(r => r.subject && r.subject.trim() === '健康與體育');
      if (hpIndex !== -1) {
        const oldTeacherName = cls.course_requirements[hpIndex].teacher;
        cls.course_requirements.splice(hpIndex, 1);
        cls.course_requirements.push({ subject: '體育', periods: 2, teacher: oldTeacherName });
        const homeroomTeacher = cls.homeroom_teacher || '';
        cls.course_requirements.push({ subject: '健康', periods: 1, teacher: homeroomTeacher });
      }
    });
  }

  // 💾 只有「安全清洗」才同步回 DB
  // 拆分結果只存在於本次 payload，不寫回 source-of-truth
  if (hasSafeCleanup) {
    dataStore.markScheduleDirty();
    await dataStore.syncToCloud();
    console.log("🧹 已成功清洗低年級髒資料！");
  }

  // 拆分結果的日誌（不寫 DB）
  if (hasSplit) {
    console.log("🧹 已完成中高年級科目轉換（僅用於本次排課 payload，不寫回 DB）！");
  }

  const homeroomRequirementTrace = dataStore.classes.map((cls) => {
    const homeroomSubjects = (cls.course_requirements || []).filter((req) => {
      const subject = String(req.subject || '').trim();
      return req.defaultTeacher === 'homeroom'
        && subject !== '導師區塊'
        && !subject.includes('生活')
        && !subject.includes('游泳')
        && !subject.includes('體育');
    });

    const existingHomeroomBlock = (cls.course_requirements || []).find(
      (req) => String(req.subject || '').trim() === '導師區塊'
    );

    return {
      className: cls.name,
      blockCandidatePeriods: homeroomSubjects.reduce((sum, req) => sum + (Number(req.periods) || 0), 0),
      existingHomeroomBlockPeriods: Number(existingHomeroomBlock?.periods) || 0,
      mergedSubjects: homeroomSubjects.map((req) => ({
        subject: req.subject,
        periods: Number(req.periods) || 0
      }))
    };
  }).filter((item) => item.blockCandidatePeriods > 0 || item.existingHomeroomBlockPeriods > 0);

  // 🚀 組合最乾淨的 Payload 送出給 Python
  const realPayload = {
    schoolInfo: dataStore.schoolInfo,
    teachers: dataStore.teachers,
    classes: dataStore.classes,
    specialCourses: dataStore.specialCourses,
    standardDomainSettings: dataStore.standardDomainSettings,
    classrooms: dataStore.classrooms, // 🚀 BugFix: 將專科教室資料打包送給後端
    aiSettings: dataStore.aiSettings,   // 🚀 Fix 0: 補上 AI 硬約束設定，確保後端正確讀取游泳/交替等開關
    payloadDiagnostics: {
      homeroomRequirementTrace
    }
  };

  console.log("🚀 準備發送 Payload 至後端引擎:", realPayload);

  // [Phase_ExtendTimeout Phase 1] 增加排課規模的心理建設提示
  if (!confirm("即將啟動全校排課引擎。\n\n由於班級數與約束條件龐大，運算可能需要 5 到 10 分鐘，期間請勿關閉或重新整理此視窗。\n是否確認啟動？")) {
    return;
  }

  const success = await dataStore.runSmartEngine(realPayload);

  if (!success) {
    // [Phase_ExtendTimeout Phase 1] 針對逾時做客製化提示
    if (dataStore.engineErrorMessage && dataStore.engineErrorMessage.includes('逾時')) {
      alert(`⌛ 運算時間較長：\n引擎仍在後端執行中，或網路連線已達前端等待上限。請稍後檢查排課結果。`);
    } else {
      alert(`❌ 排課引擎執行失敗！\n${dataStore.engineErrorMessage}`);
    }
  } else {
    console.log('🎉 排課完成，結果已存入 engineResult');
  }
};

/**
 * 判斷指定年級在指定星期/節次是否為「可上課時段」。
 * 作息規則：
 * - 下午節次為第 5, 6, 7 節
 * - 1、2 年級：只允許星期二(day=2)下午；星期一、三、四、五下午不上課
 * - 3、4 年級：允許星期一、二、四下午；星期三、五下午不上課
 * - 5、6 年級：星期三下午不上課，其餘下午可上課
 * - 上午(1-4節)：全年級可上課
 */
const isTeachablePeriod = (grade, day, period) => {
  if (period <= 4) return true; // 上午全年級可上
  // 下午 (5, 6, 7 節)
  if (grade === 1 || grade === 2) {
    return day === 2; // 僅星期二下午
  }
  if (grade === 3 || grade === 4) {
    return day === 1 || day === 2 || day === 4; // 一、二、四下午
  }
  // 5, 6 年級：星期三下午不上課
  return day !== 3;
};

/**
 * 從班級 course_requirements 中提取指定科目的教師姓名
 */
const getSubjectTeacher = (cls, subjectKey) => {
  if (!cls || !cls.course_requirements) return '';
  const req = cls.course_requirements.find(r =>
    r.subject === subjectKey || r.subject.includes(subjectKey)
  );
  return req ? (req.teacher_name || req.teacher || '') : '';
};

const getAiReportArtifacts = computed(() => {
  if (!dataStore.engineResult || !Array.isArray(dataStore.engineResult.schedule)) return null;

  return buildScheduleAiReport({
    scheduleEntries: dataStore.engineResult.schedule,
    classes: dataStore.classes,
    teachers: dataStore.teachers,
    classrooms: dataStore.classrooms,
    schoolInfo: dataStore.schoolInfo,
    aiSettings: dataStore.aiSettings,
    engineMeta: {
      jobId: dataStore.engineJobId,
      status: dataStore.engineStatus,
      finishedAt: dataStore.engineFinishedAt,
    },
  });
});

const aiReportJson = computed(() => getAiReportArtifacts.value?.exportJson || null);
const aiReportMarkdown = computed(() => getAiReportArtifacts.value?.exportMarkdown || '');
const aiPromptMarkdown = computed(() => getAiReportArtifacts.value?.promptMarkdown || '');

const downloadTextFile = (filename, content, mimeType = 'text/plain;charset=utf-8') => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const downloadAiMarkdown = () => {
  if (!aiReportMarkdown.value) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadTextFile(`AI課表分析報告_${stamp}.md`, aiReportMarkdown.value, 'text/markdown;charset=utf-8');
};

const downloadAiJson = () => {
  if (!aiReportJson.value) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadTextFile(`AI課表分析報告_${stamp}.json`, JSON.stringify(aiReportJson.value, null, 2), 'application/json;charset=utf-8');
};

const downloadSubmissionBundle = async () => {
  if (!aiReportJson.value || !dataStore.engineResult?.schedule) return;

  isGeneratingBundle.value = true;
  await nextTick();
  try {
    const bundle = await createSubmissionBundle(
      {
        classes: dataStore.classes,
        teachers: dataStore.teachers,
        classrooms: dataStore.classrooms,
        schoolInfo: dataStore.schoolInfo,
        engineResult: dataStore.engineResult,
        engineMeta: {
          jobId: dataStore.engineJobId,
          status: dataStore.engineStatus,
          finishedAt: dataStore.engineFinishedAt,
        },
      },
      dataStore.aiSettings,
      {
        enabled: aiStore.enabled,
        serviceType: aiStore.serviceType,
        apiUrl: aiStore.apiUrl,
        model: aiStore.model,
        systemPrompt: aiStore.systemPrompt,
        disableThinking: aiStore.disableThinking,
        maxOutputTokens: aiStore.maxOutputTokens,
        temperature: aiStore.temperature,
      },
      aiTuningFocusStrategy.value
    );

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(bundle, `ai-tuning-bundle_${stamp}.json`);
  } catch (error) {
    console.error('[ScheduleView] Bundle generation failed:', error);
    alert(`封包產生失敗：${error.message}`);
  } finally {
    isGeneratingBundle.value = false;
  }
};

const clearAiTuningState = () => {
  aiTuningError.value = null;
  aiTuningResult.value = null;
  aiPreviewSchedule.value = null;
  aiTuningJobState.value = null;
  aiTuningPromptPreview.value = null;
};

const clearAiInfeasibleState = () => {
  isAiInfeasibleAnalyzing.value = false;
  isDownloadingInfeasibleBundle.value = false;
  aiInfeasibleError.value = null;
  aiInfeasibleAnalysis.value = null;
  aiInfeasibleBundle.value = null;
  aiInfeasiblePromptBudget.value = null;
};

const buildAiConnectionSettings = () => ({
  enabled: aiStore.enabled,
  serviceType: aiStore.serviceType,
  apiUrl: aiStore.apiUrl,
  model: aiStore.model,
  systemPrompt: aiStore.systemPrompt,
  disableThinking: aiStore.disableThinking,
  maxOutputTokens: aiStore.maxOutputTokens,
  temperature: aiStore.temperature,
});

const openAiDiagnosisModal = async () => {
  showAiModal.value = true;
  if (!aiInfeasibleAnalysis.value && !isAiInfeasibleAnalyzing.value && !aiInfeasibleError.value) {
    await requestAiInfeasibleAnalysis();
  }
};

const requestAiInfeasibleAnalysis = async () => {
  aiInfeasibleError.value = null;

  if (!aiStore.enabled || !String(aiStore.apiUrl || '').trim() || !String(aiStore.model || '').trim()) {
    aiInfeasibleError.value = buildAiTuningError({
      responseStatus: 400,
      responseData: {
        code: !aiStore.enabled ? 'AI_DISABLED' : 'AI_API_URL_MISSING',
        error: !aiStore.enabled ? 'AI 功能尚未啟用' : 'AI 連線設定不完整',
      },
    });
    return;
  }

  isAiInfeasibleAnalyzing.value = true;
  aiInfeasibleAnalysis.value = null;
  aiInfeasibleBundle.value = null;
  aiInfeasiblePromptBudget.value = null;

  try {
    const result = await runAiInfeasibleAnalysis({
      apiBase: API_BASE,
      jobId: dataStore.engineJobId,
      connectionSettings: buildAiConnectionSettings(),
      maxPromptChars: 120000,
    });

    aiInfeasibleAnalysis.value = result.analysis;
    aiInfeasibleBundle.value = result.bundle || null;
    aiInfeasiblePromptBudget.value = result.promptBudget || null;
  } catch (error) {
    aiInfeasibleError.value = buildAiTuningError({
      responseStatus: error?.responseStatus ?? null,
      responseData: error?.responseData ?? (error?.code ? { code: error.code, error: error.message } : null),
      fallbackError: error,
    });
  } finally {
    isAiInfeasibleAnalyzing.value = false;
  }
};

const downloadInfeasibleBundle = async () => {
  isDownloadingInfeasibleBundle.value = true;
  try {
    let bundle = aiInfeasibleBundle.value;

    if (!bundle) {
      const jobQuery = dataStore.engineJobId ? `?jobId=${encodeURIComponent(dataStore.engineJobId)}` : '';
      const response = await fetch(`${API_BASE}/ai-infeasible-analysis-bundle${jobQuery}`);
      const rawText = await response.text();
      let data = {};

      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = { rawText };
        }
      }

      if (!response.ok || !data?.bundle) {
        throw {
          responseStatus: response.status,
          responseData: data?.bundle ? data : {
            code: data?.code || 'AI_INFEASIBLE_BUNDLE_MISSING',
            error: data?.error || '無法取得 infeasible bundle',
            details: data?.details || rawText || '',
          },
        };
      }

      bundle = data.bundle;
      aiInfeasibleBundle.value = bundle;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jobIdLabel = dataStore.engineJobId || bundle?.job?.jobId || 'latest';
    downloadJson(bundle, `infeasible-bundle_${jobIdLabel}_${stamp}.json`);
  } catch (error) {
    aiInfeasibleError.value = buildAiTuningError({
      responseStatus: error?.responseStatus ?? null,
      responseData: error?.responseData ?? null,
      fallbackError: error instanceof Error ? error : new Error(error?.message || '下載 infeasible bundle 失敗'),
    });
  } finally {
    isDownloadingInfeasibleBundle.value = false;
  }
};

const applyAiPreviewAndGoToEditor = async () => {
  const scheduleArray = aiPreviewSchedule.value || dataStore.engineResult?.schedule;
  await applyAndGoToEditor(scheduleArray);
};

const requestAiTuning = async () => {
  clearAiTuningState();
  aiTuningJobState.value = null;

  if (!aiReportJson.value || !aiPromptMarkdown.value) {
    aiTuningError.value = buildAiTuningError({ noReport: true });
    return;
  }

  if (!aiStore.enabled || !String(aiStore.apiUrl || '').trim() || !String(aiStore.model || '').trim()) {
    aiTuningError.value = buildAiTuningError({
      responseStatus: 400,
      responseData: {
        code: !aiStore.enabled ? 'ai_disabled' : 'settings_missing',
        error: !aiStore.enabled ? 'AI 功能尚未啟用' : 'AI 連線設定不完整',
      },
    });
    return;
  }

  const promptPreview = buildAiTuningPromptPreview();
  aiTuningPromptPreview.value = promptPreview;
  if (promptPreview?.promptBudget && !promptPreview.promptBudget.withinBudget) {
    const maxPromptChars = getAiTuningPromptMaxChars(aiTuningFocusStrategy.value);
    aiTuningError.value = buildAiTuningError({
      responseStatus: 413,
      responseData: {
        code: 'AI_TUNING_PROMPT_TOO_LARGE',
        error: '本輪焦點摘要仍超過安全門檻，請縮小修復範圍後再試。',
        details: `strategy=${aiTuningFocusStrategy.value}, estimated=${promptPreview.promptBudget.estimatedChars}, max=${maxPromptChars}`,
      },
    });
    return;
  }

  isAiTuning.value = true;
  try {
    const result = await runAiTuningBackgroundJob({
      apiBase: API_BASE,
      report: aiReportJson.value,
      reportMarkdown: aiPromptMarkdown.value,
      scheduleEntries: dataStore.engineResult.schedule,
      scheduleContext: {
        classes: dataStore.classes,
        teachers: dataStore.teachers,
        classrooms: dataStore.classrooms,
        schoolInfo: dataStore.schoolInfo,
        engineMeta: {
          jobId: dataStore.engineJobId,
          status: dataStore.engineStatus,
          finishedAt: dataStore.engineFinishedAt,
        },
      },
      aiSettings: dataStore.aiSettings,
      connectionSettings: buildAiConnectionSettings(),
      focusStrategy: aiTuningFocusStrategy.value,
      maxIterations: 3,
      maxMovesPerRound: 3,
      tuningContext: {
        maxPromptChars: getAiTuningPromptMaxChars(aiTuningFocusStrategy.value),
        focusStrategy: aiTuningFocusStrategy.value,
        promptRisk: promptPreview?.promptBudget || null,
        promptWarnings: promptPreview?.promptWarnings || [],
        promptMarkdown: promptPreview?.promptMarkdown || '',
        promptScope: promptPreview?.promptScope || null,
        promptReport: promptPreview?.promptReport || null,
        focus: promptPreview?.focus || null,
      },
      onProgress: (snapshot) => {
        aiTuningJobState.value = snapshot;
      },
    });

    if (result.cancelled) {
      aiTuningJobState.value = result.jobState || aiTuningJobState.value;
      await refreshAiTuningJobHistory();
      return;
    }

    aiTuningResult.value = {
      ...result.analysis,
      loopState: result.loopState,
      history: result.history,
      fallbackFromStrategy: result.fallbackFromStrategy
        || result.loopState?.fallbackFromStrategy
        || result.fallbackState?.from
        || null,
      fallbackState: result.fallbackState || null,
      jobState: result.jobState || null,
    };
    aiPreviewSchedule.value = result.previewSchedule || result.finalSchedule || [];
    aiTuningJobState.value = result.jobState || aiTuningJobState.value;
    await refreshAiTuningJobHistory();
  } catch (error) {
    aiTuningError.value = error && error.code
      ? error
      : buildAiTuningError({ fallbackError: error });
  } finally {
    isAiTuning.value = false;
    await refreshAiTuningJobHistory();
  }
};

const cancelCurrentAiTuningJob = async () => {
  const jobId = aiTuningJobState.value?.jobId;
  if (!jobId) return;

  isCancellingAiTuningJob.value = true;
  try {
    await cancelAiTuningBackgroundJob({
      apiBase: API_BASE,
      jobId,
    });
    await refreshAiTuningJobHistory();
    aiTuningJobState.value = {
      ...aiTuningJobState.value,
      status: 'CANCELLED',
      progressPhase: 'CANCELLED',
      progressMessage: '使用者已取消背景 job',
    };
  } catch (error) {
    aiTuningError.value = error && error.code
      ? error
      : buildAiTuningError({ fallbackError: error });
  } finally {
    isCancellingAiTuningJob.value = false;
  }
};

const getDayLabel = (day) => {
  const labels = { 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五' };
  return labels[Number(day)] || `週${day}`;
};

const buildMoveFallbackLabel = (move) => {
  if (!move) return '';
  const formatDay = (day) => getDayLabel(day);
  const fromLabel = move.from?.label || `${formatDay(move.from?.day)}第${move.from?.period}節`;
  const toLabel = move.to?.label || `${formatDay(move.to?.day)}第${move.to?.period}節`;
  const subjectFrom = move.from?.subjectLabel || '--';
  const subjectTo = move.to?.subjectLabel || '--';
  return `${move.className || '?'}｜${fromLabel} ${subjectFrom} ↔ ${toLabel} ${subjectTo}`;
};

const applyAndGoToEditor = async (scheduleArrayOverride = null) => {
  const scheduleArray = scheduleArrayOverride || (dataStore.engineResult && dataStore.engineResult.schedule);

  if (!scheduleArray || !Array.isArray(scheduleArray)) {
    alert("❌ 無法套用，未取得正確的課表資料格式！");
    return;
  }

  // ========== P0-2 修復：收集既有 isLocked 狀態 ==========
  // key: "className|day|period" -> { isLocked, teacher, subject }
  const existingLockMap = {};
  dataStore.classes.forEach(cls => {
    if (!cls.timetable) return;
    for (let d = 1; d <= 5; d++) {
      for (let p = 1; p <= 7; p++) {
        const slot = cls.timetable[d]?.[p];
        if (slot && slot.isLocked) {
          const key = `${cls.name}|${d}|${p}`;
          existingLockMap[key] = {
            isLocked: true,
            teacher: slot.teacher || '',
            subject: slot.subject || '',
            oddWeek: slot.oddWeek ? { ...slot.oddWeek } : null,
            evenWeek: slot.evenWeek ? { ...slot.evenWeek } : null,
          };
        }
      }
    }
  });

  // ========== 1. 初始化所有班級課表 ==========
  dataStore.classes.forEach(cls => {
    cls.timetable = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} };
  });

  // ========== 2. 第一次通過：按 className + day + period 聚合，處理音樂/美勞單雙週合併 ==========
  // key: "className|day|period" -> { items: [], subjectSlots: {} }
  const slotMap = {};
  scheduleArray.forEach(item => {
    const key = `${item.className}|${item.day}|${item.period}`;
    if (!slotMap[key]) {
      slotMap[key] = { className: item.className, day: item.day, period: item.period, items: [] };
    }
    slotMap[key].items.push(item);
  });

  // ========== 3. 寫入課表 ==========
  Object.values(slotMap).forEach(slot => {
    const targetClass = dataStore.classes.find(c => c.name === slot.className);
    if (!targetClass) return;

    const day = slot.day;
    const period = slot.period;
    const slotKey = `${slot.className}|${day}|${period}`;

    if (!targetClass.timetable[day]) targetClass.timetable[day] = {};

    const items = slot.items;

    // P1-1 修復：從 items 中提取完整的 pair 資訊
    const pairInfo = {};
    if (items.length === 1) {
      const item = items[0];
      if (item.pairGroupId) pairInfo.pairGroupId = item.pairGroupId;
      if (item.pairRole) pairInfo.pairRole = item.pairRole;
      if (item.pairPartnerClass) pairInfo.pairPartnerClass = item.pairPartnerClass;
      if (item.pairDirection) pairInfo.pairDirection = item.pairDirection;
    } else {
      // 多筆時取第一筆有 pair 資訊的
      for (const item of items) {
        if (item.pairGroupId) { pairInfo.pairGroupId = item.pairGroupId; break; }
      }
      for (const item of items) {
        if (item.pairRole) { pairInfo.pairRole = item.pairRole; break; }
      }
      for (const item of items) {
        if (item.pairPartnerClass) { pairInfo.pairPartnerClass = item.pairPartnerClass; break; }
      }
      for (const item of items) {
        if (item.pairDirection) { pairInfo.pairDirection = item.pairDirection; break; }
      }
    }

    if (items.length === 1) {
      // 單筆：直接寫入
      const item = items[0];
      targetClass.timetable[day][period] = {
        subject: item.subject,
        teacher: item.teacherName,
        ...(item.classroomId && { classroomId: item.classroomId }),
        ...(item.classroomName && { classroomName: item.classroomName }),
        ...pairInfo,
      };
    } else {
      // 多筆：檢查是否為交替課（依 item.week 動態決定 oddWeek / evenWeek）
      const hasWeekFlag = items.some(i => i.week === 'odd' || i.week === 'even');

      if (hasWeekFlag) {
        // 合併為單雙週交替格 — 依 solver 輸出的 week 欄位動態決定方向
        const oddItem = items.find(i => i.week === 'odd');
        const evenItem = items.find(i => i.week === 'even');

        if (oddItem && evenItem) {
          const sameRoom =
            (oddItem.classroomId && evenItem.classroomId && oddItem.classroomId === evenItem.classroomId) ||
            (!oddItem.classroomId && !evenItem.classroomId && oddItem.classroomName && oddItem.classroomName === evenItem.classroomName);
          targetClass.timetable[day][period] = {
            subject: `${oddItem.subject}(單)/${evenItem.subject}(雙)`,
            teacher: `${oddItem.teacherName || ''} / ${evenItem.teacherName || ''}`,
            isAlternating: true,
            ...(sameRoom && oddItem.classroomId && { classroomId: oddItem.classroomId }),
            ...(sameRoom && oddItem.classroomName && { classroomName: oddItem.classroomName }),
            oddWeek: {
              subject: oddItem.subject,
              teacher: oddItem.teacherName || '',
              ...(oddItem.classroomId && { classroomId: oddItem.classroomId }),
              ...(oddItem.classroomName && { classroomName: oddItem.classroomName }),
            },
            evenWeek: {
              subject: evenItem.subject,
              teacher: evenItem.teacherName || '',
              ...(evenItem.classroomId && { classroomId: evenItem.classroomId }),
              ...(evenItem.classroomName && { classroomName: evenItem.classroomName }),
            }
          };
        } else {
          // 只有單一週次，降级為普通寫入
          const last = items[items.length - 1];
          targetClass.timetable[day][period] = {
            subject: last.subject,
            teacher: last.teacherName,
            ...(last.classroomId && { classroomId: last.classroomId }),
            ...(last.classroomName && { classroomName: last.classroomName }),
          };
        }
      } else {
        // 向后兼容：舊格式（無 week 欄位），沿用音樂/美勞判斷邏輯
        const subjects = items.map(i => i.subject);
        const hasMusic = subjects.some(s => s.includes('音樂'));
        const hasArt = subjects.some(s => s.includes('美勞'));

        if (hasMusic && hasArt) {
          const musicItem = items.find(i => i.subject.includes('音樂'));
          const artItem = items.find(i => i.subject.includes('美勞'));

          const musicTeacher = getSubjectTeacher(targetClass, '音樂') || musicItem?.teacherName || '';
          const artTeacher = getSubjectTeacher(targetClass, '美勞') || artItem?.teacherName || '';

          targetClass.timetable[day][period] = {
            subject: '音樂(單)/美勞(雙)',
            teacher: `${musicTeacher} / ${artTeacher}`,
            isAlternating: true,
            ...pairInfo,
            ...(musicItem?.classroomId && artItem?.classroomId && musicItem.classroomId === artItem.classroomId && { classroomId: musicItem.classroomId }),
            ...(musicItem?.classroomName && artItem?.classroomName && musicItem.classroomName === artItem.classroomName && { classroomName: musicItem.classroomName }),
            oddWeek: {
              subject: '音樂',
              teacher: musicTeacher,
              ...(musicItem?.classroomId && { classroomId: musicItem.classroomId }),
              ...(musicItem?.classroomName && { classroomName: musicItem.classroomName }),
            },
            evenWeek: {
              subject: '美勞',
              teacher: artTeacher,
              ...(artItem?.classroomId && { classroomId: artItem.classroomId }),
              ...(artItem?.classroomName && { classroomName: artItem.classroomName }),
            }
          };
        } else {
          // 其他多筆情況：取最後一筆
          const last = items[items.length - 1];
          targetClass.timetable[day][period] = {
            subject: last.subject,
            teacher: last.teacherName,
            ...pairInfo,
          };
        }
      }
    }
  });

  // ========== P0-2 修復：恢復 isLocked 狀態 ==========
  // 遍歷所有已寫入的 slot，檢查是否有對應的既有 lock
  dataStore.classes.forEach(cls => {
    if (!cls.timetable) return;
    for (let d = 1; d <= 5; d++) {
      for (let p = 1; p <= 7; p++) {
        const slotKey = `${cls.name}|${d}|${p}`;
        const currentSlot = cls.timetable[d]?.[p];
        const prevLock = existingLockMap[slotKey];

        if (currentSlot && prevLock) {
          // 判斷是否為「同一格位」：同一班級、同一天、同一節次
          // 如果新結果的教師和科目與之前相同（或接近），保留 lock
          const teacherMatch = currentSlot.teacher && prevLock.teacher &&
            (currentSlot.teacher.includes(prevLock.teacher) || prevLock.teacher.includes(currentSlot.teacher));
          const subjectMatch = currentSlot.subject && prevLock.subject &&
            (currentSlot.subject.includes(prevLock.subject) || prevLock.subject.includes(currentSlot.subject));

          if (teacherMatch || subjectMatch) {
            currentSlot.isLocked = true;
          }
        }
      }
    }
  });

  // ========== 4. 填充導師區塊：只在「可上課時段」且 Python 未排到的格子補導師區塊 ==========
  dataStore.classes.forEach(cls => {
    const gradeMatch = String(cls.name).match(/(\d+)年/) || String(cls.name).match(/^(\d)/);
    const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : 1;

    // 取得該班導師姓名 — 直接使用 cls.homeroom_teacher，避免 course_requirements 來源不一致導致誤報
    const homeroomTeacher = cls.homeroom_teacher || '';

    for (let d = 1; d <= 5; d++) {
      for (let p = 1; p <= 7; p++) {
        if (!isTeachablePeriod(grade, d, p)) {
          // 不可上課時段：保持空白，不寫入任何資料
          continue;
        }
        // 如果該格子還沒有課程，填入導師區塊
        if (!cls.timetable[d]?.[p] && homeroomTeacher) {
          if (!cls.timetable[d]) cls.timetable[d] = {};
          cls.timetable[d][p] = {
            subject: '導師區塊',
            teacher: homeroomTeacher
          };
        }
      }
    }
  });

  // ========== 5. 標記為未儲存，並觸發同步存入資料庫 ==========
  dataStore.markScheduleDirty();
  try {
    await dataStore.syncToCloud();
    alert('✅ 完美排課結果已成功套用並存入資料庫！');

    // 套用成功後，這筆 engineResult 已成為正式資料，不應再被未套用保護攔下。
    dataStore.resetEngineState();

    // 6. 切換頁面到「人工微調編輯器」
    router.push('/editor');
  } catch (error) {
    console.error(error);
    alert('⚠️ 課表已套用，但儲存至資料庫時發生異常。');
  }
};
</script>

<style scoped>
/* 保持你原本的樣式不變 */
.schedule-container { max-width: 800px; margin: 0 auto; padding: 20px; font-family: sans-serif; }
.control-panel { margin-bottom: 20px; gap: 10px; display: flex; }
button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
.start-btn { background-color: #4CAF50; color: white; border: none; border-radius: 4px; }
.start-btn:disabled { background-color: #cccccc; cursor: not-allowed; }
.reset-btn { background-color: #f44336; color: white; border: none; border-radius: 4px; }
.error { color: #f44336; }
.json-box { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; max-height: 400px; }

.apply-btn {
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 1.1em;
  font-weight: bold;
  cursor: pointer;
  margin: 15px 0;
  width: 100%;
  box-shadow: 0 4px 6px rgba(16, 185, 129, 0.3);
  transition: all 0.2s;
}

.apply-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(16, 185, 129, 0.4);
}

.result-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 15px 0;
}

.secondary-btn {
  background: #f8fafc;
  color: #334155;
  border: 1px solid #cbd5e1;
  padding: 12px 18px;
  border-radius: 8px;
  font-size: 1em;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.secondary-btn:hover {
  background: #e2e8f0;
}

.ai-tune-btn {
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  color: white;
  border: none;
  padding: 12px 18px;
  border-radius: 8px;
  font-size: 1em;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.ai-tune-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.ai-error-box {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fca5a5;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}

.ai-error-title {
  display: block;
  margin-bottom: 6px;
}

.ai-error-message {
  margin: 0;
  line-height: 1.6;
}

.ai-error-steps {
  margin-top: 12px;
  background: #fff;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 12px 14px;
}

.ai-error-steps strong {
  display: inline-block;
  margin-bottom: 6px;
}

.ai-error-steps ol {
  margin: 0 0 0 20px;
  padding: 0;
}

.ai-error-steps li + li {
  margin-top: 4px;
}

.ai-error-details {
  margin-top: 12px;
  background: #fff;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 12px;
}

.ai-error-details summary {
  cursor: pointer;
  font-weight: 700;
}

.ai-error-details pre {
  margin: 10px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #7f1d1d;
  background: #fff7f7;
  padding: 10px;
  border-radius: 6px;
}

.ai-tuning-panel {
  background: #faf5ff;
  border: 1px solid #e9d5ff;
  border-left: 4px solid #8b5cf6;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}

.ai-tuning-panel h4 {
  margin: 0 0 10px 0;
  color: #5b21b6;
}

.ai-tuning-summary,
.ai-tuning-confidence {
  margin: 6px 0;
  color: #4c1d95;
}

.ai-tuning-toolbar {
  margin-bottom: 12px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  text-align: left;
}

.ai-tuning-field {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.ai-tuning-field span {
  font-weight: 700;
  color: #334155;
}

.ai-tuning-field select {
  min-width: 180px;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
}

.ai-tuning-helper {
  margin: 8px 0 0;
  color: #475569;
  font-size: 0.9em;
}

.ai-tuning-loop-state {
  margin-top: 10px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}

.ai-tuning-focus {
  margin-top: 10px;
  padding: 10px 12px;
  background: #fff7ed;
  border: 1px solid #fdba74;
  border-radius: 8px;
}

.ai-tuning-job-state {
  margin-top: 10px;
  padding: 10px 12px;
  background: #eff6ff;
  border: 1px solid #93c5fd;
  border-radius: 8px;
}

.ai-tuning-job-state__header,
.ai-tuning-history-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ai-tuning-progress {
  margin-top: 10px;
}

.ai-tuning-progress__track {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: #dbeafe;
  overflow: hidden;
}

.ai-tuning-progress__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2563eb, #22c55e);
  transition: width 0.25s ease;
}

.ai-tuning-progress__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  font-size: 0.9em;
  color: #475569;
}

.ai-tuning-job-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.ai-tuning-job-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #dbeafe;
}

.ai-tuning-job-label {
  font-size: 0.82em;
  color: #64748b;
}

.ai-tuning-job-value {
  font-weight: 600;
  color: #0f172a;
  word-break: break-word;
}

.ai-tuning-job-value--message {
  font-weight: 500;
}

.ai-tuning-job-state__preview-risk,
.ai-tuning-prompt-preview {
  margin-top: 10px;
  color: #0f766e;
  font-size: 0.92em;
}

.ai-tuning-cancel-btn {
  background: #fff7ed;
  border-color: #fdba74;
  color: #9a3412;
}

.ai-tuning-history-panel {
  margin-top: 16px;
  padding: 12px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  text-align: left;
}

.ai-tuning-history-list {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}

.ai-tuning-history-item {
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.ai-tuning-history-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  align-items: center;
  cursor: pointer;
}

.ai-tuning-history-id {
  font-family: monospace;
  color: #334155;
}

.ai-tuning-history-status {
  justify-self: end;
  padding: 2px 8px;
  border-radius: 999px;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 0.82em;
  font-weight: 700;
}

.ai-tuning-history-status--completed {
  background: #dcfce7;
  color: #15803d;
}

.ai-tuning-history-status--failed,
.ai-tuning-history-status--cancelled {
  background: #fee2e2;
  color: #b91c1c;
}

.ai-tuning-history-meta {
  grid-column: 1 / -1;
  color: #475569;
  font-size: 0.92em;
}

.ai-tuning-history-body {
  margin-top: 10px;
  color: #334155;
  display: grid;
  gap: 4px;
}

.ai-tuning-history-error {
  color: #b91c1c;
  margin-top: 10px;
}

.ai-tuning-history-empty {
  color: #64748b;
  margin-top: 10px;
}

.ai-tuning-fallback-note {
  margin-top: 10px;
  padding: 10px 12px;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  color: #92400e;
}

.ai-tuning-warnings,
.ai-tuning-moves {
  margin-top: 12px;
  background: white;
  border: 1px solid #e9d5ff;
  border-radius: 8px;
  padding: 12px;
}

.ai-tuning-warnings ul,
.ai-tuning-moves ul {
  margin: 8px 0 0 18px;
}

.ai-tuning-move-id {
  font-family: monospace;
  color: #6d28d9;
  font-size: 0.85em;
  margin-right: 8px;
}

.ai-tuning-move-summary {
  color: #1e293b;
  font-weight: 500;
}

.ai-tuning-move-reason {
  color: #64748b;
  font-size: 0.9em;
  margin-left: 6px;
}

.ai-tuning-debug {
  margin-top: 8px;
  padding: 8px;
  background: #f1f5f9;
  border-radius: 6px;
  font-size: 0.85em;
  color: #64748b;
}

.ai-tuning-debug summary {
  cursor: pointer;
  font-weight: 600;
}

.ai-tuning-actionable {
  margin-top: 12px;
  background: #fff7ed;
  border: 1px solid #fdba74;
  border-radius: 8px;
  padding: 12px;
}

.ai-tuning-actionable strong {
  color: #9a3412;
  display: block;
  margin-bottom: 6px;
}

.ai-tuning-actionable ul {
  margin: 0 0 0 18px;
  padding: 0;
}

.ai-tuning-actionable-item {
  color: #7c2d12;
  line-height: 1.6;
  margin-bottom: 4px;
}

.ai-tuning-actionable-suggestion {
  color: #059669;
  font-weight: 600;
}

/* ===== 進度面板 ===== */
.progress-panel {
  background: #eff6ff;
  border: 2px solid #3b82f6;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}

.progress-panel .spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #bfdbfe;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.progress-panel .phase-badge {
  display: inline-block;
  background: #3b82f6;
  color: white;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.85em;
  font-weight: bold;
  margin-bottom: 8px;
}

/* ===== progress-header ===== */
.progress-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
}

.phase-badge {
  display: inline-block;
  background: #3b82f6;
  color: white;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.85em;
  font-weight: bold;
}

.phase-solving { background: #f59e0b; }
.phase-repairing { background: #6366f1; }
.phase-finalizing { background: #8b5cf6; }
.phase-completed { background: #22c55e; }
.phase-failed { background: #ef4444; }

.pulse-indicator {
  width: 12px;
  height: 12px;
  background: #3b82f6;
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}

/* ===== progress-details ===== */
.progress-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 16px;
  text-align: left;
  background: white;
  padding: 16px;
  border-radius: 8px;
  font-size: 0.9em;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid #f3f4f6;
}

.detail-row .label {
  color: #6b7280;
}

.detail-row .value {
  font-weight: bold;
  color: #111827;
  font-family: monospace;
}

.detail-row .value.warning {
  color: #d97706;
}

.detail-row .value.message {
  font-family: sans-serif;
  color: #1e40af;
}

.detail-row .value.time {
  color: #059669;
}

/* ===== progress-note ===== */
.progress-note {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 6px;
  font-size: 0.9em;
}

/* ===== 錯誤面板 ===== */
.error-panel {
  background: #fef2f2;
  border: 2px solid #ef4444;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}

.error-panel h3 {
  color: #dc2626;
  margin: 0 0 8px;
}

.error-details {
  background: white;
  padding: 16px;
  border-radius: 8px;
  margin: 12px 0;
  text-align: left;
}

.error-details p {
  color: #991b1b;
  margin: 6px 0;
  font-size: 0.9em;
}

.retry-btn {
  background: #ef4444;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1em;
  margin-top: 12px;
}

.retry-btn:hover {
  background: #dc2626;
}

/* ===== 空閒狀態面板 ===== */
.idle-panel {
  background: #f9fafb;
  border: 2px dashed #d1d5db;
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  color: #6b7280;
}

.idle-panel .icon {
  font-size: 3em;
  margin-bottom: 12px;
}

.idle-panel h3 {
  margin: 0 0 8px;
  color: #374151;
}

.idle-panel p {
  margin: 0;
  font-size: 0.95em;
}

/* ===== 結果面板 ===== */
.result-panel {
  background: #f0fdf4;
  border: 2px solid #22c55e;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}

.result-panel h3 {
  color: #16a34a;
  margin: 0 0 8px;
}

.result-summary {
  background: white;
  padding: 16px;
  border-radius: 8px;
  margin: 12px 0;
  text-align: left;
}

.result-summary p {
  color: #166534;
  margin: 6px 0;
  font-size: 0.9em;
}

.result-panel .json-box {
  background: white;
  border: 1px solid #bbf7d0;
  padding: 16px;
  border-radius: 8px;
  margin-top: 16px;
  text-align: left;
  max-height: 400px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 0.85em;
}

/* ===== 錯誤操作按鈕區 ===== */
.error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 16px;
}

/* ===== AI 診斷按鈕 ===== */
.ai-diagnosis-btn {
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 1em;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 6px rgba(139, 92, 246, 0.3);
}

.ai-diagnosis-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(139, 92, 246, 0.4);
}

.ai-deep-analysis-btn {
  background: linear-gradient(135deg, #0f766e, #115e59);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 1em;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 6px rgba(15, 118, 110, 0.28);
}

.ai-deep-analysis-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(15, 118, 110, 0.35);
}

.ai-deep-analysis-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

/* ===== Modal Overlay ===== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}

/* ===== AI Modal 內容區塊 ===== */
.ai-modal-content {
  background: white;
  border-radius: 16px;
  width: 90%;
  max-width: 700px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  animation: modalSlideIn 0.3s ease-out;
}

@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: translateY(-30px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.ai-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 2px solid #f1f5f9;
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  color: white;
  border-radius: 16px 16px 0 0;
}

.ai-modal-header h3 {
  margin: 0;
  font-size: 1.3em;
}

.modal-close-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  font-size: 1.2em;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.4);
}

.ai-modal-body {
  padding: 24px;
}

.ai-modal-intro {
  color: #475569;
  font-size: 0.95em;
  margin-bottom: 16px;
  padding: 12px;
  background: #f8fafc;
  border-left: 4px solid #8b5cf6;
  border-radius: 4px;
}

.ai-analysis-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.ai-analysis-list li {
  padding: 14px 16px;
  margin-bottom: 10px;
  background: #faf5ff;
  border: 1px solid #e9d5ff;
  border-radius: 8px;
  color: #4c1d95;
  font-size: 0.95em;
  line-height: 1.6;
  border-left: 4px solid #8b5cf6;
}

.ai-analysis-list li:hover {
  background: #f3e8ff;
}

.ai-empty {
  text-align: center;
  color: #94a3b8;
  padding: 30px;
  font-style: italic;
}

.ai-deep-analysis-panel {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #e2e8f0;
}

.ai-deep-analysis-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}

.ai-deep-analysis-header h4 {
  margin: 0 0 6px;
  color: #0f172a;
}

.ai-deep-analysis-header p {
  margin: 0;
  color: #475569;
  font-size: 0.92em;
}

.ai-deep-analysis-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.ai-deep-analysis-budget {
  margin: 0 0 16px;
  color: #0f766e;
  font-size: 0.9em;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
  border-radius: 8px;
  padding: 10px 12px;
}

.ai-deep-analysis-result {
  display: grid;
  gap: 16px;
}

.ai-deep-analysis-summary {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 16px;
  text-align: left;
}

.ai-deep-analysis-summary strong {
  color: #0f172a;
}

.ai-deep-analysis-summary p {
  margin: 8px 0 0;
  color: #334155;
  line-height: 1.6;
}

.ai-deep-analysis-section {
  text-align: left;
}

.ai-deep-analysis-section h5 {
  margin: 0 0 10px;
  color: #0f172a;
  font-size: 0.98em;
}

.ai-deep-analysis-items {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
}

.ai-deep-analysis-items li {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 16px;
}

.ai-deep-analysis-items strong {
  color: #0f172a;
}

.ai-deep-analysis-items span {
  color: #475569;
  font-size: 0.9em;
}

.ai-deep-analysis-items p {
  margin: 8px 0 0;
  color: #334155;
  line-height: 1.6;
}

.ai-deep-analysis-evidence,
.ai-deep-analysis-rationale {
  color: #475569;
  font-size: 0.92em;
}

.ai-modal-footer {
  padding: 16px 24px;
  border-top: 1px solid #f1f5f9;
  text-align: center;
}

.modal-close-full-btn {
  background: #64748b;
  color: white;
  border: none;
  padding: 10px 32px;
  border-radius: 6px;
  font-size: 1em;
  cursor: pointer;
  transition: background 0.2s;
}

.modal-close-full-btn:hover {
  background: #475569;
}
</style>
