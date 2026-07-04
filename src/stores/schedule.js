import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { computeExpectedClassNames, computeClassDiff, checkClassHasData, createMinimalClass } from '../composables/useClassSync'
import { buildScheduleAiReport, flattenClassTimetablesToEntries } from '../utils/scheduleAiReport'
import { sanitizeRequirementsByGrade } from '../utils/gradeSubjectUtils'
import { normalizeCoPlanningSettings } from '../utils/coPlanningSettings'

export const useScheduleStore = defineStore('simpleSchedule', () => {

  // 優先使用相對路徑走 Vite proxy；僅在生產環境 (非 localhost) 時才 fallback 到絕對 URL
  const API_BASE = import.meta.env.VITE_API_BASE_URL && !import.meta.env.DEV
    ? import.meta.env.VITE_API_BASE_URL
    : '/api';

  /**
   * 从班级名称提取年级数字（如 "3年1班" → 3）
   */
  const getGradeFromClassName = (className) => {
    const match = String(className).match(/(\d+)\s*(年|grade)/i) || String(className).match(/^(\d)/);
    return match ? parseInt(match[1], 10) : 1;
  };


  /**
   * 🔧 教室科目名稱 normalization — 統一為 canonical key
   */
  const normalizeRoomSubject = (subj) => {
    if (!subj) return '';
    const s = String(subj).trim();
    if (s === '英語') return '語文-英語';
    if (s === '自然') return '自然科學';
    if (s === '科技-資訊' || s === '電腦') return '資訊';
    if (s === '健康與體育') return '體育';
    if (s === '本土語言' || s === '閩南語' || s === '客語') return '本土語';
    return s;
  };

  /**
   * 🆕 Phase 1: 從 standardDomainSettings 產生 subjectGradeRules 初值
   */
  function migrateSubjectGradeRules(standardDomainSettings) {
    const rules = {}
    for (const entry of standardDomainSettings) {
      const grades = Object.entries(entry.periods || {})
        .filter(([, p]) => Number(p) > 0)
        .map(([g]) => parseInt(g, 10))
      if (grades.length > 0) {
        rules[entry.name] = grades
      }
    }
    return rules
  }

  const sanitizeClassRequirements = (classData) => {
    if (!classData) return classData;
    const grade = Number(classData.grade || getGradeFromClassName(classData.name));
    if (!Array.isArray(classData.course_requirements)) {
      return {
        ...classData,
        grade,
        removedRequirements: [],
      };
    }

    const { requirements, removed } = sanitizeRequirementsByGrade(classData.course_requirements, grade);
    return {
      ...classData,
      grade,
      course_requirements: requirements,
      removedRequirements: removed,
    };
  };

  const normalizeDiagnosticLine = (line) => String(line || '').replace(/\r/g, '').trim();

  const normalizeDiagnosticWarningDetail = (item) => {
    if (!item || typeof item !== 'object') return null;
    const message = normalizeDiagnosticLine(item.message);
    if (!message) return null;
    const level = String(item.level || 'warn').trim().toLowerCase() || 'warn';
    const category = String(item.category || 'generic_infeasible').trim() || 'generic_infeasible';
    const displayText = normalizeDiagnosticLine(item.displayText || `[${level.toUpperCase()}] ${message}`);
    return {
      level,
      category,
      message,
      displayText,
      rawLine: normalizeDiagnosticLine(item.rawLine),
      contextLine: normalizeDiagnosticLine(item.contextLine),
    };
  };

  const normalizeDiagnosticWarningDetails = (input) => (
    Array.isArray(input)
      ? input.map((item) => normalizeDiagnosticWarningDetail(item)).filter(Boolean)
      : []
  );

  const isDiagnosticWarningLine = (line) => {
    const normalized = normalizeDiagnosticLine(line);
    if (!normalized) return false;
    if (normalized.startsWith('===') && normalized.includes('診斷報告')) return false;
    if (/\[OK\]/i.test(normalized) || /\[INFO\]/i.test(normalized)) return false;
    return (
      /\[(WARN|ERROR|ALERT)\]/i.test(normalized)
      || normalized.includes('⚠️')
      || normalized.includes('❌')
      || normalized.includes('🚨')
    );
  };

  const extractDiagnosticWarningLines = (input) => {
    const sourceLines = Array.isArray(input)
      ? input
      : String(input || '').split('\n');
    const deduped = [];
    const seen = new Set();

    sourceLines.forEach((line) => {
      const normalized = normalizeDiagnosticLine(line);
      if (!isDiagnosticWarningLine(normalized) || seen.has(normalized)) return;
      seen.add(normalized);
      deduped.push(normalized);
    });

    return deduped;
  };

  const buildGenericDiagnosticFallback = () => ([
    '⚠️ 排課引擎無法找到可辨識的診斷警示，請優先檢查班級課程需求、教師配額與專科教室容量。',
  ]);

  const loadDiagnosticWarningsFromReport = async () => {
    try {
      const reportRes = await fetch(`${API_BASE}/debug-infeasible-report`);
      if (!reportRes.ok) return buildGenericDiagnosticFallback();

      const reportData = await reportRes.json();
      const warningLines = extractDiagnosticWarningLines(reportData.content || '');
      return warningLines.length > 0 ? warningLines : buildGenericDiagnosticFallback();
    } catch (_) {
      return buildGenericDiagnosticFallback();
    }
  };

  const schoolInfo = ref({
    name: '',
    academic_year: '115', semester: '上學期',
    periodDefaults: { homeroom: 15, subject: 19, admin: 6 },
    gradeSettings: { '1': 3, '2': 3, '3': 3, '4': 3, '5': 3, '6': 3 },
    alternativeMatrix: { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] },
    classExceptions: [],
    classroomLimits: { '自然科學': 3, '語文-英語': 3, '音樂': 3, '美勞': 3, '體育': 6, '資訊': 1 },
    // 🔧 修復 B (RC-CONF-01 輔因)：接收 solver 輸出的 gradeCapacityMap
    // 過渡方案：solver → gradeCapacityMap → store cache → frontend consumer
    gradeMaxPeriods: null,
    subjectClassroomGrades: {
      '語文-英語': [2, 3, 4, 5, 6],
      '音樂': [3, 4, 5, 6],
      '美勞': [3, 4, 5, 6],
      '自然科學': [3, 4, 5, 6]
    },
    // 🆕 Phase 1: 科目可排年級規則 — 控制哪些科目可以排在哪些年級
    subjectGradeRules: {
      '生活': [1, 2],
      '自然科學': [3, 4, 5, 6],
      '音樂': [3, 4, 5, 6],
      '美勞': [3, 4, 5, 6],
      '社會': [3, 4, 5, 6],
      '綜合活動': [3, 4, 5, 6],
      '科技-資訊': [3, 4, 5, 6],
      '語文-英語': [1, 2, 3, 4, 5, 6]
    },
    // 🆕 [2026-06-28] 五六年級共備設定
    coPlanningSettings: {
      enabled: false,
      grades: [5, 6],
      mode: "auto",
      candidateBlocks: [],
      manualBlocks: { "5": null, "6": null }
    }
  });

  const teachers = ref([]);
  const classes = ref([]);
  const specialCourses = ref([]);
  const classrooms = ref([]);

  // 🚀 補上這段：宣告 AI 硬約束設定
  const aiSettings = ref({
    naturalConsecutive: true,
    grade12AfternoonOff: true,
    allowTeacherOverlap: false,
    swimmingCapEnabled: true,
    artsClassEnabled: false,  // 藝才班特規排課模組開關
    grade12TuesdayAfternoonHomeroom: false,  // 1-2年級週二下午排導師課
    homeroomBlockizationEnabled: true  // 導師科目自動區塊化
  });

  const standardDomainSettings = ref([
    { id: '1', name: '語文-國語', defaultTeacher: 'homeroom', color: '#fca5a5', periods: { 1: 6, 2: 6, 3: 5, 4: 5, 5: 5, 6: 5 } },
    { id: '2', name: '語文-本土語', defaultTeacher: 'subject', color: '#f87171', periods: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 } },
    { id: '3', name: '語文-英語', defaultTeacher: 'subject', color: '#ef4444', periods: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2 } },
    { id: '4', name: '數學', defaultTeacher: 'homeroom', color: '#60a5fa', periods: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 } },
    { id: '5', name: '生活', defaultTeacher: 'homeroom', color: '#fde047', periods: { 1: 6, 2: 6, 3: 0, 4: 0, 5: 0, 6: 0 } },
    { id: '6', name: '自然科學', defaultTeacher: 'subject', color: '#4ade80', periods: { 1: 0, 2: 0, 3: 3, 4: 3, 5: 3, 6: 3 } },
    { id: '7', name: '社會', defaultTeacher: 'homeroom', color: '#fb923c', periods: { 1: 0, 2: 0, 3: 3, 4: 3, 5: 3, 6: 3 } },
    { id: '8a', name: '健康', defaultTeacher: 'homeroom', color: '#c084fc', periods: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 } },
    { id: '8b', name: '體育', defaultTeacher: 'subject', color: '#a855f7', periods: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 } },
    // 替換在這裡：將「藝術」拆分成「音樂(1.5節)」與「美勞(1.5節)」
    { id: '9', name: '音樂', defaultTeacher: 'subject', color: '#fbcfe8', periods: { 1: 0, 2: 0, 3: 1.5, 4: 1.5, 5: 1.5, 6: 1.5 } },
    { id: '12', name: '美勞', defaultTeacher: 'subject', color: '#f472b6', periods: { 1: 0, 2: 0, 3: 1.5, 4: 1.5, 5: 1.5, 6: 1.5 } },

    { id: '10', name: '綜合活動', defaultTeacher: 'homeroom', color: '#a78bfa', periods: { 1: 0, 2: 0, 3: 2, 4: 2, 5: 2, 6: 2 } },
    { id: '11', name: '科技-資訊', defaultTeacher: 'subject', color: '#94a3b8', periods: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 1 } }
  ]);

  const syncStatus = ref('saved');
  const lastSavedTime = ref(null);
  const editingTeacherId = ref(null);
  const isInitialized = ref(false);

  // --- 🚀 排課引擎狀態管理 ---
  const engineStatus = ref('IDLE'); // IDLE, PROCESSING, COMPLETED, ERROR
  const engineJobId = ref(null);
  const engineErrorMessage = ref('');
  const engineResult = ref(null);
  // 🔍 AI 診斷分析結果
  const engineAiAnalysis = ref([]);
  const engineDiagnosticWarningDetails = ref([]);
  const engineDiagnosticWarnings = computed(() => (
    engineDiagnosticWarningDetails.value.length > 0
      ? engineDiagnosticWarningDetails.value.map((item) => item.displayText).filter(Boolean)
      : extractDiagnosticWarningLines(engineAiAnalysis.value)
  ));

  // --- 🔄 排課進度狀態 (持久化輪詢) ---
  const enginePhase = ref(''); // QUEUED, PROCESSING, SOLVING, REPAIRING, FINALIZING, COMPLETED, FAILED
  const engineMessage = ref('');
  const engineStartedAt = ref(null);
  const engineFinishedAt = ref(null);
  const engineElapsedSeconds = ref(0);
  const engineLastUpdated = ref(null);
  const enginePollingActive = ref(false);
  const engineNetworkRetry = ref(0); // 網路重試次數
  let pollTimer = null; // 轮询定时器引用，用於清理

  // 🚀 修復問題 1：新增 teacherQuotas 計算屬性
  const teacherQuotas = computed(() => {
    return teachers.value.map(t => {
      const roleGroup = t.type || 'subject'; // 預設為專任
      const base = schoolInfo.value.periodDefaults?.[roleGroup] || 20;
      const reduction = Number(t.reduction) || 0;
      const overtime = Number(t.overtime) || 0;

      // 自動統計該教師在「全校班級」中已經排了多少節課
      let assignedCount = 0;
      classes.value.forEach(cls => {
        cls.course_requirements?.forEach(req => {
          if (req.teacher && req.teacher.trim() === t.name.trim()) {
            assignedCount += Number(req.periods || 0);
          }
        });
      });

      return {
        name: t.name,
        roleGroup: roleGroup,
        reduction: reduction,
        overtime: overtime,
        maxPeriods: base - reduction + overtime, // 計算最大配額
        assigned: assignedCount
      };
    });
  });

  const allAvailableSubjects = computed(() => {
    let subjects = standardDomainSettings.value.map(s => ({ name: s.name, color: s.color }));
    if (schoolInfo.value.alternativeMatrix) {
      Object.values(schoolInfo.value.alternativeMatrix).forEach(altList => {
        if (Array.isArray(altList)) {
          altList.forEach(alt => {
            if (alt.subject && !subjects.find(s => s.name === alt.subject)) {
              subjects.push({ name: alt.subject, color: '#e2e8f0' });
            }
          });
        }
      });
    }
    return subjects;
  });

  const getSubjectColor = (subjectName) => {
    const subj = allAvailableSubjects.value.find(s => s.name === subjectName);
    return subj ? subj.color : '#e2e8f0';
  };

  const markScheduleDirty = () => { syncStatus.value = 'unsaved'; };

  const loadFromDB = async (force = false) => {
    // 🚀 智慧門神：只有在真的有資料且非強制更新時才攔截
    // 🚀 修復：增加 standardDomainSettings 檢查，防止錯誤結構被快取
    if (isInitialized.value && !force && teachers.value.length > 0 && standardDomainSettings.value.length > 0) return;
    if (force) isInitialized.value = false;
    try {
      const response = await fetch(`${API_BASE}/schedule`);
      const data = await response.json();

// 🔧 [Step 4-B] 專科教室容量防禦性合併：確保 classroomLimits 不缺鍵
      const DEFAULT_CLASSROOM_LIMITS = { '自然科學': 3, '語文-英語': 3, '音樂': 3, '美勞': 3, '體育': 6, '資訊': 1  };
      const DEFAULT_SUBJECT_CLASSROOM_GRADES = {
        '語文-英語': [2, 3, 4, 5, 6],
        '音樂': [3, 4, 5, 6],
        '美勞': [3, 4, 5, 6],
        '自然科學': [3, 4, 5, 6]
      };
      if (data.schoolInfo) {
        // 🆕 Phase 1: Migration — if DB has no subjectGradeRules, generate from standardDomainSettings
        const dbGradeRules = data.schoolInfo?.subjectGradeRules;
        let mergedGradeRules = dbGradeRules && Object.keys(dbGradeRules).length > 0
          ? dbGradeRules
          : null;

        schoolInfo.value = {
          ...schoolInfo.value,
          ...data.schoolInfo,
          classroomLimits: {
            ...DEFAULT_CLASSROOM_LIMITS,
            ...(data.schoolInfo?.classroomLimits ?? {}),
          },
          subjectClassroomGrades: {
            ...DEFAULT_SUBJECT_CLASSROOM_GRADES,
            ...(data.schoolInfo?.subjectClassroomGrades ?? {}),
          },
          // If DB already has subjectGradeRules, use it; will be filled by migration below if needed
          subjectGradeRules: mergedGradeRules || schoolInfo.value.subjectGradeRules
        };
      }

      // 🆕 Phase 1: After loading standardDomainSettings, migrate subjectGradeRules if still empty
      if (!schoolInfo.value.subjectGradeRules || Object.keys(schoolInfo.value.subjectGradeRules).length === 0) {
        const migrated = migrateSubjectGradeRules(standardDomainSettings.value);
        if (Object.keys(migrated).length > 0) {
          schoolInfo.value.subjectGradeRules = migrated;
        }
      }

      // [2026-06-28] Normalize coPlanningSettings from DB using central normalizer
      if (data.schoolInfo) {
        schoolInfo.value.coPlanningSettings = normalizeCoPlanningSettings(data.schoolInfo.coPlanningSettings);
      }

      // 🌟 關鍵修復：從資料庫讀取教師資料時，強制將 JSON 字串解析回陣列
      if (data.teachers) {
        teachers.value = data.teachers.map(t => {
          let parsedUnavailable = t.unavailable_slots;
          if (typeof parsedUnavailable === 'string') {
            try { parsedUnavailable = JSON.parse(parsedUnavailable); } catch { parsedUnavailable = []; }
          }

          // 🚀 Phase 2: 解析 expertise_allocations（專長+配額結構）
          let parsedAllocations = t.expertise_allocations;
          if (typeof parsedAllocations === 'string') {
            try { parsedAllocations = JSON.parse(parsedAllocations); } catch { parsedAllocations = []; }
          }
          // 確保 expertise_allocations 是有效的陣列物件格式 [{subject, quota}, ...]
          const expertiseAllocations = Array.isArray(parsedAllocations) ? parsedAllocations : [];

          let parsedExpertise = t.expertiseSubjects;
          if (typeof parsedExpertise === 'string') {
            try { parsedExpertise = JSON.parse(parsedExpertise); } catch { parsedExpertise = []; }
          }
          // 若沒有舊版 expertiseSubjects 但有 allocations，從 allocations 提取科目名稱作為備份
          const expertiseSubjects = Array.isArray(parsedExpertise)
            ? parsedExpertise
            : (expertiseAllocations.length > 0 ? expertiseAllocations.map(a => a.subject) : []);

          let parsedGradePrefs = t.gradePreferences;
          if (typeof parsedGradePrefs === 'string') {
            try { parsedGradePrefs = JSON.parse(parsedGradePrefs); } catch { parsedGradePrefs = []; }
          }

          return sanitizeClassRequirements({
            ...t,
            unavailable_slots: Array.isArray(parsedUnavailable) ? parsedUnavailable : [],
            expertiseSubjects,
            expertise_allocations: expertiseAllocations,
            gradePreferences: Array.isArray(parsedGradePrefs) ? parsedGradePrefs : []
          });
        });
      }

      // 👇 🌟 關鍵修復：防彈級的 JSON 解析，確保從資料庫回來的 timetable 絕對是前端能讀的 Object！
     if (data.classes) {
        // 🚀 終極修復：資料庫欄位與前端欄位翻譯機 (Data Translator)
        classes.value = data.classes.map(c => {
          // 1. 修復導師：將資料庫回傳的 ID (數字) 轉換回真實姓名，讓畫面能正常顯示
          let htName = c.homeroom_teacher || c.homeroom_teacher_id;
          if (typeof htName === 'number' || (typeof htName === 'string' && !isNaN(htName))) {
            const tObj = teachers.value.find(t => String(t.id) === String(htName));
            if (tObj) htName = tObj.name;
          } else if (typeof htName === 'object' && htName !== null) {
            htName = htName.name;
          }

          return {
            ...c,
            homeroom_teacher: htName, // 確保前端拿到的是純文字姓名
            conflicts: c.conflicts || {}, // 🆕 還原衝堂資料

            // 2. 修復科任：將 DB 的 teacher_name 映射回前端需要的 teacher 欄位
            course_requirements: (c.course_requirements || []).map(req => ({
              ...req,
              teacher: req.teacher_name || req.teacher || ''
            }))
          };
        });
      }

      if (data.specialCourses) specialCourses.value = data.specialCourses;
      // 🔧 normalization：載入教室資料時，將舊資料的科目名稱統一為 canonical key
      // 🆕 [gradePreferences] 同步解析優先年級欄位
      if (data.classrooms) {
        classrooms.value = data.classrooms.map(room => {
          let gp = room.gradePreferences;
          if (typeof gp === 'string') {
            try { gp = JSON.parse(gp); } catch { gp = []; }
          }
          return {
            ...room,
            subject: normalizeRoomSubject(room.subject),
            gradePreferences: Array.isArray(gp) ? gp : []
          };
        });
      }

      // 🚀 修復：從 top-level key 讀取 standardDomainSettings（與後端回傳結構一致）
      // 若 DB 無資料或資料結構錯誤，則使用 ref 初始值作為 fallback
      if (data.standardDomainSettings && Array.isArray(data.standardDomainSettings) && data.standardDomainSettings.length > 0) {
        // 驗證結構：確保每個項目都有 name 和 periods 欄位
        const isValidStructure = data.standardDomainSettings.every(item =>
          item.name && item.periods
        );
        if (isValidStructure) {
          standardDomainSettings.value = data.standardDomainSettings;
        } else {
          console.warn('⚠️ 資料庫中 standardDomainSettings 結構不正確，使用初始預設值');
          // 不覆蓋，保持 ref 初始值
        }
      } else if (!data.standardDomainSettings || data.standardDomainSettings.length === 0) {
        console.log('🌱 偵測到 108 課綱矩陣為空，使用初始預設值...');
        // 不覆蓋，保持 ref 初始值（L37-53 已定義正確結構）
      }

      // 🆕 Phase 1: subjectGradeRules 遷移邏輯
      // 若 DB 沒有 subjectGradeRules，從 standardDomainSettings 產生初值
      if (!schoolInfo.value.subjectGradeRules || Object.keys(schoolInfo.value.subjectGradeRules).length === 0) {
        schoolInfo.value.subjectGradeRules = migrateSubjectGradeRules(standardDomainSettings.value);
        console.log('🌱 從 standardDomainSettings 產生 subjectGradeRules 初值:', schoolInfo.value.subjectGradeRules);
      }

      // 🚀 修復：ai_settings 位於 data.schoolInfo.ai_settings（後端 /api/schedule 回傳格式）
      if (data.schoolInfo && data.schoolInfo.ai_settings) {
        try {
          aiSettings.value = { ...aiSettings.value, ...data.schoolInfo.ai_settings };
          // 這條規則已固定生效，避免舊資料把它帶回 false
          aiSettings.value.grade12AfternoonOff = true;
        } catch (e) { console.error('AI 設定解析失敗', e); }
      }

      syncStatus.value = 'saved';
      isInitialized.value = true;
    } catch (error) {
      console.error('❌ 讀取失敗:', error);
    }
  };

  // 🆕 儲存前自動計算全校班級衝突，實現衝突持久化以供 AI 分析使用
  const computeAllConflicts = () => {
    const conflictResults = {};
    const allClasses = classes.value || [];
    const allRooms = classrooms.value || [];

    const getGrade = (className) => {
      const m = String(className).match(/(\d+)年/) || String(className).match(/^(\d)/);
      return m ? parseInt(m[1], 10) : 0;
    };

    const isExempt = (subject, className) => {
      const grade = getGrade(className);
      if (!subject) return false;
      const isEnglish = subject.includes('英語') || subject.includes('英文');
      if (isEnglish && grade === 1) return true;
      return false;
    };

    const extractTeachers = (course) => {
      const teachersList = [];
      if (course.teacher) teachersList.push(course.teacher);
      if (course.isAlternating) {
        if (course.oddWeek?.teacher && !teachersList.includes(course.oddWeek.teacher))
          teachersList.push(course.oddWeek.teacher);
        if (course.evenWeek?.teacher && !teachersList.includes(course.evenWeek.teacher))
          teachersList.push(course.evenWeek.teacher);
      }
      return teachersList;
    };

    const extractSubjects = (course) => {
      const subjectsList = [];
      if (course.subject && course.subject !== '導師區塊') subjectsList.push(course.subject);
      if (course.isAlternating) {
        if (course.oddWeek?.subject && !subjectsList.includes(course.oddWeek.subject))
          subjectsList.push(course.oddWeek.subject);
        if (course.evenWeek?.subject && !subjectsList.includes(course.evenWeek.subject))
          subjectsList.push(course.evenWeek.subject);
      }
      return subjectsList;
    };

    const otherTeacherIndex = {};
    const concurrentSubjectIndex = {};

    for (const cls of allClasses) {
      if (!cls.timetable) continue;
      for (let d = 1; d <= 5; d++) {
        for (let p = 1; p <= 7; p++) {
          const course = cls.timetable[d]?.[p];
          if (!course || !course.subject || course.subject === '導師區塊') continue;
          const key = `${d}-${p}`;

          for (const teacher of extractTeachers(course)) {
            if (!otherTeacherIndex[key]) otherTeacherIndex[key] = [];
            otherTeacherIndex[key].push({ teacher, className: cls.name });
          }

          for (const subj of extractSubjects(course)) {
            if (isExempt(subj, cls.name)) continue;
            if (!concurrentSubjectIndex[key]) concurrentSubjectIndex[key] = {};
            if (!concurrentSubjectIndex[key][subj]) concurrentSubjectIndex[key][subj] = [];
            concurrentSubjectIndex[key][subj].push(cls.name);
          }
        }
      }
    }

    for (const cls of allClasses) {
      conflictResults[cls.name] = {};
      if (!cls.timetable) continue;

      for (let d = 1; d <= 5; d++) {
        for (let p = 1; p <= 7; p++) {
          const course = cls.timetable[d]?.[p];
          if (!course || !course.subject || course.subject === '導師區塊') continue;

          const key = `${d}-${p}`;
          const conflicts = [];

          for (const myTeacher of extractTeachers(course)) {
            const clashes = (otherTeacherIndex[key] || []).filter(t => t.teacher === myTeacher && t.className !== cls.name);
            for (const clash of clashes) {
              conflicts.push({
                type: 'teacher',
                message: `教師衝堂：${myTeacher} 已在 ${clash.className}`
              });
            }
          }

          for (const mySubject of extractSubjects(course)) {
            if (isExempt(mySubject, cls.name)) continue;
            const roomCapacity = allRooms.filter(r => (r.subject || '').trim() === mySubject).length;
            if (roomCapacity === 0) continue;

            const concurrentClasses = concurrentSubjectIndex[key]?.[mySubject] || [];
            if (concurrentClasses.length > roomCapacity) {
              const otherClasses = concurrentClasses.filter(c => c !== cls.name);
              conflicts.push({
                type: 'room',
                message: `容量超載：${mySubject} 共 ${concurrentClasses.length} 班同時上課（上限 ${roomCapacity} 間）。其他班：${otherClasses.join('、')}`
              });
            }
          }

          if (conflicts.length > 0) {
            conflictResults[cls.name][key] = conflicts;
          }
        }
      }
    }
    return conflictResults;
  };

  const computeAllConflictsV2 = () => {
    const report = buildScheduleAiReport({
      scheduleEntries: flattenClassTimetablesToEntries(classes.value),
      classes: classes.value,
      teachers: teachers.value,
      classrooms: classrooms.value,
      schoolInfo: schoolInfo.value,
      aiSettings: aiSettings.value,
      engineMeta: { source: 'current-store' },
    });

    const conflictResults = {};
    for (const classReport of report.report.classes) {
      conflictResults[classReport.className] = {};
      for (const issueSlot of classReport.issueSlots) {
        conflictResults[classReport.className][`${issueSlot.day}-${issueSlot.period}`] = issueSlot.issues.map((issue) => ({
          type: issue.type,
          message: issue.message,
        }));
      }
    }
    return conflictResults;
  };

  const syncToCloud = async () => {
    // 防呆：如果正在儲存中，阻擋重複點擊
    if (syncStatus.value === 'saving') return false;

    syncStatus.value = 'saving';

    // 🚀 終極防護：幽靈班級清道夫 (Ghost Class Sweeper)
    // 解決記憶體殘留導致 101 與 1年1班 同時存在的問題
    const uniqueClasses = [];
    classes.value.forEach(cls => {
      // 若班級名稱是純 3 位數字 (如 101)
      if (/^\d{3}$/.test(String(cls.name).trim())) {
        const grade = String(cls.name).charAt(0);
        const clsNum = parseInt(String(cls.name).substring(1), 10);
        const fullName = `${grade}年${clsNum}班`;

        // 如果記憶體中已經存在「1年1班」，則這個「101」就是幽靈，直接拋棄！
        if (classes.value.some(c => c.name === fullName)) {
          console.warn(`🧹 [幽靈清理] 偵測到重複班級 ${cls.name}，已自動剔除。`);
          return;
        }
      }
      uniqueClasses.push(cls);
    });
    // 將清理後的乾淨陣列覆蓋回去
    classes.value = uniqueClasses.map(cls => sanitizeClassRequirements(cls));

    // 🚀 BugFix: 第一層防護 —— 在發送前為每個班級填充 grade 欄位 + 清理 homeroom_teacher 型別
    const conflictResults = computeAllConflictsV2();
    const classesWithGrade = classes.value.map(cls => {
      let ht = cls.homeroom_teacher;
      // 🚀 修復：安全提取名稱，防止數字 ID 被抹除
      if (typeof ht === 'object' && ht !== null) {
        ht = ht.name || '';
      } else if (typeof ht === 'number') {
        // 如果是數字，強制轉為字串保留
        ht = String(ht);
      }

      if (typeof ht !== 'string') {
        ht = '';
      }
      return {
        ...cls,
        grade: cls.grade || getGradeFromClassName(cls.name),
        homeroom_teacher: ht,
        conflicts: conflictResults[cls.name] || {}
      };
    });

    const payload = {
      schoolInfo: schoolInfo.value,
      teachers: teachers.value, classes: classesWithGrade, specialCourses: specialCourses.value, classrooms: classrooms.value, standardDomainSettings: standardDomainSettings.value,
      aiSettings: aiSettings.value
    };

    try {
      const response = await fetch(`${API_BASE}/save-all`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

      // 🚀 關鍵修復：如果後端回傳失敗 (如 500 錯誤)，強制拋出異常！
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `HTTP 錯誤碼: ${response.status}`);
      }

      syncStatus.value = 'saved';
      // 🚀 關鍵修復：儲存完畢後強制重載，確保前端拿到資料庫真實生成的 ID
      await loadFromDB(true);
      const now = new Date();
      lastSavedTime.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      return true;
    } catch (error) {
      // 發生錯誤時，解除 saving 鎖定，並彈出視窗告訴使用者真正的錯誤原因！
      syncStatus.value = 'unsaved';
      console.error('❌ 同步失敗:', error);
      alert(`⚠️ 資料庫同步失敗！\n原因：${error.message}\n請確認後端伺服器 (server.js) 是否有正確重啟，或檢查終端機的錯誤訊息。`);
      return false;
    }
  };

  const updateTeacher = (index, quota) => {
    if (teachers.value[index]) {
      teachers.value[index] = { ...teachers.value[index], ...quota };
      markScheduleDirty();
    }
  };

  const saveClass = (classData) => {
    const sanitizedClass = sanitizeClassRequirements(classData);
    const index = classes.value.findIndex(c => c.name === classData.name);
    if (index !== -1) classes.value[index] = sanitizedClass;
    else classes.value.push(sanitizedClass);
    markScheduleDirty();
  };

  const addSpecialCourse = (course) => {
    const uniqueId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    specialCourses.value.push({ ...course, teacher_name: course.teacher_name || course.teacher || '', id: uniqueId });
    markScheduleDirty();
  };

  const deleteSpecialCourse = (id) => {
    const index = specialCourses.value.findIndex(c => c.id === id);
    if (index !== -1) { specialCourses.value.splice(index, 1); markScheduleDirty(); }
  };

  const checkTeacherConflict = (teacherName, day, period) => {
    const specialConflict = specialCourses.value.find(sc => sc.teacher_name === teacherName && sc.day === day && sc.period === period);
    if (specialConflict) return `教師在此時段有特殊課程：${specialConflict.name}`;
    for (const cls of classes.value) {
      if (cls.timetable && cls.timetable[day] && cls.timetable[day][period]) {
        if (cls.timetable[day][period].teacher === teacherName) return `教師在此時段已安排至 ${cls.name} 上課`;
      }
    }
    return null;
  };

  // ==========================================
  // 🚀 導師課區塊化預處理函數
  // ==========================================
  const buildHomeroomBlockMap = () => {
    const blockMap = {};

    classes.value.forEach(cls => {
      // 萃取年級數字
      const gradeMatch = String(cls.name).match(/(\d+)年/) || String(cls.name).match(/^(\d)/);
      const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : (cls.grade || 0);

      (cls.course_requirements || []).forEach(req => {
        // 🔧 修復：支援 req.teacher_name 與 req.teacher 兩種欄位
        const teacherName = req.teacher_name || req.teacher;
        // 篩選條件：預設由導師授課，且已明確指派教師姓名，且節數 > 0
        // 不把已聚合的 subject: '導師區塊' 當成背包科目
        if (req.defaultTeacher === 'homeroom' && teacherName && Number(req.periods) > 0 && req.subject !== '導師區塊') {
          const tName = teacherName;

          // 若該導師尚未在 map 中，初始化它
          if (!blockMap[tName]) {
            blockMap[tName] = {
              totalPeriods: 0,
              classes: []
            };
          }

          // 尋找該導師的班級陣列中，是否已經有這個班級
          let classEntry = blockMap[tName].classes.find(c => c.className === cls.name);
          if (!classEntry) {
            classEntry = {
              className: cls.name,
              grade: grade,
              homeroomPeriods: 0,
              subjectBreakdown: []
            };
            blockMap[tName].classes.push(classEntry);
          }

          // 累加節數與記錄科目明細
          const periods = Number(req.periods) || 0;
          classEntry.homeroomPeriods += periods;
          classEntry.subjectBreakdown.push({
            subject: req.subject,
            periods: periods
          });

          blockMap[tName].totalPeriods += periods;
        }
      });
    });

    return blockMap;
  };

  const addClassroom = async (classroom) => {
    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    // 🔧 normalization：確保新增教室的科目名稱是 canonical key
    const normalizedSubject = normalizeRoomSubject(classroom.subject);
    const newClassroom = {
      ...classroom,
      id: newId,
      subject: normalizedSubject,
      // 🆕 [gradePreferences] 確保新增時有預設值
      gradePreferences: Array.isArray(classroom.gradePreferences)
        ? classroom.gradePreferences
        : []
    };
    classrooms.value.push(newClassroom);
    markScheduleDirty();
    const success = await syncToCloud();
    if (!success) {
      // 🐛 修復：用 newId 來回滾，而不是 classroom.id (原始物件沒有 id)
      classrooms.value = classrooms.value.filter(c => c.id !== newId);
    }
    return success;
  };

  // 🚀 關鍵修復：強制轉為字串 String() 再比對，防止 SQLite 數字 ID 與前端字串 ID 比對失敗
  const deleteClassroom = async (id) => {
    const index = classrooms.value.findIndex(c => String(c.id) === String(id));
    if (index !== -1) {
      classrooms.value.splice(index, 1);
      markScheduleDirty();
      const success = await syncToCloud();
      if (!success) {
        // 如果同步失敗，嘗試恢復資料 (簡單處理：提示使用者手動重新儲存)
        alert('⚠️ 刪除成功但同步失敗，請手動點擊「儲存設定」重新同步。');
      }
      return success;
    }
    return false;
  };

  // 🚀 新增：更新教室的函式
  const updateClassroom = async (id, updates) => {
    const index = classrooms.value.findIndex(c => String(c.id) === String(id));
    if (index !== -1) {
      // 🚀 關鍵修復：使用 merge 方式更新，保留 allowSharing 等欄位
      // 🔧 normalization：確保更新教室的科目名稱是 canonical key
      const normalizedUpdates = {
        ...updates,
        ...(updates.subject ? { subject: normalizeRoomSubject(updates.subject) } : {})
      };
      classrooms.value[index] = {
        ...classrooms.value[index],
        ...normalizedUpdates
      };
      markScheduleDirty();
      const success = await syncToCloud();
      return success;
    }
    return false;
  };

  // 🚀 新增：清除教室負責教師的函式，保留 allowSharing
  const clearTeacher = async (id) => {
    const index = classrooms.value.findIndex(c => String(c.id) === String(id));
    if (index !== -1) {
      // 🚀 關鍵修復：只清除 primaryTeacher，保留 allowSharing 和其他欄位
      classrooms.value[index] = {
        ...classrooms.value[index],
        primaryTeacher: ''
      };
      markScheduleDirty();
      const success = await syncToCloud();
      if (!success) {
        alert('⚠️ 清除成功但同步失敗，請手動點擊「儲存設定」重新同步。');
      }
      return success;
    }
    return false;
  };

  const setEditingTeacherId = (id) => { editingTeacherId.value = id; };
  const addTeacher = (teacher) => {
    const uniqueId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    teachers.value.push({ id: uniqueId, ...teacher });
    markScheduleDirty();
  };
  const deleteTeacher = (idOrName) => {
    const index = teachers.value.findIndex(t => String(t.id) === String(idOrName) || t.name === idOrName);
    if (index !== -1) { teachers.value.splice(index, 1); markScheduleDirty(); syncToCloud(); }
  };

  // --- 🆕 新增：獨立的配額計算與檢查工具 ---
  const countUsedPeriodsInternal = (teacherName) => {
    let count = 0;
    classes.value.forEach(cls => {
      cls.course_requirements?.forEach(req => {
        if (req.teacher && req.teacher.trim() === teacherName.trim()) {
          count += Number(req.periods) || 0;
        }
      });
    });
    return count;
  };

  const checkQuotaExceed = (teacherName, additionalPeriods) => {
    const teacher = teachers.value.find(t => t.name === teacherName);
    if (!teacher) return { exceed: true, message: '教師不存在' };

    // 取得職務群組，若未設定預設為 subject
    const roleGroup = teacher.type || 'subject';
    const base = Number(teacher.base_periods || teacher.max_periods ||
      (schoolInfo.value.periodDefaults?.[roleGroup] || 20));

    const reduction = Number(teacher.reduction || 0);
    const overtime = Number(teacher.overtime || 0);
    const used = countUsedPeriodsInternal(teacherName);
    const maxPeriods = base - reduction + overtime;
    const remaining = maxPeriods - used;

    return {
      exceed: additionalPeriods > remaining,
      teacherName,
      maxPeriods,
      used,
      remaining,
      wouldExceedBy: Math.max(0, additionalPeriods - remaining),
      message: additionalPeriods > remaining
        ? `⚠️ ${teacherName} 將超配 ${additionalPeriods - remaining} 節`
        : `✅ ${teacherName} 配額充足 (剩餘 ${remaining} 節)`
    };
  };


  const clearAllTimetables = () => {
    if (!classes.value) return;
    classes.value.forEach(c => {
      c.timetable = { "1": {}, "2": {}, "3": {}, "4": {}, "5": {} };
    });
    markScheduleDirty();
  };

  const clearAllTeachers = () => {
    teachers.value = [];
    markScheduleDirty();
  };

  // === 🚀 Phase 2: API 對接觸發函數 ===

  // localStorage key for persisting active job
  const ACTIVE_JOB_KEY = 'schedule_active_job';

  // 保存 jobId 到 localStorage
  const saveActiveJob = (jobId) => {
    try {
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({
        jobId,
        startedAt: engineStartedAt.value,
        enginePhase: enginePhase.value,
        engineMessage: engineMessage.value,
        timestamp: Date.now()
      }));
    } catch (e) { /* ignore localStorage errors */ }
  };

  // 從 localStorage 讀取 active job
  const loadActiveJob = () => {
    try {
      const raw = localStorage.getItem(ACTIVE_JOB_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  };

  // 清除 localStorage 中的 active job
  const clearActiveJob = () => {
    try {
      localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch (e) { /* ignore */ }
  };

  // 清理輪詢計時器
  const stopPolling = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    enginePollingActive.value = false;
  };

  // 計算已運行時間 (秒)
  const calculateElapsed = (startedAt) => {
    if (!startedAt) return 0;
    const start = new Date(startedAt).getTime();
    if (isNaN(start)) return 0;
    return Math.floor((Date.now() - start) / 1000);
  };

  // 格式化時間顯示
  const formatElapsed = (seconds) => {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    return `${Math.floor(seconds / 3600)}時${Math.floor((seconds % 3600) / 60)}分${seconds % 60}秒`;
  };

  // 內部：終止輪詢並設為 ERROR 狀態
  const _terminalErrorHandle = (rejectFn, errorMsg) => {
    stopPolling();
    clearActiveJob();
    engineStatus.value = 'ERROR';
    enginePhase.value = enginePhase.value || 'FAILED';
    engineErrorMessage.value = errorMsg;
    console.error(`🛑 終止型錯誤，停止輪詢:`, errorMsg);
    rejectFn(new Error(errorMsg));
  };

  const pollJobStatus = async (jobId) => {
    return new Promise((resolve, reject) => {
      enginePollingActive.value = true;
      engineNetworkRetry.value = 0;

      const check = async () => {
        let response;
        try {
          response = await fetch(`${API_BASE}/schedule/${jobId}`);
        } catch (fetchError) {
          // 純網路斷線 (可重試型)
          engineNetworkRetry.value += 1;
          console.warn(`⚠️ 輪詢網路失敗 (重試 #${engineNetworkRetry.value}/36):`, fetchError.message);

          if (engineNetworkRetry.value >= 36) {
            _terminalErrorHandle(reject, '暫時無法連線至後端，請稍後重新進入頁面續接監看');
            return;
          }
          pollTimer = setTimeout(check, 5000);
          return;
        }

        // 成功收到 HTTP 回應，解析 body
        let data;
        try {
          data = await response.json();
        } catch (parseError) {
          // JSON 解析失敗 (終止型)
          _terminalErrorHandle(reject, `後端回應格式異常 (HTTP ${response.status})，輪詢終止`);
          return;
        }

        // HTTP 狀態異常 (終止型)
        if (!response.ok) {
          _terminalErrorHandle(reject, data?.error || `後端回應錯誤 (HTTP ${response.status})`);
          return;
        }

        // 更新進度狀態
        enginePhase.value = data.progressPhase || data.status || enginePhase.value;

        // 🛡️ [BugFix] 嚴格檢查：有新且非空的訊息才覆蓋，避免舊有意義訊息被洗白
        if (data.progressMessage && data.progressMessage.trim() !== '') {
          engineMessage.value = data.progressMessage;
        } else if (data.message && data.message.trim() !== '') {
          engineMessage.value = data.message;
        }

        engineStartedAt.value = data.startedAt || engineStartedAt.value;
        engineFinishedAt.value = data.finishedAt || null;
        engineLastUpdated.value = new Date().toISOString();

        // 確保只要有開始時間，就觸發一次計算
        if (engineStartedAt.value) {
          engineElapsedSeconds.value = calculateElapsed(engineStartedAt.value);
        }

        // 重置網路重試計數
        engineNetworkRetry.value = 0;

        if (data.status === 'COMPLETED') {
          stopPolling();
          clearActiveJob();
          engineFinishedAt.value = data.finishedAt;

          // 🚨 [狀態分類] 區分 INFEASIBLE / INVALID_INPUT / INVALID_VALIDATION / UNKNOWN_TIMEOUT / ERROR
          // 🛡️ solverStatus > status，因為 status 可能是後端 DB 層級的状态（COMPLETED/FAILED）
          let resultObj = data.result;
          if (typeof resultObj === 'string') {
            try { resultObj = JSON.parse(resultObj); } catch { resultObj = {}; }
          }
          const solverStatus = resultObj?.solverStatus || resultObj?.status;
          const scheduleEmpty = !resultObj?.schedule || (Array.isArray(resultObj.schedule) && resultObj.schedule.length === 0);

          // 🛡️ INVALID_INPUT：輸入超載（如總節數超過年級容量）
          if (solverStatus === 'INVALID_INPUT') {
            engineStatus.value = 'ERROR';
            enginePhase.value = 'FAILED';
            engineErrorMessage.value = resultObj?.error || resultObj?.message || '輸入資料超載，請檢查班級總節數是否超過年級上限';

            // 附帶 classLoadTrace 供前端診斷
            if (resultObj?.classLoadTrace) {
              engineDiagnosticWarningDetails.value = resultObj.classLoadTrace
                .filter(t => t.validationError)
                .map(t => ({
                  category: 'CLASS_LOAD',
                  className: t.className,
                  grade: t.grade,
                  totalPeriods: t.totalPeriods,
                  capacity: t.capacity ?? t.gradeMaxPeriods,
                  periodExcess: t.periodExcess,
                  message: `${t.className}: 總節數 ${t.totalPeriods} > 容量 ${t.capacity ?? t.gradeMaxPeriods} (超限 ${t.periodExcess})`,
                }));
            }

            // 🔧 修復 B (RC-CONF-01 輔因)：接收 gradeCapacityMap 並轉換為 gradeMaxPeriods
            // solver 輸出格式: { "grade1": 29, "grade1_arts": 29, "grade2": 29, ... }
            // 前端格式: { 1: 29, 2: 29, ... }
            if (resultObj?.gradeCapacityMap && typeof resultObj.gradeCapacityMap === 'object') {
              const gcm = resultObj.gradeCapacityMap;
              const gradeMap = {};
              for (const [key, val] of Object.entries(gcm)) {
                // 解析 key: "grade1" → grade=1, "grade3_arts" → grade=3
                const match = key.match(/^grade(\d+)/);
                if (match) {
                  const gradeNum = parseInt(match[1], 10);
                  // 以非 arts 版本為基礎（一般班容量），arts 版本通常相同
                  if (!key.includes('_arts')) {
                    gradeMap[gradeNum] = val;
                  }
                }
              }
              schoolInfo.value.gradeMaxPeriods = gradeMap;
              console.log(`[schedule.js] 🔧 已從 gradeCapacityMap 更新 gradeMaxPeriods:`, gradeMap);
            }

            if (data.startedAt && data.finishedAt) {
              engineElapsedSeconds.value = calculateElapsed(data.startedAt);
            }
            reject(new Error(engineErrorMessage.value));

          // 🛡️ INVALID_VALIDATION：求解成功但驗證失敗（如 unassigned_special_rooms）
          } else if (solverStatus === 'INVALID' || solverStatus === 'INVALID_VALIDATION') {
            engineStatus.value = 'ERROR';
            enginePhase.value = 'FAILED';
            engineErrorMessage.value = resultObj?.message || '求解結果未通過驗證，請檢查 debug_schedule_validation_report.json';

            // 讀取 validation report
            try {
              const valResp = await fetch(`${API_BASE}/debug/validation-report`);
              if (valResp.ok) {
                const valReport = await valResp.json();
                engineDiagnosticWarningDetails.value = normalizeDiagnosticWarningDetails(valReport);
              }
            } catch {
              // 靜默失敗，不影響主流程
            }

            if (data.startedAt && data.finishedAt) {
              engineElapsedSeconds.value = calculateElapsed(data.startedAt);
            }
            reject(new Error(engineErrorMessage.value));

          // ⏱️ UNKNOWN_TIMEOUT：求解逾時
          } else if (solverStatus === 'UNKNOWN_TIMEOUT') {
            engineStatus.value = 'ERROR';
            enginePhase.value = 'FAILED';
            engineErrorMessage.value = resultObj?.message || '排課引擎逾時未完成——建議增加時間上限或放寬部分條件';

            engineDiagnosticWarningDetails.value = normalizeDiagnosticWarningDetails(resultObj?.diagnosticWarnings);
            if (resultObj && Array.isArray(resultObj.aiAnalysis)) {
              engineAiAnalysis.value = resultObj.aiAnalysis;
            }

            if (data.startedAt && data.finishedAt) {
              engineElapsedSeconds.value = calculateElapsed(data.startedAt);
            }
            reject(new Error(engineErrorMessage.value));

          // 🚨 INFEASIBLE：求解器證明無解
          //    只有當 solverStatus 明確是 INFEASIBLE，或狀態完全未知（null/undefined）且 schedule 為空時才走這裡
          } else if (solverStatus === 'INFEASIBLE' || (!solverStatus && scheduleEmpty)) {
            engineStatus.value = 'ERROR';
            enginePhase.value = 'FAILED';
            engineErrorMessage.value = resultObj?.message || resultObj?.error || '排課引擎無法找到可行解 (INFEASIBLE)';

            // 🔍 捕獲診斷資料；優先使用結構化 diagnosticWarnings
            engineDiagnosticWarningDetails.value = normalizeDiagnosticWarningDetails(resultObj?.diagnosticWarnings);
            if (resultObj && Array.isArray(resultObj.aiAnalysis)) {
              engineAiAnalysis.value = resultObj.aiAnalysis;
            }

            // 🔍 若尚無可辨識警示，讀取 debug_infeasible_report.txt 萃取警示
            if (engineDiagnosticWarnings.value.length === 0) {
              engineAiAnalysis.value = await loadDiagnosticWarningsFromReport();
            }

            if (data.startedAt && data.finishedAt) {
              engineElapsedSeconds.value = calculateElapsed(data.startedAt);
            }
            reject(new Error(engineErrorMessage.value));
          } else {
            // ✅ 真正完成
            engineStatus.value = 'COMPLETED';
            // 🚀 核心修復：排課完成後，強制從資料庫抓取最新產出的 timetable
            await loadFromDB(true);
            if (data.startedAt && data.finishedAt) {
              engineElapsedSeconds.value = calculateElapsed(data.startedAt);
            }
            resolve(data.result);
          }
        } else if (data.status === 'FAILED') {
          stopPolling();
          clearActiveJob();
          engineStatus.value = 'ERROR';
          engineFinishedAt.value = data.finishedAt;
          // 🔍 P1-B: data.result 可能是 JSON 字串（server.js 中 JSON.stringify(failedResult)），需先解析
          let failedResultObj = data.result;
          if (typeof failedResultObj === 'string') {
            try { failedResultObj = JSON.parse(failedResultObj); } catch { failedResultObj = {}; }
          }
          const errDetail = failedResultObj?.error || failedResultObj?.message || data.progressMessage || '排課引擎執行失敗';
          engineErrorMessage.value = errDetail;
          // 🔍 捕獲診斷分析資料
          engineDiagnosticWarningDetails.value = normalizeDiagnosticWarningDetails(failedResultObj?.diagnosticWarnings);
          if (failedResultObj && Array.isArray(failedResultObj.aiAnalysis)) {
            engineAiAnalysis.value = failedResultObj.aiAnalysis;
          }
          if (engineDiagnosticWarnings.value.length === 0) {
            engineAiAnalysis.value = await loadDiagnosticWarningsFromReport();
          }
          reject(new Error(errDetail));
        } else {
          // PROCESSING / QUEUED / SOLVING / FINALIZING 中，繼續輪詢
          saveActiveJob(jobId);
          pollTimer = setTimeout(check, 5000); // 每 5 秒輪詢一次
        }
      };

      check();
    });
  };

  // 恢復之前中斷的輪詢 (idempotent)
  const resumePolling = async () => {
    // Idempotent: 如果同一個 jobId 已在輪詢中，直接回傳
    if (enginePollingActive.value && engineJobId.value) {
      console.log(`🔁 輪詢已在進行中 (JobId: ${engineJobId.value})，跳過重複啟動`);
      return true;
    }

    const savedJob = loadActiveJob();
    if (!savedJob || !savedJob.jobId) return false;

    engineJobId.value = savedJob.jobId;
    engineStatus.value = 'PROCESSING';
    enginePhase.value = savedJob.enginePhase || 'UNKNOWN';
    engineMessage.value = savedJob.engineMessage || '恢復輪詢中...';
    engineStartedAt.value = savedJob.startedAt || null;
    enginePollingActive.value = true;

    console.log(`🔄 恢復輪詢 JobId: ${savedJob.jobId}`);

    try {
      const result = await pollJobStatus(savedJob.jobId);
      engineResult.value = result;
      return true;
    } catch (error) {
      engineErrorMessage.value = error.message;
      return false;
    }
  };

  const runSmartEngine = async (payload) => {
    // 停止舊輪詢
    stopPolling();
    clearActiveJob();

    engineStatus.value = 'PROCESSING';
    engineErrorMessage.value = '';
    engineResult.value = null;
    enginePhase.value = 'QUEUED';
    engineMessage.value = '提交排課任務...';
    engineStartedAt.value = null;
    engineFinishedAt.value = null;
    engineElapsedSeconds.value = 0;
    engineLastUpdated.value = null;
    engineNetworkRetry.value = 0;

    try {
      // Step 1: 提交任務到後端
      const response = await fetch(`${API_BASE}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '排課引擎啟動失敗');
      }

      engineJobId.value = data.jobId;
      enginePhase.value = 'QUEUED';
      engineMessage.value = '排課任務已進入排程';
      // 🛡️ [BugFix] 等拿到 jobId 後再補 fallback 時間，避免 API 失敗卻留下「已開始」的假時間
      engineStartedAt.value = new Date().toISOString();
      saveActiveJob(data.jobId);
      console.log(`🚀 排課任務已提交，JobId: ${data.jobId}`);

      // Step 2: Polling 等待 Python OR-Tools 運算完成 (無限輪詢)
      const result = await pollJobStatus(data.jobId);
      engineResult.value = result;
      console.log('🎉 排課引擎運算完成！');
      return true;

    } catch (error) {
      console.error('🚀 引擎運算失敗:', error);
      engineErrorMessage.value = error.message;
      engineStatus.value = 'ERROR';
      enginePhase.value = 'FAILED';
      stopPolling();
      clearActiveJob();
      return false;
    }
  };

  const resetEngineState = () => {
    stopPolling();
    clearActiveJob();
    engineStatus.value = 'IDLE';
    engineJobId.value = null;
    engineErrorMessage.value = '';
    engineResult.value = null;
    enginePhase.value = '';
    engineMessage.value = '';
    engineStartedAt.value = null;
    engineFinishedAt.value = null;
    engineElapsedSeconds.value = 0;
    engineLastUpdated.value = null;
    enginePollingActive.value = false;
    engineNetworkRetry.value = 0;
    engineAiAnalysis.value = [];
    engineDiagnosticWarningDetails.value = [];
  };

  // 🚀 新增：根據 gradeSettings 同步 Class 記錄
  const syncClassesFromGradeSettings = () => {
    const expectedNames = computeExpectedClassNames(schoolInfo.value.gradeSettings)
    const { toAdd, toRemove, toKeep } = computeClassDiff(classes.value, expectedNames)

    const added = []
    const removed = []
    const blocked = []

    // 新增班級
    for (const name of toAdd) {
      const newCls = createMinimalClass(name)
      classes.value.push(newCls)
      added.push(name)
    }

    // 刪除班級（保護機制）
    for (const name of toRemove) {
      const cls = classes.value.find(c => String(c.name).trim() === name)
      if (cls) {
        const { hasData, reason } = checkClassHasData(cls)
        if (hasData) {
          blocked.push({ className: name, reason })
        } else {
          const idx = classes.value.findIndex(c => String(c.name).trim() === name)
          if (idx !== -1) {
            classes.value.splice(idx, 1)
            removed.push(name)
          }
        }
      }
    }

    markScheduleDirty()

    // 日誌輸出
    if (added.length > 0) console.log(`✅ [班級同步] 新增 ${added.length} 個班級:`, added)
    if (removed.length > 0) console.log(`🗑️ [班級同步] 刪除 ${removed.length} 個班級:`, removed)
    if (blocked.length > 0) console.warn(`⚠️ [班級同步] 以下班級因已有資料無法刪除:`, blocked)

    return {
      added,
      removed,
      kept: toKeep,
      blocked,
      message: buildSyncMessage(added, removed, blocked)
    }
  }

  // 建立同步結果訊息
  const buildSyncMessage = (added, removed, blocked) => {
    const parts = []
    if (added.length > 0) parts.push(`✅ 新增 ${added.length} 個班級`)
    if (removed.length > 0) parts.push(`🗑️ 移除 ${removed.length} 個班級`)
    if (blocked.length > 0) parts.push(`⚠️ ${blocked.length} 個班級因已有資料保留`)
    if (parts.length === 0) parts.push('✅ 班級數無變化')
    return parts.join(' | ')
  }

  const resetAllData = () => {
    schoolInfo.value = {
      name: '',
      academic_year: '115', semester: '上學期',
      periodDefaults: { homeroom: 15, subject: 19, admin: 6 },
      gradeSettings: { '1': 3, '2': 3, '3': 3, '4': 3, '5': 3, '6': 3 },
      alternativeMatrix: { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] },
      classExceptions: [],
      classroomLimits: { '自然科學': 3, '語文-英語': 3, '音樂': 3, '美勞': 3, '體育': 6, '資訊': 1 },
      subjectClassroomGrades: {
        '語文-英語': [2, 3, 4, 5, 6],
        '音樂': [3, 4, 5, 6],
        '美勞': [3, 4, 5, 6],
        '自然科學': [3, 4, 5, 6]
      },
      subjectGradeRules: {
        '生活': [1, 2],
        '自然科學': [3, 4, 5, 6],
        '音樂': [3, 4, 5, 6],
        '美勞': [3, 4, 5, 6],
        '社會': [3, 4, 5, 6],
        '綜合活動': [3, 4, 5, 6],
        '科技-資訊': [3, 4, 5, 6],
        '語文-英語': [1, 2, 3, 4, 5, 6]
      },
      // [2026-06-28] Use normalizer to guarantee consistent coPlanningSettings shape
      coPlanningSettings: normalizeCoPlanningSettings(null),
    };
    teachers.value = [];
    classes.value = [];
    specialCourses.value = [];
    classrooms.value = [];
    isInitialized.value = false;
    resetEngineState();
    markScheduleDirty();
  };

  return {
    isInitialized,
    schoolInfo, syncStatus, lastSavedTime, teachers, classes, specialCourses, classrooms, standardDomainSettings, allAvailableSubjects,
    teacherQuotas,
    engineStatus, engineJobId, engineErrorMessage, engineResult, engineAiAnalysis, engineDiagnosticWarnings, engineDiagnosticWarningDetails,
    // 新增：進度狀態欄位
    enginePhase, engineMessage, engineStartedAt, engineFinishedAt,
    engineElapsedSeconds, engineLastUpdated, enginePollingActive, engineNetworkRetry,
    getSubjectColor, saveClass, markScheduleDirty, addSpecialCourse, deleteSpecialCourse, checkTeacherConflict,
    addClassroom, deleteClassroom, updateClassroom, clearTeacher,
    editingTeacherId, setEditingTeacherId, addTeacher, deleteTeacher, updateTeacher,
    checkQuotaExceed, countUsedPeriodsInternal,
    aiSettings,
    buildHomeroomBlockMap,
    loadFromDB,
    syncToCloud,
    clearAllTimetables, clearAllTeachers, resetAllData,
    runSmartEngine, resetEngineState,
    // 新增：輪詢恢復與工具函數
    resumePolling, stopPolling, formatElapsed,
    // 新增：班級同步
    syncClassesFromGradeSettings,
  }
});
