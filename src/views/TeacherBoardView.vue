<template>
  <div class="teacher-board-container">
    <div class="header-actions">
      <div class="title-group">
        <h2>👨‍🏫 導師排課台</h2>
        <div class="class-info" v-if="currentClass">
          <span class="class-badge">{{ currentClass.name }}</span>
          <span class="teacher-label">導師：{{ currentClass.homeroom_teacher }}</span>
        </div>
      </div>
      <button class="print-btn" @click="printSchedule">🖨️ 列印 A4 課表</button>
      <button class="save-btn" @click="saveSchedule">💾 儲存課表</button>
    </div>

    <div v-if="currentClass" class="board-layout">
      <div class="subject-pool print-hide">
        <h3>待排配額 ({{ currentClass.name }})</h3>
        <p class="hint">點選科目，再點擊右側空格填入</p>
        <div class="pool-grid">
          <div 
            v-for="(count, subject) in subjectPool" 
            :key="subject"
            class="pool-card"
            :class="{ 'is-active': activeSubject === subject, 'is-empty': count === 0 }"
            :style="getCardStyle(subject, activeSubject === subject)"
            @click="selectSubject(subject)"
          >
            <span class="subj-name">{{ subject }}</span>
            <span class="subj-count">{{ count }} 節</span>
          </div>
        </div>
      </div>

      <div class="timetable-area">
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
                'is-locked': isLocked(day, period),
                'is-noon': period === 4
              }"
              :style="getCellStyle(day, period)"
              @click="placeSubject(day, period)"
            >
              <div v-if="getCell(day, period)" class="cell-content">
                <div class="subject">{{ getCell(day, period).subject }}</div>
                <div class="teacher">
                  {{ getCell(day, period).teacher === '導師' || getCell(day, period).teacher === '' ? currentClass.homeroom_teacher : getCell(day, period).teacher }}
                </div>
              </div>
              <div v-if="isLocked(day, period)" class="lock-icon">🔒</div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div v-else class="warning-box">
      <p>⚠️ 無法識別您的班級身分。您目前選擇的身分是 ({{ scheduleStore.currentRole || scheduleStore.currentUser || '未選擇' }})。</p>
      <p class="hint">請確認該班級已在「單一班級設定」中建立。</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const scheduleStore = useScheduleStore()

// --- 1. 翻轉身分識別邏輯：根據「班級名稱」直接比對 ---
// 不再比對 homeroom_teacher，而是從登入身分字串中萃取出班級名稱
const currentClass = computed(() => {
  // 1. 抓取下拉選單的值 (通常存在 currentRole 或 currentUser)
  const roleString = scheduleStore.currentRole || scheduleStore.currentUser || '';
  
  // 2. 用正規表達式抓取裡面的數字，例如從 "班級導師 (301 班)" 抓出 "301"
  const match = roleString.match(/(\d+)/);
  if (!match) return null;

  const code = match[1]; // 例如 "301"
  const grade = code.charAt(0); // "3"
  const classNum = parseInt(code.substring(1), 10); // "1"
  const expectedName = `${grade}年${classNum}班`; // 組合成大倉庫的標準名稱 "3 年 1 班"

  // 3. 只要大倉庫的代碼或名稱對得上，就放行！(不管導師是誰或是不是空的)
  return scheduleStore.classes.find(c => 
    c.code === code || 
    c.name === expectedName || 
    c.name === code
  );
});

// --- 2. 修正配額顯示邏輯：抓取「這個班級所有歸屬於導師」的課 ---
const subjectPool = computed(() => {
  if (!currentClass.value || !currentClass.value.course_requirements) return {}
  
  const pool = {}
  const homeroomTeacher = currentClass.value.homeroom_teacher
  
  // 只要是這班的課，且預設由導師上（或已經指派給該班現任導師），就列入配額
  currentClass.value.course_requirements.forEach(req => {
    const isHomeroomSubject = req.defaultTeacher === 'homeroom' || req.teacher === homeroomTeacher
    if (isHomeroomSubject) {
      pool[req.subject] = req.periods
    }
  })
  
  // 扣除網格中已經排進去的節數
  Object.values(gridData.value).forEach(cell => {
    // ⚠️ 關鍵防呆：必須確認 cell 不是 null，再去讀取 cell.subject
    if (cell && cell.subject && pool[cell.subject] !== undefined) {
      pool[cell.subject]--
    }
  })
  
  return pool
})

// --- 3. 課表網格隔離：僅綁定 currentClass.value 的課表資料 ---
const gridData = ref({}) // 該班級的課表資料
const timetable = ref([]) // 課表陣列格式（7 節 × 5 天）

// 生成空白網格（7 節 × 5 天）
const generateEmptyGrid = () => {
  const empty = {}
  for (let day = 1; day <= 5; day++) {
    for (let period = 1; period <= 7; period++) {
      empty[`${day}-${period}`] = null
    }
  }
  return empty
}

// 生成空白課表陣列（7 節 × 5 天）
const generateEmptyTimetable = () => {
  const timetable = []
  for (let day = 1; day <= 5; day++) {
    const daySlots = []
    for (let period = 1; period <= 7; period++) {
      daySlots.push(null)
    }
    timetable.push(daySlots)
  }
  return timetable
}

// 網格操作方法
const getCellKey = (day, period) => `${day}-${period}`
const getCell = (day, period) => gridData.value[getCellKey(day, period)]
const isLocked = (day, period) => getCell(day, period)?.locked

// --- 4. 視覺樣式 ---
const getCardStyle = (subject, isActive) => {
  const baseColor = typeof scheduleStore.getSubjectColor === 'function' 
                  ? scheduleStore.getSubjectColor(subject) 
                  : '#f8fafc'
  if (isActive) return { backgroundColor: baseColor, border: '2px solid #6366f1', transform: 'scale(1.02)' }
  return { backgroundColor: 'white', borderLeft: `6px solid ${baseColor}` }
}

const getCellStyle = (day, period) => {
  const cell = getCell(day, period)
  if (!cell || !cell.subject) return {} // 確保 cell 與 subject 存在
  const bgColor = typeof scheduleStore.getSubjectColor === 'function' 
                  ? scheduleStore.getSubjectColor(cell.subject) 
                  : '#f8fafc'
  return { backgroundColor: bgColor, border: `1px solid ${bgColor}` }
}

// --- 5. 互動邏輯 ---
const activeSubject = ref(null)
const selectSubject = (subject) => {
  if (subjectPool.value[subject] > 0) activeSubject.value = subject
}

const placeSubject = (day, period) => {
  const key = getCellKey(day, period)
  const existing = getCell(day, period)

  if (existing?.locked) {
    alert('此為科任課或特教時段，無法修改！')
    return
  }

  // 移除已排課程
  if (existing && !existing.locked) {
    const newData = { ...gridData.value }
    delete newData[key]
    gridData.value = newData
  }

  // 填入新課程
  if (activeSubject.value && subjectPool.value[activeSubject.value] > 0) {
    gridData.value = {
      ...gridData.value,
      [key]: { subject: activeSubject.value, teacher: homeroomTeacher.value }
    }
    if (subjectPool.value[activeSubject.value] === 0) activeSubject.value = null
  }
}

const printSchedule = () => window.print()

// 計算導師姓名（供 placeSubject 使用）
const homeroomTeacher = computed(() => currentClass.value?.homeroom_teacher || '導師')

// --- 6. 儲存邏輯 ---
// 🚀 修復問題 5：儲存按鈕聯動資料庫同步與錯誤處理
// 🚀 修正問題 4：加入 async 與 syncToCloud
const saveSchedule = async () => {
  if (!currentClass.value) {
    alert('無班級資料可儲存！')
    return
  }

  // 將網格資料轉換回 2D 陣列 (保留您原有的邏輯)
  const newTimetable = generateEmptyTimetable()
  for (let day = 1; day <= 5; day++) {
    for (let period = 1; period <= 7; period++) {
      const key = `${day}-${period}`
      if (gridData.value[key]) {
        newTimetable[day - 1][period - 1] = gridData.value[key]
      }
    }
  }
  
  timetable.value = newTimetable
  currentClass.value.timetable = JSON.parse(JSON.stringify(newTimetable))

  // 標記變更
  scheduleStore.markScheduleDirty()
  
  try {
    // 🔥 真正呼叫後端 API 儲存
    await scheduleStore.syncToCloud() 
    alert(`✅ ${currentClass.value.name} 班課表已成功存入資料庫！`)
  } catch (error) {
    console.error('儲存失敗:', error)
    alert('❌ 儲存失敗，請檢查伺服器連線。')
  }
}

// --- 7. 監聽班級變化，徹底清除幽靈狀態 ---
watch(currentClass, (newClass) => {
  // 1. 清空目前手中抓取的待排科目
  if (typeof activeSubject !== 'undefined') {
    activeSubject.value = null
  }

  // 2. 重新初始化/載入網格資料
  if (newClass) {
    // 如果大倉庫中該班級已有儲存的課表，則深拷貝載入；否則給空白
    if (newClass.timetable && newClass.timetable.length > 0) {
      timetable.value = JSON.parse(JSON.stringify(newClass.timetable))
      
      // 從 timetable 陣列重建 gridData
      const newGridData = {}
      for (let day = 0; day < 5; day++) {
        for (let period = 1; period <= 7; period++) {
          const cellData = newClass.timetable[day][period - 1]
          if (cellData) {
            newGridData[`${day + 1}-${period}`] = cellData
          }
        }
      }
      gridData.value = newGridData
      
      console.log(`已重新載入 ${newClass.name} 的專屬課表（共 ${newClass.timetable.flat().filter(Boolean).length} 節課）`)
    } else {
      // 如果該班級沒有課表資料，生成空白網格
      timetable.value = generateEmptyTimetable()
      gridData.value = generateEmptyGrid()
      console.log(`已生成空白課表給 ${newClass.name}`)
    }
  } else {
    // 如果找不到班級，強制給空白網格
    timetable.value = generateEmptyTimetable()
    gridData.value = generateEmptyGrid()
    console.log('未識別班級，已清空課表')
  }
}, { immediate: true, deep: true })
</script>

<style scoped>
.teacher-board-container { padding: 20px; max-width: 1200px; margin: 0 auto; }
.header-actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 15px;}
.title-group { display: flex; align-items: center; gap: 20px; }
.class-info { display: flex; align-items: center; gap: 10px; }
.class-badge { background: #3b82f6; color: white; padding: 6px 12px; border-radius: 6px; font-weight: bold; }
.teacher-label { color: #64748b; font-size: 0.95em; }
.print-btn { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;}
.print-btn:hover { background: #2563eb; }
.save-btn { background: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;}
.save-btn:hover { background: #059669; }

.warning-box { text-align: center; padding: 50px; background: #fffbeb; border: 2px dashed #f59e0b; border-radius: 8px; color: #92400e; font-size: 1.1em; }
.warning-box p { margin: 8px 0; }
.hint { font-size: 0.9em; color: #78350f; }

.board-layout { display: flex; gap: 20px; flex-direction: column; }
@media (min-width: 768px) { .board-layout { flex-direction: row; } }

.subject-pool { width: 100%; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
@media (min-width: 768px) { .subject-pool { width: 250px; } }
.pool-grid { display: flex; flex-direction: column; gap: 12px; margin-top: 15px; }
.pool-card { border: 2px solid #e2e8f0; padding: 15px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.05);}
.pool-card.is-empty { opacity: 0.4; cursor: not-allowed; filter: grayscale(100%);}
.subj-name { font-weight: 900; font-size: 1.1em; color: #1e293b; }
.subj-count { background: rgba(255,255,255,0.7); padding: 4px 10px; border-radius: 12px; font-size: 0.85em; font-weight: bold; border: 1px solid rgba(0,0,0,0.1);}

.timetable-area { flex: 1; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow-x: auto;}
.timetable-grid { display: grid; grid-template-columns: 60px repeat(5, minmax(100px, 1fr)); gap: 4px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px; min-width: 600px;}
.grid-header, .grid-time-label { background: #f1f5f9; padding: 10px; text-align: center; font-weight: bold; color: #475569; border-radius: 4px;}
.grid-cell { background: white; height: 80px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; position: relative; border-radius: 6px; transition: 0.2s; border: 1px solid #e2e8f0;}
.grid-cell:hover:not(.is-locked) { transform: scale(1.02); box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 2;}
.grid-cell.is-locked { opacity: 0.8; cursor: not-allowed; filter: brightness(0.95);}
.grid-cell.is-noon { border-bottom: 4px solid #94a3b8; margin-bottom: 4px;}
.cell-content { text-align: center; pointer-events: none;}
.subject { font-weight: 900; font-size: 1.15em; color: #0f172a; }
.teacher { font-size: 0.85em; color: #64748b; margin-top: 4px;}
.lock-icon { position: absolute; top: 4px; right: 4px; font-size: 0.8em; opacity: 0.6; }

@media print {
  :deep(.sidebar), :deep(.top-header), .print-hide, .header-actions button { display: none !important; }
  :deep(.main-content) { margin: 0 !important; padding: 0 !important; }
  .timetable-area { box-shadow: none; padding: 0; overflow: visible;}
  .timetable-grid { min-width: 100%; }
  .grid-cell { height: 60px; border: 1px solid #cbd5e1 !important;}
}
</style>