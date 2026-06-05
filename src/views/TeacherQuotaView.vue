<template>
  <div class="teacher-quota-view">
    <h1>教師配額管理</h1>
    
    <table class="quota-table">
      <thead>
        <tr>
          <th>姓名</th>
          <th>角色類型</th>
          <th>基本節數</th>
          <th>減課</th>
          <th>超鐘點</th>
          <th>最大配額</th>
          <th>已排節數</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="quota in quotas" :key="quota.name">
          <td>{{ quota.name }}</td>
          <td>{{ getRoleGroupName(quota.roleGroup) }}</td>
          <td>{{ getBasePeriods(quota.roleGroup) }}</td>
          <td>
            <input 
              type="number" 
              v-model.number="quota.reduction" 
              min="0"
              @change="updateTeacher(quota)"
            />
          </td>
          <td>
            <input 
              type="number" 
              v-model.number="quota.overtime" 
              min="0"
              :max="6"
              @change="checkOvertime(quota)"
            />
            <span v-if="quota.overtime > 6" class="warning-text">
              超鐘點不得超過 6 節
            </span>
          </td>
          <td>{{ quota.maxPeriods }}</td>
          <td>{{ quota.assigned }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const store = useScheduleStore()

// 🚀 修正問題 1：正確綁定 store.teacherQuotas
const quotas = computed(() => store.teacherQuotas)

const getRoleGroupName = (roleGroup) => {
  const names = { homeroom: '導師', subject: '專任', admin: '行政' }
  return names[roleGroup] || roleGroup
}

const getBasePeriods = (roleGroup) => {
  return store.schoolInfo?.periodDefaults?.[roleGroup] || 0
}

// 🚀 修正問題 2 & 3：加上 async，移除多餘的 .value，並呼叫 syncToCloud
const updateTeacher = async (quota) => {
  // 修正：store.teachers 不需加 .value
  const teacherIndex = store.teachers.findIndex(t => t.name === quota.name)
  if (teacherIndex !== -1) {
    // 1. 更新本地狀態
    store.updateTeacher(teacherIndex, {
      reduction: quota.reduction,
      overtime: quota.overtime
    })
    // 2. 真正寫入資料庫
    await store.syncToCloud() 
  }
}

// 🚀 修正問題 4：checkOvertime 必須連動 updateTeacher
const checkOvertime = async (quota) => {
  if (quota.overtime > 6) {
    alert('超鐘點不得超過 6 節！')
    quota.overtime = 6
  }
  // 呼叫 updateTeacher 確保存檔
  await updateTeacher(quota) 
}
</script>

<style scoped>
.teacher-quota-view {
  padding: 20px;
  max-width: 1000px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 20px;
  color: #333;
}

.quota-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

.quota-table th,
.quota-table td {
  border: 1px solid #ddd;
  padding: 12px;
  text-align: center;
}

.quota-table th {
  background-color: #f5f5f5;
  font-weight: bold;
}

.quota-table tr:hover {
  background-color: #f9f9f9;
}

.quota-table input {
  width: 60px;
  padding: 5px;
  text-align: center;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.warning-text {
  color: #dc3545;
  font-size: 12px;
  display: block;
  margin-top: 5px;
}
</style>
