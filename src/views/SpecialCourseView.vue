<template>
  <div class="special-course-container">
    <h2>🎯 第三軌：特殊專案與抽離課程設定</h2>
    <p class="desc">設定學習中心、創思中心等「精準抽離」課程。</p>

    <div class="import-panel card">
      <div class="import-panel-header">
        <h3>📥 工作檔匯入</h3>
        <p>上傳教務處的區塊排課工作檔，系統會先拆成可追加、需確認取代與阻擋錯誤三種結果。</p>
      </div>

      <div class="import-controls">
        <label class="import-control">
          <span>1. 選擇工作檔 (.xlsx)：</span>
          <input
            ref="importFileInput"
            data-testid="block-schedule-import-file"
            type="file"
            accept=".xlsx,.xls"
            @change="handleImportFileChange"
          />
          <span v-if="importFileName" class="import-file-name">已選擇：{{ importFileName }}</span>
        </label>

        <label class="import-control">
          <span>2. 匯入單位名稱：</span>
          <input
            data-testid="block-schedule-unit-name"
            type="text"
            v-model.trim="blockScheduleUnitName"
            placeholder="創思中心"
          />
        </label>

        <label class="danger-check">
          <input
            data-testid="clear-block-schedule"
            type="checkbox"
            v-model="clearBeforeAppend"
          />
          先清空第三軌既有資料，再追加本次匯入
        </label>
      </div>

      <div v-if="importError" data-testid="import-error" class="status-box error">
        ❌ {{ importError }}
      </div>

      <div v-if="importStatus" data-testid="import-status" class="status-box success">
        ✅ {{ importStatus }}
      </div>

      <div v-if="importWarnings.length > 0" data-testid="import-warnings" class="status-box warning">
        <div>⚠️ 偵測到 {{ importWarnings.length }} 筆提醒</div>
        <ul class="warning-list">
          <li v-for="(warning, index) in importWarnings" :key="`warning-${index}`">
            {{ warning.message }}
          </li>
        </ul>
      </div>

      <div v-if="hasImportPlan" class="import-summary">
        <span>可追加：<strong>{{ appendableRows.length }}</strong> 筆</span>
        <span>需確認取代：<strong>{{ replacementRows.length }}</strong> 筆</span>
        <span>阻擋錯誤：<strong>{{ importBlockers.length }}</strong> 筆</span>
      </div>

      <div v-if="appendableRows.length > 0" data-testid="appendable-section" class="preview-group">
        <h4>可追加</h4>
        <table class="preview-table">
          <thead>
            <tr>
              <th>狀態</th>
              <th>來源儲存格</th>
              <th>上課時間</th>
              <th>參與班級</th>
              <th>課程</th>
              <th>教師</th>
              <th>分組</th>
              <th>專案名稱</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in appendableRows" :key="buildPreviewKey(entry)">
              <td><span class="state-badge state-append">可追加</span></td>
              <td>{{ entry.source.cell }}</td>
              <td>{{ formatCourseTime(entry.course) }}</td>
              <td>{{ formatClassList(entry.course) }}</td>
              <td>{{ entry.course.targetSubject }}</td>
              <td>{{ formatTeacherName(entry.course) }}</td>
              <td>{{ formatSourceGroup(entry.course) }}</td>
              <td>{{ formatProjectName(entry.course) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="replacementRows.length > 0" data-testid="replacement-section" class="preview-group">
        <h4>需確認取代</h4>
        <table class="preview-table">
          <thead>
            <tr>
              <th>狀態</th>
              <th>來源儲存格</th>
              <th>上課時間</th>
              <th>參與班級</th>
              <th>課程</th>
              <th>教師</th>
              <th>分組</th>
              <th>專案名稱</th>
              <th>取代候選</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in replacementRows" :key="buildPreviewKey(entry)">
              <td><span class="state-badge state-replacement">需確認取代</span></td>
              <td>{{ entry.incomingEntry.source.cell }}</td>
              <td>{{ formatCourseTime(entry.incomingEntry.course) }}</td>
              <td>{{ formatClassList(entry.incomingEntry.course) }}</td>
              <td>{{ entry.incomingEntry.course.targetSubject }}</td>
              <td>{{ formatTeacherName(entry.incomingEntry.course) }}</td>
              <td>{{ formatSourceGroup(entry.incomingEntry.course) }}</td>
              <td>{{ formatProjectName(entry.incomingEntry.course) }}</td>
              <td>
                <div class="candidate-list">
                  <label
                    v-for="candidate in entry.existingCandidates"
                    :key="candidate.id"
                    class="candidate-checkbox"
                  >
                    <input
                      type="checkbox"
                      v-model="selectedReplacementIds"
                      :value="candidate.id"
                    />
                    <span>
                      取代既有 {{ candidate.id }}
                      <small>
                        {{ formatCourseTime(candidate) }} / {{ formatClassList(candidate) }} / {{ formatTeacherName(candidate) }}
                      </small>
                    </span>
                  </label>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="importBlockers.length > 0" data-testid="blocker-section" class="preview-group blocker-group">
        <h4>阻擋錯誤</h4>
        <table class="preview-table">
          <thead>
            <tr>
              <th>狀態</th>
              <th>來源儲存格</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(blocker, index) in importBlockers" :key="`blocker-${index}-${blocker.cellRef || blocker.cell || blocker.message}`">
              <td><span class="state-badge state-blocker">阻擋錯誤</span></td>
              <td>{{ blocker.cellRef || blocker.cell || '-' }}</td>
              <td>{{ blocker.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="import-actions">
        <button
          data-testid="confirm-block-schedule-import"
          class="confirm-import-btn"
          :disabled="!canConfirmImport"
          @click="confirmBlockScheduleImport"
        >
          確認匯入第三軌
        </button>
      </div>
    </div>

    <div class="form-section">
      <div class="form-row split">
        <div class="form-group">
          <label>1. 課程類別：</label>
          <select v-model="pulloutForm.type">
            <option value="學習中心">學習中心</option>
            <option value="創思中心">創思中心</option>
            <option value="其他抽離">其他抽離課程</option>
          </select>
        </div>
        <div class="form-group">
          <label>2. 鎖定對應學科 (原班級需抽離的課)：</label>
          <select v-model="pulloutForm.subject">
            <option disabled value="">請選擇科目</option>
            <option v-for="sub in availableSubjects" :key="sub" :value="sub">{{ sub }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>3. 特教/負責教師：</label>
          <select v-model="pulloutForm.teacher">
            <option disabled value="">請選擇教師</option>
            <option v-for="t in specialEdTeachers" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group class-selector-group">
          <label>4. 參與班級指定方式：</label>
          <div class="radio-group mb-2">
            <label class="rb-label"><input type="radio" value="manual" v-model="pulloutForm.classMode"> 📌 手動指定特定班級</label>
            <label class="rb-label"><input type="radio" value="auto" v-model="pulloutForm.classMode"> 🤖 設定年級範圍，交給 AI 自動湊班 (支援跨年級)</label>
          </div>

          <div v-if="pulloutForm.classMode === 'manual'" class="class-matrix">
            <div v-for="grade in 6" :key="grade" class="grade-row" v-show="getClassesByGrade(grade).length > 0">
              <div class="grade-label">{{ grade }} 年級</div>
              <div class="checkboxes">
                <label v-for="cls in getClassesByGrade(grade)" :key="cls" class="cb-label" :class="{ 'is-selected': pulloutForm.classes.includes(cls) }">
                  <input type="checkbox" :value="cls" v-model="pulloutForm.classes"> {{ cls }}
                </label>
              </div>
            </div>
          </div>

          <div v-else class="ai-class-config">
            <div class="config-row">
              <label>允許挑選的年級池 (可複選)：</label>
              <div class="checkboxes">
                <label v-for="g in 6" :key="g" class="cb-label" :class="{ 'is-selected': pulloutForm.autoGrades.includes(g) }">
                  <input type="checkbox" :value="g" v-model="pulloutForm.autoGrades"> {{ g }} 年級
                </label>
              </div>
            </div>
            <div class="config-row mt-2">
              <label>需湊齊的總班級數：</label>
              <input type="number" v-model="pulloutForm.autoCount" min="1" max="10" class="small-input" /> 班
              <span class="hint-text ml-2">💡 AI 將從上方年級池中，自動尋找課表能完美配合的 {{ pulloutForm.autoCount }} 個班級。</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="ai-action-bar">
      <div class="ai-info">
        <strong>💡 步驟 5：選擇上課時段設定方式</strong>
        <span>您可以點擊下方網格指定絕對時間，或保留彈性交給系統自動安排。</span>
      </div>
      <button @click="handleAutoAI" class="ai-btn">🤖 不指定時間，交給 AI 尋找最佳空檔</button>
    </div>

    <div class="grid-section">
      <div class="timetable-grid">
        <div class="grid-header empty-cell"></div>
        <div class="grid-header" v-for="day in 5" :key="`header-${day}`">星期{{ ['一','二','三','四','五'][day-1] }}</div>

        <template v-for="period in 7" :key="`period-${period}`">
          <div class="grid-time-label">第 {{ period }} 節</div>
          <div
            v-for="day in 5"
            :key="`cell-${day}-${period}`"
            class="grid-cell"
            :class="{
              'is-noon': period === 4
            }"
            @click="handleGridClick(day, period)"
          >
            <span class="hover-text">
              + 手動鎖定此節
            </span>
          </div>
        </template>
      </div>
    </div>

    <div class="courses-list-section">
      <h3>已建立的特殊規則清單</h3>
      <table class="courses-table">
        <thead>
          <tr>
            <th>類型</th>
            <th>上課時間</th>
            <th>參與班級</th>
            <th>課程名稱 / 對應學科</th>
            <th>負責教師</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="course in scheduleStore.specialCourses" :key="course.id">
            <td>
              <span class="badge-purple">
                🧩 精準抽離
              </span>
            </td>
            <td>
              <strong v-if="course.isAutoTime" class="text-ai">🤖 AI 自動安排</strong>
              <strong v-else>{{ formatTime(course) }}</strong>
            </td>
            <td>
              <div v-if="course.isAutoClass" class="auto-class-badge">
                🤖 AI 跨班組合 <br><span class="sub-text">(由 {{ course.autoClassConfig?.grades.join(',') }} 年級中抽 {{ course.autoClassConfig?.count }} 班)</span>
              </div>
              <div v-else class="tags-container">
                <span class="class-tag" v-for="c in course.targetClasses" :key="c">{{ c }}</span>
              </div>
            </td>
            <td>{{ course.name }} <br><small style="color:#64748b" v-if="course.targetSubject">({{ course.targetSubject }})</small></td>
            <td>{{ course.teacher || '無' }}</td>
            <td>
              <button @click="deleteCourse(course.id)" class="delete-btn">刪除</button>
            </td>
          </tr>
          <tr v-if="!scheduleStore.specialCourses || scheduleStore.specialCourses.length === 0">
            <td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">尚無設定任何特殊規則</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import { buildBlockScheduleImportPlan, parseBlockScheduleWorkbook } from '../utils/blockScheduleExcelImport.js'

const scheduleStore = useScheduleStore()

const importFileInput = ref(null)
const importFileName = ref('')
const importError = ref('')
const importStatus = ref('')
const importWorkbookBuffer = ref(null)
const importPlan = ref(null)
const importBlockers = ref([])
const importWarnings = ref([])
const clearBeforeAppend = ref(false)
const blockScheduleUnitName = ref('創思中心')
const selectedReplacementIds = ref([])
const isImportingBlockSchedule = ref(false)

const pulloutForm = ref({
  type: '學習中心',
  subject: '',
  teacher: '',
  classMode: 'manual',
  classes: [],
  autoGrades: [],
  autoCount: 1
})

const hasImportPlan = computed(() => Boolean(importPlan.value))
const appendableRows = computed(() => importPlan.value?.appendable || [])
const replacementRows = computed(() => importPlan.value?.replacements || [])
const canConfirmImport = computed(() => {
  return hasImportPlan.value && (appendableRows.value.length + replacementRows.value.length) > 0 && importBlockers.value.length === 0 && !isImportingBlockSchedule.value
})

const getClassesByGrade = (grade) => {
  const list = []
  const configs = scheduleStore.schoolInfo?.gradeSettings || scheduleStore.schoolInfo?.gradeConfigs || {}
  const count = Number(configs[grade]) || 0
  for (let i = 1; i <= count; i++) {
    list.push(`${grade}年${i}班`)
  }
  return list
}

const availableSubjects = computed(() => {
  if (!scheduleStore.standardDomainSettings) return ['國語文', '數學', '健康與體育', '藝術']
  return scheduleStore.standardDomainSettings.map(s => s.name)
})

const formatCourseTime = (course) => {
  const slot = course?.lockedSlots?.[0]
  if (!slot) return '未指定'
  const dayLabel = ['一', '二', '三', '四', '五'][Number(slot.day) - 1] || String(slot.day || '')
  return `星期${dayLabel} 第${slot.period}節`
}

const formatClassList = (course) => (course?.targetClasses || []).join('、') || '-'

const formatTeacherName = (course) => course?.teacher || course?.teacher_name || '無'

const formatSourceGroup = (course) => course?.sourceGroup || '-'

const formatProjectName = (course) => course?.projectName || '-'

const buildPreviewKey = (entry) => {
  const course = entry?.course || entry?.incomingEntry?.course || {}
  const source = entry?.source || entry?.incomingEntry?.source
  const slot = course?.lockedSlots?.[0]
  const sourceCell = source?.cell || source?.cellRef || 'unknown'
  return `${sourceCell}-${course?.name || ''}-${course?.targetSubject || ''}-${formatClassList(course)}-${slot?.day || ''}-${slot?.period || ''}`
}

const clearImportState = ({ keepStatus = false } = {}) => {
  importWorkbookBuffer.value = null
  importPlan.value = null
  importBlockers.value = []
  importWarnings.value = []
  selectedReplacementIds.value = []
  importError.value = ''
  importFileName.value = ''
  if (!keepStatus) {
    importStatus.value = ''
  }
  if (importFileInput.value) {
    importFileInput.value.value = ''
  }
}

const rebuildImportPreview = (arrayBuffer) => {
  const parsed = parseBlockScheduleWorkbook(arrayBuffer, {
    classes: scheduleStore.classes,
    teachers: scheduleStore.teachers,
    giftedUnitName: blockScheduleUnitName.value.trim() || '創思中心',
    learningCenterName: '學習中心',
  })
  const plan = buildBlockScheduleImportPlan(parsed.entries, scheduleStore.specialCourses)
  importWorkbookBuffer.value = arrayBuffer
  importPlan.value = plan
  importBlockers.value = [...(parsed.blockers || []), ...(plan.blockers || [])]
  importWarnings.value = [...(parsed.warnings || []), ...(plan.warnings || [])]
  selectedReplacementIds.value = plan.replacements.flatMap((replacement) =>
    replacement.existingCandidates.map((candidate) => candidate.id),
  )
}

const readFileAsArrayBuffer = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(event?.target?.result)
    reader.onerror = () => reject(reader.error || new Error('檔案讀取失敗'))
    reader.readAsArrayBuffer(file)
  })
}

const handleImportFileChange = async (event) => {
  const file = event.target?.files?.[0]
  importError.value = ''
  importStatus.value = ''
  if (!file) {
    clearImportState()
    return
  }

  importFileName.value = file.name

  try {
    const buffer = await readFileAsArrayBuffer(file)
    rebuildImportPreview(buffer)
  } catch (error) {
    clearImportState()
    importFileName.value = file.name
    importError.value = error?.message || '檔案解析失敗'
  }
}

watch(blockScheduleUnitName, () => {
  if (importWorkbookBuffer.value) {
    rebuildImportPreview(importWorkbookBuffer.value)
  }
})

const confirmBlockScheduleImport = async () => {
  if (!canConfirmImport.value || !importPlan.value) return

  isImportingBlockSchedule.value = true
  importError.value = ''

  try {
    const selectedReplacementSet = new Set(selectedReplacementIds.value)
    const courses = [
      ...appendableRows.value.map((entry) => entry.course),
      ...replacementRows.value.map((entry) => entry.incomingEntry.course),
    ]
    const replaceIds = replacementRows.value.flatMap((entry) =>
      entry.existingCandidates
        .filter((candidate) => selectedReplacementSet.has(candidate.id))
        .map((candidate) => candidate.id),
    )

    scheduleStore.applyBlockScheduleImport({
      courses,
      replaceIds,
      clearExisting: clearBeforeAppend.value,
    })
    await scheduleStore.syncToCloud()
    importStatus.value = `已匯入 ${courses.length} 筆第三軌規則${clearBeforeAppend.value ? '，並先清空既有第三軌資料' : ''}`
    clearImportState({ keepStatus: true })
  } catch (error) {
    importError.value = error?.message || '第三軌工作檔匯入失敗'
  } finally {
    isImportingBlockSchedule.value = false
  }
}

// 只顯示正式特教資源身份，避免舊 special 專科教師誤進抽離課選單。
const specialEdTeachers = computed(() => {
  return scheduleStore.teachers.filter(t => t.type === 'special_ed_resource')
})

const handleAutoAI = () => {
  savePulloutRule(null, null, true)
}

const handleGridClick = (day, period) => {
  savePulloutRule(day, period, false)
}

const savePulloutRule = async (day, period, isAutoTime = false) => {
  const isAutoClass = pulloutForm.value.classMode === 'auto'

  if (!pulloutForm.value.subject) { alert('請先選擇對應學科！'); return }
  if (!pulloutForm.value.teacher) { alert('請選擇特教/負責教師！'); return }

  if (isAutoClass) {
    if (pulloutForm.value.autoGrades.length === 0) { alert('請至少選擇一個允許湊班的年級池！'); return }
    if (pulloutForm.value.autoCount < 1) { alert('需湊齊的總班級數必須大於 0！'); return }
  } else {
    if (pulloutForm.value.classes.length === 0) { alert('請至少手動選擇一個參與班級！'); return }
  }

  if (!isAutoTime) {
    if (scheduleStore.checkTeacherConflict(pulloutForm.value.teacher, day, period)) {
      alert(`🚨 衝堂警告：【${pulloutForm.value.teacher}】老師在星期${['一','二','三','四','五'][day-1]}第${period}節已有安特殊課程，請勿讓老師分身！`);
      return;
    }
  }

  scheduleStore.addSpecialCourse({
    type: 'pullout',
    name: `${pulloutForm.value.type}`,
    targetSubject: pulloutForm.value.subject,
    targetClasses: isAutoClass ? [] : [...pulloutForm.value.classes],
    teacher: pulloutForm.value.teacher,
    lockedSlots: isAutoTime ? [] : [{ day, period }],
    isAutoTime: isAutoTime,
    isAutoClass: isAutoClass,
    autoClassConfig: isAutoClass ? { grades: [...pulloutForm.value.autoGrades], count: pulloutForm.value.autoCount } : null
  })

  await scheduleStore.syncToCloud()
  alert('✅ 成功儲存抽離課程規則並同步至資料庫！');
}

const formatTime = (course) => {
  if (!course.lockedSlots || course.lockedSlots.length === 0) return ''
  const dayStr = `星期${['一','二','三','四','五'][course.lockedSlots[0].day-1]}`
  const periods = course.lockedSlots.map(s => s.period).join(', ')
  return `${dayStr} 第 ${periods} 節`
}

const deleteCourse = async (id) => {
  if (confirm('確定要刪除這筆特殊規則嗎？')) {
    scheduleStore.deleteSpecialCourse(id)
    await scheduleStore.syncToCloud()
  }
}
</script>

<style scoped>
.special-course-container { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 1000px; margin: 0 auto; }
.desc { color: #64748b; margin-bottom: 20px; }
.import-panel { background: linear-gradient(180deg, #fff7ed 0%, #ffffff 100%); padding: 18px; border: 1px solid #fed7aa; border-radius: 12px; margin-bottom: 18px; }
.import-panel-header h3 { margin: 0 0 6px; color: #9a3412; }
.import-panel-header p { margin: 0 0 14px; color: #7c2d12; }
.import-controls { display: grid; grid-template-columns: 1.4fr 1.4fr 1fr; gap: 12px; align-items: end; margin-bottom: 12px; }
.import-control { display: flex; flex-direction: column; gap: 8px; color: #7c2d12; font-weight: 600; }
.import-control input[type="text"], .import-control input[type="file"] { padding: 10px; border: 1px solid #fdba74; border-radius: 8px; background: white; }
.import-file-name { color: #c2410c; font-size: 0.9em; }
.danger-check { display: flex; align-items: center; gap: 10px; color: #991b1b; font-weight: 700; background: #fef2f2; border: 1px dashed #fca5a5; border-radius: 8px; padding: 10px 12px; }
.warning-list { margin: 8px 0 0; padding-inline-start: 20px; }
.import-summary { display: flex; gap: 18px; flex-wrap: wrap; margin: 14px 0 16px; color: #7c2d12; font-weight: 600; }
.preview-group { margin-top: 16px; }
.preview-group h4 { margin: 0 0 10px; color: #9a3412; }
.preview-table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #fde68a; border-radius: 10px; overflow: hidden; }
.preview-table th, .preview-table td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; text-align: left; vertical-align: top; }
.preview-table th { background: #fffbeb; color: #92400e; font-weight: 700; }
.candidate-list { display: flex; flex-direction: column; gap: 8px; }
.candidate-checkbox { display: flex; gap: 8px; align-items: flex-start; color: #374151; }
.candidate-checkbox small { display: block; color: #6b7280; }
.state-badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 0.82em; font-weight: 700; white-space: nowrap; }
.state-append { background: #dcfce7; color: #166534; }
.state-replacement { background: #dbeafe; color: #1d4ed8; }
.state-blocker { background: #fee2e2; color: #b91c1c; }
.blocker-group .preview-table th { background: #fef2f2; color: #991b1b; }
.import-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
.confirm-import-btn { background: #c2410c; color: white; border: none; padding: 12px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 4px rgba(194, 65, 12, 0.2); }
.confirm-import-btn:hover:not(:disabled) { background: #9a3412; }
.confirm-import-btn:disabled { background: #fb923c; cursor: not-allowed; opacity: 0.6; }
.form-section { background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 15px; animation: fadeIn 0.3s; }
.form-row { display: flex; flex-direction: column; gap: 8px; margin-bottom: 15px; }
.form-row.split { flex-direction: row; gap: 20px; }
.form-group { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.form-group label { font-weight: bold; color: #334155; }
select, input[type="text"], input[type="number"] { padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; outline: none; }
.small-input { width: 80px; }
.radio-group { display: flex; gap: 20px; align-items: center; }
.mb-2 { margin-bottom: 10px; }
.mt-2 { margin-top: 10px; }
.ml-2 { margin-left: 10px; }
.class-matrix { background: white; padding: 15px; border-radius: 6px; border: 1px solid #cbd5e1; max-height: 250px; overflow-y: auto; }
.grade-row { display: flex; align-items: flex-start; padding: 8px 0; border-bottom: 1px dashed #e2e8f0; }
.grade-row:last-child { border-bottom: none; }
.grade-label { width: 70px; font-weight: bold; color: #475569; padding-top: 6px; }
.checkboxes { display: flex; gap: 10px; flex-wrap: wrap; flex: 1; }
.cb-label { display: flex; align-items: center; gap: 5px; cursor: pointer; color: #475569; padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 6px; transition: 0.2s; background: #f8fafc; }
.cb-label:hover:not(.disabled-cb) { background: #e2e8f0; }
.cb-label.is-selected { background: #d1fae5; border-color: #10b981; color: #065f46; font-weight: bold; }
.disabled-cb { opacity: 0.4; cursor: not-allowed; background: #f1f5f9; }
.ai-class-config { background: #f0fdf4; border: 1px dashed #4ade80; padding: 15px; border-radius: 6px; }
.config-row { display: flex; align-items: center; gap: 10px; }
.hint-text { color: #16a34a; font-size: 0.9em; font-weight: bold; }
.ai-action-bar { display: flex; justify-content: space-between; align-items: center; background: #fffbeb; padding: 15px 20px; border-radius: 8px; border: 1px solid #fcd34d; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(252, 211, 77, 0.2); }
.ai-info { display: flex; flex-direction: column; gap: 4px; }
.ai-info strong { color: #b45309; font-size: 1.1em; }
.ai-info span { color: #d97706; font-size: 0.9em; }
.ai-btn { background: #10b981; color: white; border: none; padding: 12px 20px; border-radius: 6px; font-weight: bold; font-size: 15px; cursor: pointer; transition: 0.2s; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3); }
.ai-btn:hover { background: #059669; transform: translateY(-1px); box-shadow: 0 4px 6px rgba(16, 185, 129, 0.4); }
.timetable-grid { display: grid; grid-template-columns: 60px repeat(5, 1fr); gap: 2px; background: #e2e8f0; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
.grid-header, .grid-time-label { background: #f1f5f9; padding: 10px; text-align: center; font-weight: bold; color: #475569; display: flex; align-items: center; justify-content: center; }
.grid-cell { background: white; height: 50px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; position: relative; }
.grid-cell .hover-text { display: none; font-weight: bold; color: #4338ca; font-size: 0.9em; }
.grid-cell:hover { background: #e0e7ff; }
.grid-cell:hover .hover-text { display: block; }
.grid-cell.is-noon { border-bottom: 3px solid #94a3b8; }
.courses-list-section { margin-top: 30px; border-top: 2px dashed #e2e8f0; padding-top: 20px; }
.courses-table { width: 100%; border-collapse: collapse; }
.courses-table th, .courses-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
.courses-table th { background: #f8fafc; color: #475569; }
.badge-purple { background: #f3e8ff; color: #7e22ce; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold; white-space: nowrap; }
.tags-container { display: flex; flex-wrap: wrap; gap: 4px; }
.class-tag { background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; border: 1px solid #cbd5e1; }
.delete-btn { background: #fee2e2; color: #dc2626; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
.delete-btn:hover { background: #fecaca; }
.text-ai { color: #10b981; font-weight: bold; background: #d1fae5; padding: 4px 8px; border-radius: 4px; display: inline-block; white-space: nowrap; }
.auto-class-badge { background: #d1fae5; color: #065f46; padding: 6px 10px; border-radius: 6px; font-weight: bold; font-size: 0.9em; border: 1px solid #34d399; display: inline-block; }
.auto-class-badge .sub-text { font-weight: normal; font-size: 0.9em; opacity: 0.9; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
.status-box { padding: 12px 16px; border-radius: 8px; font-weight: 500; margin-bottom: 12px; }
.status-box.success { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.status-box.error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.status-box.warning { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
</style>
