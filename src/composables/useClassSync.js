/**
 * useClassSync — gradeSettings → Class 記錄同步工具
 *
 * 核心邏輯：
 * - 根據 schoolInfo.gradeSettings 算出期望的班級名稱清單
 * - 與目前 classes 比對，算出要新增/刪除/保留的班級
 * - 有課程需求或課表資料的班級不予刪除（保護機制）
 */

/**
 * 根據 gradeSettings 產出期望的班級名稱清單
 * @param {Object} gradeSettings - { '1': 3, '2': 2, ... }
 * @returns {string[]} 班級名稱陣列
 */
export function computeExpectedClassNames(gradeSettings) {
  const names = []
  if (!gradeSettings) return names

  for (const [grade, count] of Object.entries(gradeSettings)) {
    const num = Number(count) || 0
    for (let i = 1; i <= num; i++) {
      names.push(`${grade}年${i}班`)
    }
  }
  return names
}

/**
 * 從班級名稱提取年級數字
 * @param {string} className - 如 "3年1班"
 * @returns {number} 年級數字
 */
export function getGradeFromClassName(className) {
  const match = String(className).match(/(\d+)\s*(年|grade)/i) || String(className).match(/^(\d)/)
  return match ? parseInt(match[1], 10) : 1
}

/**
 * 比對目前班級與期望班級，算出差異
 * @param {Array} currentClasses - 目前 class 記錄陣列
 * @param {string[]} expectedNames - 期望班級名稱清單
 * @returns {{ toAdd: string[], toRemove: string[], toKeep: string[] }}
 */
export function computeClassDiff(currentClasses, expectedNames) {
  const currentNames = new Set(
    (currentClasses || []).map(c => String(c.name).trim())
  )
  const expectedSet = new Set(expectedNames)

  const toAdd = []
  const toRemove = []
  const toKeep = []

  // 找出需要新增的班級
  for (const name of expectedNames) {
    if (!currentNames.has(name)) {
      toAdd.push(name)
    } else {
      toKeep.push(name)
    }
  }

  // 找出需要刪除的班級
  for (const name of currentNames) {
    if (!expectedSet.has(name)) {
      toRemove.push(name)
    }
  }

  return { toAdd, toRemove, toKeep }
}

/**
 * 檢查班級是否有資料（保護機制）
 * @param {Object} cls - 班級物件
 * @returns {{ hasData: boolean, reason: string }}
 */
export function checkClassHasData(cls) {
  if (!cls) return { hasData: false, reason: '' }

  // 檢查課程需求
  if (cls.course_requirements && Array.isArray(cls.course_requirements) && cls.course_requirements.length > 0) {
    // 過濾掉節數為 0 的空項目
    const meaningful = cls.course_requirements.filter(r => Number(r.periods) > 0)
    if (meaningful.length > 0) {
      return { hasData: true, reason: `已有 ${meaningful.length} 項課程需求` }
    }
  }

  // 檢查課表
  if (cls.timetable) {
    const tt = cls.timetable
    for (const day of Object.keys(tt)) {
      const dayData = tt[day]
      if (dayData && typeof dayData === 'object') {
        for (const period of Object.keys(dayData)) {
          if (dayData[period]) {
            return { hasData: true, reason: `已有課表資料 (${day}天${period}節)` }
          }
        }
      }
    }
  }

  return { hasData: false, reason: '' }
}

/**
 * 建立空殼班級記錄
 * @param {string} name - 班級名稱
 * @returns {Object} 最小班級記錄
 */
export function createMinimalClass(name) {
  const grade = getGradeFromClassName(name)
  return {
    name: name,
    grade: grade,
    homeroom_teacher: '',
    course_requirements: [],
    timetable: { '1': {}, '2': {}, '3': {}, '4': {}, '5': {} }
  }
}
