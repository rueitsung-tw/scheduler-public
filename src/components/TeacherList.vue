<template>
  <div class="teacher-list-container">
    <h2>東門國小 - 已註冊教師列表</h2>

    <table v-if="scheduleStore.teachers.length > 0" class="teacher-table">
       <thead>
         <tr>
            <th>姓名</th>
            <th>身份</th>
            <th>職位</th>
            <th>帶領班級</th>
            <th>專長配額</th>
            <th>Google 帳號</th>
            <th>不排課時段數</th>
            <th>操作</th>
         </tr>
       </thead>
       <tbody>
         <tr v-for="(teacher, index) in scheduleStore.teachers" :key="index">
           <td>{{ teacher.name }}</td>
           <td>{{ teacher.type === 'homeroom' ? '導師' : '科任' }}</td>
           <td>{{ teacher.jobTitle || '教師' }}</td>
           <td>{{ teacher.assignedClass || '-' }}</td>
           <td>{{ getExpertiseDisplay(teacher) }}</td>
           <td>{{ teacher.google_account || '未綁定' }}</td>
           <td>{{ teacher.unavailable_slots?.length || 0 }} 節</td>
           <td>
             <button @click="scheduleStore.setEditingTeacherId(teacher.id || teacher.name)" class="edit-btn">編輯</button>
             <button @click="scheduleStore.deleteTeacher(teacher.name)" class="delete-btn">刪除</button>
           </td>
         </tr>
       </tbody>
    </table>

    <p v-else class="empty-msg">目前大倉庫中尚無教師資料，請從上方表單新增。</p>
  </div>
</template>

<script setup>
import { useScheduleStore } from '../stores/schedule'

// 取得 Pinia 大倉庫實體 (類似 Singleton Instance)
const scheduleStore = useScheduleStore()

// 🚀 Phase 2: 專長配額顯示輔助函式
// 新格式：體育(17), 健康(2) ｜ 舊格式：體育, 健康 ｜ 無資料：-
const getExpertiseDisplay = (teacher) => {
  if (
    teacher.expertise_allocations &&
    Array.isArray(teacher.expertise_allocations) &&
    teacher.expertise_allocations.length > 0
  ) {
    return teacher.expertise_allocations
      .map(a => {
        const quota = a.quota > 0 ? `(${a.quota})` : ''
        return `${a.subject}${quota}`
      })
      .join(', ')
  }
  // 舊版格式（純科目名稱陣列）
  if (Array.isArray(teacher.expertiseSubjects) && teacher.expertiseSubjects.length > 0) {
    return teacher.expertiseSubjects.join(', ')
  }
  return '-'
}
</script>

<style scoped>
.teacher-list-container { max-width: 800px; margin: 20px auto; font-family: sans-serif; }
.teacher-table { width: 100%; border-collapse: collapse; margin-top: 10px; background-color: white;}
.teacher-table th, .teacher-table td { border: 1px solid #ccc; padding: 10px; text-align: center; }
.teacher-table th { background-color: #e2e8f0; }
.edit-btn { background-color: #2196F3; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px; }
.edit-btn:hover { background-color: #1976D2; }
.delete-btn { background-color: #ff4d4d; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
.delete-btn:hover { background-color: #cc0000; }
.empty-msg { text-align: center; color: #666; font-style: italic; padding: 20px; background-color: #f8f9fa; border-radius: 8px;}
</style>
