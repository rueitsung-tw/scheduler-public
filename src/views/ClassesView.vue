<template>
  <div class="classes-view">
    <h1>課程管理</h1>

    <!-- 頁籤導航 -->
    <div class="tab-navigation">
      <button
        class="tab-button"
        :class="{ active: activeTab === 'class' }"
        @click="activeTab = 'class'"
      >
        單一班級/導師配課
      </button>
      <button
        class="tab-button"
        :class="{ active: activeTab === 'subject' }"
        @click="activeTab = 'subject'"
      >
        科任教師批次配課
      </button>
      <button
        class="tab-button"
        :class="{ active: activeTab === 'list' }"
        @click="activeTab = 'list'"
      >
        班級課程列表
      </button>
    </div>

    <!-- 內容區域 -->
    <div class="tab-content">
      <ClassForm v-if="activeTab === 'class'" />
      <SubjectAssignmentForm v-if="activeTab === 'subject'" />

      <!-- 班級課程列表 -->
      <div v-if="activeTab === 'list'" class="class-list-section">
        <h2>班級課程需求列表</h2>
        <table class="class-table">
          <thead>
            <tr>
              <th>序號</th>
              <th>班級名稱</th>
              <th>導師</th>
              <th>課程數</th>
              <th>總節數</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(cls, idx) in scheduleStore.classes" :key="cls.id || cls.name" :class="{ 'highlight-row': false }">
              <td>{{ idx + 1 }}</td>
              <td><strong>{{ cls.name }}</strong></td>
              <td>{{ cls.homeroom_teacher || '-' }}</td>
              <td>{{ (cls.course_requirements || []).length }}</td>
              <td>
                {{ (cls.course_requirements || []).reduce((sum, r) => sum + (Number(r.periods) || 0), 0) }}
              </td>
              <td>
                <button
                  class="edit-btn"
                  @click="openEditDialog(cls)"
                  title="編輯節數"
                >
                  ✏️ 編輯節數
                </button>
                <button
                  class="quick-setting-btn"
                  @click="goToClassSettings(cls)"
                  title="快速設定"
                >
                  ⚡ 快速設定
                </button>
              </td>
            </tr>
            <tr v-if="scheduleStore.classes.length === 0">
              <td colspan="6" style="text-align: center; padding: 40px; color: #999;">
                目前沒有班級資料，請先至「單一班級/導師配課」產生課程需求
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 編輯節數彈窗 -->
    <div v-if="showDialog" class="dialog-overlay" @click="closeDialog">
      <div class="dialog-modal" @click.stop>
        <div class="dialog-header">
          <h3>{{ editingClass?.name || '' }} 課程需求調整</h3>
          <button class="dialog-close-btn" @click="closeDialog">&times;</button>
        </div>
        <div class="arts-class-toggle" style="margin: 10px 0; padding: 10px; background: #f8fafc; border-radius: 8px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" v-model="editingClass.isArtsClass">
            <strong>🎨 將此班級設定為「特殊藝才班」</strong>
            <span style="color: #64748b; font-size: 0.9em;">(啟用後，將允許排入舞蹈/芭蕾等特規科目)</span>
          </label>
        </div>

        <div class="dialog-body">
          <table class="edit-table">
            <thead>
              <tr>
                <th style="width: 5%;">#</th>
                <th style="width: 25%;">科目名稱</th>
                <th style="width: 20%;">節數</th>
                <th style="width: 25%;">指派教師</th>
                <th style="width: 25%;">授課身份</th>
              </tr>
            </thead>
             <tbody>
               <tr v-for="(req, idx) in editingRequirements" :key="idx">
                 <td>{{ idx + 1 }}</td>
                 <td>
                   <input
                     class="subject-input"
                     v-model="req.subject"
                     :style="{ backgroundColor: subjectColorMap[req.subject] ? 'transparent' : 'transparent' }"
                     placeholder="輸入科目名稱 (如: 舞蹈)"
                   />
                 </td>
                 <td>
                   <input
                     type="number"
                     class="period-input"
                     v-model.number="req.periods"
                     min="0"
                     max="20"
                     step="0.5"
                   />
                 </td>
                 <td>
                   <select class="teacher-select" v-model="req.teacher_name">
                     <option value="">-- 未指派 --</option>
                     <option v-for="teacher in scheduleStore.teachers" :key="teacher.id || teacher.name" :value="teacher.name">
                       {{ teacher.name }}
                     </option>
                   </select>
                 </td>
                 <td>
                   <span class="teacher-type-badge" :class="req.defaultTeacher === 'homeroom' ? 'homeroom' : 'subject'">
                     {{ req.defaultTeacher === 'homeroom' ? '導師' : '科任' }}
                   </span>
                 </td>
                 <td style="width: 10%;">
                   <button class="delete-btn" @click="removeRequirement(idx)" title="刪除此科目">🗑️</button>
                 </td>
               </tr>
              <tr v-if="editingRequirements.length === 0">
                <td colspan="5" style="text-align: center; padding: 30px; color: #999;">
                  該班級目前沒有課程需求
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ➕ 新增課程需求按鈕 -->
        <div class="add-row-container">
          <button class="add-row-btn" @click="addNewRequirement">➕ 新增課程需求 (例如：舞蹈、芭蕾)</button>
        </div>

        <div class="dialog-footer">
          <button class="btn btn-cancel" @click="closeDialog">取消</button>
          <button class="btn btn-save" @click="saveChanges" :disabled="saving">
            {{ saving ? '儲存中...' : '儲存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import ClassForm from '@/components/ClassForm.vue'
import SubjectAssignmentForm from '@/components/SubjectAssignmentForm.vue'

export default {
  name: 'ClassesView',
  components: {
    ClassForm,
    SubjectAssignmentForm
  },
  setup() {
    const router = useRouter()
    const scheduleStore = useScheduleStore()
    const activeTab = ref('class')

    // 彈窗狀態
    const showDialog = ref(false)
    const editingClass = ref(null)
    const editingRequirements = ref([])
    const saving = ref(false)

    // 科目顏色映射
    const subjectColorMap = computed(() => {
      const map = {}
      ;(scheduleStore.standardDomainSettings || []).forEach(s => {
        map[s.name] = s.color || '#e2e8f0'
      })
      return map
    })

    // 開啟編輯彈窗
    const openEditDialog = (cls) => {
      editingClass.value = cls
      // 深拷貝 course_requirements，避免直接修改原始資料
      editingRequirements.value = (cls.course_requirements || []).map(req => ({
        subject: req.subject || '',
        periods: Number(req.periods) || 0,
        teacher_name: req.teacher_name || req.teacher || '',
        defaultTeacher: req.defaultTeacher || 'subject'
      }))
      showDialog.value = true
    }

    // 關閉彈窗
    const closeDialog = () => {
      showDialog.value = false
      editingClass.value = null
      editingRequirements.value = []
    }

    // 儲存變更
  const saveChanges = async () => {
    if (!editingClass.value) return;

    try {
      // 🚀 BugFix: 統一使用 editingRequirements，同時確保 isArtsClass 狀態被正確保留
      const updatedClassData = {
        ...editingClass.value,
        course_requirements: editingRequirements.value.map(req => ({
          subject: req.subject,
          periods: Number(req.periods) || 0,
          teacher_name: req.teacher_name || '',
          teacher: req.teacher_name || '', // 對齊前後端
          defaultTeacher: req.defaultTeacher || 'subject'
        }))
      };

      const index = scheduleStore.classes.findIndex(c => c.id === editingClass.value.id);
      if (index !== -1) {
        scheduleStore.classes[index] = updatedClassData;
        scheduleStore.markScheduleDirty();
        await scheduleStore.syncToCloud();
        showDialog.value = false;
        alert('✅ 班級設定與課程需求已更新！');
      }
    } catch (error) {
      console.error('儲存修改失敗:', error);
      alert('❌ 儲存失敗，請檢查網路。');
    }
  };

    // 🚀 新增：新增一列課程需求
    const addNewRequirement = () => {
      editingRequirements.value.push({
        subject: '',
        periods: 2,
        teacher_name: '',
        defaultTeacher: 'subject'
      });
    };

    // 🚀 新增：刪除指定索引的課程需求
    const removeRequirement = (index) => {
      editingRequirements.value.splice(index, 1);
    };

    // 跳轉到班級設定頁面（快速設定模式）
    const goToClassSettings = (cls) => {
      router.push({
        path: '/class-settings',
        query: { class: cls.name }
      })
    }

    return {
      activeTab,
      scheduleStore,
      showDialog,
      editingClass,
      editingRequirements,
      saving,
      subjectColorMap,
      openEditDialog,
      closeDialog,
      saveChanges,
      goToClassSettings,
      addNewRequirement,
      removeRequirement
    }
  }
}
</script>

<style scoped>
.classes-view {
  padding: 20px;
}

.classes-view h1 {
  margin-bottom: 30px;
  color: #333;
}

/* 頁籤導航樣式 */
.tab-navigation {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  border-bottom: 2px solid #e0e0e0;
  padding-bottom: 0;
}

.tab-button {
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 500;
  color: #555;
  background: #f5f5f5;
  border: 1px solid #ddd;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  top: 2px;
}

.tab-button:hover {
  background: #e8f4fc;
  border-color: #4a90d9;
  color: #4a90d9;
}

.tab-button.active {
  background: #4a90d9;
  color: white;
  border-color: #4a90d9;
  font-weight: 600;
  box-shadow: 0 -2px 4px rgba(74, 144, 217, 0.2);
}

.tab-button.active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 3px;
  background: #4a90d9;
  border-radius: 0 0 4px 4px;
}

.tab-content {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 0 8px 8px 8px;
  padding: 24px;
  min-height: 400px;
}

/* 班級列表 */
.class-list-section h2 {
  margin-bottom: 20px;
  color: #333;
}

.class-table {
  width: 100%;
  border-collapse: collapse;
}

.class-table th,
.class-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.class-table th {
  background: #f8f9fa;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
  font-size: 13px;
}

.class-table tbody tr:hover {
  background: #f0f7ff;
}

.edit-btn {
  padding: 8px 16px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2);
}

.edit-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(245, 158, 11, 0.3);
}

.quick-setting-btn {
  padding: 8px 16px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(139, 92, 246, 0.2);
  margin-left: 8px;
}

.quick-setting-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(139, 92, 246, 0.3);
}

/* 彈窗 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.dialog-modal {
  background: white;
  border-radius: 16px;
  width: 90%;
  max-width: 900px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { transform: translateY(30px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #eee;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  color: #1e293b;
}

.dialog-close-btn {
  background: none;
  border: none;
  font-size: 28px;
  color: #999;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}

.dialog-close-btn:hover {
  color: #333;
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

/* 編輯表格 */
.edit-table {
  width: 100%;
  border-collapse: collapse;
}

.edit-table th,
.edit-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #f0f0f0;
  vertical-align: middle;
}

.edit-table th {
  background: #f8f9fa;
  font-weight: 600;
  color: #555;
  font-size: 13px;
  position: sticky;
  top: 0;
}

.edit-table tbody tr:hover {
  background: #f8fafc;
}

/* 科目徽章 */
.subject-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  color: white;
  font-size: 13px;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

/* 節數輸入框 */
.period-input {
  width: 70px;
  padding: 8px 10px;
  border: 2px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  text-align: center;
  transition: border-color 0.2s;
}

.period-input:focus {
  outline: none;
  border-color: #4a90d9;
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.1);
}

/* 教師下拉選單 */
.teacher-select {
  width: 100%;
  padding: 8px 10px;
  border: 2px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  cursor: pointer;
  transition: border-color 0.2s;
}

.teacher-select:focus {
  outline: none;
  border-color: #4a90d9;
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.1);
}

/* 教師身份徽章 */
.teacher-type-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
}

.teacher-type-badge.homeroom {
  background: #dcfce7;
  color: #166534;
}

.teacher-type-badge.subject {
  background: #dbeafe;
  color: #1e40af;
}

/* 底部按鈕 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #eee;
}

.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: #f1f5f9;
  color: #64748b;
}

.btn-cancel:hover {
  background: #e2e8f0;
  color: #475569;
}

.btn-save {
  background: linear-gradient(135deg, #4a90d9, #2563eb);
  color: white;
  box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);
}

.btn-save:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(37, 99, 235, 0.3);
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 🚀 新增：新增需求按鈕容器 */
.add-row-container {
  padding: 10px 24px;
}

.add-row-btn {
  width: 100%;
  padding: 10px;
  background: #ecfdf5;
  color: #059669;
  border: 2px dashed #059669;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s;
}

.add-row-btn:hover {
  background: #d1fae5;
  box-shadow: 0 2px 8px rgba(5, 150, 105, 0.2);
}

/* 🚀 新增：刪除按鈕 */
.delete-btn {
  background: #fee2e2;
  color: #dc2626;
  border: none;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.delete-btn:hover {
  background: #fecaca;
  transform: scale(1.1);
}

/* 🚀 新增：科目名稱輸入框 */
.subject-input {
  width: 100%;
  padding: 6px 10px;
  border: 2px solid #e2e8f0;
  border-radius: 6px;
  font-size: 13px;
  transition: border-color 0.2s;
}

.subject-input:focus {
  outline: none;
  border-color: #4a90d9;
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.1);
}
</style>
