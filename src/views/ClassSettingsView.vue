<template>
  <div class="class-settings-view">
    <h1>班級設定</h1>

    <div class="form-container">
      <div class="form-group">
        <label for="class-select">選擇班級</label>
        <select
          v-model="currentClassForm.name"
          @change="loadClassData"
          id="class-select"
        >
          <option value="" disabled>請選擇班級</option>
          <option v-for="cls in scheduleStore.classes" :key="cls.name" :value="cls.name">
            {{ cls.name }}班
          </option>
          <option value="new">＋ 新增班級</option>
        </select>
      </div>

      <div class="form-group">
        <label for="homeroom-teacher">導師</label>
        <select v-model="currentClassForm.homeroom_teacher" id="homeroom-teacher">
          <option value="" disabled>請選擇導師</option>
          <option v-for="t in scheduleStore.teachers" :key="t.name" :value="t.name">
            {{ t.name }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label>課程需求</label>
        <div v-for="(req, index) in currentClassForm.course_requirements" :key="index" class="requirement-item">
          <select
            :value="req.subject"
            @change="applySubjectSelection(req, $event)"
          >
            <option value="" disabled>請選擇科目</option>
            <option
              v-for="subjName in availableSubjectsForClass"
              :key="subjName"
              :value="subjName"
            >
              {{ subjName }}
              <template v-if="isLegacySubject(subjName)"> (舊資料保留)</template>
            </option>
          </select>

          <div v-if="isHomeroomSubject(req.subject)" class="locked-teacher-badge">
            ✅ 由導師 ({{ currentClassForm.homeroom_teacher || '未指定' }}) 任教
          </div>

          <select v-else v-model="req.teacher">
            <option value="" disabled>請選擇老師</option>
            <option v-for="t in scheduleStore.teachers" :key="t.name" :value="t.name">
              {{ t.name }}
            </option>
          </select>

          <!-- Legacy 科目警告 badge -->
          <div v-if="isLegacySubject(req.subject)" class="warning-badge">
            ⚠️ 舊資料保留
          </div>

          <button @click="removeRequirement(index)" class="btn-remove">✕</button>
        </div>
        <button @click="addRequirement" class="btn-add">＋ 新增課程需求</button>
      </div>

      <button @click="handleSave" class="btn-save">儲存班級資料</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useScheduleStore } from '../stores/schedule'
import {
  isSubjectApplicableToGrade,
  sanitizeRequirementsByGrade,
  buildAvailableSubjectCatalog,
  findSubjectCatalogEntry,
  enrichRequirementsWithMetadata,
  validateRequirementsAgainstCatalog
} from '../utils/gradeSubjectUtils'

const route = useRoute()
const scheduleStore = useScheduleStore()
const currentClassForm = ref({
  name: '',
  homeroom_teacher: '',
  course_requirements: []
})

const currentClassGrade = computed(() => getGrade(currentClassForm.value.name))

// 🆕 Catalog-driven subject metadata (取代純字串陣列)
const availableSubjectCatalog = computed(() => {
  const grade = currentClassGrade.value
  if (grade == null) return []

  return buildAvailableSubjectCatalog({
    grade,
    standardDomainSettings: scheduleStore.standardDomainSettings,
    alternativeMatrix: scheduleStore.schoolInfo?.alternativeMatrix ?? {},
    currentRequirements: currentClassForm.value.course_requirements ?? []
  })
})

// 保留純名稱陣列供 template 中使用
const availableSubjectsForClass = computed(() =>
  availableSubjectCatalog.value.map(e => e.subject)
)

// 🆕 判斷是否為 legacy 科目
const isLegacySubject = (subjectName) => {
  const entry = findSubjectCatalogEntry(subjectName, availableSubjectCatalog.value)
  return entry?.isLegacy || false
}

// 透過 query string 判斷是否為「快速設定」模式
const quickMode = ref(false)

onMounted(() => {
  const className = route.query.class
  if (className && scheduleStore.classes.find(c => c.name === className)) {
    currentClassForm.value.name = className
    quickMode.value = true
    loadClassData()
  }
})

// 輔助函式：從班級名稱提取年級數字
const getGrade = (className) => {
  if (!className) return 1
  const match = String(className).match(/(\d+)\s*(年|grade)/i) || String(className).match(/^(\d)/)
  return match ? parseInt(match[1], 10) : 1
}

// 生成空白課程模板 (⚠️ 修正：保留 defaultTeacher 屬性供 AI 判讀)
// 🔒 加入年級適用性檢查與 0 節過濾
// 🆕 納入 alternativeMatrix 彈性課
const generateTemplate = () => {
  // 嘗試從已選班級或目前表單班級取得年級
  const className = currentClassForm.value.name || ''
  const grade = getGrade(className)

  // 標準課程需求
  const standardReqs = scheduleStore.standardDomainSettings
    .filter(domain => {
      // 0 節不配課
      const rawVal = domain.periods?.[grade] ?? 0
      const matrixPeriods = Number(rawVal)
      if (isNaN(matrixPeriods) || matrixPeriods <= 0) {
        return false
      }
      // 年級適用性檢查
      if (!isSubjectApplicableToGrade(domain.name, grade)) {
        return false
      }
      return true
    })
    .map(domain => ({
      subject: domain.name,
      defaultTeacher: domain.defaultTeacher,
      periods: Number(domain.periods?.[grade] ?? 0),
      teacher: ''
    }))

  // 🆕 從 alternativeMatrix 產生彈性課需求
  const altCourses = scheduleStore.schoolInfo?.alternativeMatrix?.[String(grade)] || []
  const altReqs = altCourses
    .filter(alt => {
      const periods = Number(alt.periods ?? 0)
      if (isNaN(periods) || periods <= 0) return false
      const name = alt.subject || alt.name
      if (!name) return false
      if (!isSubjectApplicableToGrade(name, grade)) return false
      return true
    })
    .map(alt => ({
      subject: alt.subject || alt.name,
      defaultTeacher: alt.defaultTeacher || 'subject',
      periods: Number(alt.periods ?? 0),
      teacher: ''
    }))

  currentClassForm.value = {
    name: className,
    homeroom_teacher: currentClassForm.value.homeroom_teacher || '',
    course_requirements: [...standardReqs, ...altReqs]
  }
}

const loadClassData = () => {
  if (!currentClassForm.value.name) return
  const existingClass = scheduleStore.classes.find(c => c.name === currentClassForm.value.name)
  if (existingClass) {
    // ⚠️ 極限防呆如果舊資料的 homeroom_teacher 爛掉了變成物件，強制把它轉回純字串
    const parsed = JSON.parse(JSON.stringify(existingClass))
    if (typeof parsed.homeroom_teacher === 'object' && parsed.homeroom_teacher !== null) {
      parsed.homeroom_teacher = parsed.homeroom_teacher.name || ''
    }
    currentClassForm.value = parsed
  } else {
    generateTemplate()
  }
}

const isHomeroomSubject = (subjectName) => {
  if (!subjectName) return false

  // 優先從 catalog 查找
  const entry = findSubjectCatalogEntry(subjectName, availableSubjectCatalog.value)
  if (entry && entry.defaultTeacher === 'homeroom') return true

  // fallback：檢查 standardDomainSettings（相容性）
  const subject = scheduleStore.standardDomainSettings.find(s =>
    s.name === subjectName || s.name.includes(subjectName) || subjectName.includes(s.name)
  )
  return subject && subject.defaultTeacher === 'homeroom'
}

/**
 * 🆕 當使用者選擇科目時，同步更新 req 的 metadata
 * 🔧 用戶修正：必須用 $event.target.value，不要依賴還沒更新的 req.subject
 */
const applySubjectSelection = (req, event) => {
  const subjectName = event.target.value
  const entry = findSubjectCatalogEntry(subjectName, availableSubjectCatalog.value)

  req.subject = subjectName

  if (entry) {
    req.defaultTeacher = entry.defaultTeacher

    // 若為導師科目，清空 teacher 讓 UI 顯示 locked badge
    if (entry.defaultTeacher === 'homeroom') {
      req.teacher = ''
    }
  } else {
    // fallback：未知科目預設科任
    req.defaultTeacher = 'subject'
  }
}

const addRequirement = () => {
  currentClassForm.value.course_requirements.push({
    subject: '',
    defaultTeacher: 'subject', // 預設新增的為科任
    teacher: ''
  })
}

const removeRequirement = (index) => {
  currentClassForm.value.course_requirements.splice(index, 1)
}

const handleSave = async () => {
  if (!currentClassForm.value.name) {
    alert('請先選擇班級！')
    return
  }

  // 1. 對照 catalog 驗證（取代原有的空字串檢查）
  const catalog = availableSubjectCatalog.value
  const validation = validateRequirementsAgainstCatalog(
    currentClassForm.value.course_requirements,
    catalog
  )

  if (!validation.valid) {
    const issueLines = validation.issues.map(i => i.message).join('\n')
    alert(`❌ 課程需求有問題：\n${issueLines}\n\n請修正後再儲存。`)
    return
  }

  // 2. Legacy 科目警告（不攔截，僅提示）
  const legacyReqs = currentClassForm.value.course_requirements.filter(req => {
    const entry = findSubjectCatalogEntry(req.subject, catalog)
    return entry?.isLegacy
  })

  if (legacyReqs.length > 0) {
    const legacyNames = legacyReqs.map(r => r.subject).join('、')
    const proceed = confirm(
      `⚠️ 以下科目為舊資料殘留，建議修正或刪除：\n${legacyNames}\n\n是否仍要儲存？`
    )
    if (!proceed) return
  }

  // 3. 存檔前統一補齊 metadata
  const enriched = enrichRequirementsWithMetadata(
    currentClassForm.value.course_requirements,
    catalog
  )
  currentClassForm.value.course_requirements = enriched

  // 4. 覆蓋確認
  const exists = scheduleStore.classes.some(c => c.name === currentClassForm.value.name)
  if (exists) {
    const confirmOverwrite = confirm(`⚠️ 警告：大倉庫中已經有 ${currentClassForm.value.name}班 的排課資料。\n\n繼續儲存將會「完全覆蓋」原本的設定！\n請問是否確定要覆蓋？`)
    if (!confirmOverwrite) return
  }

  // 5. 年級適用性清洗
  const grade = getGrade(currentClassForm.value.name)
  const sanitized = sanitizeRequirementsByGrade(currentClassForm.value.course_requirements || [], grade)
  if (sanitized.removed.length > 0) {
    currentClassForm.value.course_requirements = sanitized.requirements
    alert(`已自動移除不適用於 ${grade} 年級的科目：${sanitized.removed.map(item => item.subject).join('、')}`)
  }

  scheduleStore.saveClass(currentClassForm.value)
  try {
    await scheduleStore.syncToCloud()
    alert(`✅ ${currentClassForm.value.name}班 資料已成功儲存至大倉庫與資料庫！`)
  } catch {
    alert('❌ 儲存失敗！')
  }
}
</script>

<style scoped>
.class-settings-view { padding: 20px; }
.class-settings-view h1 { margin-bottom: 30px; color: #333; }
.form-container { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px; max-width: 600px; }
.form-group { margin-bottom: 20px; }
.form-group label { display: block; margin-bottom: 8px; font-weight: 500; color: #555; }
.form-group select { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
.requirement-item { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
.requirement-item select { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
.btn-remove { padding: 8px 12px; background: #ff4444; color: white; border: none; border-radius: 4px; cursor: pointer; }
.btn-remove:hover { background: #cc0000; }
.btn-add { padding: 8px 16px; background: #4a90d9; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 8px; }
.btn-add:hover { background: #3a7bc8; }
.btn-save { width: 100%; padding: 12px; background: #28a745; color: white; border: none; border-radius: 4px; font-size: 16px; font-weight: 500; cursor: pointer; margin-top: 20px; }
.btn-save:hover { background: #218838; }
.locked-teacher-badge { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: #d1fae5; border: 1px solid #10b981; border-radius: 6px; color: #065f46; font-weight: bold; font-size: 14px; cursor: default; user-select: none; }
.warning-badge { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; color: #92400e; font-weight: bold; font-size: 14px; cursor: default; user-select: none; }
</style>
