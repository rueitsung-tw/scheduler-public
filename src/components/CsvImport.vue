<template>
  <div class="csv-import-container">
    <h3>📥 批次匯入教師名單 (CSV)</h3>
    <div class="upload-area">
      <input type="file" accept=".csv" @change="handleFileUpload" class="file-input" id="csv-upload" />
      <label for="csv-upload" class="upload-btn">📂 選擇 CSV</label>
      <button @click="downloadTemplate" class="download-btn">📄 下載範本</button>
    </div>
    <div v-if="parsedData.length > 0" class="preview-area">
      <p class="preview-info">✅ 已解析 {{ parsedData.length }} 筆教師資料</p>
      <div class="preview-table-wrapper">
        <table class="preview-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>職務別</th>
              <th>每週節數</th>
              <th>帶領班級</th>
              <th>專長科目</th>
              <th>志願1 (年級)</th>
              <th>志願2 (年級)</th>
              <th>志願3 (年級)</th>
              <th>Google 帳號</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, idx) in parsedData" :key="idx">
              <td>{{ t.name }}</td>
                <td>{{ 
                  t.type === 'homeroom' ? '導師' : 
                  t.type === 'special_ed_resource' ? '特教資源' : 
                  t.type === 'admin' ? '行政' : 
                  '科任' 
                }}</td>
              <td>{{ t.max_periods }}</td>
              <td>{{ t.assignedClass || '-' }}</td>
              <td>{{ getExpertiseDisplay(t) }}</td>
              <td>{{ t.pref_grade1 || '-' }}</td>
              <td>{{ t.pref_grade2 || '-' }}</td>
              <td>{{ t.pref_grade3 || '-' }}</td>
              <td>{{ t.google_account || '未綁定' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <button @click="confirmImport" class="confirm-btn">確認匯入 {{ parsedData.length }} 筆</button>
    </div>
  </div>
</template>

<script>
export const normalizeTeacherTypeLabel = (value) => {
  const label = String(value || '').trim()
  const typeMap = {
    '導師': 'homeroom',
    '行政': 'admin',
    '科任': 'subject',
    '專任': 'subject',
    '專科': 'subject',
    '特殊': 'subject',
    'special': 'subject',
    '特教': 'special_ed_resource',
    '特教老師': 'special_ed_resource',
    '特教資源': 'special_ed_resource'
  }
  return typeMap[label] || 'subject'
}
</script>

<script setup>
import { ref } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import { sanitizeRequirementsByGrade } from '../utils/gradeSubjectUtils'

const scheduleStore = useScheduleStore()
const parsedData = ref([])

// 🚀 Phase 2: 專長顯示輔助函式
// 格式：體育(17), 健康(2) 或 單純 體育, 健康（舊版無配額時）
const getExpertiseDisplay = (teacher) => {
  if (teacher.expertise_allocations && Array.isArray(teacher.expertise_allocations) && teacher.expertise_allocations.length > 0) {
    return teacher.expertise_allocations
      .map(a => {
        const quota = a.quota > 0 ? `(${a.quota})` : ''
        return `${a.subject}${quota}`
      })
      .join(', ')
  }
  // 舊版格式（純科目名稱陣列）
  if (Array.isArray(teacher.expertiseSubjects)) {
    return teacher.expertiseSubjects.join(', ')
  }
  return '-'
}

const downloadTemplate = () => {
  // ✅ CSV 範本（v2）：支援 3 組專長 + 各別配課節數
  // 欄位：姓名, 職務別, 每週節數, 職位, 帶領班級,
  //       專長1, 專長1節數, 專長2, 專長2節數, 專長3, 專長3節數,
  //       志願1年級, 志願2年級, 志願3年級, Google 帳號
  const csv = `\uFEFF姓名,職務別,每週節數,職位,帶領班級,專長1,節數1,專長2,節數2,專長3,節數3,志願1 (年級),志願2 (年級),志願3 (年級),Google 帳號\n王大明,導師,,,101,,,,,,,,,wanger@school.tw \n李小華,任,22,科任,,自然,15,資訊,5,,,,,,liha@school.tw\n張小鳳,任,18,科任,,體育,12,健康,4,,,,,\n`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = '教師名單範本_v2.csv'
  link.click()
}

const parseCSVLine = (line) => {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}


// ✅ 已移除 subjectAliasMap 與 normalizeSubject
// 科目名稱保留原始值，不做任何 alias 轉換

// 🚀 修正：保留原始班級名稱格式，不強制轉換
// 系統中可能存在「1年1班」或「101」等不同命名方式，
// 保留原始值讓 confirmImport 做智能匹配
const normalizeClassName = (rawClass) => {
  if (!rawClass) return ''
  return String(rawClass).trim()
}

// 🚀 新增：將 3 位數字班級碼 (如 101) 轉換為「1年1班」格式
const codeToFullClassName = (code) => {
  const strCode = String(code).trim()
  if (strCode.length === 3 && !isNaN(strCode)) {
    const grade = strCode.charAt(0)
    const clsNum = parseInt(strCode.substring(1), 10)
    return `${grade}年${clsNum}班`
  }
  return null
}
const getGradeFromClassName = (className) => {
  const match = String(className).match(/(\d+)\s*(撟揉grade)/i) || String(className).match(/^(\d)/)
  return match ? parseInt(match[1], 10) : 1
}

// 🚀 新增：從完整班級名稱(如「1年1班」)提取 3 位數字碼 (如 101)
const fullClassToCode = (fullName) => {
  const match = String(fullName).match(/(\d+)年(\d+)班/)
  if (match) {
    const grade = match[1]
    const clsNum = match[2].padStart(2, '0')
    return grade + clsNum // 例如 "1" + "01" = "101"
  }
  return null
}

// 🚀 透過 CSV 標頭名稱建立欄位索引對應表（精確匹配，不再依賴硬編碼 Index）
function buildHeaderMap(headers) {
  const map = {}
  headers.forEach((h, idx) => {
    const key = h.trim().replace(/\s+/g, ' ') // 統一多餘空白
    map[key] = idx
  })
  return map
}

// 根據標頭判斷 CSV 版本（V2 會有「專長1」或「節數1」等欄位）
function detectCSVVersionByHeader(headers) {
  const headerKeys = Object.keys(headers)
  // ✅ Bug 3 修復：需分開檢查兩個 key 是否都存在
  const hasExpertiseCol = headerKeys.some(k => k === '專長1' || k.includes('專長1'))
  const hasQuotaCol = headerKeys.some(k => k === '節數1' || k.includes('節數1'))
  if (hasExpertiseCol && hasQuotaCol) return 'v2'
  if (hasExpertiseCol) return 'v2'
  return 'v1'
}

// 从 headerMap 安全取值：支援彈性比對標頭名稱
function getValByHeader(row, headerMap, ...possibleKeys) {
  for (const key of possibleKeys) {
    // 精確匹配
    if (headerMap[key] !== undefined && row[headerMap[key]]) return row[headerMap[key]].trim()
    // 模糊匹配：標頭包含關鍵字
    const found = Object.keys(headerMap).find(k => k.includes(key))
    if (found && row[headerMap[found]]) return row[headerMap[found]].trim()
  }
  return ''
}

const handleFileUpload = (e) => {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    // 🚀 BugFix: 主動剝除 UTF-8 BOM，防止第一個欄位名稱異常
    const rawText = ev.target.result.replace(/^\uFEFF/, '')
    const lines = rawText.split('\n').filter(l => l.trim() !== '')
    if (lines.length < 2) {
      alert('⚠️ CSV 檔案為空或只有標頭，請檢查後重新匯入。')
      return
    }

    // 🚀 讀取並解析 CSV 標頭（第一行），建立名稱 → Index 對應表
    const headerRow = parseCSVLine(lines[0])
    const headerMap = buildHeaderMap(headerRow)
    const csvVersion = detectCSVVersionByHeader(headerMap)

    // 🚀 BugFix: 建立姓名查核機制，防止同名資料互相覆寫
    const nameSet = new Set()

    const rawData = []
    let hasError = false

    lines.slice(1).forEach((l, rowIdx) => {
      if (hasError) return // 🚀 BugFix: 若已發生錯誤，提早跳出
      const cols = parseCSVLine(l)
      if (cols.length < 3) return // 跳過空行或無效行

      const name = cols[0] || `第${rowIdx + 2}列`

      // 🚨 防呆機制：同一份檔案發現重複姓名，立即阻斷並警告
      if (nameSet.has(name)) {
        alert(`🚨 檔案解析失敗：發現同名教師「${name}」！\n\n系統目前以姓名作為唯一識別碼。為避免專長資料互相覆蓋（例如美勞專長被體育覆蓋），請在 CSV 中將同名老師的多項專長合併填寫在同一行，若為不同人請加上代號（如：${name}A、${name}B），確認無誤後再重新匯入。`)
        hasError = true
        return
      }
      nameSet.add(name)

      if (csvVersion === 'v2') {
        // ===== 新版格式：透過標頭名稱取值 =====
        const maxPeriodsStr = getValByHeader(cols, headerMap, '每週節數')
        const maxPeriods = parseInt(maxPeriodsStr) || 20

        // 建構 expertise_allocations（按標頭名稱匹配）
        const allocations = []
        for (let i = 1; i <= 3; i++) {
          const subject = getValByHeader(cols, headerMap, `專長${i}`)
          const quotaStr = getValByHeader(cols, headerMap, `節數${i}`)
          const quota = parseInt(quotaStr) || 0
          if (subject && quota > 0) {
            allocations.push({ subject, quota })
          }
        }

        // 去重：若同一科目出現多次，合併節數
        const subjectMap = {}
        allocations.forEach(({ subject, quota }) => {
          if (subjectMap[subject]) {
            subjectMap[subject].quota += quota
          } else {
            subjectMap[subject] = { subject, quota }
          }
        })
        const expertiseAllocations = Object.values(subjectMap)

        // 防呆驗證：專長節數加總不可大於 max_periods
        const totalQuota = expertiseAllocations.reduce((sum, a) => sum + a.quota, 0)
        if (totalQuota > maxPeriods) {
          alert(`⚠️ 第 ${rowIdx + 2} 列「${name}」的專長節數加總 (${totalQuota}) 大於總節數上限 (${maxPeriods})！\n\n請修改 Excel 後重新匯入。本次匯入已阻斷。`)
          hasError = true
          return
        }

        // 🚀 BugFix: 職務別只讀取一次，並補上特教映射
        const jobType = getValByHeader(cols, headerMap, '職務別')

        // 🚀 V2 志願欄位：透過精確標頭名稱取值
        const pref_grade1Raw = getValByHeader(cols, headerMap, '志願1 (年級)', '志願1年級', '志願1')
        const pref_grade2Raw = getValByHeader(cols, headerMap, '志願2 (年級)', '志願2年級', '志願2')
        const pref_grade3Raw = getValByHeader(cols, headerMap, '志願3 (年級)', '志願3年級', '志願3')
        const pref_grade1 = pref_grade1Raw ? parseInt(pref_grade1Raw) || null : null
        const pref_grade2 = pref_grade2Raw ? parseInt(pref_grade2Raw) || null : null
        const pref_grade3 = pref_grade3Raw ? parseInt(pref_grade3Raw) || null : null
        const google_account = getValByHeader(cols, headerMap, 'Google 帳號', 'Google帳號', 'Google')

        rawData.push({
          name,
          type: normalizeTeacherTypeLabel(jobType),
          max_periods: maxPeriods,
          jobTitle: getValByHeader(cols, headerMap, '職位'),
          assignedClass: normalizeClassName(getValByHeader(cols, headerMap, '帶領班級')),
          expertiseSubjects: expertiseAllocations.map(a => a.subject),
          expertise_allocations: expertiseAllocations,
          gradePreferences: [
            ...(pref_grade1 && pref_grade1 >= 1 && pref_grade1 <= 6 ? [pref_grade1] : []),
            ...(pref_grade2 && pref_grade2 >= 1 && pref_grade2 <= 6 ? [pref_grade2] : []),
            ...(pref_grade3 && pref_grade3 >= 1 && pref_grade3 <= 6 ? [pref_grade3] : [])
          ],
          pref_grade1,
          pref_grade2,
          pref_grade3,
          google_account,
          unavailable_slots: []
        })
      } else {
        // ===== 舊版格式 (v1) =====
        const rawSubjects = []
        let pref_grade1 = null
        let pref_grade2 = null
        let pref_grade3 = null
        let google_account = ''

        for (let i = 3; i < cols.length; i++) {
          const val = cols[i].trim()
          if (val) {
            rawSubjects.push(val)
          }
        }
        const pref_grade1Raw = cols[6]?.trim()
        const pref_grade2Raw = cols[7]?.trim()
        const pref_grade3Raw = cols[8]?.trim()
        if (pref_grade1Raw && !isNaN(pref_grade1Raw)) pref_grade1 = parseInt(pref_grade1Raw)
        if (pref_grade2Raw && !isNaN(pref_grade2Raw)) pref_grade2 = parseInt(pref_grade2Raw)
        if (pref_grade3Raw && !isNaN(pref_grade3Raw)) pref_grade3 = parseInt(pref_grade3Raw)

        // 舊版第 9 欄是 Google 帳號
        if (cols[9]?.trim()) google_account = cols[9].trim()

        // 🚀 BugFix: 職務別只讀取一次，並補上特教映射
        const jobTypeV1 = getValByHeader(cols, headerMap, '職務別')

        rawData.push({
          name,
          type: normalizeTeacherTypeLabel(jobTypeV1),
          max_periods: parseInt(cols[2]?.trim()) || 20,
          jobTitle: getValByHeader(cols, headerMap, '職位') || cols[3]?.trim(),
          assignedClass: normalizeClassName(getValByHeader(cols, headerMap, '帶領班級') || cols[4]?.trim()),
          expertiseSubjects: [...new Set(rawSubjects)],
          expertise_allocations: [],
          gradePreferences: [
            ...(pref_grade1 && pref_grade1 >= 1 && pref_grade1 <= 6 ? [pref_grade1] : []),
            ...(pref_grade2 && pref_grade2 >= 1 && pref_grade2 <= 6 ? [pref_grade2] : []),
            ...(pref_grade3 && pref_grade3 >= 1 && pref_grade3 <= 6 ? [pref_grade3] : [])
          ],
          pref_grade1,
          pref_grade2,
          pref_grade3,
          google_account,
          unavailable_slots: []
        })
      }
    })

    if (hasError) {
      parsedData.value = []
      e.target.value = '' // 🚀 BugFix: 錯誤時清空 Input，允許直接重新上傳同名檔案
      return
    }

    parsedData.value = rawData
    e.target.value = '' // 🚀 BugFix: 成功解析也清空 Input
  }
  reader.readAsText(file, 'UTF-8')
}

const confirmImport = async () => {
  // ✅ Bug 2 修復：宣告在迴圈外，迴圈內才賦予真實 ID
  let firstTeacherId = null

  // 🔥 響應式修復：複製新陣列，避免直接修改 Pinia 陣列內部導致 Vue 失去響應式
  const newTeachers = [...scheduleStore.teachers]
  const newClasses = [...scheduleStore.classes]

  parsedData.value.forEach(importedTeacher => {
    // ✅ Bug 1 修復：先做班級匹配並更新 assignedClass，再存入陣列
    if (importedTeacher.type === 'homeroom' && importedTeacher.assignedClass) {
      const rawClass = importedTeacher.assignedClass
      let cls = newClasses.find(c => c.name === rawClass)

      if (!cls) {
        const fullName = codeToFullClassName(rawClass) || rawClass  // "101" → "1年1班"
        newClasses.push({
        name: fullName,                      // ← 改用完整名稱
        homeroom_teacher: importedTeacher.name,
        course_requirements: []
        })
        importedTeacher.assignedClass = fullName  // ← 同步更新教師的 assignedClass
        console.log(`⚠️ 班級 ${rawClass} 不存在，已自動建立「${fullName}」並綁定導師 ${importedTeacher.name}`)
        }
      if (!cls) {
        const code = fullClassToCode(rawClass)
        if (code) cls = newClasses.find(c => c.name === code)
      }

      if (cls) {
        // 🚀 修正：防呆機制 - 清空該老師原本可能帶領的其他班級，確保 1 對 1
        newClasses.forEach(c => {
          if (c.homeroom_teacher === importedTeacher.name && c.name !== cls.name) {
            c.homeroom_teacher = ''
          }
          // 👻 幽靈獵殺：如果發現這老師還綁在舊的 3 碼班級上，強制解綁
          const codeMatch = fullClassToCode(cls.name);
          if (codeMatch && c.name === codeMatch) {
              c.homeroom_teacher = '';
          }
        });

        cls.homeroom_teacher = importedTeacher.name
        importedTeacher.assignedClass = cls.name  // ← 先改好正確的系統班級名稱
        console.log(`✅ 導師 ${importedTeacher.name} 已綁定班級 ${cls.name}`)
      } else {
        newClasses.push({
          name: rawClass,
          homeroom_teacher: importedTeacher.name,
          course_requirements: []
        })
        console.log(`⚠️ 班級 ${rawClass} 不存在，已自動建立並綁定導師 ${importedTeacher.name}`)
      }
    }

    // 寫入新陣列 (此時 importedTeacher 已具備正確的 assignedClass)
    const existingIdx = newTeachers.findIndex(t => t.name === importedTeacher.name)
    if (existingIdx !== -1) {
      const oldT = newTeachers[existingIdx]
      newTeachers[existingIdx] = {
        ...oldT,
        ...importedTeacher,
        unavailable_slots: oldT.unavailable_slots || []
      }
      // ✅ Bug 2 修復：取既有教師的 teacher_id
      if (!firstTeacherId) firstTeacherId = oldT.teacher_id || oldT.id || importedTeacher.name
    } else {
      const uniqueId = 'T' + Date.now() + '-' + Math.random().toString(36).substring(2, 9)
      newTeachers.push({
        id: uniqueId,
        teacher_id: uniqueId,
        ...importedTeacher,
        unavailable_slots: importedTeacher.unavailable_slots || []
      })
      // ✅ Bug 2 修復：取剛生成的 uniqueId
      if (!firstTeacherId) firstTeacherId = uniqueId
    }
  })

  // 🔥 響應式修復：強制觸發 Vue 更新！(改變記憶體位址)
  const sanitizedClasses = newClasses.map(cls => {
    if (!Array.isArray(cls.course_requirements)) return cls
    const grade = Number(cls.grade || getGradeFromClassName(cls.name))
    const sanitized = sanitizeRequirementsByGrade(cls.course_requirements, grade)
    return {
      ...cls,
      grade,
      course_requirements: sanitized.requirements,
    }
  })

  scheduleStore.teachers = newTeachers
  scheduleStore.classes = sanitizedClasses
  scheduleStore.markScheduleDirty()

  try {
    await scheduleStore.syncToCloud()
    alert('✅ 教師名單匯入成功！已同步至資料庫。')

    // 🔥 響應式修復：使用 setTimeout 確保 DOM 完全更新後，再觸發表單讀取
    setTimeout(() => {
      if (firstTeacherId) {
        scheduleStore.setEditingTeacherId(firstTeacherId)
      }
    }, 100)

    parsedData.value = []
  } catch (err) {
    alert('❌ 儲存失敗！')
  }
}
</script>

<style scoped>
.csv-import-container { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
.upload-btn { display: inline-block; background: #6366f1; color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-right: 10px; }
.upload-btn:hover { background: #4f46e5; }
.file-input { display: none; }
.download-btn { padding: 8px 16px; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer; font-weight: bold;}
.download-btn:hover { background: #e2e8f0; }
.preview-area { margin-top: 15px; padding-top: 15px; border-top: 1px dashed #cbd5e1;}
.confirm-btn { background: #10b981; color: white; padding: 10px 20px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;}
.confirm-btn:hover { background: #059669; }
.preview-info { color: #059669; font-weight: bold; margin-bottom: 10px; }
.preview-table-wrapper { max-height: 300px; overflow-y: auto; margin-bottom: 15px; border: 1px solid #e2e8f0; border-radius: 6px; }
.preview-table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
.preview-table th, .preview-table td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; text-align: left; }
.preview-table th { background: #f8fafc; font-weight: 600; color: #475569; position: sticky; top: 0; }
.preview-table tr:hover { background: #f1f5f9; }
</style>
