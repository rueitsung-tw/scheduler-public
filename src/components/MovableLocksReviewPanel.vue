<template>
  <div v-if="shouldRender" class="movable-locks-review-panel" data-testid="movable-locks-review-panel">
    <div class="panel-header">
      <div class="header-title">
        <span class="warning-icon">⚠️</span>
        <h3>鎖定課微調審核</h3>
      </div>
      <span class="review-badge">需要人工審核 (requiresUserReview)</span>
    </div>

    <!-- 動態警示文字區塊 -->
    <div 
      class="blocking-warning-box"
      :class="{
        'box-rejected': isAnyRejected,
        'box-accepted': isAllAccepted,
        'box-pending': !isAnyRejected && !isAllAccepted
      }"
    >
      <template v-if="isAnyRejected">
        <strong>⛔ 此排課結果不可直接套用</strong>
        <p class="warning-subtext">
          包含已被拒絕的鎖定課微調建議。在進行重新微調設定或重跑求解器前，不可套用此結果。
        </p>
      </template>
      <template v-else-if="isAllAccepted">
        <strong>✅ 已完成所有微調審核</strong>
        <p class="warning-subtext">
          所有鎖定課微調建議已全數審核同意，可以正式套用此課表結果。
        </p>
      </template>
      <template v-else>
        <strong>⚠️ 系統提出了鎖定課微調建議，需人工審核後才能視為正式安排。</strong>
        <p class="warning-subtext">
          本排課結果包含被系統微調移位的鎖定課程。在進行人工審核確認前，不可將此結果視為正式排課版本。
        </p>
      </template>
    </div>

    <!-- 摘要統計 -->
    <div class="summary-cards">
      <div class="summary-card">
        <span class="card-label">微調建議數量</span>
        <span class="card-value highlight">{{ movedCount }} 堂</span>
      </div>
      <div class="summary-card">
        <span class="card-label">待審核數量</span>
        <span class="card-value" :class="{ 'val-warning': decisionSummary.pendingCount > 0 }">{{ decisionSummary.pendingCount }} 堂</span>
      </div>
      <div class="summary-card">
        <span class="card-label">已同意數量</span>
        <span class="card-value" :class="{ 'val-success': decisionSummary.acceptedCount > 0 }">{{ decisionSummary.acceptedCount }} 堂</span>
      </div>
      <div class="summary-card">
        <span class="card-label">已拒絕數量</span>
        <span class="card-value" :class="{ 'val-danger': decisionSummary.rejectedCount > 0 }">{{ decisionSummary.rejectedCount }} 堂</span>
      </div>
      <div class="summary-card">
        <span class="card-label">微調政策開關</span>
        <span class="card-value">{{ policyEnabled ? '已啟用 (Enabled)' : '未啟用 / 預設' }}</span>
      </div>
      <div class="summary-card">
        <span class="card-label">允許微調範圍</span>
        <span class="card-value">{{ formatScope(moveScope) }}</span>
      </div>
    </div>

    <!-- 微調明細列表 / 表格 -->
    <div class="details-section">
      <h4>微調明細對照表 ({{ movedLessons.length }} 筆)</h4>
      
      <div class="responsive-table-wrapper">
        <table class="movable-locks-table">
          <thead>
            <tr>
              <th>班級</th>
              <th>科目</th>
              <th>鎖定類別</th>
              <th>原始時段 (From)</th>
              <th>建議新時段 (To)</th>
              <th>移動範圍</th>
              <th>距離 (節)</th>
              <th>懲罰扣分</th>
              <th>微調理由</th>
              <th>審核狀態</th>
              <th>審核操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in movedLessons" :key="index">
              <td class="font-bold">{{ getFieldValue(item, ['className', 'class_name', 'class']) }}</td>
              <td>{{ getFieldValue(item, ['subject', 'subjectName']) }}</td>
              <td>
                <span class="type-tag" :class="getTypeTagClass(item)">
                  {{ getLockTypeLabel(item) }}
                </span>
              </td>
              <td class="period-from">{{ formatPeriodSlot(item.from || item.originalPeriod || item.original_slot) }}</td>
              <td class="period-to">{{ formatPeriodSlot(item.to || item.newPeriod || item.new_slot) }}</td>
              <td>{{ formatScope(item.moveScope || item.scope) }}</td>
              <td>{{ getFieldValue(item, ['periodDistance', 'distance'], '-') }}</td>
              <td class="penalty-val">{{ getFieldValue(item, ['totalPenalty', 'penalty'], '-') }}</td>
              <td class="reason-cell" :title="getReasonText(item)">{{ getReasonText(item) }}</td>
              <td>
                <span class="status-badge" :class="getDecisionBadgeClass(getDecision(item, index))">
                  {{ getDecisionLabel(getDecision(item, index)) }}
                </span>
              </td>
              <td class="action-cell">
                <div class="action-buttons">
                  <button 
                    class="btn-action btn-accept" 
                    :disabled="getDecision(item, index) !== 'pending_review'"
                    title="同意此微調建議"
                    @click="handleAccept(item, index)"
                  >
                    同意
                  </button>
                  <button 
                    class="btn-action btn-reject" 
                    :disabled="getDecision(item, index) !== 'pending_review'"
                    title="拒絕此微調建議"
                    @click="handleReject(item, index)"
                  >
                    拒絕
                  </button>
                  <button 
                    class="btn-action btn-undo" 
                    :disabled="getDecision(item, index) === 'pending_review'"
                    title="撤回微調審核決定"
                    @click="handleUndo(item, index)"
                  >
                    撤回決定
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useScheduleStore } from '../stores/schedule';

const props = defineProps({
  reviewData: {
    type: Object,
    default: null
  },
  policyData: {
    type: Object,
    default: null
  }
});

const scheduleStore = useScheduleStore();

const activeReviewData = computed(() => {
  return props.reviewData || scheduleStore.movableLocksReviewData || null;
});

const activePolicy = computed(() => {
  return props.policyData || scheduleStore.movableLocksPolicy || {};
});

const movedLessons = computed(() => {
  const data = activeReviewData.value;
  if (!data || !Array.isArray(data.movedLockedLessons)) {
    return [];
  }
  return data.movedLockedLessons;
});

const shouldRender = computed(() => {
  const data = activeReviewData.value;
  if (!data) return false;
  const requiresReview = data.requiresUserReview === true;
  const hasMoved = movedLessons.value.length > 0;
  return requiresReview && hasMoved;
});

const movedCount = computed(() => {
  const summaryCount = activeReviewData.value?.movableLockSummary?.totalMoved 
    ?? activeReviewData.value?.movableLockSummary?.moveCount;
  if (typeof summaryCount === 'number') {
    return summaryCount;
  }
  return movedLessons.value.length;
});

const policyEnabled = computed(() => {
  return activePolicy.value?.movableLocksEnabled 
    ?? activeReviewData.value?.movableLockSummary?.enabled 
    ?? false;
});

const moveScope = computed(() => {
  return activePolicy.value?.moveWindow?.scope 
    || activeReviewData.value?.movableLockSummary?.moveScope 
    || 'same_day';
});

const decisionSummary = computed(() => {
  return scheduleStore.movableLockDecisionSummary || {
    totalCount: 0,
    pendingCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    invalidCount: 0
  };
});

const isAnyRejected = computed(() => {
  return scheduleStore.hasRejectedMovableLockReviews || decisionSummary.value.rejectedCount > 0;
});

const isAllAccepted = computed(() => {
  return scheduleStore.areAllMovableLockReviewsAccepted || (
    movedLessons.value.length > 0 && decisionSummary.value.acceptedCount === movedLessons.value.length
  );
});

function getMoveKey(item, index) {
  if (typeof scheduleStore.getMovableLockDecisionKeyForMove === 'function') {
    return scheduleStore.getMovableLockDecisionKeyForMove(item, index);
  }
  return scheduleStore.getMovableLockMoveKey(item, index);
}

function getDecision(item, index) {
  const key = getMoveKey(item, index);
  return scheduleStore.movableLockReviewDecisions?.[key]?.decision || 'pending_review';
}

function getDecisionLabel(decision) {
  switch (decision) {
    case 'accepted':
      return '已同意';
    case 'rejected':
      return '已拒絕';
    case 'pending_review':
    default:
      return '待審核';
  }
}

function getDecisionBadgeClass(decision) {
  switch (decision) {
    case 'accepted':
      return 'badge-accepted';
    case 'rejected':
      return 'badge-rejected';
    case 'pending_review':
    default:
      return 'badge-pending';
  }
}

function handleAccept(item, index) {
  const key = getMoveKey(item, index);
  scheduleStore.acceptMovableLockMove(key);
}

function handleReject(item, index) {
  const key = getMoveKey(item, index);
  scheduleStore.rejectMovableLockMove(key);
}

function handleUndo(item, index) {
  const key = getMoveKey(item, index);
  scheduleStore.resetMovableLockMoveDecision(key);
}

function formatScope(scopeStr) {
  if (!scopeStr || scopeStr === '-') return '未指定';
  switch (scopeStr) {
    case 'same_day':
    case 'sameDay':
      return '同日平移 (same_day)';
    case 'same_halfday':
    case 'sameHalfday':
      return '同半天平移 (same_halfday)';
    case 'same_week':
    case 'sameWeek':
      return '同週平移 (same_week)';
    default:
      return scopeStr;
  }
}

function formatPeriodSlot(slot) {
  if (!slot) return '未提供';
  if (typeof slot === 'string') return slot;
  
  const day = slot.day ?? slot.weekday ?? slot.Day;
  const period = slot.period ?? slot.section ?? slot.Period;
  
  if (day === undefined || period === undefined) {
    return JSON.stringify(slot);
  }
  
  const dayMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };
  return `星期${dayMap[day] || day} 第 ${period} 節`;
}

function getFieldValue(obj, fieldNames, fallback = '未提供') {
  if (!obj) return fallback;
  for (const name of fieldNames) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== '') {
      return obj[name];
    }
  }
  return fallback;
}

function getLockTypeLabel(item) {
  const type = item.lockType || item.lock_type || item.type || item.specialCourseType;
  if (!type) return '人工鎖定';
  if (type === 'manual_subject_lock' || type === 'manualSubject') return '人工科目鎖';
  if (type === 'pullout_lock' || type === 'pullout' || type === 'specialCourse') return '抽離課程鎖';
  return type;
}

function getTypeTagClass(item) {
  const type = item.lockType || item.lock_type || item.type;
  if (type?.includes('pullout') || item.specialCourseType) return 'tag-pullout';
  return 'tag-manual';
}

function getReasonText(item) {
  const r = item.reason || item.movementReason || item.movement_reason;
  if (!r) return '疏緩空間壓力';
  if (r === 'relieved_structural_schedule_pressure') return '疏緩全域結構性壓力';
  return r;
}
</script>

<style scoped>
.movable-locks-review-panel {
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 12px;
  padding: 20px;
  margin: 20px 0;
  box-shadow: 0 2px 8px rgba(250, 173, 20, 0.12);
  color: #1f1f1f;
  text-align: left;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  border-bottom: 1px solid #ffe58f;
  padding-bottom: 12px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #d46b08;
  font-weight: 700;
}

.warning-icon {
  font-size: 1.3rem;
}

.review-badge {
  background: #fa8c16;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 20px;
}

.blocking-warning-box {
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  border: 1px solid #ffbb96;
  border-left: 4px solid #ff4d4f;
  background: #fff2e8;
  transition: all 0.3s ease;
}

.box-pending {
  background: #fff2e8;
  border-color: #ffbb96;
  border-left-color: #fa8c16;
}

.box-pending strong {
  color: #d46b08;
  font-size: 1rem;
  display: block;
}

.box-accepted {
  background: #f6ffed;
  border-color: #b7eb8f;
  border-left-color: #52c41a;
}

.box-accepted strong {
  color: #278200;
  font-size: 1rem;
  display: block;
}

.box-rejected {
  background: #fff1f0;
  border-color: #ffa39e;
  border-left-color: #ff4d4f;
}

.box-rejected strong {
  color: #a8071a;
  font-size: 1rem;
  display: block;
}

.warning-subtext {
  margin: 4px 0 0 0;
  color: #595959;
  font-size: 0.9rem;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.summary-card {
  background: #ffffff;
  border: 1px solid #ffd591;
  padding: 12px 14px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-label {
  font-size: 0.82rem;
  color: #8c8c8c;
}

.card-value {
  font-size: 1.05rem;
  font-weight: 600;
  color: #262626;
}

.card-value.highlight {
  color: #d46b08;
  font-size: 1.2rem;
}

.val-warning {
  color: #fa8c16;
}

.val-success {
  color: #389e0d;
}

.val-danger {
  color: #cf1322;
}

.details-section h4 {
  margin: 0 0 12px 0;
  font-size: 1rem;
  color: #434343;
}

.responsive-table-wrapper {
  overflow-x: auto;
  border: 1px solid #ffe58f;
  border-radius: 8px;
  background: #ffffff;
}

.movable-locks-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.movable-locks-table th {
  background: #fff7e6;
  color: #8c4400;
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #ffe58f;
  white-space: nowrap;
}

.movable-locks-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
  color: #333;
}

.movable-locks-table tr:last-child td {
  border-bottom: none;
}

.period-from {
  color: #cf1322;
  font-weight: 500;
}

.period-to {
  color: #389e0d;
  font-weight: 600;
}

.type-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
}

.tag-manual {
  background: #e6f7ff;
  color: #096dd9;
  border: 1px solid #91d5ff;
}

.tag-pullout {
  background: #f9f0ff;
  color: #531dab;
  border: 1px solid #d3ade6;
}

.status-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.82rem;
  font-weight: 600;
}

.badge-pending {
  background: #fff7e6;
  color: #d46b08;
  border: 1px solid #ffd591;
}

.badge-accepted {
  background: #f6ffed;
  color: #389e0d;
  border: 1px solid #b7eb8f;
}

.badge-rejected {
  background: #fff1f0;
  color: #cf1322;
  border: 1px solid #ffa39e;
}

.action-cell {
  white-space: nowrap;
}

.action-buttons {
  display: flex;
  gap: 6px;
  align-items: center;
}

.btn-action {
  padding: 4px 10px;
  font-size: 0.82rem;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.btn-accept {
  background-color: #f6ffed;
  color: #389e0d;
  border-color: #b7eb8f;
}

.btn-accept:hover:not(:disabled) {
  background-color: #389e0d;
  color: #ffffff;
}

.btn-reject {
  background-color: #fff1f0;
  color: #cf1322;
  border-color: #ffa39e;
}

.btn-reject:hover:not(:disabled) {
  background-color: #cf1322;
  color: #ffffff;
}

.btn-undo {
  background-color: #f5f5f5;
  color: #595959;
  border-color: #d9d9d9;
}

.btn-undo:hover:not(:disabled) {
  background-color: #d9d9d9;
  color: #1f1f1f;
}

.btn-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  background-color: #f5f5f5 !important;
  color: #bfbfbf !important;
  border-color: #d9d9d9 !important;
}

.font-bold {
  font-weight: 600;
}

.reason-cell {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.penalty-val {
  font-family: monospace;
}
</style>
