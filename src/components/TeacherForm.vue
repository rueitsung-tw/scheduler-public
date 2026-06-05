<script setup>
import { ref, watch, nextTick } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const scheduleStore = useScheduleStore()

// 建立乾淨的預設表單格式
const getDefaultTeacher = () => ({
  teacher_id: 'T' + Date.now() + '-' + Math.floor(Math.random() * 10000),
  name: '',
  type: 'homeroom',
  max_periods: 20,
  unavailable_slots: [],
  expertiseSubjects: []
})

const teacher = ref(getDefaultTeacher())

// 🚀 核心修復 1：精準監聽並強制去空白比對 (.trim)
watch(() => scheduleStore.editingTeacherId, async (newId) => {
  console.log('📌 收到編輯請求 ID:', newId); // 幫助你在 F12 開發者工具中除錯

  if (newId && newId !== -1) {
    // 使用 String().trim() 防止 CSV 匯入的隱藏空白字元導致比對失敗
    const target = scheduleStore.teachers.find(t =>
      String(t.name).trim() === String(newId).trim() ||
      String(t.teacher_id).trim() === String(newId).trim() ||
      String(t.id).trim() === String(newId).trim()
    )

    if (target) {
      console.log('✅ 成功找到目標教師:', target.name);
      const parsedData = JSON.parse(JSON.stringify(target))

      // 🛡️ 陣列防呆：防止 SQLite 將陣列變成字串導致前端卡死
      if (typeof parsedData.expertiseSubjects === 'string') {
        try { parsedData.expertiseSubjects = JSON.parse(parsedData.expertiseSubjects) } catch { parsedData.expertiseSubjects = [] }
      }
      if (typeof parsedData.unavailable_slots === 'string') {
        try { parsedData.unavailable_slots = JSON.parse(parsedData.unavailable_slots) } catch { parsedData.unavailable_slots = [] }
      }

      if (!Array.isArray(parsedData.expertiseSubjects)) parsedData.expertiseSubjects = []
      if (!Array.isArray(parsedData.unavailable_slots)) parsedData.unavailable_slots = []

      teacher.value = parsedData

      // 🚀 自動向上捲動，讓使用者立刻看到表單已切換為該老師
      await nextTick()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      console.warn('⚠️ 找不到對應的教師資料，請確認大倉庫。', newId);
    }
  } else {
    teacher.value = getDefaultTeacher()
  }
}, { immediate: true })

const isUnavailable = (d, p) => (teacher.value.unavailable_slots || []).some(s => s.day === d && s.period === p)

const toggleUnavailable = (d, p) => {
  if (!Array.isArray(teacher.value.unavailable_slots)) teacher.value.unavailable_slots = []
  const idx = teacher.value.unavailable_slots.findIndex(s => s.day === d && s.period === p)
  if (idx === -1) teacher.value.unavailable_slots.push({ day: d, period: p })
  else teacher.value.unavailable_slots.splice(idx, 1)
}

const cancelEdit = () => {
  scheduleStore.setEditingTeacherId(-1)
}

const saveData = async () => {
  if (!teacher.value.name) { alert("請輸入教師姓名！"); return }

  const editId = scheduleStore.editingTeacherId;
  const payload = JSON.parse(JSON.stringify(teacher.value));

  if (editId && editId !== -1) {
    // 編輯模式：精準尋找並覆寫
    const idx = scheduleStore.teachers.findIndex(t =>
      String(t.name).trim() === String(editId).trim() ||
      String(t.teacher_id).trim() === String(editId).trim() ||
      String(t.id).trim() === String(editId).trim()
    )
    if (idx !== -1) {
      scheduleStore.updateTeacher(idx, payload)
    } else {
      scheduleStore.addTeacher(payload)
    }
  } else {
    // 新增模式
    scheduleStore.addTeacher(payload)
  }

  scheduleStore.setEditingTeacherId(-1)
  scheduleStore.markScheduleDirty()

  try {
    await scheduleStore.syncToCloud()
    alert(`✅ 教師 ${payload.name} 的資料已成功更新並同步！`)
  } catch (error) {
    console.error('儲存失敗', error)
    alert('❌ 儲存失敗，請檢查伺服器連線。')
  }
}
</script>

<template>
  <div class="teacher-form-container">
    <div class="form-header">
      <h2>{{ scheduleStore.editingTeacherId && scheduleStore.editingTeacherId !== -1 ? `✏️ 編輯教師：${teacher.name}` : '➕ 新增教師排課條件' }}</h2>
      <button v-if="scheduleStore.editingTeacherId && scheduleStore.editingTeacherId !== -1" @click="cancelEdit" class="cancel-btn">✖ 取消編輯</button>
    </div>

    <div class="form-group"><label>教師姓名：</label><input v-model="teacher.name" type="text" placeholder="例如：王大明" /></div>
    <div class="form-row">
      <div class="form-group">
        <label>教師身份：</label>
        <select v-model="teacher.type">
          <option value="homeroom">班導師</option>
          <option value="subject">專任教師</option>
          <option value="special">特教/其他</option>
          <option value="admin">行政</option>
        </select>
      </div>
      <div class="form-group"><label>最大節數：</label><input v-model.number="teacher.max_periods" type="number" /></div>
    </div>

    <!-- 🚀 Phase 2: 支援 expertise_allocations 格式（專長 + 配額） -->
    <div class="form-group" v-if="teacher.type === 'subject' || teacher.type === 'special'">
      <label>專長科目與配課節數：</label>
      <div class="expertise-allocation-section">
        <!-- 舊版 checkbox 保留向後相容 -->
        <div class="checkbox-group" v-if="!teacher.expertise_allocations || teacher.expertise_allocations.length === 0">
          <label v-for="sub in scheduleStore.allAvailableSubjects" :key="sub.name" class="cb-label">
            <input type="checkbox" :value="sub.name" v-model="teacher.expertiseSubjects"> {{ sub.name }}
          </label>
        </div>
        <!-- 新版：專長配額列表 -->
        <div class="allocation-list" v-else>
          <div v-for="(alloc, idx) in teacher.expertise_allocations" :key="idx" class="allocation-item">
            <span class="subject-name">{{ alloc.subject }}</span>
            <span class="quota-badge">配額: {{ alloc.quota }} 節</span>
          </div>
          <div v-if="teacher.expertise_allocations.length === 0" class="no-expertise">尚未設定專長配額</div>
        </div>
        <!-- 顯示已選專長總計 -->
        <div class="allocation-summary" v-if="teacher.expertise_allocations && teacher.expertise_allocations.length > 0">
          已選專長總節數: {{ teacher.expertise_allocations.reduce((sum, a) => sum + (a.quota || 0), 0) }} / {{ teacher.max_periods }} 節
        </div>
      </div>
    </div>

    <div class="schedule-grid">
      <h3>禁排時段設定</h3>
      <table class="timetable">
        <thead><tr><th>節次</th><th v-for="d in 5" :key="d">星期{{ ['一', '二', '三', '四', '五'][d-1] }}</th></tr></thead>
        <tbody>
          <tr v-for="p in 7" :key="p">
            <td>第 {{p}} 節</td>
            <td v-for="d in 5" :key="d" :class="{ 'unavailable': isUnavailable(d, p) }" @click="toggleUnavailable(d, p)">
              {{ isUnavailable(d, p) ? '禁排' : '可排' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <button @click="saveData" class="save-btn">
      {{ scheduleStore.editingTeacherId && scheduleStore.editingTeacherId !== -1 ? '💾 儲存修改並同步' : '➕ 新增教師並同步' }}
    </button>
  </div>
</template>

<style scoped>
.teacher-form-container { max-width: 800px; margin: 20px auto; background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border-top: 4px solid #3b82f6;}
.form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; }
.form-header h2 { margin: 0; color: #1e293b; }
.cancel-btn { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;}
.cancel-btn:hover { background: #e2e8f0; }

.form-group { margin-bottom: 15px; display: flex; flex-direction: column; gap: 8px; }
.form-group label { font-weight: bold; color: #475569; }
.form-group input[type="text"], .form-group input[type="number"], .form-group select { padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; outline: none;}
.form-group input:focus, .form-group select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
.form-row { display: flex; gap: 20px; }
.form-row .form-group { flex: 1; }

.checkbox-group { display: flex; flex-wrap: wrap; gap: 10px; padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
.cb-label { cursor: pointer; display: flex; align-items: center; gap: 5px; color: #475569; font-weight: bold; background: white; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 20px; transition: 0.2s;}
.cb-label:hover { background: #f1f5f9; }

/* 🚀 Phase 2: 專長配額列表樣式 */
.allocation-list { display: flex; flex-direction: column; gap: 8px; padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
.allocation-item { display: flex; align-items: center; gap: 12px; background: white; padding: 10px 15px; border: 1px solid #cbd5e1; border-radius: 8px; }
.allocation-item .subject-name { font-weight: bold; color: #1e293b; min-width: 60px; }
.allocation-item .quota-badge { font-size: 0.9em; color: #3b82f6; background: #eff6ff; padding: 4px 10px; border-radius: 12px; font-weight: 600; }
.allocation-summary { margin-top: 10px; padding: 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; color: #1e40af; font-weight: bold; text-align: center; }
.no-expertise { color: #94a3b8; font-style: italic; text-align: center; padding: 10px; }

.schedule-grid h3 { color: #334155; margin-top: 20px; margin-bottom: 10px;}
.timetable { width: 100%; border-collapse: collapse; margin-top: 10px;}
.timetable th { background: #f8fafc; color: #475569; padding: 10px; border: 1px solid #cbd5e1; }
.timetable td { border: 1px solid #cbd5e1; text-align: center; padding: 12px; cursor: pointer; transition: 0.2s; font-weight: bold; color: #10b981; background: #f0fdf4; }
.timetable td:first-child { background: #f8fafc; color: #475569; cursor: default; }
.timetable td.unavailable { background-color: #fee2e2; color: #dc2626; border-color: #fca5a5; }
.timetable td:not(:first-child):hover { filter: brightness(0.95); transform: scale(0.98); }

.save-btn { margin-top: 25px; padding: 15px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none; border-radius: 8px; cursor: pointer; width: 100%; font-size: 1.1em; font-weight: bold; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.3); transition: 0.3s; }
.save-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(59, 130, 246, 0.4); }
</style>
