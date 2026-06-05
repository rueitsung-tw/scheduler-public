<template>
  <div class="export-container">
    <h2>📊 報表匯出中心</h2>
    <p class="desc">將排課結果匯出為標準格式報表。所有匯出功能需排課資料就緒後啟用。</p>

    <div v-if="!scheduleStore.isInitialized" class="warning-banner">
      ⚠️ 資料尚未載入，請先載入排課資料後再進行匯出。
    </div>

    <div class="export-cards">
      <!-- 卡片 1: 教育部標準格式 -->
      <div class="card">
        <h3>📋 教育部標準格式</h3>
        <p>教師總表，依科目字典順序水平展開，含導師姓名與任課節數。</p>
        <div class="action-group">
          <button
            @click="handleMoEExport"
            class="btn btn-xlsx"
            :disabled="!scheduleStore.isInitialized"
          >
            📊 匯出 XLSX
          </button>
        </div>
      </div>

      <!-- 卡片 2: 全校班級課表總表 -->
      <div class="card">
        <h3>🏫 全校班級課表總表</h3>
        <p>5x7 矩陣格式，含交替課標記(*)、(#)及午休列。</p>
        <div class="action-group">
          <button
            @click="handleClassTimetableExport"
            class="btn btn-xlsx"
            :disabled="!scheduleStore.isInitialized"
          >
            📊 匯出 XLSX
          </button>
        </div>
      </div>

      <!-- 卡片 5: 全校班級課表總表（直式） -->
      <div class="card">
        <h3>🏫 全校班級課表總表（直式）</h3>
        <p>直式矩陣，班級為欄、星期節次為列，每年級獨立工作表，含午休列。</p>
        <div class="action-group">
          <button
            @click="handleClassTimetableVerticalExport"
            class="btn btn-xlsx"
            :disabled="!scheduleStore.isInitialized"
          >
            📊 匯出 XLSX
          </button>
        </div>
      </div>

      <!-- 卡片 6: 科任教師課表 -->
      <div class="card">
        <h3>👨‍🏫 科任教師課表</h3>
        <p>依科目分頁顯示各專科教師授課班級，含衝堂標記。</p>
        <div class="action-group">
          <button
            @click="handleSubjectTeacherExport"
            class="btn btn-xlsx"
            :disabled="!scheduleStore.isInitialized"
          >
            📊 匯出 XLSX
          </button>
        </div>
      </div>

      <!-- 卡片 3: 專科教室課表 -->
      <div class="card">
        <h3>🎨 專科教室課表</h3>
        <p>空間視角課表，含晨光時間、午休、打掃時間等固定作息列。</p>
        <div class="action-group">
          <button
            @click="handleClassroomExport"
            class="btn btn-docx"
            :disabled="!scheduleStore.isInitialized"
          >
            📝 匯出 Docx
          </button>
        </div>
      </div>

      <!-- 卡片 4: 游泳池使用課表 -->
      <div class="card">
        <h3>🏊 游泳池使用課表</h3>
        <p>整合課表與特殊課程資料，產出游泳池使用清單。</p>
        <div class="action-group">
          <button
            @click="handleSwimmingExport"
            class="btn btn-docx"
            :disabled="!scheduleStore.isInitialized"
          >
            📝 匯出 Docx
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import {
  exportMoEFormat,
  exportClassesTimetableXLSX,
  exportClassesTimetableVerticalXLSX,
  exportClassroomTimetable,
  exportSwimmingSchedule,
  exportSubjectTeacherTimetables,
} from '../utils/exportUtilsTeacherPatch'


const scheduleStore = useScheduleStore()

onMounted(async () => {
  // 🚀 修正：傳入 true 以強制跳過快取，確保撈到 AI 算完後的最新課表
  console.log('📬 ExportHubView Mounted: 正在同步資料庫最新課表...');
  await scheduleStore.loadFromDB(true);
});

const handleMoEExport = () => {
  if (!scheduleStore.isInitialized) return
  try {
    exportMoEFormat(scheduleStore)
  } catch (e) {
    console.error('匯出教育部標準格式失敗:', e)
    alert('匯出失敗: ' + e.message)
  }
}

const handleClassTimetableExport = () => {
  if (!scheduleStore.isInitialized) return
  try {
    exportClassesTimetableXLSX(scheduleStore)
  } catch (e) {
    console.error('匯出班級課表失敗:', e)
    alert('匯出失敗: ' + e.message)
  }
}

const handleClassTimetableVerticalExport = () => {
  if (!scheduleStore.isInitialized) return
  try {
    exportClassesTimetableVerticalXLSX(scheduleStore)
  } catch (e) {
    console.error('匯出直式班級課表失敗:', e)
    alert('匯出失敗: ' + e.message)
  }
}

const handleClassroomExport = async () => {
  if (!scheduleStore.isInitialized) return
  try {
    await exportClassroomTimetable(scheduleStore)
  } catch (e) {
    console.error('匯出專科教室課表失敗:', e)
    alert('匯出失敗: ' + e.message)
  }
}

const handleSubjectTeacherExport = () => {
  if (!scheduleStore.isInitialized) return
  try {
    exportSubjectTeacherTimetables(scheduleStore)
  } catch (e) {
    console.error('匯出科任教師課表失敗:', e)
    alert('匯出失敗: ' + e.message)
  }
}

const handleSwimmingExport = async () => {
  if (!scheduleStore.isInitialized) return
  try {
    await exportSwimmingSchedule(scheduleStore)
  } catch (e) {
    console.error('匯出游泳池課表失敗:', e)
    alert('匯出失敗: ' + e.message)
  }
}
</script>

<style scoped>
.export-container { padding: 20px; max-width: 1200px; margin: 0 auto; }
.desc { color: #64748b; margin-bottom: 30px; }

.warning-banner {
  background: #fef3c7;
  border: 1px solid #f59e0b;
  color: #92400e;
  padding: 15px 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-weight: bold;
}

.export-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
}

.card {
  background: white;
  padding: 25px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  border-top: 4px solid #3b82f6;
  display: flex;
  flex-direction: column;
}

.card h3 { margin-top: 0; color: #1e293b; }
.card p { color: #64748b; flex: 1; margin-bottom: 20px; }

.action-group { display: flex; gap: 10px; }

.btn {
  padding: 10px 15px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  font-size: 15px;
  transition: 0.2s;
  flex: 1;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-xlsx { background-color: #10b981; color: white; }
.btn-xlsx:hover:not(:disabled) { background-color: #059669; }
.btn-docx { background-color: #3b82f6; color: white; }
.btn-docx:hover:not(:disabled) { background-color: #2563eb; }
</style>
