<template>
  <div v-if="visible" class="mixed-dialog-overlay">
    <div class="mixed-dialog-content" data-testid="mixed-dialog-content">
      <div class="mixed-dialog-header">
        <h3>混合配課分配確認</h3>
        <button class="close-btn" data-testid="mixed-cancel-icon" @click="handleCancel">&times;</button>
      </div>

      <div class="mixed-dialog-body">
        <div v-for="(plan, index) in plans" :key="plan.key || index" class="plan-card">
          <div class="plan-card-header">
            <h4>{{ plan.grade }}年級 - {{ plan.subject }}</h4>
          </div>

          <p class="plan-summary">
            偵測到 {{ plan.grade }}年級 {{ plan.subject }} 同時由導師及科任／行政教師授課。該科目共需
            {{ plan.totalDemandPeriods }}堂，其中導師已配置 {{ getHomeroomPeriods(plan) }}堂，
            科任／行政教師已配置 {{ getSubjectAdminPeriods(plan) }}堂。請選擇班級分配方式。
          </p>

          <div class="mode-selector">
            <label class="mode-option">
              <input
                type="radio"
                :name="'mode-' + (plan.key || index)"
                value="auto"
                :checked="getMode(plan) === 'auto'"
                data-testid="mode-auto"
                @click="setMode(plan, 'auto')"
                @change="setMode(plan, 'auto')"
              />
              <span>自動分配 (依班級序自動配對)</span>
            </label>
            <label class="mode-option">
              <input
                type="radio"
                :name="'mode-' + (plan.key || index)"
                value="manual"
                :checked="getMode(plan) === 'manual'"
                data-testid="mode-manual"
                @click="setMode(plan, 'manual')"
                @change="setMode(plan, 'manual')"
              />
              <span>手動指定例外班級</span>
            </label>
          </div>

          <!-- 自動模式預覽 -->
          <div v-if="getMode(plan) === 'auto'" class="auto-preview">
            <div class="auto-strategy-selector">
              <span class="auto-strategy-label">自動分配方式：</span>
              <label class="mode-option">
                <input
                  type="radio"
                  :name="'auto-strategy-' + getKey(plan)"
                  value="class-order"
                  :checked="getAutoAllocation(plan).strategy === 'class-order'"
                  :data-testid="'auto-strategy-order-' + getKey(plan)"
                  @change="setAutoStrategy(plan, 'class-order')"
                />
                <span>按班級順序（預設）</span>
              </label>
              <label class="mode-option">
                <input
                  type="radio"
                  :name="'auto-strategy-' + getKey(plan)"
                  value="random"
                  :checked="getAutoAllocation(plan).strategy === 'random'"
                  :data-testid="'auto-strategy-random-' + getKey(plan)"
                  @change="setAutoStrategy(plan, 'random')"
                />
                <span>隨機分配</span>
              </label>
            </div>
            <div class="preview-title">自動分配預覽：</div>
            <div v-if="getPlanState(plan).valid" class="assignment-grid">
              <div
                v-for="item in getPlanState(plan).resolution?.assignments || []"
                :key="item.className"
                class="assignment-tag"
              >
                <span class="class-name">{{ item.className }}</span>
                <span class="teacher-info" :class="[item.teacherType, { 'unassigned-teacher': !item.teacherName }]">
                  {{ item.teacherName || '未指定教師（資料錯誤）' }} ({{ item.periods }}堂)
                </span>
              </div>
            </div>
          </div>

          <!-- 手動模式班級選擇 -->
          <div v-else-if="getMode(plan) === 'manual'" class="manual-selection">
            <div class="selection-helper">
              <template v-if="isHomeroomDefault(plan)">
                <span>請勾選由「科任／行政教師」授課的班級（其餘班級維持由導師授課）：</span>
              </template>
              <template v-else>
                <span>請勾選由「導師」授課的班級（其餘班級維持由科任／行政授課）：</span>
              </template>
            </div>

            <div class="class-checkbox-grid">
              <label
                v-for="(block, bIdx) in plan.classBlocks"
                :key="block.className"
                class="class-checkbox-item"
              >
                <input
                  type="checkbox"
                  :checked="isExceptionSelected(plan, block.className)"
                  :disabled="isForcedAssignment(plan, block.className)"
                  :data-testid="'class-checkbox-' + block.className"
                  :data-testid-alt="'class-checkbox-' + bIdx"
                  @change="setException(plan, block.className, $event.target.checked)"
                />
                <span>
                  {{ block.className }} ({{ block.periods }}堂)
                  <small v-if="isForcedAssignment(plan, block.className)" class="forced-exception-note">已由匯入指定</small>
                </span>
              </label>
            </div>

            <div class="periods-counter">
              已分配例外節數：{{ getSelectedPeriods(plan) }} / {{ getTargetQuota(plan) }} 堂
            </div>
          </div>

          <!-- 錯誤訊息顯示 -->
          <div
            v-if="!getPlanState(plan).valid && getPlanState(plan).errors.length > 0"
            class="error-box"
          >
            <div v-for="(err, eIdx) in getPlanState(plan).errors" :key="eIdx" class="error-item">
              ⚠️ {{ err }}
            </div>
          </div>
        </div>
      </div>

      <div class="mixed-dialog-footer">
        <div v-if="applyError" class="error-box" data-testid="mixed-apply-error">
          ⚠️ {{ applyError }}
        </div>
        <button class="btn btn-secondary" data-testid="mixed-cancel" @click="handleCancel">
          取消
        </button>
        <button
          class="btn btn-primary"
          data-testid="mixed-confirm"
          :disabled="!isAllValid || isApplying"
          @click="handleConfirm"
        >
          {{ isApplying ? '套用中…' : '確認套用' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { resolveMixedTeachingPlan } from '../utils/mixedTeachingPlan.js'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  plans: {
    type: Array,
    default: () => [],
  },
  applyError: {
    type: String,
    default: '',
  },
  isApplying: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['confirm', 'cancel'])

// 儲存每個 plan 的 mode: { [planKey]: 'auto' | 'manual' }
const planModes = ref({})

// 儲存每個 plan 的 exceptionClassNames: { [planKey]: Array<string> }
const planExceptions = ref({})

// 儲存每個 plan 的自動分配策略與一次性隨機 seed
const autoAllocationStates = ref({})

function getKey(plan) {
  return plan.key || `${plan.grade}::${plan.subject}`
}

function getMode(plan) {
  const key = getKey(plan)
  return planModes.value[key] || 'auto'
}

function setMode(plan, mode) {
  const key = getKey(plan)
  planModes.value = {
    ...planModes.value,
    [key]: mode,
  }
}

function getAutoAllocation(plan) {
  const key = getKey(plan)
  return autoAllocationStates.value[key] || { strategy: 'class-order' }
}

function createRandomSeed(plan) {
  const keyOffset = Array.from(getKey(plan)).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return Date.now() + keyOffset
}

function setAutoStrategy(plan, strategy) {
  const key = getKey(plan)
  const current = getAutoAllocation(plan)
  autoAllocationStates.value = {
    ...autoAllocationStates.value,
    [key]: {
      strategy,
      ...(strategy === 'random' ? { seed: current.seed ?? createRandomSeed(plan) } : current.seed != null ? { seed: current.seed } : {}),
    },
  }
}

watch(
  () => props.visible,
  (visible, wasVisible) => {
    if (!visible && wasVisible) {
      planModes.value = {}
      planExceptions.value = {}
      autoAllocationStates.value = {}
    }
  }
)

function isHomeroomDefault(plan) {
  if (plan.defaultRoleGroup) return plan.defaultRoleGroup === 'homeroom'
  return (
    plan.defaultTeacher === 'homeroom' ||
    (plan.defaultTeacher !== 'subject' && plan.defaultTeacher !== 'admin')
  )
}

function getHomeroomPeriods(plan) {
  const explicit = Number(plan.homeroomPeriods)
  if (Number.isFinite(explicit)) return explicit
  const subjectAdmin = Number(plan.subjectAdminPeriods ?? plan.importedSubjectAdminPeriods)
  return Number.isFinite(subjectAdmin) ? Number(plan.totalDemandPeriods || 0) - subjectAdmin : 0
}

function getSubjectAdminPeriods(plan) {
  const explicit = Number(plan.subjectAdminPeriods)
  if (Number.isFinite(explicit)) return explicit
  if (!isHomeroomDefault(plan)) {
    return Number(plan.totalDemandPeriods || 0) - getHomeroomPeriods(plan)
  }
  const imported = Number(plan.importedSubjectAdminPeriods ?? plan.importedPeriods)
  return Number.isFinite(imported) ? imported : 0
}

function getTargetQuota(plan) {
  if (isHomeroomDefault(plan)) {
    return plan.importedSubjectAdminPeriods ?? plan.importedPeriods ?? 0
  } else {
    return plan.importedHomeroomPeriods ?? plan.importedPeriods ?? 0
  }
}

function getSelectedExceptions(plan) {
  const key = getKey(plan)
  return planExceptions.value[key] || []
}

function getForcedExceptionClassNames(plan) {
  return Array.isArray(plan.forcedExceptionClassNames) ? plan.forcedExceptionClassNames : []
}

function isForcedException(plan, className) {
  return getForcedExceptionClassNames(plan).includes(className)
}

function getForcedDefaultClassNames(plan) {
  return Array.isArray(plan.forcedDefaultClassNames) ? plan.forcedDefaultClassNames : []
}

function isForcedDefault(plan, className) {
  return getForcedDefaultClassNames(plan).includes(className)
}

function isForcedAssignment(plan, className) {
  return isForcedException(plan, className) || isForcedDefault(plan, className)
}

function isExceptionSelected(plan, className) {
  const selected = getSelectedExceptions(plan)
  return isForcedException(plan, className) || selected.includes(className)
}

function setException(plan, className, isChecked) {
  if (isForcedAssignment(plan, className)) return
  const key = getKey(plan)
  const current = getSelectedExceptions(plan)
  let updated
  if (isChecked) {
    if (!current.includes(className)) {
      updated = [...current, className]
    } else {
      updated = current
    }
  } else {
    updated = current.filter((c) => c !== className)
  }
  planExceptions.value = {
    ...planExceptions.value,
    [key]: updated,
  }
}

function getSelectedPeriods(plan) {
  const selected = Array.from(new Set([
    ...getForcedExceptionClassNames(plan),
    ...getSelectedExceptions(plan),
  ]))
  const classMap = new Map((plan.classBlocks || []).map((b) => [b.className, b.periods]))
  return selected.reduce((sum, name) => sum + (classMap.get(name) || 0), 0)
}

// 算出各個 Plan 的驗證狀態
const planStates = computed(() => {
  if (!props.plans) return []
  return props.plans.map((plan) => {
    const key = getKey(plan)
    const mode = getMode(plan)
    const exceptionClassNames = getSelectedExceptions(plan)

    const res = resolveMixedTeachingPlan(plan, {
      mode,
      exceptionClassNames,
      autoAllocation: getAutoAllocation(plan),
    })

    return {
      plan,
      key,
      mode,
      exceptionClassNames,
      valid: res.valid,
      resolution: res.resolution,
      errors: res.errors || [],
    }
  })
})

function getPlanState(plan) {
  const key = getKey(plan)
  return planStates.value.find((s) => s.key === key) || { valid: false, errors: ['未初始化'] }
}

const isAllValid = computed(() => {
  if (!props.plans || props.plans.length === 0) return false
  return planStates.value.every((s) => s.valid)
})

function handleConfirm() {
  if (!isAllValid.value || props.isApplying) return
  const resolutions = planStates.value.map((s) => ({
    planKey: s.key,
    grade: s.plan.grade,
    subject: s.plan.subject,
    resolution: s.resolution,
  }))
  emit('confirm', { resolutions })
}

function handleCancel() {
  emit('cancel')
}
</script>

<style scoped>
.mixed-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.mixed-dialog-content {
  background: #ffffff;
  border-radius: 8px;
  width: 600px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.mixed-dialog-header {
  padding: 16px 24px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mixed-dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #6b7280;
}

.mixed-dialog-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

.plan-card {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
  background: #f9fafb;
}

.plan-card-header h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
  color: #1f2937;
}

.plan-summary {
  font-size: 14px;
  line-height: 1.5;
  color: #374151;
  margin-bottom: 12px;
}

.mode-selector {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
}

.auto-preview {
  margin-top: 8px;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 10px;
}

.auto-strategy-selector {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.auto-strategy-label {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.preview-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #4b5563;
}

.assignment-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.assignment-tag {
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  display: flex;
  gap: 4px;
}

.class-name {
  font-weight: 600;
}

.manual-selection {
  margin-top: 8px;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 12px;
}

.selection-helper {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}

.class-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.class-checkbox-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

.class-checkbox-item input:disabled + span {
  color: #6b7280;
}

.forced-exception-note {
  margin-left: 4px;
  color: #2563eb;
}

.unassigned-teacher {
  color: #b91c1c;
  font-weight: 600;
}

.periods-counter {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-align: right;
}

.error-box {
  margin-top: 10px;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  border-radius: 4px;
  padding: 8px 12px;
}

.error-item {
  color: #dc2626;
  font-size: 13px;
}

.mixed-dialog-footer {
  padding: 16px 24px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn-secondary {
  background: #ffffff;
  border-color: #d1d5db;
  color: #374151;
}

.btn-secondary:hover {
  background: #f9fafb;
}

.btn-primary {
  background: #2563eb;
  color: #ffffff;
}

.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
</style>
