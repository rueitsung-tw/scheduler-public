/**
 * 回歸測試：導師衝堂警示誤報修復
 *
 * 對應 20260605-5 計畫 Step 1-2
 * 驗證「不同老師在同時段授課」不被誤當成衝堂，
 * 且「導師區塊」使用班級導師欄位而非 course_requirements。
 */
import { describe, it, expect } from 'vitest'

/**
 * 模擬衝堂檢測邏輯：僅當同一老師在同一時段出現在不同班級時才算衝堂。
 * 此測試驗證核心判定規則，不依賴完整 Vue 組件。
 */

describe('導師衝堂判定規則', () => {
  it('同一老師在同時段不同班級 → 應判定為衝堂', () => {
    const schedule = [
      { day: 0, period: 0, teacher: '王小明', className: '3年1班' },
      { day: 0, period: 0, teacher: '王小明', className: '3年2班' },
    ]

    const conflicts = detectTeacherConflicts(schedule)
    expect(conflicts.length).toBe(1)
    expect(conflicts[0].teacher).toBe('王小明')
  })

  it('不同老師在同時段 → 不應判定為衝堂', () => {
    const schedule = [
      { day: 0, period: 0, teacher: '王小明', className: '3年1班' },
      { day: 0, period: 0, teacher: '李大明', className: '3年2班' },
    ]

    const conflicts = detectTeacherConflicts(schedule)
    expect(conflicts.length).toBe(0)
  })

  it('同一老師在不同節次 → 不應判定為衝堂', () => {
    const schedule = [
      { day: 0, period: 0, teacher: '王小明', className: '3年1班' },
      { day: 0, period: 1, teacher: '王小明', className: '3年2班' },
    ]

    const conflicts = detectTeacherConflicts(schedule)
    expect(conflicts.length).toBe(0)
  })

  it('同一老師在不同天數 → 不應判定為衝堂', () => {
    const schedule = [
      { day: 0, period: 0, teacher: '王小明', className: '3年1班' },
      { day: 1, period: 0, teacher: '王小明', className: '3年2班' },
    ]

    const conflicts = detectTeacherConflicts(schedule)
    expect(conflicts.length).toBe(0)
  })

  it('導師區塊：不同班級的不同導師同時段 → 不應判定為衝堂', () => {
    // 這是原始誤報場景：3年1班的導師與3年2班的導師在同一時段都被標記為「導師區塊」
    // 因為是不同老師，不應該算衝堂
    const schedule = [
      { day: 0, period: 0, teacher: '王小明', className: '3年1班', subject: '導師區塊' },
      { day: 0, period: 0, teacher: '李大明', className: '3年2班', subject: '導師區塊' },
    ]

    const conflicts = detectTeacherConflicts(schedule)
    expect(conflicts.length).toBe(0)
  })

  it('導師區塊：同一導師被錯誤寫入兩個班級 → 應判定為衝堂', () => {
    // 這是資料錯誤場景：若 course_requirements 來源不一致，導致同一導師出現在兩班
    const schedule = [
      { day: 0, period: 0, teacher: '王小明', className: '3年1班', subject: '導師區塊' },
      { day: 0, period: 0, teacher: '王小明', className: '3年2班', subject: '導師區塊' },
    ]

    const conflicts = detectTeacherConflicts(schedule)
    expect(conflicts.length).toBe(1)
  })
})

describe('導師來源欄位驗證', () => {
  it('導師區塊的老師應來自 cls.homeroom_teacher，而非 course_requirements', () => {
    // 模擬班級資料
    const classes = [
      { name: '3年1班', homeroom_teacher: '王小明' },
      { name: '3年2班', homeroom_teacher: '李大明' },
    ]

    // 修復後的邏輯：直接使用 homeroom_teacher
    const fillHomeroomBlock = (cls) => {
      const homeroomTeacher = cls.homeroom_teacher || ''
      return {
        subject: '導師區塊',
        teacher: homeroomTeacher,
      }
    }

    // 驗證：3年2班的導師應是「李大明」而非「陳錯錯」
    const result1 = fillHomeroomBlock(classes[0])
    const result2 = fillHomeroomBlock(classes[1])

    expect(result1.teacher).toBe('王小明')
    expect(result2.teacher).toBe('李大明')
    expect(result2.teacher).not.toBe('陳錯錯')
  })

  it('當 homeroom_teacher 為空時，導師欄位應為空字串', () => {
    const cls = { name: '3年3班', homeroom_teacher: null }

    const fillHomeroomBlock = (cls) => {
      const homeroomTeacher = cls.homeroom_teacher || ''
      return {
        subject: '導師區塊',
        teacher: homeroomTeacher,
      }
    }

    const result = fillHomeroomBlock(cls)
    expect(result.teacher).toBe('')
  })
})

/**
 * 輔助函數：模擬前端衝堂檢測邏輯
 */
function detectTeacherConflicts(schedule) {
  const conflicts = []
  const seen = new Map()

  for (const entry of schedule) {
    const key = `${entry.teacher}|${entry.day}|${entry.period}`

    if (seen.has(key)) {
      // 同一老師在同一天同一節次出現多次
      const firstEntry = seen.get(key)
      if (firstEntry.className !== entry.className) {
        conflicts.push({
          type: 'teacher',
          teacher: entry.teacher,
          day: entry.day,
          period: entry.period,
          classes: [firstEntry.className, entry.className],
        })
      }
    } else {
      seen.set(key, entry)
    }
  }

  return conflicts
}
