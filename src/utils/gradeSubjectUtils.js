/**
 * 年級科目適用範圍判斷工具
 *
 * 核心規則：
 * - `生活` → 只允許 1-2 年級
 * - `自然科學` / `音樂` / `美勞` / `社會` / `綜合活動` / `科技-資訊` → 只允許 3-6 年級
 * - 其他科目 → 不限制年級
 */

/**
 * 定義科目的適用年級範圍
 * @returns {Object} 科目名稱到適用年級陣列的映射
 */
function getSubjectGradeRanges() {
  return {
    // 生活 → 只允許 1-2 年級
    '生活': [1, 2],

    // 以下科目只允許 3-6 年級
    '自然科學': [3, 4, 5, 6],
    '音樂': [3, 4, 5, 6],
    '美勞': [3, 4, 5, 6],
    '社會': [3, 4, 5, 6],
    '綜合活動': [3, 4, 5, 6],
    '科技-資訊': [3, 4, 5, 6],
  };
}

/**
 * 檢查指定科目是否適用於指定年級
 * @param {string} subjectName - 科目名稱
 * @param {number} grade - 年級 (1-6)
 * @returns {boolean} 是否適用
 */
export function isSubjectApplicableToGrade(subjectName, grade) {
  if (!subjectName || typeof grade !== 'number') {
    return true;
  }

  const ranges = getSubjectGradeRanges();
  const applicableGrades = ranges[subjectName];

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

export function getSubjectGradeValidation(subjectName, grade) {
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

  const ranges = getSubjectGradeRanges();
  const allowedGrades = ranges[subjectName];
  if (!allowedGrades) {
    return {
      subjectName,
      grade: numericGrade,
      allowedGrades: null,
      allowed: true,
      reason: '',
    };
  }

  const allowed = allowedGrades.includes(numericGrade);
  return {
    subjectName,
    grade: numericGrade,
    allowedGrades,
    allowed,
    reason: allowed
      ? ''
      : `科目「${subjectName}」僅允許 ${formatAllowedGrades(allowedGrades)} 年級，${numericGrade} 年級不可排入`,
  };
}

export function sanitizeRequirementsByGrade(requirements, grade) {
  if (!Array.isArray(requirements)) {
    return { requirements: [], removed: [] };
  }

  const kept = [];
  const removed = [];

  for (const req of requirements) {
    const subjectName = req?.subject || req?.subjectName || req?.name || '';
    const validation = getSubjectGradeValidation(subjectName, grade);
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
export function filterSubjectsByGrade(subjects, grade) {
  if (!subjects || !Array.isArray(subjects)) {
    return [];
  }

  return subjects.filter(s => {
    const subjectName = s.subject || s.name || s.subject_name || '';
    return isSubjectApplicableToGrade(subjectName, grade);
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
export function filterValidRequirements(requirements, grade) {
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
    if (!isSubjectApplicableToGrade(subjectName, grade)) {
      return false;
    }

    return true;
  });
}
