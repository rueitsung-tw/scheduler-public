<template>
  <div class="editor-container">
    <div class="editor-header">
      <h2>🎯 全域預排畫布</h2>

      <!-- 🚀 急救操作區 -->
      <div class="action-area">
        <button @click="handleClearTeachers" class="danger-btn outline">🧹 清空教師清單</button>
        <button @click="handleClearTimetables" class="danger-btn outline">🗑️ 清空所有課表</button>
        <button @click="handleResetAllData" class="danger-btn">☢️ 終極系統重置</button>
      </div>
    </div>

    <div class="tuning-controls">
      <label class="lock-toggle" :class="{ 'is-unlocked': !isHomeroomLocked }">
        <input type="checkbox" v-model="isHomeroomLocked">
        {{ isHomeroomLocked ? '🔒 鎖定畫布 (防誤觸)' : '🔓 解除鎖定 (編輯模式)' }}
      </label>
      <span class="status-badge" v-if="scheduleStore.syncStatus === 'unsaved'">⚠️ 儲存中...</span>
      <span class="status-badge success" v-if="scheduleStore.syncStatus === 'saved'">✅ 已與資料庫同步</span>
    </div>

    <div class="main-workspace">
      <!-- 左側：身分切換與背包區 -->
      <div class="sidebar">
        <div class="control-panel">
          <h3>🎯 選擇預排班級</h3>
          <p class="hint">選擇班級後，可手動填入並鎖定科目，作為 AI 排課的前置預排。</p>
          <select v-model="targetClass" class="teacher-select">
            <option disabled value="">請選擇班級...</option>
            <option v-for="c in scheduleStore.classes" :key="c.name" :value="c.name">
              {{ c.name }}
            </option>
          </select>
        </div>

        <div class="backpack-panel" v-if="targetClass">
          <h3>🎒 {{ targetClass }} 待排科目</h3>
          <p class="hint">點擊選擇科目，再點擊右側空白格填入並鎖定。</p>

          <div class="backpack-items">
            <div
              v-for="subj in backpackItems"
              :key="subj.subject"
              class="backpack-item"
              :class="{
                'is-selected': selectedSubject === subj.subject,
                'is-empty': subj.remaining <= 0
              }"
              @click="selectBackpackItem(subj)"
              :style="{ borderLeftColor: scheduleStore.getSubjectColor(subj.subject) }"
            >
              <span class="subj-name">{{ subj.subject }}</span>
              <span class="subj-count" :class="{'text-danger': subj.remaining <= 0}">
                剩餘 {{ subj.remaining }} 節
              </span>
            </div>
            <div v-if="backpackItems.length === 0" class="empty-state">
              該班級目前無待排科目。
            </div>
          </div>
        </div>

        <!-- 🆕 本班專科教室資訊 -->
        <div class="special-classroom-panel" v-if="targetClass && specialClassroomUsage.length > 0">
          <h3>🏛️ 本班專科教室</h3>
          <p class="hint">以下為本班會用到的專科教室，可用來核對排課是否正確使用教室資源。</p>

          <div
            v-for="item in specialClassroomUsage"
            :key="item.subject + item.classroomName"
            class="special-classroom-item"
          >
            <div class="sci-header">
              <span class="sci-room-name">{{ item.classroomName }}</span>
              <span class="sci-subject">{{ item.subject }}</span>
            </div>
            <div class="sci-label" v-if="item.classroomLabel">{{ item.classroomLabel }}</div>
            <div class="sci-teacher" v-if="item.teacher">👤 {{ item.teacher }}</div>
            <div class="sci-usage" v-if="item.usagePeriods.length > 0">
              已排 {{ item.usagePeriods.length }} 節：
              <div v-for="slot in item.usagePeriods" :key="slot.day + '-' + slot.period" class="sci-slot-detail">
                • 星期{{ slot.day }}第{{ slot.period }}節 → 🏫 {{ slot.classroomName || '原班教室' }}
              </div>
            </div>
            <div class="sci-usage text-warning" v-else>
              尚未排課
            </div>
          </div>
        </div>

        <!-- 🆕 目前班級無對應專科教室時的提示 -->
        <div class="special-classroom-panel" v-else-if="targetClass && specialClassroomUsage.length === 0">
          <h3>🏛️ 本班專科教室</h3>
          <p class="hint sci-no-data">此班無需使用專科教室，或教室資料尚未建檔。</p>
        </div>
      </div>

      <!-- 右側：班級課表畫布 -->
      <div class="canvas-area">
        <div v-if="!targetClass" class="empty-canvas-prompt">
          👈 請先從左側選擇要預排的班級。
        </div>

        <div v-else class="timetable-grid">
          <div class="canvas-header">
            <h3>🏫 {{ targetClass }} - 班級課表</h3>
            <span class="sub-hint" v-if="!isHomeroomLocked">✨ 點擊空白格可填入選定科目（預設上鎖）；點擊已填入的未鎖定科目可退回背包；點擊🔒/🔓 按鈕切換單格鎖定。</span>
          </div>

<table class="main-table">
            <thead>
              <tr><th>節次</th><th v-for="d in 5" :key="d">星期{{d}}</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in 7" :key="p">
                <td class="period-label">第 {{p}} 節</td>
                <td
                  v-for="d in 5"
                  :key="d"
                  class="course-slot"
                  :class="{
                    'is-empty-slot': !isTeachablePeriod(d, p),
                    'is-fillable': !isHomeroomLocked && isTeachablePeriod(d, p) && !isSlotLocked(d, p) && isSlotFillable(d, p),
                    'is-revertable': !isHomeroomLocked && isTeachablePeriod(d, p) && !isSlotLocked(d, p) && isSlotRevertable(d, p),
                    'is-locked': isSlotLocked(d, p)
                  }"
                  @click="handleSlotClick(d, p)"
                  @contextmenu.prevent="handleSlotContext(d, p)"
                >
                  <div
                    v-if="getCourse(d, p)"
                    class="course-card"
                    :class="{
                      'dash-style': getCourse(d, p).subject === '導師區塊',
                      'alternating-card': getCourse(d, p).isAlternating,
                      'is-locked-cell': isSlotLocked(d, p)
                    }"
                    :style="{ backgroundColor: getCourseColor(getCourse(d, p).subject) }"
                  >
                    <!-- 🚀 單格鎖定按鈕 -->
                    <button
                      class="cell-lock-btn"
                      @click.stop="toggleCellLock(d, p)"
                      :title="isSlotLocked(d, p) ? '點擊解鎖此時段' : '點擊鎖定此時段'"
                    >
                      {{ isSlotLocked(d, p) ? '🔒' : '🔓' }}
                    </button>

                    <span class="subj">{{ getCourse(d, p).subject }}</span>
                    <span class="t-name" v-if="getCourse(d, p).subject !== '導師區塊'">
                      {{ getCourse(d, p).teacher }}
                    </span>
                    <!-- 交替顯示：優先 pair 資訊，fallback oddWeek/evenWeek -->
                    <template v-if="getCourse(d, p).isAlternating">
                      <span class="alt-week-label odd">
                        {{ getCellDisplay(d, p).subject || getCourse(d, p).oddWeek?.subject }}
                      </span>
                      <span v-if="getCellDisplay(d, p).pairLabel" class="alt-pair-label">
                        🔄 {{ getCellDisplay(d, p).pairLabel }}
                      </span>
                      <span v-if="getCellDisplay(d, p).roleLabel" class="alt-role-label">
                        {{ getCellDisplay(d, p).roleLabel }}
                      </span>
                      <span v-if="!getCellDisplay(d, p).pairLabel" class="alt-week-label odd">單: {{ getCourse(d, p).oddWeek?.subject }}</span>
                      <span v-if="!getCellDisplay(d, p).pairLabel" class="alt-week-label even">雙: {{ getCourse(d, p).evenWeek?.subject }}</span>
                    </template>
                    <span class="hover-prompt fill-prompt">📥 填入</span>
                    <span class="hover-prompt revert-prompt">↩️ 退回</span>

                    <!-- 🆕 衝堂標註：精簡為「衝堂」 -->
                    <div
                      v-if="getConflicts(d, p).length > 0"
                      class="conflict-badge-mini"
                    >
                      ⚠️ 衝堂
                    </div>

                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 🆕 衝堂詳細說明區塊 -->
          <div class="conflict-detail-panel" v-if="allConflictsList.length > 0">
            <h4>🚨 課表衝堂詳細說明</h4>
            <ul class="conflict-list">
              <li v-for="(item, idx) in allConflictsList" :key="idx" class="conflict-detail-item">
                <strong>{{ item.label }}</strong>
                <span :class="['conflict-type-tag', item.type === 'teacher' ? 'tag-teacher' : item.type === 'room' ? 'tag-room' : item.type === 'grade' ? 'tag-grade' : 'tag-requirement']">
                  {{ item.type === 'teacher' ? '教師衝堂' : item.type === 'room' ? '專科教室超載' : item.type === 'grade' ? '年級不符' : '課程需求' }}
                </span>
                {{ item.message }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import { formatCellForDisplay } from '../utils/alternatingHelper'
import { useTimetableConflicts } from '../composables/useTimetableConflicts'

const scheduleStore = useScheduleStore()

// 狀態控制
const isHomeroomLocked = ref(true)
const selectedSubject = ref('')
const targetClass = ref('')

// 班級切換時清空已選科目
watch(targetClass, () => {
  selectedSubject.value = '';
});

// 計算背包內的科目剩餘數量（讀取班級 course_requirements，支援空課表預排）
const backpackItems = computed(() => {
  if (!targetClass.value) return [];

  const clsData = (scheduleStore.classes || []).find(c => c.name === targetClass.value);
  if (!clsData || !clsData.course_requirements) return [];

 // 掃描現有課表，計算各科已排節數
  const usedCounts = {};
  if (clsData.timetable) {
    for (let d = 1; d <= 5; d++) {
      for (let p = 1; p <= 7; p++) {
        const course = clsData.timetable[d]?.[p];
        if (course && course.subject && course.subject !== '導師區塊') {
          const subj = course.subject;

          // 🎯 核心修復：解析音美特殊科目的節數扣抵
          if (subj === '音樂_固定') {
            usedCounts['音樂'] = (usedCounts['音樂'] || 0) + 1;
          } else if (subj === '美勞_固定') {
            usedCounts['美勞'] = (usedCounts['美勞'] || 0) + 1;
          } else if (subj.includes('音樂') && subj.includes('美勞') && (subj.includes('交替') || subj.includes('單') || subj.includes('雙'))) {
            // 處理 "音樂美勞_交替", "美勞(單)/音樂(雙)" 等交替科目，各扣 0.5 節
            usedCounts['音樂'] = (usedCounts['音樂'] || 0) + 0.5;
            usedCounts['美勞'] = (usedCounts['美勞'] || 0) + 0.5;
          } else {
            // 一般科目正常計算
            usedCounts[subj] = (usedCounts[subj] || 0) + 1;
          }
        }
      }
    }
  }

  return clsData.course_requirements.map(req => {
    // 過濾游泳與特殊體育（由 AI 自動排課處理）
    if (req.subject.includes('體育 s') || req.subject.includes('游泳')) return null;
    const used = usedCounts[req.subject] || 0;
    return {
      subject: req.subject,
      teacher: req.teacher_name || req.teacher || '',
      total: req.periods,
      remaining: req.periods - used
    };
  }).filter(item => item !== null && item.total > 0);
});

const selectBackpackItem = (subj) => {
  if (isHomeroomLocked.value) {
    alert('⚠️ 畫布目前已鎖定，請先點擊上方「解除鎖定」再進行操作！');
    return;
  }
  if (subj.remaining <= 0) return;
  selectedSubject.value = subj.subject;
}

const getCourse = (d, p) => {
  if (!targetClass.value) return null;
  const cls = (scheduleStore.classes || []).find(c => c.name === targetClass.value);
  return cls?.timetable?.[d]?.[p] || null;
}

const getCourseColor = (sub) => {
  if (sub === '導師區塊') return '#f1f5f9';
  return scheduleStore.getSubjectColor(sub);
}

// Pair-aware 顯示輔助：封裝 formatCellForDisplay
const getCellDisplay = (d, p) => formatCellForDisplay(getCourse(d, p))

// 🚀 允許填入的條件：空格（null）或導師區塊
const isSlotFillable = (d, p) => {
  const course = getCourse(d, p);
  return !course || course.subject === '導師區塊';
};

// 可退回的條件：有科目、未鎖定、不是導師區塊
const isSlotRevertable = (d, p) => {
  const course = getCourse(d, p);
  return !!(course && course.subject && course.subject !== '導師區塊' && !course.isLocked);
};

// 🔒 直接讀取 timetable 物件的 isLocked 欄位
const isSlotLocked = (d, p) => getCourse(d, p)?.isLocked === true;

// 🔒 切換單格鎖定，並將結果寫入 timetable 物件持久化至資料庫
const toggleCellLock = async (day, period) => {
  if (isHomeroomLocked.value) {
    alert('⚠️ 畫布全域已鎖定，請先點擊上方「解除鎖定」再操作！');
    return;
  }
  const course = getCourse(day, period);
  if (!course || !course.subject || course.subject === '導師區塊') {
    alert('⚠️ 請先填入具體科目，才能進行鎖定！');
    return;
  }
  course.isLocked = !course.isLocked;
  scheduleStore.markScheduleDirty();
  await scheduleStore.syncToCloud();
};

// 🔒 右鍵選單：切換單格鎖定
const handleSlotContext = (day, period) => {
  toggleCellLock(day, period);
};

const handleSlotClick = async (d, p) => {
  if (isHomeroomLocked.value) {
    alert('⚠️ 畫布目前已鎖定，請先點擊上方「解除鎖定」才能更改課表！');
    return;
  }

  // 🔒 單格鎖定攔截
  if (isSlotLocked(d, p)) {
    alert('🔒 此時段已被手動鎖定，禁止修改！請點擊格子右上角的 🔒 按鈕解鎖後再操作。');
    return;
  }

  const clsData = scheduleStore.classes.find(c => c.name === targetClass.value);
  if (!clsData) return;

  // 確保 timetable 結構存在（支援全空課表的預排起始狀態）
  if (!clsData.timetable) clsData.timetable = {};
  if (!clsData.timetable[d]) clsData.timetable[d] = {};

  const course = getCourse(d, p);

  // --- 填入科目 ---
  if (!course || course.subject === '導師區塊') {
    if (!selectedSubject.value) {
      alert('👉 請先從左側背包點擊選擇要排入的科目！');
      return;
    }
    const targetItem = backpackItems.value.find(item => item.subject === selectedSubject.value);
    if (!targetItem || targetItem.remaining <= 0) {
      alert('❌ 該科目節數已用完！請選擇其他科目。');
      return;
    }
    // 填入科目，使用課程需求中的指派教師，預設直接上鎖
    clsData.timetable[d][p] = {
      subject: selectedSubject.value,
      teacher: targetItem.teacher,
      isLocked: true
    };
    scheduleStore.markScheduleDirty();
    await scheduleStore.syncToCloud();

  // --- 退回科目 ---
  } else if (isSlotRevertable(d, p)) {
    clsData.timetable[d][p] = null;  // 清空格子，恢復空缺狀態
    scheduleStore.markScheduleDirty();
    await scheduleStore.syncToCloud();

  } else {
    alert('🚫 此格已鎖定或為特殊課程，無法退回。請點擊格子右上角的 🔒 按鈕解鎖後再操作。');
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
const isTeachablePeriod = (day, period) => {
  if (!targetClass.value) return true;
  if (period <= 4) return true; // 上午全年級可上

  const gradeMatch = String(targetClass.value).match(/(\d+)年/) || String(targetClass.value).match(/^(\d)/);
  const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : 1;

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

// 🗑️ 清空所有課表
const handleClearTimetables = async () => {
  if (!confirm('🚨 確定要清空全校所有已排好的課表嗎？此動作無法復原！')) return;
  scheduleStore.clearAllTimetables();
  await scheduleStore.syncToCloud();
  alert('✅ 全校課表已清空！');
}

// 🧹 清空教師清單
const handleClearTeachers = async () => {
  if (!confirm('🚨 確定要清空所有教師資料嗎？這會影響已排定的課務！')) return;
  scheduleStore.clearAllTeachers();
  await scheduleStore.syncToCloud();
  alert('✅ 教師清單已清空！');
}

// ☢️ 終極系統重置
const handleResetAllData = async () => {
  if (!confirm('☢️ 警告！這將重置系統所有資料（學校資訊、教師、班級、教室等）！確定要執行終極重置嗎？')) return;
  if (!confirm('⚠️ 這是最後一次確認，確定要清空一切嗎？')) return;
  scheduleStore.resetAllData();
  await scheduleStore.syncToCloud();
  alert('✅ 系統已終極重置！');
}

const { specialClassroomUsage, getConflicts, currentClassReport } = useTimetableConflicts(targetClass, scheduleStore)

// 🆕 計算全校當前班級的衝突清單
const allConflictsList = computed(() => {
  const list = []
  const classReport = currentClassReport.value
  if (!classReport) return list

  for (const slot of classReport.issueSlots || []) {
    for (const issue of slot.issues || []) {
      list.push({
        day: slot.day,
        period: slot.period,
        type: issue.type,
        message: issue.message,
        label: `【星期${slot.day} 第 ${slot.period} 節】`,
      })
    }
  }

  for (const issue of classReport.requirementIssues || []) {
    list.push({
      day: null,
      period: null,
      type: 'requirement',
      message: `${issue.subject}：需求 ${issue.required}，已排 ${issue.scheduled}，${issue.message}`,
      label: '【課程需求】',
    })
  }

  return list
})
</script>

<style scoped>
.editor-container { max-width: 1400px; margin: 0 auto; padding: 20px; }
.editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; }
.editor-header h2 { margin: 0; color: #1e293b; }

.action-area { display: flex; gap: 10px; }
.danger-btn { background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;}
.danger-btn.outline { background: white; color: #ef4444; border: 1px solid #ef4444; }
.danger-btn:hover { background: #dc2626; color: white; }

.tuning-controls { display: flex; gap: 15px; align-items: center; margin-bottom: 20px;}
.lock-toggle { background: #fee2e2; color: #991b1b; padding: 10px 15px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.3s; display: flex; align-items: center; gap: 8px; border: 2px solid transparent; }
.lock-toggle.is-unlocked { background: #dcfce7; color: #166534; border-color: #22c55e; }
.lock-toggle input { cursor: pointer; transform: scale(1.2); }
.status-badge { background: #fef08a; color: #854d0e; padding: 6px 12px; border-radius: 20px; font-size: 0.9em; font-weight: bold; }
.status-badge.success { background: #d1fae5; color: #065f46; }

.main-workspace { display: flex; gap: 25px; align-items: flex-start; }

.sidebar { width: 300px; display: flex; flex-direction: column; gap: 20px; flex-shrink: 0; }
.control-panel, .backpack-panel { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
.control-panel h3, .backpack-panel h3 { margin-top: 0; color: #334155; margin-bottom: 5px; }
.hint { color: #64748b; font-size: 0.85em; margin-bottom: 15px; line-height: 1.4; }
.teacher-select { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 1em; cursor: pointer; background: #f8fafc; }

.backpack-items { display: flex; flex-direction: column; gap: 10px; }
.backpack-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-left-width: 6px; border-radius: 8px; cursor: pointer; transition: 0.2s; }
.backpack-item:hover:not(.is-empty) { background: #f1f5f9; transform: translateX(2px); }
.backpack-item.is-selected { background: #eff6ff; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2); font-weight: bold; }
.backpack-item.is-empty { opacity: 0.5; cursor: not-allowed; background: #f1f5f9; }
.subj-name { font-size: 1.1em; color: #1e293b; }
.subj-count { font-size: 0.9em; color: #059669; background: #d1fae5; padding: 4px 8px; border-radius: 20px; font-weight: bold; }
.subj-count.text-danger { color: #dc2626; background: #fee2e2; }
.empty-state { text-align: center; color: #94a3b8; padding: 20px 0; font-style: italic; }

.canvas-area { flex: 1; background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
.empty-canvas-prompt { display: flex; justify-content: center; align-items: center; height: 400px; color: #94a3b8; font-size: 1.2em; font-weight: bold; background: #f8fafc; border-radius: 8px; border: 2px dashed #cbd5e1; }
.canvas-header { margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
.canvas-header h3 { margin: 0; color: #0f172a; font-size: 1.5em; }
.sub-hint { color: #f59e0b; font-weight: bold; }

.main-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.main-table th, .main-table td { border: 1px solid #e2e8f0; padding: 8px; }
.main-table th:first-child, .period-label { width: 70px; text-align: center; background-color: #f8fafc; font-weight: bold; color: #475569; vertical-align: middle; }
.main-table th:not(:first-child) { text-align: center; background-color: #f1f5f9; color: #334155; font-size: 1.05em; padding: 12px; }

.course-slot { vertical-align: top; min-height: 100px; height: auto; position: relative; transition: 0.2s; }
.course-card { padding: 10px; border-radius: 8px; font-weight: bold; font-size: 0.95em; text-align: center; border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 2px 4px rgba(0,0,0,0.04); height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; position: relative; overflow: hidden; }
.dash-style { border: 2px dashed #cbd5e1 !important; color: #94a3b8; }
.t-name { font-size: 0.85em; opacity: 0.85; margin-top: 6px; }

.hover-prompt { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.2em; opacity: 0; transition: 0.2s; border-radius: 8px; }
.fill-prompt { background: rgba(34, 197, 94, 0.85); }
.revert-prompt { background: rgba(239, 68, 68, 0.85); }

.is-fillable { cursor: pointer; }
.is-fillable:hover .course-card { border-color: #22c55e !important; transform: scale(1.02); }
.is-fillable:hover .fill-prompt { opacity: 1; }

.is-revertable { cursor: pointer; }
.is-revertable:hover .course-card { transform: scale(1.02); }
.is-revertable:hover .revert-prompt { opacity: 1; }

/* 不可上課時段：灰白不可點擊 */
.is-empty-slot {
  background: #f8fafc;
  cursor: default;
  pointer-events: none;
}

/* 單雙週交替卡片 */
.alternating-card {
  background: linear-gradient(135deg, #fbcfe8 50%, #f472b6 50%) !important;
  border: 2px solid #ec4899 !important;
}

.alt-week-label {
  font-size: 0.75em;
  padding: 2px 6px;
  border-radius: 4px;
  margin-top: 2px;
  display: inline-block;
}

.alt-week-label.odd {
  background: rgba(251, 191, 232, 0.5);
  color: #831843;
}

.alt-week-label.even {
  background: rgba(244, 114, 182, 0.5);
  color: #831843;
}

/* Pair 標籤 */
.alt-pair-label {
  font-size: 0.8em;
  padding: 2px 6px;
  border-radius: 4px;
  margin-top: 2px;
  display: inline-block;
  background: rgba(198, 219, 239, 0.6);
  color: #1e3a5f;
  font-weight: bold;
}

.alt-role-label {
  font-size: 0.75em;
  padding: 2px 6px;
  border-radius: 4px;
  margin-top: 2px;
  display: inline-block;
  background: rgba(199, 210, 254, 0.6);
  color: #3730a3;
  font-weight: bold;
}

/* 🚀 單格鎖定功能專屬樣式 */
.cell-lock-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 2px 4px;
  z-index: 10;
  transition: all 0.2s ease;
  opacity: 0.3;
  line-height: 1;
}

/* 滑鼠移入才顯示鎖頭按鈕 */
.course-card:hover .cell-lock-btn {
  opacity: 1;
}

/* 已鎖定的按鈕永遠清晰顯示 */
.is-locked-cell .cell-lock-btn {
  opacity: 1;
  background: #fee2e2;
  border-color: #ef4444;
}

/* 🚀 鎖定後的紅色半透明遮罩與醒目框線 */
.is-locked-cell {
  background-color: #fef2f2 !important;
  border: 2px solid #ef4444 !important;
  box-shadow: inset 0 0 10px rgba(239, 68, 68, 0.1);
}

/* 鎖定時禁止顯示拖曳的 hover 提示 */
.is-locked-cell .hover-prompt {
  display: none !important;
}

/* ═══════════════════════════════════════════
   🆕 專科教室資訊面板
   ═══════════════════════════════════════════ */
.special-classroom-panel {
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
  border: 1px solid #e2e8f0;
}

.special-classroom-panel h3 {
  margin-top: 0;
  color: #334155;
  margin-bottom: 5px;
}

.special-classroom-item {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #6366f1;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  font-size: 0.88em;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sci-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sci-room-name {
  font-weight: bold;
  color: #1e293b;
  font-size: 1em;
}

.sci-subject {
  background: #ede9fe;
  color: #5b21b6;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: bold;
}

.sci-label {
  color: #475569;
  font-size: 0.85em;
}

.sci-teacher {
  color: #64748b;
  font-size: 0.82em;
}

.sci-usage {
  color: #059669;
  font-size: 0.82em;
  font-weight: bold;
}

.sci-usage.text-warning {
  color: #d97706;
}

.sci-no-data {
  text-align: center;
  color: #94a3b8;
  font-style: italic;
}

/* ═══════════════════════════════════════════
   🆕 衝堂標註
   ═══════════════════════════════════════════ */
.conflict-badge-mini {
  position: absolute;
  top: 4px;
  left: 4px;
  background: #ef4444;
  color: white;
  font-size: 0.7em;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  pointer-events: none;
  z-index: 5;
}

.sci-slot-detail {
  font-size: 0.85em;
  color: #475569;
  margin-top: 4px;
  padding-left: 6px;
  border-left: 2px solid #cbd5e1;
  text-align: left;
}

.conflict-detail-panel {
  margin-top: 25px;
  background: #fee2e2;
  border: 1px solid #fca5a5;
  border-radius: 12px;
  padding: 20px;
  text-align: left;
}

.conflict-detail-panel h4 {
  margin-top: 0;
  color: #991b1b;
  font-size: 1.1em;
  margin-bottom: 12px;
}

.conflict-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.conflict-detail-item {
  font-size: 0.9em;
  color: #7f1d1d;
  margin-bottom: 8px;
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.conflict-type-tag {
  font-size: 0.75em;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag-teacher {
  background: #fecaca;
  color: #dc2626;
}

.tag-room {
  background: #fef3c7;
  color: #d97706;
}

.tag-grade {
  background: #f3e8ff;
  color: #7c3aed;
}

.tag-requirement {
  background: #dbeafe;
  color: #2563eb;
}
</style>
