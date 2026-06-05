<template>
  <div class="teachers-view">
    <h1>教師管理</h1>
    <CsvImport />
    <TeacherForm />
    <TeacherList />
  </div>
</template>

<script>
import TeacherForm from '@/components/TeacherForm.vue'
import TeacherList from '@/components/TeacherList.vue'
import CsvImport from '@/components/CsvImport.vue'

export default {
  name: 'TeachersView',
  components: {
    TeacherForm,
    TeacherList,
    CsvImport
  }
}
</script>

<style scoped>
.teachers-view {
  padding: 20px;
}

.teachers-view h1 {
  margin-bottom: 30px;
  color: #333;
}
</style>
