<template>
  <div class="prealloc-import-container">
    <div class="header">
      <h1>通用預排匯入</h1>
      <p class="subtitle">
        匯入單一科目的既有 Excel 課表為預排事件，並交由智慧排課處理。
        <RouterLink to="/ai-settings" class="back-link">返回 AI 設定</RouterLink>
      </p>
    </div>

    <!-- Progress Steps -->
    <div class="progress-bar">
      <div
        v-for="s in 7"
        :key="s"
        class="step-indicator"
        :class="{ active: s <= step, completed: s < step }"
      >
        <span class="step-number">{{ s }}</span>
        <span class="step-label">{{ stepLabels[s - 1] }}</span>
      </div>
    </div>

    <!-- Step 1: 上傳與科目選擇 -->
    <div v-if="step === 1" class="step-panel">
      <h2>步驟 1：選擇科目與上傳 Excel</h2>

      <div class="form-group">
        <label for="subject-select">選擇科目</label>
        <select id="subject-select" v-model="selectedSubject">
          <option value="" disabled>請選擇科目</option>
          <option
            v-for="subj in scheduleStore.allAvailableSubjects"
            :key="subj.name"
            :value="subj.name"
          >
            {{ subj.name }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label for="excel-upload">上傳 Excel 課表</label>
        <input
          type="file"
          id="excel-upload"
          accept=".xlsx"
          @change="handleFileUpload"
          :disabled="!selectedSubject"
        />
        <p class="hint">請上傳 .xlsx 格式的課表檔案</p>
      </div>

      <div v-if="uploadError" class="error-box">
        <p>{{ uploadError }}</p>
      </div>

      <div v-if="parseResult && parseResult.parseErrors.length > 0" class="parse-errors-box">
        <h4>解析錯誤：</h4>
        <ul>
          <li v-for="(err, i) in parseResult.parseErrors" :key="i">
            {{ err.message }}
            <span v-if="err.cellRef" class="cell-ref">({{ err.cellRef }})</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Step 2: 教師確認 -->
    <div v-if="step === 2" class="step-panel">
      <h2>步驟 2：教師確認</h2>
      <p class="hint">
        以下教師目前不在系統中，勾選表示確認建立。未勾選的教師對應課次將成為阻擋錯誤。
      </p>

      <div v-if="unknownTeachers.length === 0" class="info-box">
        <p>所有教師已存在系統中，無需確認。</p>
      </div>

      <div v-for="teacher in unknownTeachers" :key="teacher.name" class="teacher-row">
        <input
          type="checkbox"
          :id="'teacher-' + teacher.name"
          v-model="teacherConfirmed[teacher.name]"
        />
        <label :for="'teacher-' + teacher.name">{{ teacher.name }}</label>
      </div>

      <div class="actions">
        <button @click="step = 3" class="btn-primary">確認教師，下一步</button>
      </div>
    </div>

    <!-- Step 3: 課程需求確認 -->
    <div v-if="step === 3" class="step-panel">
      <h2>步驟 3：課程需求確認</h2>
      <p class="hint">
        以下班級尚未有對應科目的課程需求，勾選表示確認建立需求。
      </p>

      <div v-if="classesNeedingRequirement.length === 0" class="info-box">
        <p>所有班級已有對應科目的課程需求。</p>
      </div>

      <div
        v-for="clsName in classesNeedingRequirement"
        :key="clsName"
        class="requirement-row"
      >
        <input
          type="checkbox"
          :id="'req-' + clsName"
          v-model="requirementConfirmed[clsName]"
        />
        <label :for="'req-' + clsName">{{ clsName }}</label>
      </div>

      <div class="actions">
        <button @click="step = 4" class="btn-primary">確認需求，下一步</button>
      </div>
    </div>

    <!-- Step 4: 課次選項 -->
    <div v-if="step === 4" class="step-panel">
      <h2>步驟 4：課次選項</h2>
      <p class="hint">
        為每個課次設定「班級教室上課」與「人工鎖定」選項。
      </p>

      <div class="slot-table-wrapper">
        <table class="slot-table">
          <thead>
            <tr>
              <th>班級</th>
              <th>教師</th>
              <th>星期</th>
              <th>節次</th>
              <th>班級教室</th>
              <th>人工鎖定</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(slot, i) in parseResult.slots" :key="i">
              <td>{{ slot.className }}</td>
              <td>{{ slot.teacher }}</td>
              <td>週{{ dayNames[slot.day - 1] }}</td>
              <td>{{ periodLabel(slot.period) }}</td>
              <td>
                <input
                  type="checkbox"
                  v-model="slotOptions[i].useClassroom"
                  @change="recalcApplyPlan"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  v-model="slotOptions[i].manualLocked"
                  @change="recalcApplyPlan"
                />
              </td>
              <td>
                <span
                  v-if="getSlotBlockers(i).length > 0"
                  class="tag tag-error"
                >
                  阻擋
                </span>
                <span
                  v-else-if="getSlotWarnings(i).length > 0"
                  class="tag tag-warning"
                >
                  警示
                </span>
                <span v-else class="tag tag-ok">OK</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="applyPlan && applyPlan.warnings.some(w => w.code === 'SPECIAL_ROOM_MISSING_CONFIG')"
        class="warning-box"
      >
        <p>⚠️ 部分課次需要專科教室，但系統設定中找不到對應教室。</p>
        <RouterLink to="/settings" class="btn-link">前往系統設定</RouterLink>
      </div>

      <div class="actions">
        <button
          @click="step = 5"
          class="btn-primary"
          :disabled="applyPlan && applyPlan.blockers.length > 0"
        >
          下一步確認套用
        </button>
      </div>
    </div>

    <!-- Step 5: 衝突摘要 -->
    <div v-if="step === 5" class="step-panel">
      <h2>步驟 5：衝突摘要</h2>

      <div v-if="applyPlan && applyPlan.blockers.length > 0" class="error-box">
        <h4>阻擋錯誤（必須解決）：</h4>
        <ul>
          <li v-for="(b, i) in applyPlan.blockers" :key="'b' + i">{{ b.message }}</li>
        </ul>
      </div>

      <div v-if="applyPlan && applyPlan.warnings.length > 0" class="warning-box">
        <h4>警示（可忽略）：</h4>
        <ul>
          <li v-for="(w, i) in applyPlan.warnings" :key="'w' + i">{{ w.message }}</li>
        </ul>
      </div>

      <div v-if="!applyPlan || applyPlan.blockers.length === 0" class="info-box">
        <p>無阻擋錯誤，可以安全套用。</p>
      </div>

      <div class="actions">
        <button @click="step = 4" class="btn-secondary">上一步</button>
        <button
          @click="handleApply"
          class="btn-primary"
          :disabled="applyPlan && applyPlan.blockers.length > 0"
        >
          確認套用
        </button>
      </div>
    </div>

    <!-- Step 6: 套用 -->
    <div v-if="step === 6" class="step-panel">
      <h2>步驟 6：套用中</h2>
      <div class="loading">
        <p>正在套用預排事件...</p>
      </div>
    </div>

    <!-- Step 7: 完成 -->
    <div v-if="step === 7" class="step-panel">
      <h2>步驟 7：完成</h2>

      <div v-if="appliedEvent" class="summary-box">
        <h4>套用摘要</h4>
        <table class="summary-table">
          <tr><td>已套用課次</td><td>{{ appliedEvent.summary.slotsApplied }}</td></tr>
          <tr><td>建立教師</td><td>{{ appliedEvent.summary.teachersCreated }}</td></tr>
          <tr><td>建立需求</td><td>{{ appliedEvent.summary.requirementsCreated }}</td></tr>
          <tr><td>人工鎖定</td><td>{{ appliedEvent.summary.manualLockedCount }}</td></tr>
          <tr><td>班級教室</td><td>{{ appliedEvent.summary.useClassroomCount }}</td></tr>
          <tr><td>阻擋</td><td>{{ appliedEvent.summary.blockers }}</td></tr>
          <tr><td>警示</td><td>{{ appliedEvent.summary.warnings }}</td></tr>
        </table>
      </div>

      <div v-if="manualLockedList.length > 0" class="locked-slots-box">
        <h4>人工鎖定課次清單</h4>
        <table class="locked-slots-table">
          <thead>
            <tr>
              <th>班級</th>
              <th>星期</th>
              <th>節次</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(slot, i) in manualLockedList" :key="i">
              <td>{{ slot.className }}</td>
              <td>週{{ dayNames[slot.day - 1] }}</td>
              <td>{{ periodLabel(slot.period) }}</td>
              <td>🔒 鎖定</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="applyError" class="error-box">
        <p>{{ applyError }}</p>
      </div>

      <div class="actions">
        <button @click="handleComplete" class="btn-primary" v-if="!showCompletion">
          完成並鎖定事件
        </button>
      </div>

      <div v-if="showCompletion" class="completion-box">
        <p class="success-message">✅ 已交接至全校排課</p>
        <RouterLink to="/schedule" id="goto-schedule-btn" class="btn-primary">
          前往智慧排課
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useScheduleStore } from '../stores/schedule'
import { parsePreallocationExcel } from '../utils/preallocEventExcelImport.js'
import {
  createPreallocationEvent,
  createPreallocationSlot,
  buildEventApplyPlan,
  canApplyPreallocationEvent,
} from '../utils/preallocEventModel.js'
import { normalizeSubject } from '../utils/subjectCanonical.js'

const scheduleStore = useScheduleStore()
const step = ref(1)
const selectedSubject = ref('')
const uploadError = ref('')
const parseResult = ref(null)
const teacherConfirmed = ref({})
const requirementConfirmed = ref({})
const slotOptions = ref([])
const applyPlan = ref(null)
const appliedEvent = ref(null)
const applyError = ref('')
const showCompletion = ref(false)

const stepLabels = [
  '上傳',
  '教師',
  '需求',
  '選項',
  '確認',
  '套用',
  '完成'
]

const dayNames = ['一', '二', '三', '四', '五']

function periodLabel(p) {
  if (p === 0) return '早'
  if (p === 8) return '午休'
  return '第' + p + '節'
}

// Unknown teachers not in system
const unknownTeachers = computed(() => {
  if (!parseResult.value) return []
  return parseResult.value.teachers.filter(t =>
    !scheduleStore.teachers.find(st => st.name === t.name)
  )
})

// Classes needing course requirement
const classesNeedingRequirement = computed(() => {
  if (!parseResult.value || !selectedSubject.value) return []
  const subject = normalizeSubject(selectedSubject.value)
  const classNames = new Set(parseResult.value.slots.map(s => s.className))
  const result = []
  for (const clsName of classNames) {
    const cls = scheduleStore.classes.find(c => c.name === clsName)
    if (!cls) {
      result.push(clsName)
      continue
    }
    const hasReq = (cls.course_requirements || []).some(
      r => normalizeSubject(r.subject) === subject
    )
    if (!hasReq) result.push(clsName)
  }
  return result
})

const manualLockedList = computed(() => {
  if (!appliedEvent.value) return []
  return scheduleStore.getEventManualLockedSlots(appliedEvent.value.id)
})

// Initialize slot options when parseResult changes
watch(parseResult, (newVal) => {
  if (newVal && newVal.slots.length > 0) {
    slotOptions.value = newVal.slots.map(() => ({
      useClassroom: false,
      manualLocked: false,
    }))
  }
})

// Initialize teacher confirmed defaults
watch(unknownTeachers, (teachers) => {
  for (const t of teachers) {
    if (!(t.name in teacherConfirmed.value)) {
      teacherConfirmed.value[t.name] = true
    }
  }
})

// Initialize requirement confirmed defaults
watch(classesNeedingRequirement, (classes) => {
  for (const cls of classes) {
    if (!(cls in requirementConfirmed.value)) {
      requirementConfirmed.value[cls] = true
    }
  }
})

function handleFileUpload(event) {
  const file = event.target.files[0]
  if (!file) return

  if (!selectedSubject.value) {
    uploadError.value = '請先選擇科目'
    return
  }

  uploadError.value = ''

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const buffer = e.target.result
      const result = parsePreallocationExcel(buffer, {
        subject: selectedSubject.value,
        fileName: file.name,
        classesList: scheduleStore.classes,
        allowMorningSession:
          scheduleStore.schoolInfo.preallocEventSettings?.allowMorningSession || false,
        allowNoonBreakSession:
          scheduleStore.schoolInfo.preallocEventSettings?.allowNoonBreakSession || false,
      })

      // Attach subject to each slot
      const subject = normalizeSubject(selectedSubject.value)
      result.slots.forEach(s => { s.subject = subject })

      parseResult.value = result

      if (result.parseErrors.length > 0) {
        uploadError.value = `解析完成但有 ${result.parseErrors.length} 個錯誤，請檢查檔案格式`
        return
      }

      // Auto-advance if no unknown teachers
      if (result.teachers.length > 0) {
        step.value = 2
      } else {
        step.value = 3
      }
    } catch (err) {
      uploadError.value = '解析失敗：' + err.message
      console.error('Excel parse error:', err)
    }
  }
  reader.readAsArrayBuffer(file)
}

function recalcApplyPlan() {
  try {
    const eventDraft = assembleEventDraft()
    applyPlan.value = buildEventApplyPlan(eventDraft, scheduleStore.classes, scheduleStore.schoolInfo)
  } catch (err) {
    applyPlan.value = { classUpdates: [], teachersToCreate: [], blockers: [{ code: 'ERROR', message: err.message }], warnings: [] }
  }
}

function getSlotBlockers(slotIndex) {
  if (!applyPlan.value) return []
  // Map blockers to slots by checking classUpdates
  return applyPlan.value.blockers.filter(b =>
    b.message.includes(parseResult.value?.slots[slotIndex]?.className || '')
  )
}

function getSlotWarnings(slotIndex) {
  if (!applyPlan.value) return []
  return applyPlan.value.warnings.filter(w =>
    w.message.includes(parseResult.value?.slots[slotIndex]?.className || '')
  )
}

function assembleEventDraft() {
  const rejectedTeachers = new Set(
    Object.entries(teacherConfirmed.value)
      .filter(([, v]) => v === false)
      .map(([name]) => name),
  )

  const event = createPreallocationEvent({
    subject: normalizeSubject(selectedSubject.value),
    sourceFileName: parseResult.value?.fileName || '',
    sourceKind: 'excel',
  })

  event.allowAdjustment = false
  event._rejectedTeachers = rejectedTeachers
  event._requirementConfirmed = { ...requirementConfirmed.value }

  event.slots = parseResult.value.slots.map((s, i) => {
    const opts = slotOptions.value[i] || {}
    return createPreallocationSlot({
      eventId: event.id,
      className: s.className,
      teacher: s.teacher,
      subject: s.subject || normalizeSubject(selectedSubject.value),
      day: s.day,
      period: s.period,
      useClassroom: opts.useClassroom || false,
      manualLocked: opts.manualLocked || false,
    })
  })

  return event
}

async function handleApply() {
  step.value = 6
  applyError.value = ''

  try {
    const event = assembleEventDraft()

    // Calculate summary before applying
    const rejectedTeachers = event._rejectedTeachers
    const manualLockedCount = event.slots.filter(s => s.manualLocked).length
    const useClassroomCount = event.slots.filter(s => s.useClassroom).length

    scheduleStore.applyPreallocationEvent(event)

    // Update summary
    appliedEvent.value = {
      ...event,
      summary: {
        slotsApplied: event.slots.length,
        teachersCreated: event.slots.filter(s =>
          !scheduleStore.teachers.find(t => t.name === s.teacher)
        ).length,
        requirementsCreated: classesNeedingRequirement.value.length,
        manualLockedCount,
        useClassroomCount,
        blockers: 0,
        warnings: applyPlan.value?.warnings.length || 0,
      }
    }

    await scheduleStore.syncToCloud()
    step.value = 7
  } catch (err) {
    applyError.value = err.message
    step.value = 5
    console.error('Apply error:', err)
  }
}

async function handleComplete() {
  try {
    scheduleStore.completePreallocationEvent(appliedEvent.value.id)
    await scheduleStore.syncToCloud()
    showCompletion.value = true
  } catch (err) {
    applyError.value = '完成失敗：' + err.message
    console.error('Complete error:', err)
  }
}

// Recalculate apply plan when entering step 4
watch(step, (newStep) => {
  if (newStep === 4) {
    recalcApplyPlan()
  }
})
</script>

<style scoped>
.prealloc-import-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}

.header {
  margin-bottom: 32px;
}

.header h1 {
  margin: 0 0 8px;
  font-size: 24px;
}

.subtitle {
  color: #6b7280;
  margin: 0;
}

.back-link {
  color: #2563eb;
  text-decoration: underline;
}

/* Progress Bar */
.progress-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 32px;
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
}

.step-indicator {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  opacity: 0.4;
  transition: opacity 0.2s;
}

.step-indicator.active {
  opacity: 1;
}

.step-indicator.completed .step-number {
  background: #22c55e;
  color: white;
}

.step-number {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
}

.step-label {
  font-size: 11px;
  color: #6b7280;
}

/* Step Panel */
.step-panel {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 24px;
}

.step-panel h2 {
  margin: 0 0 16px;
  font-size: 18px;
}

.hint {
  color: #6b7280;
  font-size: 13px;
  margin: 0 0 16px;
}

/* Form */
.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-weight: 500;
}

.form-group select,
.form-group input[type="file"] {
  width: 100%;
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

/* Teacher/Requirement rows */
.teacher-row,
.requirement-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}

/* Slot Table */
.slot-table-wrapper {
  overflow-x: auto;
  margin: 16px 0;
}

.slot-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.slot-table th,
.slot-table td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
}

.slot-table th {
  background: #f9fafb;
  font-weight: 600;
}

/* Tags */
.tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.tag-error {
  background: #fee2e2;
  color: #dc2626;
}

.tag-warning {
  background: #fef3c7;
  color: #d97706;
}

.tag-ok {
  background: #dcfce7;
  color: #16a34a;
}

/* Boxes */
.error-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  color: #991b1b;
}

.warning-box {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  color: #92400e;
}

.info-box {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  color: #1e40af;
}

.cell-ref {
  color: #9ca3af;
  font-size: 11px;
}

/* Actions */
.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.btn-primary {
  background: #2563eb;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}

.btn-secondary {
  background: #e5e7eb;
  color: #374151;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-link {
  color: #2563eb;
  text-decoration: underline;
}

/* Summary */
.summary-box,
.locked-slots-box,
.completion-box {
  margin: 16px 0;
}

.summary-table,
.locked-slots-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.summary-table td,
.locked-slots-table td,
.locked-slots-table th {
  padding: 6px 8px;
  border-bottom: 1px solid #e5e7eb;
}

.summary-table tr:nth-child(odd) {
  background: #f9fafb;
}

.locked-slots-table th {
  background: #f3f4f6;
  font-weight: 600;
}

.success-message {
  font-size: 18px;
  color: #16a34a;
  font-weight: 600;
  margin: 16px 0;
}

/* Loading */
.loading {
  text-align: center;
  padding: 32px;
  color: #6b7280;
}
</style>
