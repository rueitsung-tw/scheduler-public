<template>
  <div class="grade-time-rule-editor">
    <!-- Master Toggle Header -->
    <div class="header-bar">
      <div class="master-control">
        <label class="switch">
          <input
            type="checkbox"
            data-testid="master-toggle"
            :checked="canonicalSettings.enabled"
            @change="toggleMasterEnabled($event.target.checked)"
            @click="onMasterToggleClick"
          />
          <span class="slider round"></span>
        </label>
        <div class="master-label">
          <span class="main-title">年級時段與共備規則管理 (Grade-Time Rules)</span>
          <span class="sub-title">統一管理全校年級排課時段約束、年級導師共備與特定時間規則</span>
        </div>
      </div>
    </div>

    <!-- Quality Rules Non-Overwrite Statement Banner -->
    <div class="quality-rules-statement-banner">
      <span class="banner-icon">ℹ️</span>
      <div class="banner-text">
        本區規則不會關閉或取代排課品質設定。「體育課避免第 4、5 節」與「第 7 節優先安排校本／彈性課程」仍會持續生效。若 Hard 年級規則與品質偏好相反，系統會先顯示風險，但品質違規分數仍會保留。
      </div>
    </div>

    <!-- Warning Confirmation Bar (if warnings present and master enabled) -->
    <div v-if="canonicalSettings.enabled && hasWarnings" class="warning-confirmation-bar">
      <div class="warning-info">
        <span class="warning-icon">⚠️</span>
        <span>系統偵測到排課風險（教師或空間容量風險），需要排課前確認。</span>
      </div>
      <button
        type="button"
        data-testid="confirm-warning-btn"
        class="btn-confirm-warning"
        :class="{ confirmed: isWarningConfirmed }"
        @click="toggleWarningConfirmed"
      >
        {{ isWarningConfirmed ? '✓ 已確認風險' : '確認風險並繼續' }}
      </button>
    </div>

    <!-- Tab Navigation -->
    <div class="tab-nav">
      <button
        type="button"
        data-testid="coplanning-quick-settings-tab"
        :class="{ active: activeTab === 'quick' }"
        @click="activeTab = 'quick'"
      >
        🤝 共備快速設定
      </button>
      <button
        type="button"
        data-testid="advanced-rules-tab"
        :class="{ active: activeTab === 'rules' }"
        @click="activeTab = 'rules'"
      >
        ⚙️ 進階年級規則
      </button>
    </div>

    <!-- TAB 1: 共備快速設定 (Quick Co-Planning Settings) -->
    <div v-if="activeTab === 'quick'" class="tab-content">
      <div class="quick-coplan-container">
        <p class="section-desc">
          為年級導師設定共同空堂（共備）時段。支援候選區塊（自動模組偏好選擇）與固定時段兩種模式。
        </p>

        <!-- Grade Selector Quick Bar (Grades 1 to 6) -->
        <div class="grade-quick-bar">
          <span class="bar-label">設定年級：</span>
          <div class="grade-chips">
            <button
              v-for="g in [1, 2, 3, 4, 5, 6]"
              :key="g"
              type="button"
              :class="['grade-chip', { active: activeQuickGrade === g, hasRule: hasCoPlanRule(g) }]"
              @click="activeQuickGrade = g"
            >
              {{ g }}年級
              <span v-if="hasCoPlanRule(g)" class="dot">●</span>
            </button>
          </div>
        </div>

        <!-- Grade Co-Planning Rule Form -->
        <div class="co-plan-rule-card">
          <div class="card-header">
            <h4>{{ activeQuickGrade }} 年級共備設定</h4>
            <label class="switch-small">
              <input
                type="checkbox"
                :checked="getCoPlanRule(activeQuickGrade)?.enabled ?? false"
                @change="toggleCoPlanRuleEnabled(activeQuickGrade, $event.target.checked)"
              />
              <span class="slider round switch-small-track"></span>
              <span class="switch-label">啟用本年級共備</span>
            </label>
          </div>

          <div v-if="getCoPlanRule(activeQuickGrade)" class="card-body">
            <!-- Mode Selection -->
            <div class="form-row">
              <label class="form-label">時間選擇模式：</label>
              <div class="radio-group">
                <label class="radio-label">
                  <input
                    type="radio"
                    value="candidate"
                    :checked="getCoPlanRule(activeQuickGrade).timeSelectionMode === 'candidate'"
                    @change="updateCoPlanMode(activeQuickGrade, 'candidate')"
                  />
                  <span>自動候選區塊 (Candidate Blocks)</span>
                </label>
                <label class="radio-label">
                  <input
                    type="radio"
                    value="fixed"
                    :checked="getCoPlanRule(activeQuickGrade).timeSelectionMode === 'fixed'"
                    @change="updateCoPlanMode(activeQuickGrade, 'fixed')"
                  />
                  <span>指定固定時段 (Fixed Slot)</span>
                </label>
              </div>
            </div>

            <!-- Candidate Mode Blocks Editor -->
            <div v-if="getCoPlanRule(activeQuickGrade).timeSelectionMode === 'candidate'" class="form-row block-editor-row">
              <label class="form-label">候選區塊列表：</label>
              <div class="blocks-list">
                <div
                  v-for="(block, bIdx) in (getCoPlanRule(activeQuickGrade).candidateBlocks || [])"
                  :key="bIdx"
                  class="candidate-block-item"
                >
                  <span class="block-label">區塊 #{{ bIdx + 1 }}</span>
                  <select
                    :value="block.day"
                    @change="updateCandidateBlock(activeQuickGrade, bIdx, 'day', Number($event.target.value))"
                  >
                    <option :value="undefined" disabled>選擇星期</option>
                    <option :value="1">週一</option>
                    <option :value="2">週二</option>
                    <option :value="3">週三</option>
                    <option :value="4">週四</option>
                    <option :value="5">週五</option>
                  </select>
                  <span>節次：</span>
                  <div class="period-pills">
                    <button
                      v-for="p in [5, 6, 7]"
                      :key="p"
                      type="button"
                      :class="['pill-btn', { selected: (block.periods || []).includes(p) }]"
                      @click="toggleCandidateBlockPeriod(activeQuickGrade, bIdx, p)"
                    >
                      第 {{ p }} 節
                    </button>
                  </div>
                  <button
                    type="button"
                    class="btn-remove-block"
                    @click="removeCandidateBlock(activeQuickGrade, bIdx)"
                  >
                    ✕
                  </button>
                </div>
                <button
                  type="button"
                  class="btn-add-block"
                  @click="addCandidateBlock(activeQuickGrade)"
                >
                  + 新增候選區塊
                </button>
              </div>
            </div>

            <!-- Fixed Mode Slot Editor -->
            <div v-else class="form-row">
              <label class="form-label">固定共備時段：</label>
              <div class="fixed-slot-inputs">
                <select
                  :value="getCoPlanRule(activeQuickGrade).day"
                  @change="updateCoPlanFixed(activeQuickGrade, 'day', Number($event.target.value))"
                >
                  <option :value="undefined" disabled>選擇星期</option>
                  <option :value="1">週一</option>
                  <option :value="2">週二</option>
                  <option :value="3">週三</option>
                  <option :value="4">週四</option>
                  <option :value="5">週五</option>
                </select>
                <div class="period-pills">
                  <button
                    v-for="p in [1, 2, 3, 4, 5, 6, 7]"
                    :key="p"
                    type="button"
                    :class="['pill-btn', { selected: (getCoPlanRule(activeQuickGrade).periods || []).includes(p) }]"
                    @click="toggleCoPlanFixedPeriod(activeQuickGrade, p)"
                  >
                    第 {{ p }} 節
                  </button>
                </div>
              </div>
            </div>

            <!-- Fulfillment Threshold -->
            <div class="form-row">
              <label class="form-label">達成度門檻 (Fulfillment Threshold)：</label>
              <select
                :value="getCoPlanRule(activeQuickGrade).fulfillmentThreshold || 'all'"
                @change="updateCoPlanRuleField(activeQuickGrade, 'fulfillmentThreshold', $event.target.value)"
              >
                <option value="all">100% 完全滿足 (all)</option>
                <option value="at_least_90">至少 90% 同步 (at_least_90)</option>
                <option value="prefer">盡量排入 (prefer)</option>
              </select>
            </div>

            <!-- Name and Note -->
            <div class="form-row text-inputs-row">
              <div class="field">
                <label>名稱：</label>
                <input
                  type="text"
                  :value="getCoPlanRule(activeQuickGrade).name || ''"
                  placeholder="如：5年級導師共備"
                  @input="updateCoPlanRuleField(activeQuickGrade, 'name', $event.target.value)"
                />
              </div>
              <div class="field">
                <label>備註：</label>
                <input
                  type="text"
                  :value="getCoPlanRule(activeQuickGrade).note || ''"
                  placeholder="備註說明..."
                  @input="updateCoPlanRuleField(activeQuickGrade, 'note', $event.target.value)"
                />
              </div>
            </div>
          </div>

          <div v-else class="card-empty-prompt">
            <p>目前未設定 {{ activeQuickGrade }} 年級共備規則。</p>
            <button
              type="button"
              class="btn-primary"
              @click="createDefaultCoPlanRule(activeQuickGrade)"
            >
              + 建立 {{ activeQuickGrade }} 年級共備規則
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: 進階年級規則 (Advanced Grade Time Rules) -->
    <div v-if="activeTab === 'rules'" class="tab-content">
      <div class="advanced-rules-container">
        <div class="toolbar">
          <p class="section-desc">設定特定年級在指定時段的科目、科目類別或教師類型要求（固定時段硬／軟約束）。</p>
          <button
            type="button"
            data-testid="add-advanced-rule-btn"
            class="btn-primary"
            @click="addAdvancedRule"
          >
            + 新增進階年級規則
          </button>
        </div>

        <!-- Rules List -->
        <div class="rule-list">
          <div
            v-for="(rule, idx) in canonicalSettings.rules"
            :key="rule.id || idx"
            :data-testid="`rule-card-${rule.id}`"
            :class="['rule-card', getRuleStatusClass(rule)]"
          >
            <div class="card-header">
              <div class="rule-title-box">
                <span class="purpose-tag" :class="rule.purpose">
                  {{ rule.purpose === 'co_planning' ? '共備' : '一般規則' }}
                </span>
                <span class="rule-name">{{ rule.name || rule.id }}</span>
              </div>
              <div class="rule-status-badge">
                <span :class="['badge', getBadgeClass(rule)]">
                  {{ getRuleStatusText(rule) }}
                </span>
              </div>
            </div>

            <div class="card-body">
              <div class="rule-info-line">
                <span class="info-label">年級：</span>
                <span class="info-val">{{ (rule.grades || []).join(', ') || '未指定' }} 年級</span>
                <span class="info-label ml-4">模式：</span>
                <span class="info-val">{{ rule.timeSelectionMode === 'candidate' ? '候選區塊' : '固定時段' }}</span>
              </div>

              <!-- Rule Parameters Display & Edit -->
              <div class="rule-details-grid">
                <div class="detail-item">
                  <label>規則類型 (Rule Type)：</label>
                  <select
                    :value="rule.ruleType || 'require_subject'"
                    :disabled="rule.purpose === 'co_planning'"
                    @change="updateRuleField(rule.id, 'ruleType', $event.target.value)"
                  >
                    <option value="require_subject">指定科目 (require_subject)</option>
                    <option value="require_subject_category">指定科目類別 (require_subject_category)</option>
                    <option value="require_teacher_type">指定教師類型 (require_teacher_type)</option>
                    <option value="forbid_teacher_type">禁止教師類型 (forbid_teacher_type)</option>
                  </select>
                </div>

                <div class="detail-item">
                  <label>強度 (Enforcement)：</label>
                  <select
                    :value="rule.enforcementMode || 'hard'"
                    @change="updateRuleField(rule.id, 'enforcementMode', $event.target.value)"
                  >
                    <option value="hard">硬約束 (Hard)</option>
                    <option value="near_hard">近硬約束 (Near Hard)</option>
                    <option value="soft">軟偏好 (Soft)</option>
                  </select>
                </div>

                <div v-if="rule.ruleType === 'require_subject'" class="detail-item">
                  <label>科目名稱：</label>
                  <input
                    type="text"
                    :value="rule.subjectName || ''"
                    placeholder="如：校本、彈性"
                    @input="updateRuleField(rule.id, 'subjectName', $event.target.value)"
                  />
                </div>

                <div v-if="rule.ruleType === 'require_subject_category'" class="detail-item">
                  <label>科目類別：</label>
                  <input
                    type="text"
                    :value="rule.subjectCategory || ''"
                    placeholder="如：校本课程"
                    @input="updateRuleField(rule.id, 'subjectCategory', $event.target.value)"
                  />
                </div>

                <div v-if="['require_teacher_type', 'forbid_teacher_type'].includes(rule.ruleType)" class="detail-item">
                  <label>教師類型：</label>
                  <select
                    :value="rule.teacherType || 'subject'"
                    @change="updateRuleField(rule.id, 'teacherType', $event.target.value)"
                  >
                    <option value="subject">專任教師 (subject)</option>
                    <option value="homeroom">導師 (homeroom)</option>
                  </select>
                </div>
              </div>

              <!-- Action Footer -->
              <div class="card-footer">
                <label class="switch-small">
                  <input
                    type="checkbox"
                    :checked="rule.enabled !== false"
                    :disabled="isRuleBlocking(rule)"
                    @change="updateRuleField(rule.id, 'enabled', $event.target.checked)"
                  />
                  <span class="slider round"></span>
                  <span class="switch-label">
                    {{ isRuleBlocking(rule) ? '封鎖中 (強制草稿)' : (rule.enabled !== false ? '已啟用' : '已停用草稿') }}
                  </span>
                </label>

                <button
                  type="button"
                  class="btn-delete"
                  @click="deleteRule(rule.id)"
                >
                  刪除規則
                </button>
              </div>
            </div>
          </div>

          <div v-if="canonicalSettings.rules.length === 0" class="empty-state">
            目前沒有建立任何年級時段規則。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  normalizeGradeTimeRulesSettings,
  detectDeterministicGradeTimeRuleIssues,
  forceBlockingRulesToDraft,
  stripTransientRuleFields
} from '../utils/gradeTimeRules.js'

const props = defineProps({
  settings: {
    type: Object,
    default: () => ({ enabled: false, version: 2, rules: [] })
  },
  gradeTimeRulesSettings: {
    type: Object,
    default: null
  },
  issues: {
    type: Array,
    default: () => []
  },
  warningConfirmed: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:settings', 'update:gradeTimeRulesSettings', 'update:warningConfirmed'])

const activeTab = ref('quick')
const activeQuickGrade = ref(5)

// Canonical settings computed
const canonicalSettings = computed(() => {
  const raw = props.gradeTimeRulesSettings || props.settings || { enabled: false, version: 2, rules: [] }
  return normalizeGradeTimeRulesSettings(raw)
})

// Issues evaluation
const computedIssues = computed(() => {
  if (props.issues && props.issues.length > 0) return props.issues
  return detectDeterministicGradeTimeRuleIssues(canonicalSettings.value)
})

const hasWarnings = computed(() => {
  return computedIssues.value.some(i => i.severity === 'warning')
})

const isWarningConfirmed = computed({
  get: () => Boolean(props.warningConfirmed),
  set: (val) => emit('update:warningConfirmed', Boolean(val))
})

function toggleWarningConfirmed() {
  emit('update:warningConfirmed', !props.warningConfirmed)
}

function emitCanonical(newSettings) {
  // Reset warning confirmation when rules are modified
  emit('update:warningConfirmed', false)

  // Ensure blocking rules are forced to enabled: false drafts
  const normalized = normalizeGradeTimeRulesSettings(newSettings)
  const currentIssues = detectDeterministicGradeTimeRuleIssues(normalized)
  const forced = forceBlockingRulesToDraft(normalized, currentIssues)
  const clean = stripTransientRuleFields(forced)

  emit('update:settings', clean)
  emit('update:gradeTimeRulesSettings', clean)
}

function toggleMasterEnabled(enabled) {
  emitCanonical({
    ...canonicalSettings.value,
    enabled
  })
}

function onMasterToggleClick() {
  toggleMasterEnabled(!canonicalSettings.value.enabled)
}

// Quick Co-Planning Helpers
function getCoPlanRule(grade) {
  return canonicalSettings.value.rules.find(
    r => r.purpose === 'co_planning' && Array.isArray(r.grades) && r.grades.includes(grade)
  )
}

function hasCoPlanRule(grade) {
  const r = getCoPlanRule(grade)
  return !!r && r.enabled !== false
}

function createDefaultCoPlanRule(grade) {
  const newRule = {
    id: `co-planning-grade-${grade}`,
    enabled: true,
    purpose: 'co_planning',
    grades: [grade],
    timeSelectionMode: 'candidate',
    candidateBlocks: [
      { day: 4, periods: [5, 6] },
      { day: 5, periods: [5, 6] }
    ],
    ruleType: 'require_teacher_type',
    teacherType: 'subject',
    fulfillmentThreshold: 'at_least_90',
    name: `${grade}年級導師共備`,
    note: '自動候選區塊'
  }
  const existingRules = canonicalSettings.value.rules.filter(
    r => !(r.purpose === 'co_planning' && Array.isArray(r.grades) && r.grades.includes(grade))
  )
  emitCanonical({
    ...canonicalSettings.value,
    rules: [...existingRules, newRule]
  })
}

function toggleCoPlanRuleEnabled(grade, enabled) {
  const r = getCoPlanRule(grade)
  if (!r) {
    if (enabled) createDefaultCoPlanRule(grade)
    return
  }
  updateRuleField(r.id, 'enabled', enabled)
}

function updateCoPlanMode(grade, mode) {
  const r = getCoPlanRule(grade)
  if (!r) return
  const updated = {
    ...r,
    timeSelectionMode: mode
  }
  if (mode === 'candidate' && (!updated.candidateBlocks || updated.candidateBlocks.length === 0)) {
    updated.candidateBlocks = [{ day: 4, periods: [5, 6] }]
  }
  if (mode === 'fixed' && !updated.day) {
    updated.day = 4
    updated.periods = [5, 6]
  }
  updateRuleObject(r.id, updated)
}

function updateCoPlanFixed(grade, field, value) {
  const r = getCoPlanRule(grade)
  if (!r) return
  updateRuleField(r.id, field, value)
}

function toggleCoPlanFixedPeriod(grade, period) {
  const r = getCoPlanRule(grade)
  if (!r) return
  const currentPeriods = Array.isArray(r.periods) ? [...r.periods] : []
  const idx = currentPeriods.indexOf(period)
  if (idx >= 0) {
    currentPeriods.splice(idx, 1)
  } else {
    currentPeriods.push(period)
  }
  currentPeriods.sort((a, b) => a - b)
  updateRuleField(r.id, 'periods', currentPeriods)
}

function addCandidateBlock(grade) {
  const r = getCoPlanRule(grade)
  if (!r) return
  const blocks = Array.isArray(r.candidateBlocks) ? [...r.candidateBlocks] : []
  blocks.push({ day: 5, periods: [5, 6] })
  updateRuleField(r.id, 'candidateBlocks', blocks)
}

function removeCandidateBlock(grade, blockIdx) {
  const r = getCoPlanRule(grade)
  if (!r) return
  const blocks = Array.isArray(r.candidateBlocks) ? [...r.candidateBlocks] : []
  if (blocks.length <= 1) return
  blocks.splice(blockIdx, 1)
  updateRuleField(r.id, 'candidateBlocks', blocks)
}

function updateCandidateBlock(grade, blockIdx, field, value) {
  const r = getCoPlanRule(grade)
  if (!r) return
  const blocks = (r.candidateBlocks || []).map((b, i) => {
    if (i !== blockIdx) return b
    return { ...b, [field]: value }
  })
  updateRuleField(r.id, 'candidateBlocks', blocks)
}

function toggleCandidateBlockPeriod(grade, blockIdx, period) {
  const r = getCoPlanRule(grade)
  if (!r) return
  const blocks = (r.candidateBlocks || []).map((b, i) => {
    if (i !== blockIdx) return b
    const pList = Array.isArray(b.periods) ? [...b.periods] : []
    const idx = pList.indexOf(period)
    if (idx >= 0) pList.splice(idx, 1)
    else pList.push(period)
    pList.sort((a, b) => a - b)
    return { ...b, periods: pList }
  })
  updateRuleField(r.id, 'candidateBlocks', blocks)
}

function updateCoPlanRuleField(grade, field, value) {
  const r = getCoPlanRule(grade)
  if (!r) return
  updateRuleField(r.id, field, value)
}

// Advanced Rules Helpers
function addAdvancedRule() {
  const newRule = {
    id: `rule-${Date.now()}`,
    enabled: true,
    purpose: 'general',
    grades: [3],
    timeSelectionMode: 'fixed',
    day: 2,
    periods: [1, 2],
    ruleType: 'require_subject',
    subjectName: '校本',
    enforcementMode: 'hard',
    name: '校本課程指定時段',
    note: ''
  }
  emitCanonical({
    ...canonicalSettings.value,
    rules: [...canonicalSettings.value.rules, newRule]
  })
}

function updateRuleField(ruleId, field, value) {
  const updatedRules = canonicalSettings.value.rules.map(r => {
    if (r.id !== ruleId) return r
    return { ...r, [field]: value }
  })
  emitCanonical({
    ...canonicalSettings.value,
    rules: updatedRules
  })
}

function updateRuleObject(ruleId, updatedRule) {
  const updatedRules = canonicalSettings.value.rules.map(r => {
    if (r.id !== ruleId) return r
    return updatedRule
  })
  emitCanonical({
    ...canonicalSettings.value,
    rules: updatedRules
  })
}

function deleteRule(ruleId) {
  const updatedRules = canonicalSettings.value.rules.filter(r => r.id !== ruleId)
  emitCanonical({
    ...canonicalSettings.value,
    rules: updatedRules
  })
}

// Rule Status & Issues styling
function getRuleIssue(rule) {
  return computedIssues.value.find(i => (i.ruleIds || []).includes(rule.id) || i.rule_id === rule.id)
}

function isRuleBlocking(rule) {
  const issue = getRuleIssue(rule)
  return issue?.severity === 'blocking'
}

function getRuleStatusClass(rule) {
  const issue = getRuleIssue(rule)
  if (issue) return `status-${issue.severity}`
  if (rule.enabled === false) return 'status-disabled'
  return 'status-ok'
}

function getBadgeClass(rule) {
  const issue = getRuleIssue(rule)
  if (issue) return `badge-${issue.severity}`
  if (rule.enabled === false) return 'badge-disabled'
  return 'badge-ok'
}

function getRuleStatusText(rule) {
  const issue = getRuleIssue(rule)
  if (issue) {
    switch (issue.severity) {
      case 'blocking':
        return '❌ 封鎖 (強制草稿)'
      case 'warning':
        return '⚠️ 排課風險警告'
      default:
        return issue.code || '未知'
    }
  }
  if (rule.enabled === false) return '已停用草稿'
  return '正常'
}
</script>


<style scoped>
.grade-time-rule-editor {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 20px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e2e8f0;
}

.master-control {
  display: flex;
  align-items: center;
  gap: 16px;
}

.master-label {
  display: flex;
  flex-direction: column;
}

.main-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1e293b;
}

.sub-title {
  font-size: 0.85rem;
  color: #64748b;
}

.quality-rules-statement-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.banner-icon {
  font-size: 1.2rem;
}

.banner-text {
  font-size: 0.88rem;
  color: #92400e;
  line-height: 1.5;
}

.warning-confirmation-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 16px;
  margin-bottom: 16px;
}

.warning-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  color: #991b1b;
}

.btn-confirm-warning {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #dc2626;
  background: #ef4444;
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.btn-confirm-warning.confirmed {
  background: #059669;
  border-color: #047857;
}

.tab-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 2px solid #e2e8f0;
}

.tab-nav button {
  padding: 10px 18px;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.95rem;
  color: #64748b;
}

.tab-nav button.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
}

.tab-content {
  margin-top: 12px;
}

.section-desc {
  font-size: 0.88rem;
  color: #64748b;
  margin-bottom: 16px;
}

.grade-quick-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.bar-label {
  font-weight: 600;
  color: #334155;
}

.grade-chips {
  display: flex;
  gap: 8px;
}

.grade-chip {
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #475569;
  cursor: pointer;
  font-size: 0.88rem;
  display: flex;
  align-items: center;
  gap: 4px;
}

.grade-chip.active {
  background: #2563eb;
  color: white;
  border-color: #1d4ed8;
}

.grade-chip.hasRule {
  border-color: #3b82f6;
}

.dot {
  font-size: 0.6rem;
  color: #10b981;
}

.co-plan-rule-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  background: #f8fafc;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.card-header h4 {
  margin: 0;
  font-size: 1rem;
  color: #1e293b;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 0.88rem;
  font-weight: 600;
  color: #475569;
}

.radio-group {
  display: flex;
  gap: 20px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 0.88rem;
}

.candidate-block-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: white;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  margin-bottom: 8px;
}

.period-pills {
  display: flex;
  gap: 4px;
}

.pill-btn {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: white;
  cursor: pointer;
  font-size: 0.8rem;
}

.pill-btn.selected {
  background: #3b82f6;
  color: white;
  border-color: #2563eb;
}

.btn-add-block, .btn-primary {
  padding: 8px 16px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.88rem;
}

.btn-remove-block {
  background: none;
  border: none;
  color: #ef4444;
  cursor: pointer;
  font-size: 1.1rem;
}

.fixed-slot-inputs {
  display: flex;
  align-items: center;
  gap: 12px;
}

.text-inputs-row {
  display: flex;
  gap: 16px;
}

.text-inputs-row .field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.text-inputs-row input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
}

.card-empty-prompt {
  text-align: center;
  padding: 24px;
  color: #64748b;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rule-card {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 16px;
  background: white;
}

.rule-card.status-blocking {
  border-color: #f87171;
  background: #fef2f2;
}

.rule-card.status-warning {
  border-color: #fbbf24;
  background: #fffbeb;
}

.rule-card.status-ok {
  border-color: #34d399;
  background: #f0fdf4;
}

.rule-card.status-disabled {
  border-color: #cbd5e1;
  background: #f8fafc;
  opacity: 0.75;
}

.badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.78rem;
  font-weight: 600;
}

.badge-blocking {
  background: #fecaca;
  color: #991b1b;
}

.badge-warning {
  background: #fef08a;
  color: #854d0e;
}

.badge-ok {
  background: #bbf7d0;
  color: #166534;
}

.badge-disabled {
  background: #e2e8f0;
  color: #475569;
}

.purpose-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-right: 8px;
}

.purpose-tag.co_planning {
  background: #dbeafe;
  color: #1e40af;
}

.rule-details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin: 12px 0;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
}

.detail-item select, .detail-item input {
  padding: 6px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}

.btn-delete {
  background: none;
  border: 1px solid #fca5a5;
  color: #dc2626;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.82rem;
}

.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: #ccc;
  transition: .3s;
}

.slider.round {
  border-radius: 24px;
}

.slider.round:before {
  border-radius: 50%;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s;
}

input:checked + .slider {
  background-color: #2563eb;
}

input:checked + .slider:before {
  transform: translateX(20px);
}

.switch-small {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding-left: 52px;
  font-size: 0.85rem;
}

.switch-small input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-small .switch-small-track {
  width: 44px;
  height: 24px;
  top: 0;
  right: auto;
  bottom: auto;
  left: 0;
}

.empty-state {
  text-align: center;
  padding: 30px;
  color: #94a3b8;
}
</style>
