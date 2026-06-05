<template>
  <div class="subject-settings-container">
    <h2>科目設定</h2>
    
    <div class="add-subject-form">
      <h3>新增科目</h3>
      <div class="form-row">
        <div class="form-group">
          <label>科目名稱：</label>
          <input v-model="newSubject.name" type="text" placeholder="例如：音樂、社會" />
        </div>
        
        <div class="form-group">
          <label>排課方式：</label>
          <div class="radio-group">
            <label class="radio-label">
              <input 
                type="radio" 
                v-model="newSubject.isAuto" 
                :value="true" 
              />
              自動排課（骨架）
            </label>
            <label class="radio-label">
              <input 
                type="radio" 
                v-model="newSubject.isAuto" 
                :value="false" 
              />
              導師自填
            </label>
          </div>
        </div>
      </div>
      
      <button @click="addSubject" class="add-btn">新增科目</button>
    </div>

    <div class="subject-list">
      <h3>科目清單</h3>
      <table class="subject-table">
        <thead>
          <tr>
            <th>科目名稱</th>
            <th>排課方式</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(subject, index) in subjectLibrary" :key="index">
            <td>{{ subject.name }}</td>
            <td>
              <span :class="getBadgeClass(subject.isAuto)">
                {{ subject.isAuto ? '自動排課（骨架）' : '導師自填' }}
              </span>
            </td>
            <td>
              <button @click="deleteSubject(index)" class="delete-btn">刪除</button>
            </td>
          </tr>
          <tr v-if="subjectLibrary.length === 0">
            <td colspan="3" class="empty-message">尚無科目設定</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="info-section">
      <h3>說明</h3>
      <div class="info-content">
        <p><strong>自動排課（骨架）：</strong> 此類科目會自動排入課表中，管理員無需手動填寫。排課系統會根據教師專長與班級需求自動分配。</p>
        <p><strong>導師自填：</strong> 此類科目需由導師或專任教師自行填寫授課節次。在課表網格中，這些格子會顯示為「待填寫」狀態。</p>
        <p class="hint">📌 設定會影響課表網格鎖定狀態：自動排課的科目格子會被鎖定（無法手動修改），導師自填的科目格子可手動編輯。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const scheduleStore = useScheduleStore()

// 新科目表單資料
const newSubject = ref({
  name: '',
  isAuto: true
})

// 監聽編輯狀態，清空表單
watch(
  () => scheduleStore.userRole,
  () => {
    newSubject.value = { name: '', isAuto: true }
  }
)

// 新增科目
const addSubject = () => {
  if (!newSubject.value.name.trim()) {
    alert("請輸入科目名稱！")
    return
  }

  // 檢查是否已存在同名科目
  const existingIndex = scheduleStore.subjectLibrary.findIndex(
    s => s.name.toLowerCase() === newSubject.value.name.trim().toLowerCase()
  )
  
  if (existingIndex !== -1) {
    alert("此科目名稱已存在！")
    return
  }

  // 新增到 store
  scheduleStore.subjectLibrary.push({
    name: newSubject.value.name.trim(),
    isAuto: newSubject.value.isAuto
  })

  // 清空表單
  newSubject.value.name = ''
  newSubject.value.isAuto = true

  alert(`科目「${newSubject.value.name}」已成功新增！`)
}

// 刪除科目
const deleteSubject = (index) => {
  const subject = scheduleStore.subjectLibrary[index]
  if (confirm(`確定要刪除科目「${subject.name}」嗎？`)) {
    scheduleStore.subjectLibrary.splice(index, 1)
    alert(`科目「${subject.name}」已成功刪除！`)
  }
}

// 取得徽章樣式類別
const getBadgeClass = (isAuto) => {
  return isAuto ? 'badge-auto' : 'badge-manual'
}
</script>

<style scoped>
.subject-settings-container {
  max-width: 900px;
  margin: 20px auto;
  font-family: sans-serif;
}

h2 {
  color: #1e293b;
  border-bottom: 2px solid #3b82f6;
  padding-bottom: 10px;
  margin-bottom: 20px;
}

h3 {
  color: #334155;
  margin-bottom: 15px;
  font-size: 1.1em;
}

.add-subject-form,
.subject-list,
.info-section {
  background-color: #f8fafc;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  border: 1px solid #e2e8f0;
}

.form-row {
  display: flex;
  gap: 20px;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.form-group {
  flex: 1;
  min-width: 200px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: #475569;
}

.form-group input[type="text"] {
  width: 100%;
  padding: 10px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 1em;
  box-sizing: border-box;
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.radio-group {
  display: flex;
  gap: 20px;
  margin-top: 5px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 8px 12px;
  background-color: white;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  transition: all 0.2s;
}

.radio-label:hover {
  background-color: #f1f5f9;
}

.radio-label input[type="radio"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.add-btn {
  padding: 12px 24px;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1em;
  font-weight: 600;
  transition: background-color 0.2s;
}

.add-btn:hover {
  background-color: #2563eb;
}

.subject-table {
  width: 100%;
  border-collapse: collapse;
  background-color: white;
  border-radius: 6px;
  overflow: hidden;
}

.subject-table th,
.subject-table td {
  padding: 12px 15px;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
}

.subject-table th {
  background-color: #f1f5f9;
  font-weight: 600;
  color: #475569;
}

.subject-table tr:hover {
  background-color: #f8fafc;
}

.subject-table tr:last-child td {
  border-bottom: none;
}

.badge-auto {
  display: inline-block;
  padding: 4px 12px;
  background-color: #dcfce7;
  color: #166534;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
}

.badge-manual {
  display: inline-block;
  padding: 4px 12px;
  background-color: #fef3c7;
  color: #92400e;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
}

.delete-btn {
  padding: 6px 12px;
  background-color: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  transition: background-color 0.2s;
}

.delete-btn:hover {
  background-color: #dc2626;
}

.empty-message {
  text-align: center;
  color: #94a3b8;
  padding: 20px !important;
}

.info-section {
  background-color: #eff6ff;
  border-color: #bfdbfe;
}

.info-content {
  color: #334155;
  line-height: 1.6;
}

.info-content p {
  margin-bottom: 12px;
}

.info-content strong {
  color: #1e293b;
}

.hint {
  color: #f59e0b;
  font-weight: 600;
  background-color: #fffbeb;
  padding: 10px 15px;
  border-radius: 4px;
  border-left: 4px solid #f59e0b;
}
</style>
