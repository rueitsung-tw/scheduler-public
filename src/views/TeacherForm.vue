<template>
  <div class="teacher-form-container">
    <h2>教師排課條件設定</h2>
    <div class="form-group"><label>教師姓名：</label><input v-model="teacher.name" type="text" /></div>
    <div class="form-group"><label>Google 帳號綁定：</label><input type="text" v-model="teacher.google_account" placeholder="例如: teacher@gmail.com" /></div>
    <div class="form-row">
      <div class="form-group"><label>教師身份：</label><select v-model="teacher.type"><option value="homeroom">班導師</option><option value="subject">專任教師</option><option value="special">特教/其他</option></select></div>
      <div class="form-group"><label>最大節數：</label><input v-model.number="teacher.max_periods" type="number" /></div>
    </div>

    <div class="form-group" v-if="teacher.type === 'subject' || teacher.type === 'special'">
      <label>專長科目 (可複選)：</label>
      <div class="checkbox-group">
        <label v-for="sub in scheduleStore.allAvailableSubjects" :key="sub" class="cb-label">
          <input type="checkbox" :value="sub" v-model="teacher.expertiseSubjects"> {{ sub }}
        </label>
      </div>
    </div>

    <div class="schedule-grid">
      <h3>禁排時段設定</h3>
      <table class="timetable">
        <thead><tr><th>節次</th><th v-for="d in 5" :key="d">星 {{d}}</th></tr></thead>
        <tbody>
          <tr v-for="p in 7" :key="p"><td>第 {{p}} 節</td><td v-for="d in 5" :key="d" :class="{ 'unavailable': isUnavailable(d, p) }" @click="toggleUnavailable(d, p)">{{ isUnavailable(d, p) ? '禁' : '可' }}</td></tr>
        </tbody>
      </table>
    </div>
    <button @click="saveData" class="save-btn">儲存資料</button>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const scheduleStore = useScheduleStore()
const teacher = ref({ teacher_id: '', name: '', type: 'homeroom', max_periods: 20, unavailable_slots: [], expertiseSubjects: [], google_account: '' })

// ⚠️ 修正：加入 immediate: true，確保一掛載就讀取資料
watch(() => scheduleStore.editingTeacherId, (newId) => {
  if (newId && newId !== -1) {
    const target = scheduleStore.teachers.find(t => t.name === newId || t.teacher_id === newId)
    if (target) {
      teacher.value = JSON.parse(JSON.stringify(target))
      if (!teacher.value.expertiseSubjects) teacher.value.expertiseSubjects = []
      if (!teacher.value.unavailable_slots) teacher.value.unavailable_slots = []
    }
  } else {
    // 若為新增模式，確實清空表單
    teacher.value = { teacher_id: 'T' + Date.now(), name: '', type: 'homeroom', max_periods: 20, unavailable_slots: [], expertiseSubjects: [], google_account: '' }
  }
}, { immediate: true })

const isUnavailable = (d, p) => (teacher.value.unavailable_slots || []).some(s => s.day === d && s.period === p)
const toggleUnavailable = (d, p) => {
  if (!teacher.value.unavailable_slots) teacher.value.unavailable_slots = []
  const idx = teacher.value.unavailable_slots.findIndex(s => s.day === d && s.period === p)
  if (idx === -1) teacher.value.unavailable_slots.push({ day: d, period: p })
  else teacher.value.unavailable_slots.splice(idx, 1)
}

const saveData = () => {
  if (!teacher.value.name) { alert("請輸入教師姓名！"); return }
  scheduleStore.addTeacher(JSON.parse(JSON.stringify(teacher.value)))
  scheduleStore.setEditingTeacherId(-1)
  alert(`教師 ${teacher.value.name} 資料已儲存！`)
  teacher.value = { teacher_id: 'T' + Date.now(), name: '', type: 'homeroom', max_periods: 20, unavailable_slots: [], expertiseSubjects: [], google_account: '' }
}
</script>

<style scoped>
.teacher-form-container { max-width: 800px; margin: 20px auto; }
.form-group { margin-bottom: 15px; }
.checkbox-group { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 5px; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
.cb-label { cursor: pointer; display: flex; align-items: center; gap: 5px; color: #475569; font-weight: bold; }
.timetable { width: 100%; border-collapse: collapse; }
.timetable td { border: 1px solid #ccc; text-align: center; padding: 10px; cursor: pointer; }
.unavailable { background-color: #ffcccc; color: #cc0000; font-weight: bold; }
.save-btn { margin-top: 20px; padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; }
</style>
