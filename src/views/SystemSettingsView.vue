<template>
  <div class="settings-container">
    <h2>⚙️ 系統參數與環境設定</h2>

    <div class="setting-card">
      <h3>(1) 基本資訊與班級規模</h3>
      <div class="form-row">
        <label>學校名稱：</label>
        <input
          v-model.trim="scheduleStore.schoolInfo.name"
          type="text"
          placeholder="例如：東門國小"
          @input="scheduleStore.markScheduleDirty"
        />
      </div>
      <div class="form-row">
        <label>學年度：</label>
        <input v-model="scheduleStore.schoolInfo.academic_year" type="number" @input="scheduleStore.markScheduleDirty" />
        <label>學期：</label>
        <select v-model="scheduleStore.schoolInfo.semester" @change="scheduleStore.markScheduleDirty">
          <option value="上學期">上學期</option><option value="下學期">下學期</option>
        </select>
      </div>
      <div class="grade-settings-grid">
        <div class="form-row inline-row" v-for="grade in 6" :key="grade">
          <label>{{ grade }} 年級：</label>
          <input v-model.number="scheduleStore.schoolInfo.gradeSettings[grade]" type="number" class="small-input" @input="scheduleStore.markScheduleDirty" /> 班
        </div>
      </div>
    </div>

    <div class="setting-card">
      <h3>(2) 108 課綱領域節數矩陣 </h3>
      <p class="hint">💡 調整此處數值將影響「班級課表初始化」時的預設節數分配。</p>
      <div class="table-responsive">
        <table class="curriculum-table">
          <thead>
            <tr><th>領域 / 科目</th><th v-for="g in 6" :key="g">{{ g }}年</th><th>身分</th></tr>
          </thead>
          <tbody>
            <tr v-for="subject in scheduleStore.standardDomainSettings" :key="subject.id">
              <td class="subject-cell"><span class="color-dot" :style="{ backgroundColor: subject.color }"></span>{{ subject.name }}</td>
              <td v-for="g in 6" :key="g">
                <input type="number" v-model.number="subject.periods[g]" step="0.5" min="0" class="matrix-input" @input="scheduleStore.markScheduleDirty" />
              </td>
              <td>
                <select v-model="subject.defaultTeacher" class="mini-select" @change="scheduleStore.markScheduleDirty">
                  <option value="homeroom">導師</option><option value="subject">科任</option>
                </select>
                <button @click="applyDefaultsToAllClasses" class="sync-all-btn">
                🔄 將此矩陣套用至全校各班配課 (慎用：將覆蓋手動調整)
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="setting-card">
      <h3>(3) 校訂彈性課程與校本課程</h3>
      <p class="hint">💡 若選擇「科任」，請指定關聯領域。AI 將自動指派擁有該領域專長的教師授課。</p>
      <div v-for="grade in 6" :key="grade" class="alt-grade-block">
        <h4>{{ grade }} 年級彈性課程</h4>
        <table class="alt-table">
          <thead>
            <tr>
              <th>課程名稱</th>
              <th>節數</th>
              <th>授課身份</th>
              <th>指定科任領域</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in getAltList(grade)" :key="idx">
              <td><input v-model="item.subject" placeholder="課程名稱" @input="scheduleStore.markScheduleDirty" /></td>
              <td><input type="number" v-model.number="item.periods" step="0.5" class="small-input" @input="scheduleStore.markScheduleDirty" /></td>
              <td>
                <select v-model="item.defaultTeacher" @change="scheduleStore.markScheduleDirty">
                  <option value="homeroom">由導師授課</option>
                  <option value="subject">由科任授課</option>
                </select>
              </td>
              <td>
                <select v-model="item.targetSubject" :disabled="item.defaultTeacher !== 'subject'" @change="scheduleStore.markScheduleDirty">
                  <option value="">(無/非專科)</option>
                  <option v-for="sub in scheduleStore.standardDomainSettings" :key="sub.name" :value="sub.name">{{ sub.name }}</option>
                </select>
              </td>
              <td><button @click="removeAlt(grade, idx)" class="del-btn">🗑️</button></td>
            </tr>
          </tbody>
        </table>
        <button @click="addAlt(grade)" class="add-alt-btn">+ 新增彈性課程</button>
      </div>
    </div>

<div class="setting-card">
      <h3>(4) 教師超鐘點與減課時數設定</h3>
      <p class="hint">💡 在此統整設定全校教師的減課時數與超鐘點。實際配額 = 基本節數 - 減課 + 超鐘點。</p>
      <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
        <table class="curriculum-table">
          <thead>
            <tr>
              <th>教師姓名</th>
              <th>職務別</th>
              <th>基本節數</th>
              <th>減課時數</th>
              <th>超鐘點</th>
              <th>實際配額上限</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="teacher in scheduleStore.teachers" :key="teacher.name">
              <td class="subject-cell">{{ teacher.name }}</td>
              <td>{{ teacher.type === 'homeroom' ? '導師' : teacher.type === 'admin' ? '行政' : '科任' }}</td>
              <td>
                <input type="number" v-model.number="teacher.max_periods" min="0" class="matrix-input" @input="scheduleStore.markScheduleDirty" />
              </td>
              <td>
                <input type="number" v-model.number="teacher.reduction" min="0" class="matrix-input" @input="scheduleStore.markScheduleDirty" />
              </td>
              <td>
                <input type="number" v-model.number="teacher.overtime" min="0" class="matrix-input" @input="scheduleStore.markScheduleDirty" />
              </td>
              <td style="font-weight: bold; color: #10b981;">
                {{ (Number(teacher.max_periods) || 0) - (Number(teacher.reduction) || 0) + (Number(teacher.overtime) || 0) }} 節
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

<div class="setting-card">
      <h3>(5) 特殊班級領域例外設定</h3>
      <p class="hint">💡 針對特定班級（如藝才班）設定例外科目授課身份。此處設定將優先於 (2) 中的全校預設值。</p>
      <div class="table-responsive">
        <table class="alt-table">
          <thead>
            <tr>
              <th>目標班級</th>
              <th>例外科目</th>
              <th>強制授課身份</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(ex, idx) in getExceptionList()" :key="idx">
              <td>
                <select v-model="ex.className" @change="scheduleStore.markScheduleDirty" style="width: 100%;">
                  <option value="" disabled>請選擇班級</option>
                  <option v-for="c in scheduleStore.classes" :key="c.name" :value="c.name">{{ c.name }}</option>
                </select>
              </td>
              <td>
                <select v-model="ex.subject" @change="scheduleStore.markScheduleDirty" style="width: 100%;">
                  <option value="" disabled>請選擇科目</option>
                  <option v-for="sub in scheduleStore.standardDomainSettings" :key="sub.name" :value="sub.name">{{ sub.name }}</option>
                </select>
              </td>
              <td>
                <select v-model="ex.defaultTeacher" @change="scheduleStore.markScheduleDirty" style="width: 100%;">
                  <option value="homeroom">由導師授課</option>
                  <option value="subject">由科任授課</option>
                </select>
              </td>
              <td><button @click="removeException(idx)" class="del-btn">🗑️</button></td>
            </tr>
          </tbody>
        </table>
        <button @click="addException" class="add-alt-btn" style="background-color: #f59e0b;">+ 新增例外規則</button>
      </div>
    </div>

    <div class="setting-card">
      <h3>(6) 專科教室預設容量限制</h3>
      <p class="hint">💡 設定各專科科目每日最多可使用教室數。若設為 0 則不受限。排課引擎會以此為上限來分配專科教室。</p>
      <div class="classroom-limits-grid">
        <div class="limit-item" v-for="(limit, subject) in scheduleStore.schoolInfo.classroomLimits" :key="subject">
          <label>{{ subject }}</label>
          <input
            type="number"
            v-model.number="scheduleStore.schoolInfo.classroomLimits[subject]"
            min="0"
            max="10"
            class="limit-input"
            @input="scheduleStore.markScheduleDirty"
          />
          <span class="limit-unit">間/日</span>
        </div>
      </div>
    </div>

    <!-- 匯出/匯入設定 -->
    <div class="setting-card export-import-card">
      <h3>(7) 系統設定匯入 / 匯出</h3>
      <p class="hint">💡 匯出包含：學期資訊、班級規模、課綱矩陣、彈性課程、教師超鐘點、專科教室限制、科任科目年級專科教室使用設定、專科教室資料、AI 鐵律開關，以及教師資料與班級資料。不包含課表內容與排程結果。</p>
      <div class="ei-buttons">
        <button @click="handleExport" class="ei-btn export-btn">📤 匯出設定</button>
        <button @click="triggerImport" class="ei-btn import-btn">📥 匯入設定</button>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          style="display: none"
          @change="handleImport"
        />
      </div>
      <p v-if="eiMessage" :class="['ei-message', eiType]">{{ eiMessage }}</p>
    </div>

    <!-- 🆕 (8) 科任科目年級專科教室使用設定 -->
    <div class="setting-card">
      <h3>(8) 科任科目年級專科教室使用設定</h3>
      <p class="hint">💡 勾選特定年級表示該年級上此科目時「會被分派到專科教室上課」（會佔用教室容量且受到衝堂限制）。未勾選的年級則預設在原班級教室上課，不佔用專科教室限制。</p>

      <div class="table-responsive">
        <table class="curriculum-table">
          <thead>
            <tr>
              <th>科任領域 / 科目</th>
              <th v-for="g in 6" :key="g">{{ g }}年</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="subject in filterSpecialSubjects" :key="subject.name">
              <td class="subject-cell">
                <span class="color-dot" :style="{ backgroundColor: subject.color }"></span>
                {{ subject.name }}
                <span v-if="getRoomSubjectKey(subject.name) !== subject.name" class="canonical-note">
                  (專科教室鍵：{{ getRoomSubjectKey(subject.name) }})
                </span>
              </td>
              <td v-for="g in 6" :key="g">
                <input
                  type="checkbox"
                  :checked="isGradeEnabledForRoom(subject.name, g)"
                  @change="toggleGradeForRoom(subject.name, g)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="setting-card sync-card">
      <button @click="handleSaveAll" class="save-btn-main" :disabled="scheduleStore.syncStatus === 'saving'">
        {{ scheduleStore.syncStatus === 'saving' ? '正在儲存...' : '💾 儲存所有教師與系統設定' }}
      </button>
      <p v-if="scheduleStore.lastSavedTime" class="save-time">上次同步：{{ scheduleStore.lastSavedTime }}</p>
    </div>

    <!-- 🆕 匯入模式選擇對話框 -->
    <div v-if="pendingImportData" class="modal-overlay" data-test="import-mode-modal">
      <div class="modal-card">
        <h3>📥 選擇匯入模式</h3>

        <div v-if="!selectedImportMode" class="mode-options">
          <p class="modal-desc">已成功解析備份檔案，請選擇要執行的匯入方式：</p>
          <div class="option-buttons">
            <button
              class="mode-btn full-btn"
              data-test="choose-full-restore"
              @click="confirmFullRestore"
            >
              <strong>完整還原</strong>
              <small>包含學年學期、班級規模、班級與教師完整資料、課表及專科教室等所有設定。</small>
            </button>
            <button
              class="mode-btn semester-btn"
              data-test="choose-semester-settings-import"
              @click="chooseSemesterSettingsImport"
            >
              <strong>新學期設定匯入</strong>
              <small>僅匯入彈性矩陣、專科容量、領域/專科教室設定與 AI 規則；不覆蓋學期、班級、教師與課表。</small>
            </button>
          </div>
          <div class="modal-footer">
            <button class="modal-cancel-btn" data-test="cancel-settings-import" @click="cancelImport">取消</button>
          </div>
        </div>

        <div v-else-if="selectedImportMode === 'semester-settings'" class="mode-summary">
          <h4>📋 新學期設定匯入摘要</h4>
          <div class="summary-box" v-if="semesterImportPreview">
            <p><strong>專科教室變更：</strong></p>
            <ul>
              <li>新增教室：{{ semesterImportPreview.classrooms.added }} 間</li>
              <li>覆蓋教室：{{ semesterImportPreview.classrooms.overwritten }} 間</li>
              <li>移除教室：{{ semesterImportPreview.classrooms.removed }} 間</li>
            </ul>
            <div class="warning-callout">
              ⚠️ 注意：專科教室將以此備份資料完全取代，且專科教室的<strong>負責老師將清空</strong>。現有班級、教師與課表將保持不變。
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-cancel-btn" data-test="cancel-settings-import" @click="cancelImport">取消</button>
            <button class="modal-confirm-btn" data-test="confirm-semester-settings-import" @click="confirmSemesterSettingsImport">確定匯入新學期設定</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import { buildExportPayload, downloadExport, parseImportFile, applyImport, previewSemesterSettingsImport, applySemesterSettingsImport } from '../utils/settingsBackup'
import { isSubjectApplicableToGrade, sanitizeRequirementsByGrade } from '../utils/gradeSubjectUtils'

const scheduleStore = useScheduleStore()

const fileInput = ref(null)

// 匯出/匯入狀態
const eiMessage = ref('')
const eiType = ref('success')

// 🆕 匯入模式選擇狀態機
const pendingImportData = ref(null)
const selectedImportMode = ref(null)
const semesterImportPreview = ref(null)

function resetImportState() {
  pendingImportData.value = null
  selectedImportMode.value = null
  semesterImportPreview.value = null
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

function handleExport() {
  try {
    const payload = buildExportPayload()
    downloadExport(payload)
    eiMessage.value = '✅ 設定已匯出'
    eiType.value = 'success'
  } catch (e) {
    eiMessage.value = `❌ 匯出失敗：${e.message}`
    eiType.value = 'error'
  }
}

function triggerImport() {
  fileInput.value?.click()
}

async function handleImport(event) {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const data = parseImportFile(text)
    pendingImportData.value = data
    selectedImportMode.value = null
    semesterImportPreview.value = null
  } catch (e) {
    eiMessage.value = `❌ 匯入失敗：${e.message}`
    eiType.value = 'error'
    resetImportState()
  }
}

function cancelImport() {
  resetImportState()
}

function chooseSemesterSettingsImport() {
  selectedImportMode.value = 'semester-settings'
  if (pendingImportData.value) {
    semesterImportPreview.value = previewSemesterSettingsImport(pendingImportData.value)
  }
}

function confirmSemesterSettingsImport() {
  if (!pendingImportData.value) return
  applySemesterSettingsImport(pendingImportData.value)
  eiMessage.value = '✅ 新學期設定已匯入，請記得點擊「儲存所有教師與系統設定」以寫入資料庫'
  eiType.value = 'success'
  resetImportState()
}

function confirmFullRestore() {
  if (!pendingImportData.value) return
  applyImport(pendingImportData.value)
  scheduleStore.syncClassesFromGradeSettings()
  eiMessage.value = '✅ 設定已完整還原，請記得點擊「儲存所有教師與系統設定」以寫入資料庫'
  eiType.value = 'success'
  resetImportState()
}

const getAltList = (g) => {
  if (!scheduleStore.schoolInfo.alternativeMatrix) scheduleStore.schoolInfo.alternativeMatrix = {}
  if (!scheduleStore.schoolInfo.alternativeMatrix[g]) scheduleStore.schoolInfo.alternativeMatrix[g] = []
  return scheduleStore.schoolInfo.alternativeMatrix[g]
}
const addAlt = (g) => {
  getAltList(g).push({ subject: '', periods: 1, defaultTeacher: 'homeroom', targetSubject: '' });
  scheduleStore.markScheduleDirty();
}
const removeAlt = (g, i) => { getAltList(g).splice(i, 1); scheduleStore.markScheduleDirty(); }

// 點擊大按鈕：執行全面同步（教師資料 + 系統參數 + 班級資料等全部儲存）
const handleSaveAll = async () => {
  // Step 1: 根據 gradeSettings 同步班級記錄
  const syncResult = scheduleStore.syncClassesFromGradeSettings();

  // Step 2: 顯示同步結果
  if (syncResult.blocked.length > 0) {
    const blockedMsg = syncResult.blocked.map(b => `• ${b.className}: ${b.reason}`).join('\n');
    alert(`⚠️ 以下班級因已有資料無法刪除：\n${blockedMsg}`);
  }

  // Step 3: 儲存到雲端
  await scheduleStore.syncToCloud()
}

// 🚀 新增：處理班級例外清單的邏輯
const getExceptionList = () => {
  if (!scheduleStore.schoolInfo.classExceptions) scheduleStore.schoolInfo.classExceptions = []
  return scheduleStore.schoolInfo.classExceptions
}

const addException = () => {
  getExceptionList().push({ className: '', subject: '', defaultTeacher: 'homeroom' });
  scheduleStore.markScheduleDirty();
}

const removeException = (i) => {
  getExceptionList().splice(i, 1);
  scheduleStore.markScheduleDirty();
}

// 🚀 修復 4：將 108 課綱矩陣的節數套用至全校各班配課
// 🔒 加入年級適用性檢查與 0 節過濾（雙層防護）
const applyDefaultsToAllClasses = () => {
  if (!confirm('⚠️ 確定要將此矩陣套用至全校各班配課嗎？\n此操作將覆蓋所有班級的手動調整！')) return;

  scheduleStore.classes.forEach(cls => {
    // 從班級名稱提取年級
    const gradeMatch = String(cls.name).match(/(\d+)年/) || String(cls.name).match(/^(\d)/);
    const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : (cls.grade || 1);

    // 確保 course_requirements 存在
    if (!cls.course_requirements) {
      cls.course_requirements = [];
    }

    // 針對每個標準領域科目更新節數
    scheduleStore.standardDomainSettings.forEach(setting => {
      const periods = setting.periods?.[grade] || 0;

      // 🔒 0 節不配課（所有科目通用）
      if (periods <= 0) return;

      // 🔒 年級適用性檢查
      if (!isSubjectApplicableToGrade(setting.name, grade)) return;

      // 尋找是否已有該科目
      let req = cls.course_requirements.find(r => r.subject === setting.name);
      if (req) {
        req.periods = periods;
        req.defaultTeacher = setting.defaultTeacher;
      } else {
        cls.course_requirements.push({
          subject: setting.name,
          periods: periods,
          defaultTeacher: setting.defaultTeacher,
          teacher: '',
        });
      }
    });

    const sanitized = sanitizeRequirementsByGrade(cls.course_requirements, grade);
    cls.course_requirements = sanitized.requirements;
  });

  scheduleStore.markScheduleDirty();
  alert('✅ 已將矩陣套用至全校各班配課');
}

// 🆕 科任科目分配專科教室之年級設定邏輯
const getRoomSubjectKey = (subjectName) => {
  const s = String(subjectName || '').trim();
  if (s === '英語') return '語文-英語';
  if (s === '自然') return '自然科學';
  if (s === '科技-資訊' || s === '資訊' || s === '電腦') return '資訊';
  if (s === '健康與體育') return '體育';
  return s;
};

const filterSpecialSubjects = computed(() => {
  const allowedKeys = new Set(['語文-英語', '音樂', '美勞', '自然科學', '資訊', '體育']);
  const seen = new Set();
  return scheduleStore.standardDomainSettings.filter(sub => {
    const key = getRoomSubjectKey(sub.name);
    if (!allowedKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

const getSubjectClassroomGrades = () => {
  if (!scheduleStore.schoolInfo.subjectClassroomGrades) {
    scheduleStore.schoolInfo.subjectClassroomGrades = {
      '語文-英語': [2, 3, 4, 5, 6],
      '音樂': [3, 4, 5, 6],
      '美勞': [3, 4, 5, 6],
      '自然科學': [3, 4, 5, 6],
      '資訊': [3, 4, 5, 6]
    };
  }
  return scheduleStore.schoolInfo.subjectClassroomGrades;
};

const isGradeEnabledForRoom = (subjectName, grade) => {
  const key = getRoomSubjectKey(subjectName);
  const grades = getSubjectClassroomGrades()[key] || [];
  return grades.includes(grade);
};

const toggleGradeForRoom = (subjectName, grade) => {
  const cfg = getSubjectClassroomGrades();
  const key = getRoomSubjectKey(subjectName);
  if (!cfg[key]) cfg[key] = [];

  const index = cfg[key].indexOf(grade);
  if (index > -1) {
    cfg[key].splice(index, 1); // 取消勾選
  } else {
    cfg[key].push(grade); // 勾選啟用
    cfg[key].sort((a, b) => a - b);
  }
  scheduleStore.markScheduleDirty();
};
</script>

<style scoped>
.sync-all-btn {
  margin-top: 8px;
  background: #f59e0b;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: bold;
  width: 100%;
}

.canonical-note {
  display: inline-block;
  margin-left: 6px;
  color: #64748b;
  font-size: 0.85em;
  font-weight: 400;
}
.sync-all-btn:hover {
  background: #d97706;
}
</style>

<style scoped>
.settings-container { max-width: 1000px; margin: 0 auto; padding: 20px; }
.setting-card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 25px; }
.curriculum-table, .alt-table, .teacher-quota-table { width: 100%; border-collapse: collapse; }
.curriculum-table th, .curriculum-table td, .alt-table th, .alt-table td,
.teacher-quota-table th, .teacher-quota-table td { border: 1px solid #e2e8f0; padding: 8px; text-align: center; }
.subject-cell { text-align: left !important; display: flex; align-items: center; gap: 8px; font-weight: bold; }
.color-dot { width: 10px; height: 10px; border-radius: 50%; }
.matrix-input, .small-input { width: 50px; border: 1px solid #cbd5e1; text-align: center; border-radius: 4px; }
.mini-select { padding: 6px; border-radius: 4px; border: 1px solid #cbd5e1; }
.alt-grade-block { margin-bottom: 25px; padding: 20px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; }
.alt-table input { width: 90%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; }
.alt-table select { padding: 6px; border-radius: 4px; border: 1px solid #cbd5e1; }
.add-alt-btn { margin-top: 15px; background: #6366f1; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; }
.del-btn { background: none; border: none; cursor: pointer; font-size: 1.2rem; }
.hint { font-size: 0.9rem; color: #64748b; margin-bottom: 15px; }

/* 教師加減節數表格樣式 */
.teacher-quota-table th { background: #f1f5f9; font-weight: bold; }
.teacher-name-cell { text-align: left !important; font-weight: bold; color: #1e293b; }
.reduction-input { color: #2563eb; background: #eff6ff; }
.overtime-input { color: #059669; background: #ecfdf5; }
.limit-cell { font-weight: bold; color: #7c3aed; background: #faf5ff; }

/* 儲存按鈕 */
.sync-card { background: linear-gradient(135deg, #ecfdf5, #eff6ff); }
.save-btn-main { width: 100%; background: linear-gradient(135deg, #10b981, #3b82f6); color: white; border: none; padding: 18px; border-radius: 12px; font-weight: bold; cursor: pointer; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); }
.save-btn-main:hover { background: linear-gradient(135deg, #059669, #2563eb); box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4); }
.save-btn-main:disabled { background: #94a3b8; box-shadow: none; cursor: not-allowed; }
.save-time { text-align: center; color: #64748b; font-size: 0.9rem; margin-top: 10px; }

/* 專科教室容量限制 */
.classroom-limits-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.limit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f8fafc;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.limit-item label {
  font-weight: bold;
  color: #334155;
  flex: 1;
}
.limit-input {
  width: 60px;
  border: 1px solid #cbd5e1;
  text-align: center;
  border-radius: 4px;
  padding: 4px;
}
.limit-unit {
  color: #64748b;
  font-size: 0.85rem;
}

/* 匯出/匯入 */
.export-import-card {
  background: linear-gradient(135deg, #faf5ff, #f0fdfa);
}
.ei-buttons {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}
.ei-btn {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  font-size: 0.95rem;
  transition: background 0.2s, box-shadow 0.2s;
}
.export-btn {
  background: #6366f1;
  color: white;
}
.export-btn:hover {
  background: #4f46e5;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}
.import-btn {
  background: #8b5cf6;
  color: white;
}
.import-btn:hover {
  background: #7c3aed;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}
.ei-message {
  margin-top: 8px;
  font-size: 0.9rem;
  text-align: center;
}
.ei-message.success {
  color: #10b981;
}
.ei-message.error {
  color: #ef4444;
}

/* 🆕 匯入模式選擇對話框樣式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-card {
  background: white;
  padding: 24px;
  border-radius: 12px;
  max-width: 550px;
  width: 90%;
  box-shadow: 0 10px 25px rgba(0,0,0,0.2);
}
.modal-card h3, .modal-card h4 {
  margin-top: 0;
  margin-bottom: 12px;
  color: #1e293b;
}
.modal-desc {
  margin-bottom: 16px;
  color: #475569;
  font-size: 0.95rem;
}
.option-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}
.mode-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 14px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
}
.mode-btn:hover {
  border-color: #6366f1;
  background: #f0f2fe;
}
.mode-btn strong {
  font-size: 1.05rem;
  color: #1e293b;
  margin-bottom: 4px;
}
.mode-btn small {
  color: #64748b;
  font-size: 0.85rem;
  line-height: 1.4;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
.modal-cancel-btn {
  padding: 8px 16px;
  border: 1px solid #cbd5e1;
  background: white;
  border-radius: 6px;
  cursor: pointer;
  color: #475569;
  font-weight: 500;
}
.modal-cancel-btn:hover {
  background: #f1f5f9;
}
.modal-confirm-btn {
  padding: 8px 16px;
  border: none;
  background: #10b981;
  color: white;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
}
.modal-confirm-btn:hover {
  background: #059669;
}
.summary-box {
  background: #f8fafc;
  padding: 14px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  margin-top: 12px;
  font-size: 0.95rem;
}
.summary-box ul {
  margin: 8px 0 12px 20px;
  padding: 0;
}
.summary-box li {
  margin-bottom: 4px;
  color: #334155;
}
.warning-callout {
  margin-top: 12px;
  padding: 10px 12px;
  background: #fffbeb;
  border-left: 4px solid #f59e0b;
  color: #92400e;
  font-size: 0.9rem;
  border-radius: 4px;
}
</style>
