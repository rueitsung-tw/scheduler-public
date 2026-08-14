<template>
  <div class="subject-excel-import">
    <!-- Section 1: Header & Instructions -->
    <div class="import-header">
      <h2>📥 科任配課 Excel 匯入</h2>
      <p class="explanation">
        解析 Excel 檔案中的配課公式（如「6自*5」），*號後方為班級數，系統將自動乘上該年級每班節數以更新配課與總節數。配課式填寫「-」或空白時，保留原有配課資料不覆寫。
      </p>
    </div>

    <!-- Prerequisite Check Banner -->
    <div v-if="!isPrerequisiteMet" id="prerequisite-warning" class="alert alert-warning">
      ⚠️ 前提條件未滿足：系統尚未建立完整的全校「教師名冊」與「班級/課程目錄」，無法進行配課匯入操作。
    </div>

    <!-- Section 2: File Upload & Example Template Download -->
    <div class="action-bar card">
      <div class="upload-box">
        <label for="subject-excel-upload" class="label-title">選擇 Excel 檔案 (.xlsx)：</label>
        <input
          type="file"
          id="subject-excel-upload"
          accept=".xlsx,.xls"
          :disabled="!isPrerequisiteMet"
          @change="handleFileUpload"
          class="file-input"
        />
      </div>
      <button
        id="download-template-btn"
        class="btn btn-secondary"
        :disabled="!isPrerequisiteMet"
        @click="handleDownloadTemplate"
      >
        📄 下載去識別化範例檔
      </button>
    </div>

    <!-- Status Notification -->
    <div v-if="statusMessage" id="status-message" :class="['status-box', statusType]">
      {{ statusMessage }}
    </div>

    <div v-if="skippedRows.length > 0" id="skipped-import-notice" class="status-box info">
      ℹ️ {{ skippedRows.length }} 位教師填寫「-」或空白且已有配課，已略過，不會覆寫原有資料。
    </div>

    <div v-if="unassignedTeacherWarnings.length > 0" id="unassigned-teacher-notice" class="status-box warning">
      ⚠️ {{ unassignedTeacherWarnings.length }} 位教師（{{ unassignedTeacherWarnings.map((w) => w.teacherName).join('、') }}）填寫「-」或空白且尚無配課資料，已略過不覆寫。
    </div>

    <!-- Section 3: Subject Code Mapping Management -->
    <div class="mapping-section card">
      <h3>🔀 科目代碼對照表設定</h3>
      <p class="help-text">
        對照表持久化於系統 schoolInfo.subjectCodeMappings 中。選擇系統課程目錄中的科目設定代碼對照。
      </p>

      <div class="mapping-table-wrapper">
        <table class="mapping-table">
          <thead>
            <tr>
              <th>Excel 代碼</th>
              <th>系統對應科目</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(sysSubject, code) in codeMappings" :key="code">
              <td><span class="code-badge">{{ code }}</span></td>
              <td>{{ sysSubject }}</td>
              <td>
                <button class="btn-sm btn-danger" @click="removeCodeMapping(code)">刪除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Add New Mapping Form -->
      <div class="add-mapping-form">
        <input
          type="text"
          id="new-excel-code-input"
          v-model="newCode"
          placeholder="代碼 (例: 藝)"
          class="input-sm"
        />
        <select id="new-target-subject-select" v-model="newSystemSubject" class="select-sm">
          <option value="" disabled>請選擇系統科目</option>
          <option v-for="subj in systemSubjectOptions" :key="subj" :value="subj">
            {{ subj }}
          </option>
        </select>
        <button id="add-mapping-btn" class="btn btn-sm btn-primary" @click="addCodeMapping">
          新增對照
        </button>
        <button
          id="save-mappings-btn"
          class="btn btn-sm btn-success"
          :disabled="isSavingMappings"
          @click="handleSaveMappings"
        >
          💾 儲存對照表
        </button>
      </div>
    </div>

    <!-- Section 4: Blocker Dialog / Warning Notice -->
    <div v-if="blockers.length > 0" id="blocker-notice" class="blocker-notice card">
      <h3 class="text-danger">🚫 檔案檢核阻擋 (共 {{ blockers.length }} 項錯誤)</h3>
      <p v-if="unknownCodes.length > 0" class="unknown-code-alert">
        ⚠️ 包含未知科目代碼【{{ unknownCodes.join(', ') }}】，未知代碼阻擋匯入，請先新增對照表設定後重新解析。
      </p>
      <div class="blocker-table-wrapper">
        <table class="blocker-table">
          <thead>
            <tr>
              <th>Excel列號</th>
              <th>教師姓名</th>
              <th>原始公式</th>
              <th>阻擋原因與說明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(b, idx) in blockers" :key="idx">
              <td>第 {{ b.rowNumber }} 列</td>
              <td>{{ b.teacherName || '-' }}</td>
              <td><code>{{ b.rawFormula || '-' }}</code></td>
              <td class="text-danger">{{ b.cause }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 4.5: Typo Correction Warnings Notice -->
    <div v-if="blockers.length === 0 && correctionWarnings.length > 0" id="correction-warnings-notice" class="blocker-notice card">
      <h3>⚠️ 配課式自動修正提醒 (共 {{ correctionWarnings.length }} 項)</h3>
      <p class="help-text">
        系統辨識到配課式包含已知誤字並已自動修正。修正僅作用於本次暫存匯入，不會修改上傳的原 Excel 檔案。
      </p>
      <div class="blocker-table-wrapper">
        <table class="blocker-table">
          <thead>
            <tr>
              <th>Excel列號</th>
              <th>教師姓名</th>
              <th>原配課式</th>
              <th>修正後配課式</th>
              <th>說明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(w, idx) in correctionWarnings" :key="idx">
              <td>第 {{ w.rowNumber }} 列</td>
              <td>{{ w.teacherName }}</td>
              <td><code>{{ w.originalToken }}</code></td>
              <td><code>{{ w.replacementToken }}</code></td>
              <td>{{ w.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 5: Diff Preview & Confirmation Gates -->
    <div v-if="blockers.length === 0 && parsedRows.length > 0" id="preview-section" class="preview-section card">
      <h3>🔍 匯入變更預覽 (解析 {{ parsedRows.length }} 筆教師配課)</h3>
      <div class="diff-table-wrapper">
        <table class="diff-table">
          <thead>
            <tr>
              <th>教師姓名</th>
              <th>身分類別</th>
              <th>舊配課/總節數</th>
              <th>匯入配課/總節數</th>
              <th>異動狀態</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in diffResults" :key="d.teacherName">
              <td><strong>{{ d.teacherName }}</strong></td>
              <td>{{ d.isHomeroom ? '導師' : (d.teacherType === 'admin' ? '行政' : '科任') }}</td>
              <td>
                <div>總節數: {{ d.old.max_periods }}</div>
                <div class="rules-summary">{{ formatRules(d.old.assignment_rules) }}</div>
              </td>
              <td>
                <div>總節數: {{ d.imported.max_periods }}</div>
                <div class="rules-summary">{{ formatRules(d.imported.assignment_rules) }}</div>
              </td>
              <td>
                <span v-if="d.hasChanges" class="badge badge-warning">有變更</span>
                <span v-else class="badge badge-secondary">無變更</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Confirmation Gates -->
      <div class="confirm-gates">
        <div class="gate-option">
          <label for="confirm-overwrite" class="checkbox-label">
            <input type="checkbox" id="confirm-overwrite" v-model="confirmOverwrite" />
            確認覆蓋既有教師之配課規則與專長節數
          </label>
        </div>

        <div v-if="hasHomeroomTeacherInImport" class="gate-option">
          <label for="confirm-homeroom" class="checkbox-label">
            <input type="checkbox" id="confirm-homeroom" v-model="confirmHomeroom" />
            確認匯入導師配課 (將寫入導師之兼任科任配課規則)
          </label>
        </div>

        <div v-if="correctionWarnings.length > 0" class="gate-option">
          <label for="confirm-corrections" class="checkbox-label">
            <input type="checkbox" id="confirm-corrections" v-model="confirmCorrections" />
            確認接受配課式自動修正（修正僅作用於本次暫存匯入，不會修改上傳的原 Excel 檔案）
          </label>
        </div>
      </div>

      <!-- Apply Button -->
      <div class="apply-actions">
        <button
          id="apply-import-btn"
          class="btn btn-primary btn-lg"
          :disabled="!canApply"
          @click="handleApplyImport"
        >
          🚀 確認匯入配課
        </button>
      </div>
    </div>


    <!-- Section 6: Mixed Teaching Resolution Dialog -->
    <MixedTeachingResolutionDialog
      :visible="showMixedDialog"
      :plans="pendingMixedPlans"
      :apply-error="mixedApplyError"
      :is-applying="isApplyingMixed"
      @confirm="handleMixedConfirm"
      @cancel="handleMixedCancel"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import {
  DEFAULT_SUBJECT_CODE_MAPPINGS,
  validateAndParseExcelRows,
  generateSubjectAssignmentTemplate,
  buildDiffComparison,
  applyImportToTeachers,
} from '../utils/subjectAssignmentExcelParser'
import {
  filterRulesForImportedMaterialization,
  materializeImportedAssignmentRules,
} from '../utils/subjectAssignmentMaterializer'
import MixedTeachingResolutionDialog from './MixedTeachingResolutionDialog.vue'
import {
  buildMixedTeachingPlans,
  buildMixedTeachingAssignmentLedger,
  applyResolvedMixedTeachingPlans,
  validateImportedTeacherAssignments,
} from '../utils/mixedTeachingPlan.js'

const scheduleStore = useScheduleStore()

const fileBuffer = ref(null)
const parsedRows = ref([])
const blockers = ref([])
const unknownCodes = ref([])
const skippedRows = ref([])
const unassignedTeacherWarnings = ref([])
const correctionWarnings = ref([])
const confirmOverwrite = ref(false)
const confirmHomeroom = ref(false)
const confirmCorrections = ref(false)
const statusMessage = ref('')
const statusType = ref('info')
const isSavingMappings = ref(false)

const showMixedDialog = ref(false)
const pendingMixedPlans = ref([])
const mixedPlanBlockers = ref([])
const mixedApplyError = ref('')
const isApplyingMixed = ref(false)

const newCode = ref('')
const newSystemSubject = ref('')

// Initialize codeMappings reactive ref
const codeMappings = ref({
  ...(scheduleStore.schoolInfo?.subjectCodeMappings || DEFAULT_SUBJECT_CODE_MAPPINGS),
})

watch(
  () => scheduleStore.schoolInfo?.subjectCodeMappings,
  (newVal) => {
    if (newVal && typeof newVal === 'object') {
      codeMappings.value = { ...newVal }
    }
  },
  { deep: true }
)

const isPrerequisiteMet = computed(() => {
  return (
    Array.isArray(scheduleStore.teachers) &&
    scheduleStore.teachers.length > 0 &&
    Array.isArray(scheduleStore.classes) &&
    scheduleStore.classes.length > 0
  )
})

const systemSubjectOptions = computed(() => {
  const fromAll = (scheduleStore.allAvailableSubjects || []).map((s) =>
    typeof s === 'string' ? s : s.name
  )
  const fromDomain = (scheduleStore.standardDomainSettings || []).map((s) =>
    typeof s === 'string' ? s : s.name
  )
  const set = new Set([...fromAll, ...fromDomain])
  return Array.from(set).filter(Boolean)
})

const diffResults = computed(() => {
  return buildDiffComparison(parsedRows.value, scheduleStore.teachers || [])
})

const hasHomeroomTeacherInImport = computed(() => {
  return diffResults.value.some((d) => d.isHomeroom || d.teacherType === 'homeroom')
})

const canApply = computed(() => {
  const homeroomRequirement = !hasHomeroomTeacherInImport.value || confirmHomeroom.value
  const correctionRequirement = correctionWarnings.value.length === 0 || confirmCorrections.value
  return (
    isPrerequisiteMet.value &&
    parsedRows.value.length > 0 &&
    blockers.value.length === 0 &&
    confirmOverwrite.value &&
    homeroomRequirement &&
    correctionRequirement
  )
})

const formatRules = (rules = []) => {
  if (!rules || rules.length === 0) return '無配課'
  return rules
    .map((r) => {
      const countStr = r.classCount ? `*${r.classCount}班` : ''
      return `${r.grade}年${r.systemSubject || r.subject}${countStr} (${r.periods}節)`
    })
    .join(' + ')
}

const handleDownloadTemplate = () => {
  const buffer = generateSubjectAssignmentTemplate()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '科任配課範例檔.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const handleFileUpload = (e) => {
  const fileInput = e.target
  const file = fileInput?.files?.[0]
  if (!file) return

  confirmOverwrite.value = false
  confirmHomeroom.value = false
  confirmCorrections.value = false
  correctionWarnings.value = []
  statusMessage.value = ''
  showMixedDialog.value = false
  pendingMixedPlans.value = []
  mixedApplyError.value = ''
  isApplyingMixed.value = false
  scheduleStore.pendingMixedPlans = []
  mixedPlanBlockers.value = []
  unassignedTeacherWarnings.value = []

  const reader = new FileReader()
  reader.onload = (event) => {
    fileBuffer.value = event.target.result
    parseBuffer()
    if (fileInput) {
      fileInput.value = ''
    }
  }
  reader.readAsArrayBuffer(file)
}

const parseBuffer = () => {
  if (!fileBuffer.value) return

  showMixedDialog.value = false
  pendingMixedPlans.value = []
  mixedApplyError.value = ''
  isApplyingMixed.value = false
  scheduleStore.pendingMixedPlans = []
  mixedPlanBlockers.value = []
  confirmCorrections.value = false

  const result = validateAndParseExcelRows(
    fileBuffer.value,
    scheduleStore.teachers || [],
    scheduleStore.classes || [],
    codeMappings.value,
    scheduleStore.schoolInfo,
    scheduleStore.standardDomainSettings
  )

  parsedRows.value = result.rows || []
  blockers.value = result.errors || []
  unknownCodes.value = result.unknownCodes || []
  skippedRows.value = result.skippedRows || []
  unassignedTeacherWarnings.value = result.unassignedTeacherWarnings || []
  correctionWarnings.value = result.correctionWarnings || []

  if (result.errors && result.errors.length > 0) {
    statusType.value = 'error'
    statusMessage.value = `⚠️ Excel 檢核發現 ${result.errors.length} 項錯誤阻擋，請修正後重新上傳`
  } else {
    statusType.value = 'info'
    statusMessage.value = `✅ Excel 檔案解析完成，共 ${result.rows.length} 筆教師配課資料`
    if ((result.unassignedTeacherWarnings || []).length > 0) {
      const names = result.unassignedTeacherWarnings.map((item) => item.teacherName).join('、')
      window.alert(`提醒：${names} 的配課式為「-」或空白，且系統尚未發現任何配課資料。此列不會覆寫資料，請確認後續會由自動配課或人工預排帶入。`)
    }
  }
}

const addCodeMapping = () => {
  const code = newCode.value.trim()
  const target = newSystemSubject.value
  if (!code || !target) return

  codeMappings.value = {
    ...codeMappings.value,
    [code]: target,
  }
  newCode.value = ''
  newSystemSubject.value = ''
}

const removeCodeMapping = (code) => {
  const nextMappings = { ...codeMappings.value }
  delete nextMappings[code]
  codeMappings.value = nextMappings
}

const handleSaveMappings = async () => {
  isSavingMappings.value = true
  statusMessage.value = ''
  try {
    const existingInfo =
      scheduleStore.schoolInfo && typeof scheduleStore.schoolInfo === 'object'
        ? scheduleStore.schoolInfo
        : {}
    scheduleStore.schoolInfo = {
      ...existingInfo,
      subjectCodeMappings: { ...codeMappings.value },
    }
    scheduleStore.markScheduleDirty()
    await scheduleStore.syncToCloud()

    statusType.value = 'success'
    statusMessage.value = '✅ 科目代碼對照表已成功儲存並同步至雲端！'

    if (fileBuffer.value) {
      parseBuffer()
    }
  } catch (err) {
    statusType.value = 'error'
    statusMessage.value = '❌ 儲存對照表失敗: ' + (err.message || err)
  } finally {
    isSavingMappings.value = false
  }
}

const handleApplyImport = async () => {
  if (!canApply.value) return

  if (hasHomeroomTeacherInImport.value && !confirmHomeroom.value) {
    statusType.value = 'error'
    statusMessage.value = '❌ 未確認導師配課匯入，無法套用'
    return
  }

  const { plans, blockers: mixedBlockers } = buildMixedTeachingPlans({
    parsedRows: parsedRows.value,
    teachers: scheduleStore.teachers || [],
    classes: scheduleStore.classes || [],
  })

  if (mixedBlockers && mixedBlockers.length > 0) {
    mixedPlanBlockers.value = mixedBlockers
    statusType.value = 'error'
    statusMessage.value = `⚠️ 混合配課檢核阻擋: ${mixedBlockers.map((b) => b.cause).join('; ')}`
    return
  }

  if (plans && plans.length > 0) {
    pendingMixedPlans.value = plans
    mixedApplyError.value = ''
    isApplyingMixed.value = false
    scheduleStore.pendingMixedPlans = plans
    showMixedDialog.value = true
    return
  }

  await commitImport({ resolutions: [] })
}

const handleMixedConfirm = async ({ resolutions }) => {
  if (isApplyingMixed.value) return

  isApplyingMixed.value = true
  mixedApplyError.value = ''
  try {
    await commitImport({ resolutions })
  } finally {
    isApplyingMixed.value = false
  }
}

const handleMixedCancel = () => {
  showMixedDialog.value = false
  pendingMixedPlans.value = []
  mixedApplyError.value = ''
  isApplyingMixed.value = false
  scheduleStore.pendingMixedPlans = []
}

const commitImport = async ({ resolutions = [] }) => {
  const confirmedHomeroomTeacherIds = confirmHomeroom.value
    ? diffResults.value
        .filter((d) => d.isHomeroom || d.teacherType === 'homeroom')
        .map((d) => d.teacherId ?? d.teacherName)
    : []

  const nextTeachers = applyImportToTeachers(
    parsedRows.value,
    scheduleStore.teachers || [],
    confirmedHomeroomTeacherIds
  )

  const nextClasses = applyResolvedMixedTeachingPlans(scheduleStore.classes || [], resolutions)
  const mixedAssignmentLedger = buildMixedTeachingAssignmentLedger({
    resolutions,
    teachers: nextTeachers,
  })

  const rowMap = new Map()
  for (const row of parsedRows.value) {
    if (row.teacherId != null) {
      rowMap.set(String(row.teacherId), row)
    }
    if (row.teacherName) {
      rowMap.set(String(row.teacherName).trim(), row)
    }
  }

  const participatingTeachers = nextTeachers.filter((t) => {
    const byId = t.id != null && rowMap.has(String(t.id))
    const byName = t.name && rowMap.has(String(t.name).trim())
    return byId || byName
  })

  // 混合配課決議已完整寫入這些年級＋科目；只排除一般物化的暫存規則，
  // 不影響 nextTeachers 內最終要保存的完整 Excel assignment_rules。
  const materializationTeachers = filterRulesForImportedMaterialization(
    participatingTeachers,
    resolutions
  )

  const materialized = materializeImportedAssignmentRules({
    classes: nextClasses,
    teachers: materializationTeachers,
    confirmedHomeroomTeacherIds,
  })

  if (!materialized.success) {
    statusType.value = 'error'
    statusMessage.value = `❌ 無法套用班級配課：${materialized.error || '未知錯誤'}`
    if (resolutions.length > 0) {
      mixedApplyError.value = `無法套用班級配課：${materialized.error || '未知錯誤'}`
      showMixedDialog.value = true
    }
    return
  }

  const assignmentValidation = validateImportedTeacherAssignments({
    parsedRows: parsedRows.value,
    teachers: nextTeachers,
    assignmentLedger: [
      ...mixedAssignmentLedger,
      ...(materialized.assignmentLedger || []),
    ],
  })

  if (!assignmentValidation.valid) {
    const detail = assignmentValidation.errors.join('；')
    statusType.value = 'error'
    statusMessage.value = `❌ 無法套用班級配課：匯入教師尚未完整分配至班級。${detail}`
    if (resolutions.length > 0) {
      mixedApplyError.value = `匯入教師配課檢核未通過：${detail}`
      showMixedDialog.value = true
    }
    return
  }

  const prevTeachers = scheduleStore.teachers
  const prevClasses = scheduleStore.classes

  scheduleStore.teachers = nextTeachers
  scheduleStore.classes = materialized.classes
  scheduleStore.markScheduleDirty()

  try {
    const res = await scheduleStore.syncToCloud()
    if (res === false) {
      throw new Error('雲端同步狀態異常')
    }
    showMixedDialog.value = false
    pendingMixedPlans.value = []
    scheduleStore.pendingMixedPlans = []
    statusType.value = 'success'
    statusMessage.value = `🎉 科任配課資料已成功套用並儲存至雲端！（已指派 ${materialized.assignedCount} 節班級課程）`
  } catch (err) {
    scheduleStore.teachers = prevTeachers
    scheduleStore.classes = prevClasses
    statusType.value = 'error'
    statusMessage.value = '❌ 無法儲存至雲端: ' + (err.message || err)
    if (resolutions.length > 0) {
      mixedApplyError.value = statusMessage.value
      showMixedDialog.value = true
    }
  }
}
</script>

<style scoped>
.subject-excel-import {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1rem;
}

.import-header h2 {
  margin: 0 0 0.5rem 0;
  font-size: 1.35rem;
  color: #1e293b;
}

.explanation {
  color: #64748b;
  margin: 0;
  font-size: 0.925rem;
}

.alert {
  padding: 0.85rem 1.15rem;
  border-radius: 6px;
  font-size: 0.9rem;
}

.alert-warning {
  background-color: #fffbe6;
  border: 1px solid #ffe58f;
  color: #d46b08;
}

.card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1.25rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.upload-box {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.label-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: #334155;
}

.file-input {
  font-size: 0.9rem;
}

.status-box {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
}

.status-box.info {
  background-color: #e6f7ff;
  border: 1px solid #91d5ff;
  color: #0958d9;
}

.status-box.success {
  background-color: #f6ffed;
  border: 1px solid #b7eb8f;
  color: #389e0d;
}

.status-box.error {
  background-color: #fff2f0;
  border: 1px solid #ffccc7;
  color: #cf1322;
}

.mapping-section h3,
.blocker-notice h3,
.preview-section h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
}

.help-text {
  color: #64748b;
  font-size: 0.85rem;
  margin-bottom: 1rem;
}

.mapping-table-wrapper,
.blocker-table-wrapper,
.diff-table-wrapper {
  overflow-x: auto;
  margin-bottom: 1rem;
}

.mapping-table,
.blocker-table,
.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.mapping-table th,
.mapping-table td,
.blocker-table th,
.blocker-table td,
.diff-table th,
.diff-table td {
  border: 1px solid #e2e8f0;
  padding: 0.5rem 0.75rem;
  text-align: left;
}

.mapping-table th,
.blocker-table th,
.diff-table th {
  background-color: #f8fafc;
  color: #475569;
  font-weight: 600;
}

.code-badge {
  background-color: #e2e8f0;
  color: #1e293b;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-weight: 600;
}

.add-mapping-form {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.input-sm,
.select-sm {
  padding: 0.4rem 0.6rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.875rem;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.875rem;
}

.btn-secondary {
  background-color: #64748b;
  color: #ffffff;
}

.btn-primary {
  background-color: #2563eb;
  color: #ffffff;
}

.btn-success {
  background-color: #16a34a;
  color: #ffffff;
}

.btn-sm {
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-weight: 600;
}

.btn-danger {
  background-color: #ef4444;
  color: #ffffff;
}

.btn:disabled,
.btn-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.text-danger {
  color: #dc2626;
}

.unknown-code-alert {
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.badge {
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-warning {
  background-color: #fef3c7;
  color: #92400e;
}

.badge-secondary {
  background-color: #f1f5f9;
  color: #64748b;
}

.rules-summary {
  font-size: 0.8rem;
  color: #64748b;
  margin-top: 0.2rem;
}

.confirm-gates {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 1.25rem 0;
  padding: 0.85rem;
  background-color: #f8fafc;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: #1e293b;
  cursor: pointer;
}

.apply-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
