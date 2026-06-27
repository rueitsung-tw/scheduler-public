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
import { normalizeSubject } from '../utils/subjectCanonical'

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
      const periodTraces = [];
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

          // 📊 Period Trace：記錄各來源節數，供前後端比對
          const trace = {
            className: c.name,
            grade,
            isArtsClass: !!c.isArtsClass,
            // --- 原始節數來源 ---
            standardReqsCount: 0,           // standardReqs 筆數（過濾前）
            filteredStandardPeriods: 0,     // 過濾後標準課程總節數
            altReqsCount: 0,                // alternativeMatrix 筆數（過濾前）
            filteredAltPeriods: 0,          // 過濾後彈性課程總節數
            // --- 合併前後 ---
            mergedTotalBeforeProtection: 0, // 合併後、藝才班保護前的總節數
            mergedTotalAfterProtection: 0,  // 經過藝才班保護後的總節數
            protectionTriggered: false,     // 是否觸發了藝才班超載保護
            skippedAlternativeItems: [],    // 被跳過的 alternative 明細（T6 驗收用）
            // --- 舊的 homeroom/subject 分類保留 ---
            standardPeriods: 0,
            alternativePeriods: 0,
            homeroomPeriods: 0,
            subjectPeriods: 0,
            totalPeriods: 0,
            // --- 明細 ---
            requirementBreakdown: [],       // [{subject, periods, source: 'standard'|'alternative', defaultTeacher}]
          };

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

         // 📊 A2: 記錄標準課程 trace 數據
         trace.standardReqsCount = standardReqs.length;
         trace.filteredStandardPeriods = filteredStandardReqs.reduce((sum, r) => sum + (r.periods || 0), 0);
         trace.standardPeriods = trace.filteredStandardPeriods;

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

         // 📊 A2: 記錄彈性課程 trace 數據
         trace.altReqsCount = altReqs.length;
         trace.filteredAltPeriods = filteredAltReqs.reduce((sum, r) => sum + (r.periods || 0), 0);
         trace.alternativePeriods = trace.filteredAltPeriods;

          // 🎓 藝才班保護：若 isArtsClass 且已有自訂替代課程結構，不讓 alternativeMatrix 補入會超限的項目
          const hasCustomAlternative = c.course_requirements?.some(r =>
            r.subject && !scheduleStore.standardDomainSettings?.some(d => d.name === r.subject)
          );

         // 🔧 修復 A (RC-CONF-01)：在批次覆蓋前，先保存「有效自訂科目需求」
         // 政策邊界：
         // - 只保留「批次前已存在於 course_requirements、且 periods > 0 的有效自訂科目」
         // - 不得因 locked cells 自動補回已刪除課程
         // - 不得復活 periods <= 0 的課程
         // - 不得覆蓋矩陣已正確計算出的科目節數
         const preBatchCustomReqs = (c.course_requirements || []).filter(r => {
           if (!r.subject) return false;
           if ((r.periods || 0) <= 0) return false;
           return true;
         });

          // 📐 計算年級上限（唯一真相在後端 get_effective_class_period_capacity）
          // frontend 僅作防護提示；若 schoolInfo 未提供則傳 null，不自行猜測 29
          const gradeMaxPeriods = scheduleStore.schoolInfo?.gradeMaxPeriods?.[grade] ?? null;

         // 4. 合併標準領域與彈性課程（使用過濾後的結果）
         let mergedReqs = [...filteredStandardReqs, ...filteredAltReqs];
         const mergedTotal = mergedReqs.reduce((sum, r) => sum + (r.periods || 0), 0);

         // 📊 A2: 記錄合併後、保護前的總節數
         trace.mergedTotalBeforeProtection = mergedTotal;

          // 🛡️ A3: 藝才班超載保護 — 改為「逐筆累加」演算法
          // 只有當 gradeMaxPeriods !== null（後端有提供有效上限）時才觸發保護
          if (c.isArtsClass && hasCustomAlternative && gradeMaxPeriods !== null && mergedTotal > gradeMaxPeriods) {
           trace.protectionTriggered = true;

           // 標準課程是基礎——必須保留
           let protectedReqs = [...filteredStandardReqs];
           const capacity = gradeMaxPeriods;

           // 依 alternativeMatrix 原始順序逐筆嘗試加入
           for (const altReq of filteredAltReqs) {
             // 🛡️ 防呆：檢查此科目是否有已經被鎖定的格數
             let lockedCount = 0;
             if (c.timetable) {
               if (Array.isArray(c.timetable)) {
                 for (const day of c.timetable) {
                   if (Array.isArray(day)) {
                     for (const cell of day) {
                       if (cell && cell.isLocked && cell.subject === altReq.subject) lockedCount++;
                     }
                   }
                 }
               } else if (typeof c.timetable === 'object') {
                 for (const d of Object.keys(c.timetable)) {
                   for (const p of Object.keys(c.timetable[d] || {})) {
                     const cell = c.timetable[d][p];
                     if (cell && cell.isLocked && cell.subject === altReq.subject) lockedCount++;
                   }
                 }
               }
             }

             let actualPeriods = altReq.periods || 0;
             if (lockedCount > actualPeriods) {
               // 🛡️ 嚴格防呆：不再靜默抬高需求節數，直接阻斷並報錯
               throw new Error(`【${c.name}】科目「${altReq.subject}」在畫布上已鎖定 ${lockedCount} 節，無法由系統將節數自動修剪至 ${actualPeriods} 節。請先至畫布手動解鎖該科目！`);
             }

             const projectedTotal = protectedReqs.reduce((sum, r) => sum + (r.periods || 0), 0) + actualPeriods;
             if (projectedTotal > capacity && lockedCount === 0) {
               // 這筆 alternative 會造成溢出，且無鎖定格 → 跳過並記錄
               trace.skippedAlternativeItems.push({
                 subject: altReq.subject,
                 periods: actualPeriods,
                 reason: `加入後總節數 ${projectedTotal} 超過容量 ${capacity}`,
               });
             } else {
               if (projectedTotal > capacity && lockedCount > 0) {
                 // 已有鎖定格，就算溢出也必須強制保留
                 trace.skippedAlternativeItems.push({
                   subject: altReq.subject,
                   periods: actualPeriods,
                   reason: `[強制保留] 已有 ${lockedCount} 堂鎖定課，強行加入導致溢出 (總計 ${projectedTotal} > ${capacity})`,
                 });
               }
               // 未超限或強制保留 → 保留
               protectedReqs.push({ ...altReq, periods: actualPeriods });
             }
           }

            console.warn(`[ClassForm] 🛡️ ${c.name}: 藝才班保護觸發，依 alternativeMatrix 順序逐筆累加。容量=${capacity}, 標準=${trace.filteredStandardPeriods}`);
            if (trace.skippedAlternativeItems.length > 0) {
              console.warn(`[ClassForm] ⚠️ ${c.name}: 藝才班保護跳過以下替代課程:`, trace.skippedAlternativeItems);
            }
            mergedReqs = protectedReqs;
          } else if (c.isArtsClass && hasCustomAlternative && gradeMaxPeriods === null) {
            // 🛡️ P3: schoolInfo 未提供 gradeMaxPeriods — 警告但不自行猜測上限
            console.warn(`[ClassForm] ⚠️ ${c.name}: 藝才班有自訂替代課程，但 schoolInfo.gradeMaxPeriods[${grade}] 為 null（後端未提供）。前端跳過保護檢查，將由後端 get_effective_class_period_capacity 作為唯一真相驗證。`);
          }

         // 🔧 修復 A (RC-CONF-01)：保留有效自訂科目需求
         // 建立本次批次所覆蓋的科目集合（使用 normalizeSubject 進行正規化比對）
         const allMatrixSubjects = new Set([
           ...scheduleStore.standardDomainSettings.map(d => normalizeSubject(d.name)),
           ...gradeAltCourses.map(a => normalizeSubject(a.subject || a.name)),
         ]);

         // 從批次前保存的自訂需求中，保留「不屬於任何矩陣、且節數 > 0 的有效自訂科目」
         const preservedCustomReqs = preBatchCustomReqs.filter(r =>
           r.subject && !allMatrixSubjects.has(normalizeSubject(r.subject))
         );

         // 附加到 mergedReqs（防禦：若矩陣誤產出同名科目，以矩陣版本優先，不重複加入）
         preservedCustomReqs.forEach(customReq => {
           const customCanonical = normalizeSubject(customReq.subject);
           const alreadyExists = mergedReqs.some(r => normalizeSubject(r.subject) === customCanonical);
           if (!alreadyExists) {
             mergedReqs.push({ ...customReq });
           }
         });

         c.course_requirements = mergedReqs;
          trace.totalPeriods = c.course_requirements.reduce((sum, r) => sum + (r.periods || 0), 0);

         // 📊 A2/A5: 記錄保護後最終節數與明細
         trace.mergedTotalAfterProtection = trace.totalPeriods;
         trace.requirementBreakdown = c.course_requirements.map(r => ({
           subject: r.subject,
           periods: r.periods,
           source: filteredAltReqs.some(a => a.subject === r.subject) ? 'alternative' : 'standard',
           defaultTeacher: r.defaultTeacher,
         }));

         // 📊 A5: 超載警告
         const fromConfig = scheduleStore.schoolInfo?.gradeMaxPeriods?.[grade];
         if (fromConfig && trace.totalPeriods > fromConfig) {
           console.warn(`[ClassForm] ⚠️ ${c.name}: 最終總節數 ${trace.totalPeriods} 超過 gradeMaxPeriods[${grade}]=${fromConfig}（來源: standard=${trace.filteredStandardPeriods}, alternative=${trace.filteredAltPeriods}）`);
         }

         periodTraces.push(trace);
     });

      // 📊 將 periodTrace 寫入 schoolInfo.payloadDiagnostics，供後端分析使用
      if (!scheduleStore.schoolInfo?.payloadDiagnostics) {
        scheduleStore.schoolInfo = { ...scheduleStore.schoolInfo, payloadDiagnostics: {} };
      }
      scheduleStore.schoolInfo.payloadDiagnostics.periodTraces = periodTraces;

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

      alert('✅ 全校班級基準課程與導師指派已產生完成！');
   } catch (error) {
      console.error(error);
      alert('⚠️ 產生程序發生錯誤或已被中止：\n\n' + error.message);
   }
};
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
