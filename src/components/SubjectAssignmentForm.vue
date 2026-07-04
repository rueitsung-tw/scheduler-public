<template>
  <div class="batch-assignment-container">
    <h3>👨‍🏫 科任教師批次配課與規則設定</h3>

    <!-- 🚀 新增：全校科任智慧自動配課區域 -->
    <div class="smart-assignment-section">
      <h4>🤖 智慧自動配課區</h4>
      <p class="section-desc">自動找出尚未配課的科任科目，並根據教師志願優先級智慧指派。</p>
      <button @click="smartSubjectAssignment" class="smart-btn" :disabled="isSmartAssigning">
        {{ isSmartAssigning ? '⏳ 正在配課中...' : '🚀 全校科任智慧自動配課' }}
      </button>
      <div v-if="smartAssignResult" class="result-box">
        <p class="result-success">✅ {{ smartAssignResult.successMsg }}</p>
        <p class="result-detail">📊 處理 {{ smartAssignResult.processedCount }} 個需求，成功指派 {{ smartAssignResult.assignedCount }} 筆，跳過 {{ smartAssignResult.skippedCount }} 筆</p>
        <button @click="downloadDiagnosticLog" class="smart-btn" style="margin-top: 10px; background: #fbbf24; color: #78350f;">
          📥 下載黑箱診斷報告 (TXT)
        </button>
      </div>
    </div>

    <div class="form-grid">
      <div class="form-group">
        <label>任課教師：</label>
        <select v-model="assignment.teacher" @change="onTeacherChange">
          <option disabled value="">請選擇科任教師</option>
          <option v-for="t in subjectTeachers" :key="t.name" :value="t.name">{{ t.name }}</option>
        </select>
      </div>
      <div class="form-group">
        <label>任教科目：</label>
        <select v-model="assignment.subject">
          <option disabled value="">請選擇科目</option>
          <option v-for="sub in teacherSubjects" :key="sub" :value="sub">{{ sub }}</option>
        </select>
      </div>
      <div class="form-group">
        <label>每週【每班】節數：</label>
         <input v-model="assignment.periods" type="number" step="0.5" min="0.5" max="25" />
      </div>
    </div>

    <div class="estimation-box" v-if="targetMode !== 'free_agent' && assignment.teacher && assignment.subject">
      <div class="estimation-content">
        💡 範圍預估：<strong>{{ estimatedTotalPeriods }}</strong> 節課
        <span class="detail-text">(每班 {{ assignment.periods }} 節 × 範圍內 {{ estimatedTotalPeriods / (assignment.periods || 1) }} 個班級)</span>
      </div>
      <div class="teacher-limit-text">
        📊 該教師配額上限：<strong>{{ teacherMaxPeriods }}</strong> 節
      </div>

      <div v-if="targetMode === 'specific_classes' && estimatedTotalPeriods > teacherMaxPeriods" class="danger-text">
        🚨 硬約束警告：您手動鎖定的班級節數 ({{ estimatedTotalPeriods }}) 已超出該教師法定上限 ({{ teacherMaxPeriods }})！這將導致排課衝突。
      </div>

      <div v-if="targetMode === 'grade_pool' && estimatedTotalPeriods > teacherMaxPeriods" class="info-text">
        🤖 AI 彈性分配池：您圈選的年級範圍大於教師配額上限。這很正常！統將在後續排課演算時，自動從此範圍中挑選班級，直到填滿 {{ teacherMaxPeriods }} 節為止。
      </div>
    </div>

    <div class="scheduling-settings">
      <h4>📋 排課設定</h4>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="assignment.allow_consecutive" />
          允許連堂 (兩節連上)
        </label>
      </div>
      <div class="form-group">
        <label>排課頻率：</label>
        <select v-model="assignment.period_type">
          <option value="fixed">每週固定 (如：1, 2, 3 節)</option>
          <option value="biweekly">隔週循環 (處理 1.5 節，隔週上 3 節)</option>
        </select>
      </div>
    </div>

    <div class="mode-selector">
      <h4>請選擇排課演算法綁定模式：</h4>
      <div class="radio-group">
        <label><input type="radio" value="specific_classes" v-model="targetMode" /> 📌 鎖定特定班級 (硬約束)</label>
        <label><input type="radio" value="grade_pool" v-model="targetMode" /> 📚 鎖定特定年級 (交給 AI 分配班級)</label>
        <label><input type="radio" value="free_agent" v-model="targetMode" /> 🕊️ 全校自由配課 (交給 AI 填補空缺)</label>
      </div>
    </div>

    <div class="target-matrix" v-if="targetMode !== 'free_agent'">
      <div v-if="targetMode === 'specific_classes'">
        <div v-for="grade in 6" :key="grade" class="grade-row" v-show="getGradeClassCount(grade) > 0">
          <div class="grade-label">{{ grade }} 年級</div>
          <div class="checkboxes">
            <label v-for="classNum in getGradeClassCount(grade)" :key="classNum"
                   class="cb-label"
                   :class="{ 'is-selected': selectedTargets.includes(`${grade}${classNum.toString().padStart(2, '0')}`) }">
              <input type="checkbox" :value="`${grade}${classNum.toString().padStart(2, '0')}`" v-model="selectedTargets" />
              {{ classNum }}班
              <span v-if="selectedTargets.includes(`${grade}${classNum.toString().padStart(2, '0')}`)" class="assigned-badge">✅ 已點選</span>
            </label>
          </div>
        </div>
      </div>

      <div v-if="targetMode === 'grade_pool'">
        <div class="checkboxes">
          <label v-for="grade in 6" :key="grade" class="cb-label grade-cb" v-show="getGradeClassCount(grade) > 0">
            <input type="checkbox" :value="grade.toString()" v-model="selectedTargets" /> 僅限 {{ grade }} 年級
          </label>
        </div>
      </div>
    </div>
    <div class="target-matrix free-agent-msg" v-else>
      💡 此模式下，系統將根據該教師的總節數配額，由 AI 自動尋找全校缺乏「{{ assignment.subject || '該' }}」科目的班級進行填補。
    </div>

    <button @click="submitBatch" class="submit-btn">🚀 儲存排課規則至大倉庫</button>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import { getSubjectGradeValidation, isSubjectApplicableToGrade } from '../utils/gradeSubjectUtils'

const scheduleStore = useScheduleStore()
const targetMode = ref('specific_classes')
const selectedTargets = ref([])
const assignment = ref({ subject: '', teacher: '', periods: 1, allow_consecutive: false, period_type: 'fixed' })

const isSmartAssigning = ref(false)
const smartAssignResult = ref(null)

const getGradeClassCount = (grade) => {
  const info = scheduleStore.schoolInfo || {};
  const configs = info.gradeSettings || info.gradeConfigs || {};
  return Number(configs[grade]) || 0;
};

const subjectTeachers = computed(() => {
  if (!scheduleStore.teachers) return []
  return scheduleStore.teachers.filter(t => t.type !== 'homeroom')
})

const teacherSubjects = computed(() => {
  if (!assignment.value.teacher) return []
  const teacher = scheduleStore.teachers.find(t => t.name === assignment.value.teacher)
  if (teacher && teacher.expertiseSubjects) {
    let expanded = [];
    const rawExp = Array.isArray(teacher.expertiseSubjects) ? teacher.expertiseSubjects : [teacher.expertiseSubjects];

    rawExp.forEach(sub => {
      if(!sub) return;
      const cleanSub = String(sub).replace(/["']/g, '');
      expanded.push(...cleanSub.split(/[、,,/]/).map(s => s.trim()).filter(Boolean));
    });
    return [...new Set(expanded)];
  }
  return []
})

const onTeacherChange = () => {
  const subjects = teacherSubjects.value
  const currentSubject = assignment.value.subject
  if (subjects.includes(currentSubject)) return
  assignment.value.subject = subjects.length === 1 ? subjects[0] : ''
}

const isSubjectMatch = (reqSub, teacherSub) => {
  if (!reqSub || !teacherSub) return false;

  const cleanReq = String(reqSub).replace(/["']/g, '').trim();
  const cleanTeacher = String(teacherSub).replace(/["']/g, '').trim();
  if (cleanReq === cleanTeacher) return true;

  const reqParts = cleanReq.split(/[、,,/]/).map(s => s.trim()).filter(Boolean);
  let teacherParts = cleanTeacher.split(/[、,,/]/).map(s => s.trim()).filter(Boolean);

   // 🚀 BugFix: 移除舊版 aliasMap，全面採用 V2 標準科目字典進行純字串比對
   return reqParts.some(r => teacherParts.some(t => r.includes(t) || t.includes(r)));
}

// 💡 【新增】提取班級年級的穩健函式，避免中文年級名稱導致解析失敗
const getGradeFromClassName = (className) => {
  const match = String(className).match(/(\d+)\s*(年|grade)/i) || String(className).match(/^(\d)/);
  return match ? parseInt(match[1], 10) : 1;
};

const loadExistingAssignment = () => {
  const tName = assignment.value.teacher;
  const sName = assignment.value.subject;
  if (!tName || !sName) {
    selectedTargets.value = [];
    return;
  }

  let foundTargets = [];
  let foundPeriods = 0;

  if (scheduleStore.classes) {
    scheduleStore.classes.forEach(c => {
      const req = c.course_requirements?.find(r => {
        if (!r.teacher || !r.subject) return false;
        const teacherMatch = r.teacher.trim() === tName.trim();
        const subjectMatch = isSubjectMatch(r.subject, sName);
        return teacherMatch && subjectMatch;
      });

      if (req) {
        const match = c.name.match(/(\d+)\s*(年|grade)\s*(\d+)\s*(班|class)/i) || c.name.match(/^(\d)(\d{1,2})/);
        if (match) {
          const code = match.length > 3 ? `${match[1]}${match[3].padStart(2, '0')}` : `${match[1]}${match[2].padStart(2, '0')}`;
          foundTargets.push(code);
        }
        if (foundPeriods === 0) foundPeriods = Number(req.periods);
      }
    });
  }

  if (foundTargets.length > 0) {
    targetMode.value = 'specific_classes';
    selectedTargets.value = [...foundTargets];
    assignment.value.periods = foundPeriods;
  } else {
    selectedTargets.value = [];
  }
};

watch(
  () => [assignment.value.teacher, assignment.value.subject],
  ([, newSubject]) => {
    assignment.value.allow_consecutive = false
    assignment.value.period_type = 'fixed'
    assignment.value.periods = 1

    if (newSubject === '自然') {
      assignment.value.allow_consecutive = true
    } else if (newSubject === '音樂' || newSubject === '美勞') {
      assignment.value.period_type = 'biweekly'
      assignment.value.periods = 3
    }
    loadExistingAssignment();
  }
)

const estimatedTotalPeriods = computed(() => {
  if (!assignment.value.periods) return 0;
  let classCount = 0;
  if (targetMode.value === 'specific_classes') {
    classCount = selectedTargets.value.length;
  } else if (targetMode.value === 'grade_pool') {
    selectedTargets.value.forEach(grade => {
      classCount += getGradeClassCount(grade);
    });
  } else {
    return 0;
  }
  return Number(assignment.value.periods) * classCount;
});

const teacherMaxPeriods = computed(() => {
  if (!assignment.value.teacher || !scheduleStore.teachers) return 0;
  const teacherData = scheduleStore.teachers.find(t => t.name === assignment.value.teacher);
  if (!teacherData) return 0;
  const base = Number(teacherData.base_periods || teacherData.max_periods || 20);
  const reduction = Number(teacherData.reduction || 0);
  const overtime = Number(teacherData.overtime || 0);
  return base - reduction + overtime;
});

const countUsedPeriods = (teacherName, classes) => {
  if (!classes) return 0
  let count = 0
  classes.forEach(cls => {
    if (cls.course_requirements) {
      cls.course_requirements.forEach(req => {
        if (req.teacher && req.teacher.trim() === teacherName.trim()) {
          count += Number(req.periods) || 0
        }
      })
    }
  })
  return count
}

// ============================================
// Step 1: 正確計算班級總節數（交替課不重複計算）
// ============================================
// 交替課的邏輯：「音樂美勞_交替(1)」代表一週上1節交替課
// 這 1 節會取代原本的固定音樂/美勞各 1 節
// 因此：若有交替課，固定音樂/美勞不應重複計算
// ============================================
const calculateClassTotalPeriods = (courseRequirements) => {
  if (!courseRequirements || !Array.isArray(courseRequirements)) return 0;

  let total = 0;
  let hasAlternating = false;

  // 第一趟：檢查是否有交替課
  courseRequirements.forEach(req => {
    if (req.subject && req.subject.includes('交替')) {
      hasAlternating = true;
    }
  });

  // 第二趟：計算總節數
  courseRequirements.forEach(req => {
    const subj = req.subject || '';
    const periods = Number(req.periods) || 0;

    if (subj.includes('交替')) {
      // 交替課正常計算（1節交替 = 1個時段格子）
      total += periods;
    } else if (hasAlternating && (subj.includes('音樂_固定') || subj.includes('美勞_固定'))) {
      // 當有交替課時，固定音樂/美勞不重複計算
      // （因為交替課已經取代了這些固定課的時段）
      total += 0;
    } else {
      total += periods;
    }
  });

  return total;
};

// ============================================
// Step 2: 交替課自動補償 — 調整固定科目節數
// ============================================
// 當班級同時有「音樂美勞_交替」+「音樂_固定」+「美勞_固定」時，
// 自動將固定音樂/美勞的節數設為 0，避免總節數超標。
// 同時確保總節數不超過年級上限（1-2年:23, 3-4年:29, 5-6年:32）
// ============================================
const adjustPeriodsForAlternating = (courseRequirements, grade) => {
  if (!courseRequirements || !Array.isArray(courseRequirements)) return;

  const maxPeriods = (grade <= 2) ? 23 : (grade <= 4) ? 29 : 32;

  // 檢查是否有交替課
  const alternatingReq = courseRequirements.find(req =>
    req.subject && req.subject.includes('交替')
  );

  if (!alternatingReq) return;

  // 有交替課 → 將固定音樂/美勞節數設為 0
  let adjusted = false;
  courseRequirements.forEach(req => {
    const subj = req.subject || '';
    if (subj.includes('音樂_固定') || subj.includes('美勞_固定')) {
      if (Number(req.periods) > 0) {
        req.periods = 0;
        adjusted = true;
      }
    }
  });

  // 檢查總節數是否仍然超標
  const totalAfterAdjust = calculateClassTotalPeriods(courseRequirements);
  if (totalAfterAdjust > maxPeriods) {
    console.warn(`⚠️ [交替補償] 即使調整後總節數(${totalAfterAdjust})仍超過上限(${maxPeriods})，需手動檢查課程設定`);
  }

  if (adjusted) {
    console.log(`✅ [交替補償] 已將固定音樂/美勞節數設為 0（交替課已取代）`);
  }
};

// 🚀 新增：存放診斷日誌的變數與下載函式
const diagnosticLog = ref('');

const downloadDiagnosticLog = () => {
  const bom = '\uFEFF';
  const blob = new Blob([bom + diagnosticLog.value], { type: 'text/plain;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `東門國小_科任配課診斷報告_${new Date().getTime()}.txt`;
  link.click();
}

// 💡 志願序層級計算 (1: 志願1, 2: 志願2, 3: 志願3, 4: 無志願)
function getGradePreferenceRank(teacher, grade) {
  const pref1 = teacher.pref_grade1 ?? teacher.gradePreferences?.[0] ?? null;
  const pref2 = teacher.pref_grade2 ?? teacher.gradePreferences?.[1] ?? null;
  const pref3 = teacher.pref_grade3 ?? teacher.gradePreferences?.[2] ?? null;

  if (pref1 !== null && Number(pref1) === Number(grade)) return 1;
  if (pref2 !== null && Number(pref2) === Number(grade)) return 2;
  if (pref3 !== null && Number(pref3) === Number(grade)) return 3;
  return 4;
}

// ⚖️ 智慧尋找最佳教師（志願序優先 + 負載平衡 + 穩定排序機制）
function findBestTeacher(subjectName, requiredPeriods, teachersList, loadTracker, quotaMap, grade) {
  // 1. 找出所有具備該專長的老師
  let candidates = teachersList.filter(t => {
    if (t.type === 'homeroom') return false;
    let expandedExpertise = [];
    const rawExp = Array.isArray(t.expertiseSubjects) ? t.expertiseSubjects : (t.expertiseSubjects ? [t.expertiseSubjects] : []);
    rawExp.forEach(sub => {
      if (!sub) return;
      const cleanSub = String(sub).replace(/["']/g, '');
      expandedExpertise.push(...cleanSub.split(/[、,,/]/).map(s => s.trim()).filter(Boolean));
    });
    return expandedExpertise.some(sub => isSubjectMatch(subjectName, sub));
  });

  // 2. 🛡️ 配額防護網：過濾掉接了這堂課就會超過上限的老師
  candidates = candidates.filter(t => {
    const currentLoad = loadTracker[t.name] || 0;
    const maxQuota = quotaMap[t.name]?.maxPeriods || 20;
    return (currentLoad + requiredPeriods) <= maxQuota;
  });

  // 3. ⚖️ 志願序與負載雙軌排序 (含姓名 tie-breaker 穩定排序)
  candidates.sort((a, b) => {
    const rankA = getGradePreferenceRank(a, grade);
    const rankB = getGradePreferenceRank(b, grade);
    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const loadA = loadTracker[a.name] || 0;
    const loadB = loadTracker[b.name] || 0;
    if (loadA !== loadB) {
      return loadA - loadB;
    }

    return String(a.name).localeCompare(String(b.name));
  });

  // 4. 回傳最佳老師；如果全部都爆滿了，回傳 null
  if (candidates.length > 0) {
    return candidates[0];
  }
  return null;
}

// 🚀 智慧自動配課主函數 (套用新配額機制與評分公式)
const smartSubjectAssignment = () => {
  isSmartAssigning.value = true
  smartAssignResult.value = null
  diagnosticLog.value = '=== 🚀 東門國小科任自動配課診斷日誌 ===\n\n'

  setTimeout(async () => {
    let processedCount = 0
    let assignedCount = 0
    let skippedCount = 0

    const teachers = scheduleStore.teachers || []

    // 🆕 片段 B：建立集中的 teacherQuotaMap
    diagnosticLog.value += '【1. 初始教師配額狀態檢查】\n'
    const teacherQuotaMap = {};
    teachers.forEach(t => {
      const roleGroup = t.type || 'subject';
      const base = Number(t.base_periods || t.max_periods ||
        (scheduleStore.schoolInfo?.periodDefaults?.[roleGroup] || 20));
      const reduction = Number(t.reduction || 0);
      const overtime = Number(t.overtime || 0);
      const used = countUsedPeriods(t.name, scheduleStore.classes);

      teacherQuotaMap[t.name] = {
        base, reduction, overtime,
        maxPeriods: base - reduction + overtime,
        used,
        remaining: Math.max(0, base - reduction + overtime - used)
      };

      if (t.type !== 'homeroom') {
        diagnosticLog.value += `- [${t.name}]: 上限 ${teacherQuotaMap[t.name].maxPeriods} 節 | 已排 ${used} 節 | 剩餘 ${teacherQuotaMap[t.name].remaining} 節\n`
      }
    });
    diagnosticLog.value += '-----------------------------------\n\n'

    const classes = scheduleStore.classes || []
    const assignments = []

    classes.forEach(cls => {
      if (!cls.course_requirements) return
      const grade = getGradeFromClassName(cls.name)
      cls.course_requirements.forEach(req => {
        if (req.defaultTeacher === 'subject' && (!req.teacher || req.teacher.trim() === '')) {
          const periods = Number(req.periods) || 0
          const sub = req.subject || ''

          // 🔒 雙層過濾：0 節不配課 + 年級適用性檢查
          // 1. 0 節過濾 (排除所有節數為 0 的科目需求)
          if (periods <= 0) return

          // 2. 年級適用性硬限制 (使用統一工具函數)
          if (!isSubjectApplicableToGrade(sub, grade)) return

          assignments.push({
            clsName: cls.name,
            clsGrade: grade,
            subject: sub,
            periods: periods,
            reqRef: req
          })
        }
      })
    })

    // ================================================
    // 步驟 1：建立即時負載追蹤表 (Load Tracker)
    // ================================================
    // 直接從 teacherQuotaMap 取得已排節數（countUsedPeriods 已算過所有 hand-assigned 的課）
    const teacherLoads = {};
    teachers.forEach(t => {
      teacherLoads[t.name] = teacherQuotaMap[t.name]?.used || 0;
    });

    diagnosticLog.value += `【2. 負載追蹤表初始化完成】\n`;
    Object.entries(teacherLoads).forEach(([name, load]) => {
      if (load > 0) {
        diagnosticLog.value += `  - ${name}: 目前負載 ${load} 節\n`;
      }
    });
    diagnosticLog.value += `  共發現 ${assignments.length} 筆空缺待配\n\n`;

    // ================================================
    // 步驟 2 & 3：主迴圈 - Round-Robin 均分 + 即時更新負載
    // ================================================
    for (const task of assignments) {
      processedCount++;
      diagnosticLog.value += `🎯 處理：[${task.clsName} - ${task.subject}] (需 ${task.periods} 節) | 剩餘待配：${assignments.length - processedCount} 筆\n`;

      // 使用 findBestTeacher (志願序優先 + 負載均分)
      const bestTeacher = findBestTeacher(task.subject, task.periods, teachers, teacherLoads, teacherQuotaMap, task.clsGrade);

      if (bestTeacher) {
        // 設定教師
        bestTeacher.assignedClass = task.clsName;
        task.reqRef.teacher = bestTeacher.name;

        // ✅ 關鍵：配課成功後，立刻增加該老師的負載
        teacherLoads[bestTeacher.name] = (teacherLoads[bestTeacher.name] || 0) + task.periods;

        // 同步更新配額 Map
        teacherQuotaMap[bestTeacher.name].remaining = Math.max(0, teacherQuotaMap[bestTeacher.name].maxPeriods - teacherLoads[bestTeacher.name]);
        teacherQuotaMap[bestTeacher.name].used = teacherLoads[bestTeacher.name];

        assignedCount++;

        diagnosticLog.value += `   ✅ 指派 → ${bestTeacher.name}\n`;
        diagnosticLog.value += `      目前負載: ${teacherLoads[bestTeacher.name]} 節 | 配額上限: ${teacherQuotaMap[bestTeacher.name].maxPeriods} 節 | 剩餘: ${teacherQuotaMap[bestTeacher.name].remaining} 節\n\n`;
      } else {
        skippedCount++;
        diagnosticLog.value += `   ⚠️ 無法為 ${task.clsName} 的 ${task.subject} 找到合適的老師 (可能專長不符或配額皆已滿)\n\n`;
      }
    }

    // ================================================
    // 步驟 4：交替課自動補償 — 確保總節數不超標
    // ================================================
    diagnosticLog.value += '\n【3. 交替課自動補償檢查】\n';
    let compensationCount = 0;
    classes.forEach(cls => {
      if (!cls.course_requirements) return;
      const grade = getGradeFromClassName(cls.name);
      const beforeTotal = calculateClassTotalPeriods(cls.course_requirements);
      adjustPeriodsForAlternating(cls.course_requirements, grade);
      const afterTotal = calculateClassTotalPeriods(cls.course_requirements);

      if (beforeTotal !== afterTotal) {
        compensationCount++;
        diagnosticLog.value += `  ✅ [${cls.name}] 已補償調整: ${beforeTotal}節 → ${afterTotal}節\n`;
      }
    });
    if (compensationCount === 0) {
      diagnosticLog.value += '  無需調整（無交替課或已符合規範）\n';
    }
    diagnosticLog.value += `  共調整 ${compensationCount} 個班級\n`;
    diagnosticLog.value += '=== 🏁 診斷完畢 ===\n'
    scheduleStore.markScheduleDirty()

    try {
      await scheduleStore.syncToCloud()
      smartAssignResult.value = {
        successMsg: `智慧配課完成！成功指派 ${assignedCount} 筆。`,
        processedCount, assignedCount, skippedCount
      }
    } catch (error) {
      console.error('同步失敗:', error)
    } finally {
      isSmartAssigning.value = false
    }
  }, 100)
}

const submitBatch = async () => {
  if (!assignment.value.teacher || !assignment.value.subject) { alert('請選擇教師與科目！'); return }
  if (targetMode.value !== 'free_agent' && selectedTargets.value.length === 0) { alert('請勾選目標班級或年級！'); return }

  if (targetMode.value === 'specific_classes' && estimatedTotalPeriods.value > teacherMaxPeriods.value) {
    const confirmBlast = confirm(`🚨 嚴重警告：節數超標！\n您確定要強行儲存嗎？`);
    if (!confirmBlast) return;
  }

  const tName = assignment.value.teacher.trim();
  const sName = assignment.value.subject.trim();
  const newPeriods = Number(assignment.value.periods);
  let updatedCount = 0;
  let skippedCount = 0;
  let diagnosticLogContent = '';

  const targetClassNames = selectedTargets.value.map(code => {
    const grade = code.charAt(0);
    const classNum = parseInt(code.substring(1), 10);
    return `${grade}年${classNum}班`;
  });

  if (scheduleStore.classes && targetMode.value !== 'free_agent') {
    scheduleStore.classes.forEach(c => {
      let isTarget = false;
      if (targetMode.value === 'specific_classes') {
        isTarget = targetClassNames.includes(c.name);
      } else if (targetMode.value === 'grade_pool') {
        const classGrade = c.name.charAt(0);
        isTarget = selectedTargets.value.includes(classGrade);
      }

      const classGrade = getGradeFromClassName(c.name);
      const gradeValidation = getSubjectGradeValidation(sName, classGrade);
      if (!gradeValidation.allowed) {
        skippedCount++;
        diagnosticLog.value += `   ⚠️ 跳過 ${c.name} - ${sName}：${gradeValidation.reason}\n\n`;
        return;
      }

      let reqIndex = c.course_requirements?.findIndex(r => r.subject && isSubjectMatch(r.subject, sName));

      if (isTarget) {
        // 🛡️ 防呆：檢查 timetable 中已鎖定的節數是否大於 newPeriods
        let lockedCount = 0;
        if (c.timetable) {
          if (Array.isArray(c.timetable)) {
            for (const day of c.timetable) {
              if (Array.isArray(day)) {
                for (const cell of day) {
                  if (cell && cell.isLocked && isSubjectMatch(cell.subject, sName)) {
                    lockedCount++;
                  }
                }
              }
            }
          } else if (typeof c.timetable === 'object') {
            for (const d of Object.keys(c.timetable)) {
              for (const p of Object.keys(c.timetable[d] || {})) {
                const cell = c.timetable[d][p];
                if (cell && cell.isLocked && isSubjectMatch(cell.subject, sName)) {
                  lockedCount++;
                }
              }
            }
          }
        }
        
        if (lockedCount > newPeriods) {
          skippedCount++;
          diagnosticLogContent += `   ⚠️ 拒絕更新 ${c.name} - ${sName}：此科目在課表上已被鎖定 ${lockedCount} 節，不可將需求節數下修至 ${newPeriods} 節。請先解鎖課表！\n\n`;
          return;
        }

        if (reqIndex !== -1 && reqIndex !== undefined) {
           const newReqs = [...c.course_requirements];
           newReqs[reqIndex] = { ...newReqs[reqIndex], teacher: tName, periods: newPeriods };
           c.course_requirements = newReqs;
        } else {
          if (!c.course_requirements) c.course_requirements = [];
          c.course_requirements.push({ subject: sName, periods: newPeriods, teacher: tName, defaultTeacher: 'subject' });
        }
        updatedCount++;
      } else {
        if (reqIndex !== -1 && reqIndex !== undefined) {
          const req = c.course_requirements[reqIndex];
          if (req.teacher && req.teacher.trim() === tName) {
            const newReqs = [...c.course_requirements];
            newReqs[reqIndex] = { ...newReqs[reqIndex], teacher: '' };
            c.course_requirements = newReqs;
          }
        }
      }
    });
  }

  scheduleStore.markScheduleDirty();
  await scheduleStore.syncToCloud();
  alert(`✅ 成功派發並同步！影響班級數：${updatedCount} 班`);
}

</script>

<style scoped>
.batch-assignment-container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-top: 15px;}
.form-grid { display: flex; gap: 20px; margin-bottom: 20px; }
.form-group { display: flex; flex-direction: column; gap: 5px; min-width: 150px;}

/* 🚀 智慧配課區域樣式 */
.smart-assignment-section { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; margin-bottom: 20px; color: white; }
.smart-assignment-section h4 { margin: 0 0 8px 0; font-size: 1.2em; }
.section-desc { font-size: 0.9em; opacity: 0.9; margin: 0 0 12px 0; }
.smart-btn { background: white; color: #667eea; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1em; transition: all 0.3s; }
.smart-btn:hover { background: #f0f0ff; transform: scale(1.02); }
.smart-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
.result-box { margin-top: 12px; padding: 12px; background: rgba(255,255,255,0.2); border-radius: 8px; }
.result-success { font-weight: bold; margin: 0 0 4px 0; }
.result-detail { font-size: 0.9em; opacity: 0.9; margin: 0; }

.mode-selector { margin-bottom: 20px; background: #eef2ff; padding: 15px; border-radius: 8px; border-left: 4px solid #6366f1; }
.radio-group { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.radio-group label { cursor: pointer; font-weight: bold; color: #374151; }
.target-matrix { background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px; min-height: 80px;}
.free-agent-msg { display: flex; align-items: center; color: #059669; font-weight: bold; background: #d1fae5; border: 1px solid #10b981; }
.grade-row { display: flex; align-items: center; padding: 8px 0; border-bottom: 1px dashed #cbd5e1; }
.grade-row:last-child { border-bottom: none; }
.grade-label { width: 80px; font-weight: bold; color: #475569; }
.checkboxes { display: flex; gap: 15px; flex-wrap: wrap; }

.cb-label {
  cursor: pointer; display: flex; align-items: center; gap: 5px;
  padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px;
  transition: all 0.2s; background: white;
}
.cb-label:hover { background-color: #f8fafc; }
.cb-label.is-selected { background-color: #d1fae5; border-color: #10b981; color: #065f46; font-weight: bold; }
.assigned-badge { font-size: 0.85em; margin-left: 4px; }

.grade-cb { padding: 8px 16px; background: #fff; border: 1px solid #cbd5e1; border-radius: 20px; }
.submit-btn { background-color: #8b5cf6; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; width: 100%; font-size: 16px; font-weight: bold; margin-top: 15px;}
.submit-btn:hover { background-color: #7c3aed; }
.estimation-box { background: #fffbeb; border: 1px solid #f59e0b; border-left: 5px solid #f59e0b; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
.estimation-content { font-size: 1.1em; color: #92400e; }
.detail-text { font-size: 0.85em; color: #b45309; margin-left: 10px; }
.teacher-limit-text { font-size: 0.9em; color: #475569; margin-top: 5px; margin-bottom: 5px; }
.danger-text { margin-top: 10px; color: #b91c1c; font-weight: bold; display: flex; align-items: center; gap: 5px; }
.info-text { margin-top: 10px; color: #0369a1; font-weight: bold; display: flex; align-items: center; gap: 5px; background: #e0f2fe; padding: 10px; border-radius: 6px; border-left: 4px solid #0284c7; }
</style>
