/**
 * 年級科目適用範圍判斷工具
 *
 * 核心規則：
 * - `生活` → 只允許 1-2 年級
 * - `自然科學` / `音樂` / `美勞` / `社會` / `綜合活動` / `科技-資訊` → 只允許 3-6 年級
 * - 其他科目 → 不限制年級
 */

/**
 * 🆕 Phase 2: 預設科目年級範圍 — 僅在無 subjectGradeRules 時使用
 */
const DEFAULT_GRADE_RANGES = {
  '生活': [1, 2],
  '自然科學': [3, 4, 5, 6],
  '音樂': [3, 4, 5, 6],
  '美勞': [3, 4, 5, 6],
  '社會': [3, 4, 5, 6],
  '綜合活動': [3, 4, 5, 6],
  '科技-資訊': [3, 4, 5, 6],
};

function canonicalSubjectForGradeRule(subjectName) {
  const subject = String(subjectName || '').trim()
  if (!subject) return ''
  if (subject.startsWith('音樂')) return '音樂'
  if (subject.startsWith('美勞')) return '美勞'
  if (subject.startsWith('自然')) return '自然科學'
  if (subject.startsWith('科技-資訊') || subject.startsWith('資訊') || subject.startsWith('電腦')) return '科技-資訊'
  return subject
}

function normalizeSubjectGradeRules(subjectGradeRules = null) {
  const normalized = {}

  for (const [subjectName, grades] of Object.entries(subjectGradeRules || {})) {
    if (!Array.isArray(grades) || grades.length === 0) continue

    const allowedGrades = grades
      .map((grade) => Number(grade))
      .filter((grade) => Number.isFinite(grade))

    if (allowedGrades.length > 0) {
      normalized[canonicalSubjectForGradeRule(subjectName)] = allowedGrades
    }
  }

  return normalized
}

function buildGradeRangesFromStandardDomainSettings(standardDomainSettings = null) {
  const ranges = {}

  for (const entry of standardDomainSettings || []) {
    const subjectName = canonicalSubjectForGradeRule(entry?.name || entry?.subject || entry?.subjectName)
    const periods = entry?.periods
    if (!subjectName || typeof periods !== 'object' || periods == null) continue

    const allowedGrades = Object.entries(periods)
      .map(([grade, value]) => [Number(grade), Number(value)])
      .filter(([grade, value]) => Number.isFinite(grade) && Number.isFinite(value) && value > 0)
      .map(([grade]) => grade)

    ranges[subjectName] = allowedGrades
  }

  return ranges
}

export function buildEffectiveSubjectGradeRanges(subjectGradeRules = null, standardDomainSettings = null) {
  return {
    ...DEFAULT_GRADE_RANGES,
    ...buildGradeRangesFromStandardDomainSettings(standardDomainSettings),
    ...normalizeSubjectGradeRules(subjectGradeRules),
  }
}

/**
 * 檢查指定科目是否適用於指定年級
 * @param {string} subjectName - 科目名稱
 * @param {number} grade - 年級 (1-6)
 * @param {Object|null} schoolInfo - 學校設定物件（包含 subjectGradeRules）
 * @returns {boolean} 是否適用
 */
export function isSubjectApplicableToGrade(subjectName, grade, schoolInfo = null, standardDomainSettings = null) {
  if (!subjectName || typeof grade !== 'number') {
    return true;
  }

  const ranges = buildEffectiveSubjectGradeRanges(schoolInfo?.subjectGradeRules, standardDomainSettings);
  const applicableGrades = ranges[canonicalSubjectForGradeRule(subjectName)];

  // 如果沒有定義該科目的年級範圍，則視為不限制
  if (!applicableGrades) {
    return true;
  }

  return applicableGrades.includes(grade);
}

export function formatAllowedGrades(allowedGrades) {
  if (!Array.isArray(allowedGrades) || allowedGrades.length === 0) {
    return '';
  }
  return allowedGrades.join('、');
}

export function getSubjectGradeValidation(subjectName, grade, schoolInfo = null, standardDomainSettings = null) {
  const numericGrade = Number(grade);
  if (!subjectName || !Number.isFinite(numericGrade)) {
    return {
      subjectName: subjectName || '',
      grade: Number.isFinite(numericGrade) ? numericGrade : null,
      allowedGrades: null,
      allowed: true,
      reason: '',
    };
  }

  const canonicalSubject = canonicalSubjectForGradeRule(subjectName)
  const ranges = buildEffectiveSubjectGradeRanges(schoolInfo?.subjectGradeRules, standardDomainSettings);
  const allowedGrades = ranges[canonicalSubject];
  if (!allowedGrades) {
    return {
      subjectName: canonicalSubject || subjectName,
      grade: numericGrade,
      allowedGrades: null,
      allowed: true,
      reason: '',
    };
  }

  const allowed = allowedGrades.includes(numericGrade);
  return {
    subjectName: canonicalSubject,
    grade: numericGrade,
    allowedGrades,
    allowed,
    reason: allowed
      ? ''
      : `科目「${subjectName}」僅允許 ${formatAllowedGrades(allowedGrades)} 年級，${numericGrade} 年級不可排入`,
  };
}

export function sanitizeRequirementsByGrade(requirements, grade, schoolInfo = null, standardDomainSettings = null) {
  if (!Array.isArray(requirements)) {
    return { requirements: [], removed: [] };
  }

  const kept = [];
  const removed = [];

  for (const req of requirements) {
    const subjectName = req?.subject || req?.subjectName || req?.name || '';
    const validation = getSubjectGradeValidation(subjectName, grade, schoolInfo, standardDomainSettings);
    if (validation.allowed) {
      kept.push(req);
    } else {
      removed.push({
        ...req,
        reason: validation.reason,
      });
    }
  }

  return { requirements: kept, removed };
}

/**
 * 過濾科目列表，只保留適用於指定年級的科目
 * @param {Array} subjects - 科目陣列，每個元素至少有 subject 或 name 欄位
 * @param {number} grade - 年級
 * @returns {Array} 過濾後的科目陣列
 */
export function filterSubjectsByGrade(subjects, grade, schoolInfo = null, standardDomainSettings = null) {
  if (!subjects || !Array.isArray(subjects)) {
    return [];
  }

  return subjects.filter(s => {
    const subjectName = s.subject || s.name || s.subject_name || '';
    return isSubjectApplicableToGrade(subjectName, grade, schoolInfo, standardDomainSettings);
  });
}

/**
 * 過濾課程需求列表，移除不符合規則的需求
 * 規則：
 * 1. periods <= 0 的需求不保留
 * 2. 科目不適用於該年級的需求不保留
 * @param {Array} requirements - 課程需求陣列
 * @param {number} grade - 年級
 * @returns {Array} 過濾後的需求陣列
 */
export function filterValidRequirements(requirements, grade, schoolInfo = null, standardDomainSettings = null) {
  if (!requirements || !Array.isArray(requirements)) {
    return [];
  }

  return requirements.filter(req => {
    // 0 節不配課
    if (req.periods == null || req.periods <= 0) {
      return false;
    }

    // 科目年級適用性檢查
    const subjectName = req.subject || req.subjectName || req.name || '';
    if (!isSubjectApplicableToGrade(subjectName, grade, schoolInfo, standardDomainSettings)) {
      return false;
    }

    return true;
  });
}
