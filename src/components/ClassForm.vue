<template>
  <div class="class-form-container">
    <div class="header-actions">
      <h2>🚀 全校班級課程需求批次產生器</h2>
    </div>

    <div class="batch-section">
      <div class="info-alert">
        <h4>📢 功能說明</h4>
        <ul>
          <li><strong>標準化對齊：</strong>本工具將讀取「系統參數設定」中的領域節數矩陣，為全校所有班級重新派發基準課程。</li>
          <li><strong>導師自動綁定：</strong>系統會根據匯入的導師名單，自動將國語、數學、生活等「導師配課」科目指派給該班導師。</li>
          <li><strong>特規科目過濾：</strong>舞蹈、芭蕾、術科等特規科目，僅在「藝才班例外清單」中的班級才會產生課程需求。</li>
          <li><strong>重置警示：</strong>執行此功能將會清空並覆蓋目前「大倉庫」中所有班級的現有課程分配。</li>
        </ul>
      </div>

      <div class="action-card">
        <p>準備好為全校 {{ scheduleStore.classes?.length || 0 }} 個班級產生預設課程需求嗎？</p>
        <button @click="batchGenerateRequirements" class="batch-btn">
          ⚡ 立即批次產生全校課程需求並同步至資料庫
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useScheduleStore } from '../stores/schedule'
import { isSubjectApplicableToGrade } from '../utils/gradeSubjectUtils'

const scheduleStore = useScheduleStore()

/**
 * 輔助函式：從班級名稱提取年級數字
 */
const getGrade = (className) => {
  const match = String(className).match(/(\d+)\s*(年|grade)/i) || String(className).match(/^(\d)/);
  return match ? parseInt(match[1], 10) : 1;
};

/**
 * 🎯 特規科目清單（可後續改為從 schoolInfo 或 aiSettings 讀取）
 * 這些科目需要特殊處理：只有藝才班例外清單中的班級才會排這些課
 */
const specialSubjects = ['舞蹈', '芭蕾', '術科'];

/**
 * 檢查班級是否在藝才班例外清單中
 * @param {string} className - 班級名稱
 * @param {string} subject - 科目名稱
 * @returns {boolean} - 是否在例外清單中
 */
const isExceptionClass = (className, subject) => {
  const exceptions = scheduleStore.schoolInfo?.classExceptions || [];
  return exceptions.some(ex => ex.className === className && ex.subject === subject);
};

/**
 * 核心演算法：全校批次產生課程需求 (已整合例外清單辨識 + 特規科目過濾)
 */
const batchGenerateRequirements = async () => {
  if (!confirm('🚨 警告：這將會清除目前所有班級已設定的課程與教師分配，並根據「108 領域基準矩陣」與「例外清單」重新產生。您確定要執行嗎？')) return;

   try {
      // 🚀 修正：處理資料庫回傳的導師 ID
      // 1. 遍歷大倉庫中所有班級
      (scheduleStore.classes || []).forEach(c => {
         // 取得導師參考值 (可能是 ID 或 姓名)
         const htRef = (typeof c.homeroom_teacher === 'object' ? c.homeroom_teacher?.name : c.homeroom_teacher) || null;

         // 尋找導師物件 (支援 ID 或 姓名比對)
         const teacherObj = (scheduleStore.teachers || []).find(t =>
           String(t.id) === String(htRef) || t.name === htRef
         );

          const realTeacherName = teacherObj ? teacherObj.name : null;

          // 🚀 核心修復 1：明確將找到的姓名，回填給班級物件的 homeroom_teacher 欄位！
          if (realTeacherName) {
            c.homeroom_teacher = realTeacherName;
          }

          const grade = getGrade(c.name);

        // 🚀 BugFix: 將解析出的 grade 寫回班級物件，確保 grade 欄位不會遺失
        c.grade = grade;

         // 2. 根據該年級在「領域節數矩陣」中的設定，取得基準課程需求
         const standardReqs = (scheduleStore.standardDomainSettings || []).map(domain => {
           const rawVal = domain.periods?.[grade] ?? 0;
           let matrixPeriods = Number(rawVal);
           if (isNaN(matrixPeriods)) matrixPeriods = 0;

           // 🔍 關鍵新增：檢查該班級是否有針對此科目的「特殊例外設定」
           const exception = (scheduleStore.schoolInfo.classExceptions || []).find(
             ex => ex.className === c.name && ex.subject === domain.name
           );

           // 💡 邏輯優先級：例外清單設定 > 領域矩陣預設值
           const finalDefaultTeacher = exception ? exception.defaultTeacher : domain.defaultTeacher;

           return {
             subject: domain.name,
             defaultTeacher: finalDefaultTeacher,
             periods: matrixPeriods,
             // 根據最終確定的授課身份指派老師
             teacher: finalDefaultTeacher === 'homeroom' ? (realTeacherName || '') : ''
           };
         });

          // 🎯 特規科目過濾：只保留藝才班例外清單中的班級課程
          // 🔒 雙層過濾：加入年級適用性檢查與 0 節過濾
          const filteredStandardReqs = standardReqs.filter(req => {
            // 0 節不配課（所有科目通用）
            if (req.periods <= 0) {
              return false;
            }
            // 年級適用性檢查
            if (!isSubjectApplicableToGrade(req.subject, grade)) {
              return false;
            }
            // 如果該科目不是特規科目，直接保留
            if (!specialSubjects.includes(req.subject)) {
              return true;
            }
            // 如果是特規科目，檢查該班級是否在例外清單中
            return isExceptionClass(c.name, req.subject);
          });

         // 3. 讀取該年級的「彈性校本課程 (alternativeMatrix)」
         const altMatrix = scheduleStore.schoolInfo?.alternativeMatrix || {};
         // 嘗試取得該年級的彈性課程陣列 (若無則為空陣列)
         const gradeAltCourses = altMatrix[grade] || [];

          const altReqs = gradeAltCourses.map(alt => {
            // 彈性課程的 periods 通常不分年級，直接存在 alt.periods
            let matrixPeriods = Number(alt.periods ?? 0);
            if (isNaN(matrixPeriods)) matrixPeriods = 0;

            // 🛡️ [Bug Fix] 同時支援 alt.subject 與 alt.name，避免出現「未命名科目」
            const courseName = alt.subject || alt.name || '未命名彈性課程';

            // 檢查是否有例外清單設定
            const exception = (scheduleStore.schoolInfo.classExceptions || []).find(
              ex => ex.className === c.name && ex.subject === courseName
            );

            const finalDefaultTeacher = exception ? exception.defaultTeacher : alt.defaultTeacher;

            return {
              subject: courseName,
              defaultTeacher: finalDefaultTeacher,
              periods: matrixPeriods,
              // 根據最終確定的授課身份指派老師
              teacher: finalDefaultTeacher === 'homeroom' ? (realTeacherName || '') : ''
            };
          });

          // 🎯 特規科目過濾：只保留藝才班例外清單中的班級課程
          // 🔒 雙層過濾：加入年級適用性檢查與 0 節過濾
          const filteredAltReqs = altReqs.filter(req => {
            // 0 節不配課（所有科目通用）
            if (req.periods <= 0) {
              return false;
            }
            // 年級適用性檢查
            if (!isSubjectApplicableToGrade(req.subject, grade)) {
              return false;
            }
            // 如果該科目不是特規科目，直接保留
            if (!specialSubjects.includes(req.subject)) {
              return true;
            }
            // 如果是特規科目，檢查該班級是否在例外清單中
            return isExceptionClass(c.name, req.subject);
          });

         // 4. 合併標準領域與彈性課程（使用過濾後的結果）
         c.course_requirements = [...filteredStandardReqs, ...filteredAltReqs];
     });

     // 3. 標記變動並同步至後端 SQLite
     scheduleStore.markScheduleDirty();
     await scheduleStore.syncToCloud();

     // 4. 同步成功後更新教師狀態
     (scheduleStore.classes || []).forEach(c => {
        const htRef = (typeof c.homeroom_teacher === 'object' ? c.homeroom_teacher?.name : c.homeroom_teacher) || null;
        const teacherObj = (scheduleStore.teachers || []).find(t =>
          String(t.id) === String(htRef) || t.name === htRef
        );
        if (teacherObj) {
          teacherObj.assignedClass = c.name;
          teacherObj.type = 'homeroom';
        }
     });

     alert('✅ 全校班級課程需求已成功批次產生，並已遵守例外清單設定！');
   } catch (error) {
     console.error('批次產生失敗:', error);
     alert('❌ 批次產生過程中發生錯誤，請檢查網路連線或系統參數設定。');
   }
}
</script>

<style scoped>
.class-form-container {
  padding: 10px;
}

.header-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.batch-section {
  background: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.info-alert {
  background: #f0f7ff;
  border-left: 5px solid #3b82f6;
  padding: 15px 20px;
  margin-bottom: 25px;
  border-radius: 4px;
}

.info-alert h4 {
  margin-top: 0;
  color: #1e40af;
}

.info-alert ul {
  margin: 10px 0 0 0;
  padding-left: 20px;
  color: #374151;
  line-height: 1.6;
}

.action-card {
  text-align: center;
  padding: 20px;
  border: 2px dashed #e2e8f0;
  border-radius: 8px;
}

.batch-btn {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border: none;
  padding: 18px 36px;
  border-radius: 10px;
  font-size: 1.1em;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
}

.batch-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(37, 99, 235, 0.3);
}

.batch-btn:active {
  transform: translateY(0);
}
</style>
