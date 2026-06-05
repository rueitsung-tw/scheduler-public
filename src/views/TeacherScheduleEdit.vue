<template>
  <div class="teacher-schedule-edit">
    <h2>班級課表編輯 - 導師自填</h2>
    
    <!-- 班級選擇 -->
    <div class="class-selector">
      <label>選擇班級：</label>
      <select v-model="selectedClassIndex" @change="loadClassSchedule">
        <option value="" disabled>請選擇班級</option>
        <option v-for="(cls, index) in scheduleStore.classes" :key="index" :value="index">
          {{ cls.name }} (導師：{{ cls.homeroom_teacher }})
        </option>
      </select>
    </div>

    <!-- 課表顯示 -->
    <div v-if="selectedClassIndex !== null && scheduleStore.classes[selectedClassIndex]" class="timetable-container">
      <div class="timetable-header">
        <div class="class-info">
          <h3>{{ scheduleStore.classes[selectedClassIndex].name }} 課表</h3>
          <p>導師：{{ scheduleStore.classes[selectedClassIndex].homeroom_teacher }}</p>
        </div>
      </div>

      <!-- 星期與節次表頭 -->
      <div class="timetable-grid">
        <!-- 左上角空白格 -->
        <div class="timetable-cell timetable-corner"></div>
        
        <!-- 星期標題 -->
        <div v-for="day in scheduleStore.schoolInfo.days_per_week" :key="day" class="timetable-cell timetable-day-header">
          週{{ ['一', '二', '三', '四', '五'][day - 1] }}
        </div>

        <!-- 每天各節次 -->
        <template v-for="period in scheduleStore.schoolInfo.periods_per_day" :key="period">
          <div class="timetable-cell timetable-period-header">{{ period }}節</div>
          
          <!-- 該節次的每一天格子 -->
          <template v-for="day in scheduleStore.schoolInfo.days_per_week" :key="`${day}-${period}`">
            <div 
              class="timetable-cell"
              :class="[
                getCellClass(day, period),
                { 'is-auto-scheduled': isAutoScheduled(day, period) },
                { 'is-blank': isBlank(day, period) },
                { 'is-selected': selectedCell?.day === day && selectedCell?.period === period }
              ]"
              @click="handleCellClick(day, period)"
            >
              <span v-if="getSubjectAt(day, period)" class="subject-name">
                {{ getSubjectAt(day, period) }}
              </span>
            </div>
          </template>
        </template>
      </div>

      <!-- 圖例說明 -->
      <div class="legend">
        <div class="legend-item">
          <span class="legend-color auto-scheduled"></span>
          <span>自動排課（不可編輯）</span>
        </div>
        <div class="legend-item">
          <span class="legend-color blank"></span>
          <span>空白（可點擊填入）</span>
        </div>
      </div>
    </div>

    <!-- 導師自填科目選擇彈窗 -->
    <div v-if="showSubjectModal" class="modal-overlay" @click.self="closeSubjectModal">
      <div class="modal-content">
        <h3>選擇要填入的科目</h3>
        
        <!-- 科目清單 -->
        <div class="subject-list">
          <div 
            v-for="subject in getTeacherSubjects" 
            :key="subject.name"
            class="subject-item"
            :class="{ 'quota-exceeded': getSubjectWeeklyCount(subject.name) >= subject.weekly_periods }"
            @click="selectSubject(subject.name)"
          >
            <div class="subject-info">
              <span class="subject-name">{{ subject.name }}</span>
              <span class="subject-teacher">{{ subject.teacher }}</span>
            </div>
            <div class="subject-usage">
              <span class="usage-label">本週已排：</span>
              <span class="usage-count">{{ getSubjectWeeklyCount(subject.name) }} / {{ subject.weekly_periods }} 節</span>
              <span v-if="getSubjectWeeklyCount(subject.name) >= subject.weekly_periods" class="warning-icon">⚠️</span>
            </div>
          </div>
        </div>

        <!-- 警告訊息 -->
        <div v-if="selectedSubjectExceedsQuota" class="quota-warning">
          <strong>警告：</strong> {{ selectedSubjectName }} 已達本週 {{ selectedSubjectWeeklyPeriods }} 節上限！
        </div>

        <div class="modal-actions">
          <button @click="closeSubjectModal" class="cancel-btn">取消</button>
          <button @click="confirmSubjectSelection" class="confirm-btn" :disabled="selectedSubjectExceedsQuota">
            確認填入
          </button>
        </div>
      </div>
    </div>

    <!-- 警告訊息區域 -->
    <div v-if="warningMessage" class="warning-message">
      ⚠️ {{ warningMessage }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const scheduleStore = useScheduleStore()

// 選取的班級索引
const selectedClassIndex = ref(null)

// 選中的格子
const selectedCell = ref(null)

// 顯示科目選擇彈窗
const showSubjectModal = ref(false)

// 選中的科目名稱
const selectedSubjectName = ref('')

// 警告訊息
const warningMessage = ref('')

// 是否已超過配額
const selectedSubjectExceedsQuota = ref(false)

// 自動排課的標記（isAuto: true 的科目）
const autoScheduledSubjects = computed(() => {
  return scheduleStore.subjectLibrary.filter(subject => subject.isAuto).map(s => s.name)
})

// 導師可自填的科目（isAuto: false 的科目）
const teacherSubjects = computed(() => {
  return scheduleStore.subjectLibrary.filter(subject => !subject.isAuto)
})

// 導師可自填的科目清單（包含每週節數資訊）
const getTeacherSubjects = computed(() => {
  return teacherSubjects.value.map(subject => ({
    ...subject,
    weekly_periods: 3 // 預設每週節數，實際應從班級課程需求中讀取
  }))
})

// 載入班級課表
const loadClassSchedule = () => {
  selectedCell.value = null
  showSubjectModal.value = false
  warningMessage.value = ''
}

// 取得某格子的科目
const getSubjectAt = (day, period) => {
  if (!selectedClassIndex.value || selectedClassIndex.value < 0) return null
  
  const classData = scheduleStore.classes[selectedClassIndex.value]
  if (!classData.schedule) return null
  
  const schedule = classData.schedule
  if (!schedule[day] || !schedule[day][period]) return null
  
  return schedule[day][period]
}

// 判斷是否為自動排課科目
const isAutoScheduled = (day, period) => {
  const subject = getSubjectAt(day, period)
  if (!subject) return false
  return autoScheduledSubjects.value.includes(subject)
}

// 判斷格子是否為空白
const isBlank = (day, period) => {
  return !getSubjectAt(day, period)
}

// 取得格子樣式類別
const getCellClass = (day, period) => {
  const baseClass = `cell-${day}-${period}`
  
  if (isAutoScheduled(day, period)) {
    return 'auto-scheduled-cell'
  }
  
  if (isBlank(day, period)) {
    return 'blank-cell'
  }
  
  return 'filled-cell'
}

// 處理格子點擊
const handleCellClick = (day, period) => {
  // 如果已排課或為自動排課，則不允許點擊
  if (!isBlank(day, period)) {
    warningMessage.value = '該時段已有課程，無法修改'
    return
  }
  
  // 選擇格子
  selectedCell.value = { day, period }
  
  // 顯示科目選擇彈窗
  showSubjectModal.value = true
  selectedSubjectName.value = ''
  selectedSubjectExceedsQuota.value = false
}

// 關閉科目選擇彈窗
const closeSubjectModal = () => {
  showSubjectModal.value = false
  selectedCell.value = null
  selectedSubjectName.value = ''
  selectedSubjectExceedsQuota.value = false
}

// 計算某科目本週已排節數
const getSubjectWeeklyCount = (subjectName) => {
  if (!selectedClassIndex.value || selectedClassIndex.value < 0) return 0
  
  const classData = scheduleStore.classes[selectedClassIndex.value]
  if (!classData.schedule) return 0
  
  let count = 0
  const schedule = classData.schedule
  
  for (let day = 1; day <= scheduleStore.schoolInfo.days_per_week; day++) {
    for (let period = 1; period <= scheduleStore.schoolInfo.periods_per_day; period++) {
      if (schedule[day] && schedule[day][period] === subjectName) {
        count++
      }
    }
  }
  
  return count
}

// 選擇科目
const selectSubject = (subjectName) => {
  selectedSubjectName.value = subjectName
  
  const weeklyCount = getSubjectWeeklyCount(subjectName)
  const subjectConfig = teacherSubjects.value.find(s => s.name === subjectName)
  const weeklyPeriods = subjectConfig ? subjectConfig.weekly_periods : 3
  
  selectedSubjectExceedsQuota.value = weeklyCount >= weeklyPeriods
}

// 確認填入科目
const confirmSubjectSelection = () => {
  if (!selectedCell.value || !selectedSubjectName.value) return
  
  const { day, period } = selectedCell.value
  const subjectName = selectedSubjectName.value
  
  // 初始化班級課表結構（如果尚未存在）
  if (!scheduleStore.classes[selectedClassIndex.value].schedule) {
    scheduleStore.classes[selectedClassIndex.value].schedule = {}
  }
  
  if (!scheduleStore.classes[selectedClassIndex.value].schedule[day]) {
    scheduleStore.classes[selectedClassIndex.value].schedule[day] = {}
  }
  
  // 填入科目
  scheduleStore.classes[selectedClassIndex.value].schedule[day][period] = subjectName
  
  // 關閉彈窗
  closeSubjectModal()
  
  // 顯示成功訊息
  warningMessage.value = `已將 ${subjectName} 填入 週${['一', '二', '三', '四', '五'][day - 1]} 第 ${period} 節`
  
  // 2 秒後清除訊息
  setTimeout(() => {
    warningMessage.value = ''
  }, 2000)
}
</script>

<style scoped>
.teacher-schedule-edit {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.teacher-schedule-edit h2 {
  color: #333;
  margin-bottom: 20px;
}

/* 班級選擇器 */
.class-selector {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.class-selector label {
  font-weight: bold;
  color: #555;
}

.class-selector select {
  padding: 8px 12px;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  min-width: 200px;
}

/* 課表容器 */
.timetable-container {
  margin-top: 20px;
}

.class-info {
  margin-bottom: 15px;
  padding: 10px;
  background-color: #f8f9fa;
  border-radius: 4px;
}

.class-info h3 {
  margin: 0 0 5px 0;
  color: #333;
}

.class-info p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

/* 課表網格 */
.timetable-grid {
  display: grid;
  grid-template-columns: 60px repeat(5, 1fr);
  gap: 2px;
  background-color: #e2e8f0;
  border: 2px solid #cbd5e1;
  border-radius: 4px;
  overflow: hidden;
}

.timetable-cell {
  min-height: 60px;
  background-color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  text-align: center;
  cursor: default;
  transition: all 0.2s ease;
}

.timetable-corner {
  background-color: #f1f5f9;
  min-height: 40px;
}

.timetable-day-header {
  background-color: #f1f5f9;
  font-weight: bold;
  color: #334155;
  min-height: 40px;
}

.timetable-period-header {
  background-color: #f1f5f9;
  font-weight: bold;
  color: #334155;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  min-height: 40px;
}

/* 格子狀態樣式 */
.auto-scheduled-cell {
  background-color: #e2e8f0;
  color: #64748b;
  cursor: not-allowed;
  font-weight: bold;
}

.blank-cell {
  background-color: white;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.blank-cell:hover {
  border-color: #3b82f6;
  background-color: #eff6ff;
}

.blank-cell.is-selected {
  border-color: #2563eb;
  background-color: #dbeafe;
  box-shadow: 0 0 0 2px #3b82f6;
}

.filled-cell {
  background-color: #f0fdf4;
  color: #166534;
  font-weight: bold;
  cursor: not-allowed;
}

/* 圖例 */
.legend {
  margin-top: 20px;
  display: flex;
  gap: 30px;
  justify-content: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #555;
}

.legend-color {
  width: 20px;
  height: 20px;
  border-radius: 4px;
}

.legend-color.auto-scheduled {
  background-color: #e2e8f0;
  border: 1px solid #cbd5e1;
}

.legend-color.blank {
  background-color: white;
  border: 1px solid #cbd5e1;
}

/* 彈窗覆蓋層 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: white;
  padding: 24px;
  border-radius: 8px;
  min-width: 400px;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.modal-content h3 {
  margin: 0 0 20px 0;
  color: #333;
  text-align: center;
}

/* 科目清單 */
.subject-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.subject-item {
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.subject-item:hover {
  background-color: #f8fafc;
  border-color: #3b82f6;
}

.subject-item.quota-exceeded {
  opacity: 0.6;
  cursor: not-allowed;
  background-color: #fef2f2;
  border-color: #fca5a5;
}

.subject-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.subject-name {
  font-weight: bold;
  color: #333;
  font-size: 16px;
}

.subject-teacher {
  font-size: 12px;
  color: #666;
}

.subject-usage {
  display: flex;
  align-items: center;
  gap: 8px;
}

.usage-label {
  font-size: 12px;
  color: #666;
}

.usage-count {
  font-weight: bold;
  color: #333;
}

.warning-icon {
  font-size: 16px;
}

/* 警告訊息 */
.quota-warning {
  padding: 12px;
  background-color: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 6px;
  color: #92400e;
  margin-bottom: 15px;
  font-size: 14px;
}

/* 彈窗按鈕 */
.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.cancel-btn,
.confirm-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
}

.cancel-btn {
  background-color: #f1f5f9;
  color: #475569;
}

.cancel-btn:hover {
  background-color: #e2e8f0;
}

.confirm-btn {
  background-color: #3b82f6;
  color: white;
}

.confirm-btn:hover:not(:disabled) {
  background-color: #2563eb;
}

.confirm-btn:disabled {
  background-color: #cbd5e1;
  cursor: not-allowed;
}

/* 警告訊息區域 */
.warning-message {
  margin-top: 15px;
  padding: 12px;
  background-color: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 6px;
  color: #92400e;
  text-align: center;
}
</style>
