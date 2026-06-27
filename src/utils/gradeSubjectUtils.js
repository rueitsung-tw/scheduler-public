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

// ─────────────────────────────────────────────
// Ghost Subject Fix: Catalog-driven metadata tools
// ─────────────────────────────────────────────

/**
 * 建構班級課程的完整科目 catalog
 * @param {object} params
 * @param {number} params.grade - 年級 (1-6)
 * @param {Array} [params.standardDomainSettings=[]] - 領域科目清單（含 defaultTeacher）
 * @param {object} [params.alternativeMatrix={}] - alternativeMatrix（key 為 grade string）
 * @param {Array} [params.currentRequirements=[]] - 目前班級的 course_requirements（用於補入 legacy）
 * @returns {Array<{subject, defaultTeacher, source, isLegacy}>}
 */
export function buildAvailableSubjectCatalog({
  grade,
  standardDomainSettings = [],
  alternativeMatrix = {},
  currentRequirements = [],
}) {
  const catalog = []
  const seen = new Set()

  // 1. 從 standardDomainSettings 提取該年級適用的科目，帶 metadata
  for (const domain of standardDomainSettings) {
    if (!isSubjectApplicableToGrade(domain.name, grade)) continue
    const periods = Number(domain.periods?.[grade] ?? 0)
    if (isNaN(periods) || periods <= 0) continue
    if (seen.has(domain.name)) continue
    seen.add(domain.name)
    catalog.push({
      subject: domain.name,
      defaultTeacher: domain.defaultTeacher || 'subject',
      source: 'standard',
      isLegacy: false,
    })
  }

  // 2. 從 alternativeMatrix 提取該年級彈性課，帶 metadata
  const altKey = String(grade)
  const altList = alternativeMatrix[altKey] || []
  for (const alt of altList) {
    const name = alt.subject || alt.name || ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    catalog.push({
      subject: name,
      defaultTeacher: alt.defaultTeacher || 'subject',
      source: 'alternative',
      isLegacy: false,
    })
  }

  // 3. 掃描 currentRequirements，找出不在 catalog 中的 legacy 科目
  for (const req of currentRequirements) {
    const name = req?.subject
    if (!name || typeof name !== 'string' || name.trim() === '' || seen.has(name)) continue
    seen.add(name)
    // 🔧 用戶修正：優先沿用 req.defaultTeacher，沒有才 fallback 'subject'
    catalog.push({
      subject: name,
      defaultTeacher: req?.defaultTeacher || 'subject',
      source: 'legacy',
      isLegacy: true,
    })
  }

  return catalog
}

/**
 * 在 catalog 中查找指定科目名稱的 entry
 * @param {string} subjectName
 * @param {Array} catalog - buildAvailableSubjectCatalog() 的回傳值
 * @returns {{subject, defaultTeacher, source, isLegacy} | null}
 */
export function findSubjectCatalogEntry(subjectName, catalog) {
  if (!subjectName || !Array.isArray(catalog)) return null
  return catalog.find(e => e.subject === subjectName) || null
}

/**
 * 依 catalog 補齊 course_requirements 的 metadata
 * @param {Array} requirements - 課程需求陣列
 * @param {Array} catalog - 完整科目 catalog
 * @returns {Array} 補齊後的 requirements（不修改原陣列）
 */
export function enrichRequirementsWithMetadata(requirements, catalog) {
  if (!Array.isArray(requirements)) return []
  return requirements.map(req => {
    const entry = findSubjectCatalogEntry(req?.subject, catalog)
    if (entry && !req.defaultTeacher) {
      return { ...req, defaultTeacher: entry.defaultTeacher }
    }
    return { ...req }
  })
}

/**
 * 驗證課程需求對照 catalog，回傳問題清單
 * @param {Array} requirements - 課程需求陣列
 * @param {Array} catalog - 完整科目 catalog
 * @returns {{ valid: boolean, issues: Array<{index, subject, issueType, message}> }}
 */
export function validateRequirementsAgainstCatalog(requirements, catalog) {
  const issues = []
  const catalogSubjects = new Set(catalog.map(e => e.subject))

  requirements.forEach((req, index) => {
    const subj = req?.subject
    if (!subj || String(subj).trim() === '') {
      issues.push({ index, subject: subj, issueType: 'empty', message: `第 ${index + 1} 筆為空白科目` })
    } else if (!catalogSubjects.has(subj)) {
      // 不應該發生（因為 catalog 已包含 legacy），但若發生仍記錄
      issues.push({ index, subject: subj, issueType: 'unknown', message: `第 ${index + 1} 筆科目「${subj}」不在任何來源中` })
    }
  })

  return { valid: issues.length === 0, issues }
}
