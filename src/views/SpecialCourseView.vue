<template>
  <div class="special-course-container">
    <h2>🎯 第三軌：特殊專案與抽離課程設定</h2>
    <p class="desc">設定學習中心、創思中心等「精準抽離」課程。</p>

    <div class="form-section">
      <div class="form-row split">
        <div class="form-group">
          <label>1. 課程類別：</label>
          <select v-model="pulloutForm.type">
            <option value="學習中心">學習中心</option>
            <option value="創思中心">創思中心</option>
            <option value="其他抽離">其他抽離課程</option>
          </select>
        </div>
        <div class="form-group">
          <label>2. 鎖定對應學科 (原班級需抽離的課)：</label>
          <select v-model="pulloutForm.subject">
            <option disabled value="">請選擇科目</option>
            <option v-for="sub in availableSubjects" :key="sub" :value="sub">{{ sub }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>3. 特教/負責教師：</label>
          <select v-model="pulloutForm.teacher">
            <option disabled value="">請選擇教師</option>
            <option v-for="t in scheduleStore.teachers" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group class-selector-group">
          <label>4. 參與班級指定方式：</label>
          <div class="radio-group mb-2">
            <label class="rb-label"><input type="radio" value="manual" v-model="pulloutForm.classMode"> 📌 手動指定特定班級</label>
            <label class="rb-label"><input type="radio" value="auto" v-model="pulloutForm.classMode"> 🤖 設定年級範圍，交給 AI 自動湊班 (支援跨年級)</label>
          </div>

          <div v-if="pulloutForm.classMode === 'manual'" class="class-matrix">
            <div v-for="grade in 6" :key="grade" class="grade-row" v-show="getClassesByGrade(grade).length > 0">
              <div class="grade-label">{{ grade }} 年級</div>
              <div class="checkboxes">
                <label v-for="cls in getClassesByGrade(grade)" :key="cls" class="cb-label" :class="{ 'is-selected': pulloutForm.classes.includes(cls) }">
                  <input type="checkbox" :value="cls" v-model="pulloutForm.classes"> {{ cls }}
                </label>
              </div>
            </div>
          </div>

          <div v-else class="ai-class-config">
            <div class="config-row">
              <label>允許挑選的年級池 (可複選)：</label>
              <div class="checkboxes">
                <label v-for="g in 6" :key="g" class="cb-label" :class="{ 'is-selected': pulloutForm.autoGrades.includes(g) }">
                  <input type="checkbox" :value="g" v-model="pulloutForm.autoGrades"> {{ g }} 年級
                </label>
              </div>
            </div>
            <div class="config-row mt-2">
              <label>需湊齊的總班級數：</label>
              <input type="number" v-model="pulloutForm.autoCount" min="1" max="10" class="small-input" /> 班
              <span class="hint-text ml-2">💡 AI 將從上方年級池中，自動尋找課表能完美配合的 {{ pulloutForm.autoCount }} 個班級。</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="ai-action-bar">
      <div class="ai-info">
        <strong>💡 步驟 5：選擇上課時段設定方式</strong>
        <span>您可以點擊下方網格指定絕對時間，或保留彈性交給系統自動安排。</span>
      </div>
      <button @click="handleAutoAI" class="ai-btn">🤖 不指定時間，交給 AI 尋找最佳空檔</button>
    </div>

    <div class="grid-section">
      <div class="timetable-grid">
        <div class="grid-header empty-cell"></div>
        <div class="grid-header" v-for="day in 5" :key="`header-${day}`">星期{{ ['一','二','三','四','五'][day-1] }}</div>

        <template v-for="period in 7" :key="`period-${period}`">
          <div class="grid-time-label">第 {{ period }} 節</div>
          <div
            v-for="day in 5"
            :key="`cell-${day}-${period}`"
            class="grid-cell"
            :class="{
              'is-noon': period === 4
            }"
            @click="handleGridClick(day, period)"
          >
            <span class="hover-text">
              + 手動鎖定此節
            </span>
          </div>
        </template>
      </div>
    </div>

    <div class="courses-list-section">
      <h3>已建立的特殊規則清單</h3>
      <table class="courses-table">
        <thead>
          <tr>
            <th>類型</th>
            <th>上課時間</th>
            <th>參與班級</th>
            <th>課程名稱 / 對應學科</th>
            <th>負責教師</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="course in scheduleStore.specialCourses" :key="course.id">
            <td>
              <span class="badge-purple">
                🧩 精準抽離
              </span>
            </td>
            <td>
              <strong v-if="course.isAutoTime" class="text-ai">🤖 AI 自動安排</strong>
              <strong v-else>{{ formatTime(course) }}</strong>
            </td>
            <td>
              <div v-if="course.isAutoClass" class="auto-class-badge">
                🤖 AI 跨班組合 <br><span class="sub-text">(由 {{ course.autoClassConfig?.grades.join(',') }} 年級中抽 {{ course.autoClassConfig?.count }} 班)</span>
              </div>
              <div v-else class="tags-container">
                <span class="class-tag" v-for="c in course.targetClasses" :key="c">{{ c }}</span>
              </div>
            </td>
            <td>{{ course.name }} <br><small style="color:#64748b" v-if="course.targetSubject">({{ course.targetSubject }})</small></td>
            <td>{{ course.teacher || '無' }}</td>
            <td>
              <button @click="deleteCourse(course.id)" class="delete-btn">刪除</button>
            </td>
          </tr>
          <tr v-if="!scheduleStore.specialCourses || scheduleStore.specialCourses.length === 0">
            <td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">尚無設定任何特殊規則</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const scheduleStore = useScheduleStore()

const pulloutForm = ref({
  type: '學習中心',
  subject: '',
  teacher: '',
  classMode: 'manual',
  classes: [],
  autoGrades: [],
  autoCount: 1
})

const getClassesByGrade = (grade) => {
  const list = []
  const configs = scheduleStore.schoolInfo?.gradeSettings || scheduleStore.schoolInfo?.gradeConfigs || {}
  const count = Number(configs[grade]) || 0
  for (let i = 1; i <= count; i++) {
    list.push(`${grade}年${i}班`)
  }
  return list
}

const availableSubjects = computed(() => {
  if (!scheduleStore.standardDomainSettings) return ['國語文', '數學', '健康與體育', '藝術']
  return scheduleStore.standardDomainSettings.map(s => s.name)
})

const handleAutoAI = () => {
  savePulloutRule(null, null, true)
}

const handleGridClick = (day, period) => {
  savePulloutRule(day, period, false)
}

const savePulloutRule = async (day, period, isAutoTime = false) => {
  const isAutoClass = pulloutForm.value.classMode === 'auto'

  if (!pulloutForm.value.subject) { alert('請先選擇對應學科！'); return }
  if (!pulloutForm.value.teacher) { alert('請選擇特教/負責教師！'); return }

  if (isAutoClass) {
    if (pulloutForm.value.autoGrades.length === 0) { alert('請至少選擇一個允許湊班的年級池！'); return }
    if (pulloutForm.value.autoCount < 1) { alert('需湊齊的總班級數必須大於 0！'); return }
  } else {
    if (pulloutForm.value.classes.length === 0) { alert('請至少手動選擇一個參與班級！'); return }
  }

  if (!isAutoTime) {
    if (scheduleStore.checkTeacherConflict(pulloutForm.value.teacher, day, period)) {
      alert(`🚨 衝堂警告：【${pulloutForm.value.teacher}】老師在星期${['一','二','三','四','五'][day-1]}第${period}節已有安特殊課程，請勿讓老師分身！`);
      return;
    }
  }

  scheduleStore.addSpecialCourse({
    type: 'pullout',
    name: `${pulloutForm.value.type}`,
    targetSubject: pulloutForm.value.subject,
    targetClasses: isAutoClass ? [] : [...pulloutForm.value.classes],
    teacher: pulloutForm.value.teacher,
    lockedSlots: isAutoTime ? [] : [{ day, period }],
    isAutoTime: isAutoTime,
    isAutoClass: isAutoClass,
    autoClassConfig: isAutoClass ? { grades: [...pulloutForm.value.autoGrades], count: pulloutForm.value.autoCount } : null
  })

  await scheduleStore.syncToCloud()
  alert('✅ 成功儲存抽離課程規則並同步至資料庫！');
}

const formatTime = (course) => {
  if (!course.lockedSlots || course.lockedSlots.length === 0) return ''
  const dayStr = `星期${['一','二','三','四','五'][course.lockedSlots[0].day-1]}`
  const periods = course.lockedSlots.map(s => s.period).join(', ')
  return `${dayStr} 第 ${periods} 節`
}

const deleteCourse = async (id) => {
  if (confirm('確定要刪除這筆特殊規則嗎？')) {
    scheduleStore.deleteSpecialCourse(id)
    await scheduleStore.syncToCloud()
  }
}
</script>

<style scoped>
.special-course-container { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 1000px; margin: 0 auto; }
.desc { color: #64748b; margin-bottom: 20px; }
.form-section { background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 15px; animation: fadeIn 0.3s; }
.form-row { display: flex; flex-direction: column; gap: 8px; margin-bottom: 15px; }
.form-row.split { flex-direction: row; gap: 20px; }
.form-group { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.form-group label { font-weight: bold; color: #334155; }
select, input[type="text"], input[type="number"] { padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; outline: none; }
.small-input { width: 80px; }
.radio-group { display: flex; gap: 20px; align-items: center; }
.mb-2 { margin-bottom: 10px; }
.mt-2 { margin-top: 10px; }
.ml-2 { margin-left: 10px; }
.class-matrix { background: white; padding: 15px; border-radius: 6px; border: 1px solid #cbd5e1; max-height: 250px; overflow-y: auto; }
.grade-row { display: flex; align-items: flex-start; padding: 8px 0; border-bottom: 1px dashed #e2e8f0; }
.grade-row:last-child { border-bottom: none; }
.grade-label { width: 70px; font-weight: bold; color: #475569; padding-top: 6px; }
.checkboxes { display: flex; gap: 10px; flex-wrap: wrap; flex: 1; }
.cb-label { display: flex; align-items: center; gap: 5px; cursor: pointer; color: #475569; padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 6px; transition: 0.2s; background: #f8fafc; }
.cb-label:hover:not(.disabled-cb) { background: #e2e8f0; }
.cb-label.is-selected { background: #d1fae5; border-color: #10b981; color: #065f46; font-weight: bold; }
.disabled-cb { opacity: 0.4; cursor: not-allowed; background: #f1f5f9; }
.ai-class-config { background: #f0fdf4; border: 1px dashed #4ade80; padding: 15px; border-radius: 6px; }
.config-row { display: flex; align-items: center; gap: 10px; }
.hint-text { color: #16a34a; font-size: 0.9em; font-weight: bold; }
.ai-action-bar { display: flex; justify-content: space-between; align-items: center; background: #fffbeb; padding: 15px 20px; border-radius: 8px; border: 1px solid #fcd34d; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(252, 211, 77, 0.2); }
.ai-info { display: flex; flex-direction: column; gap: 4px; }
.ai-info strong { color: #b45309; font-size: 1.1em; }
.ai-info span { color: #d97706; font-size: 0.9em; }
.ai-btn { background: #10b981; color: white; border: none; padding: 12px 20px; border-radius: 6px; font-weight: bold; font-size: 15px; cursor: pointer; transition: 0.2s; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3); }
.ai-btn:hover { background: #059669; transform: translateY(-1px); box-shadow: 0 4px 6px rgba(16, 185, 129, 0.4); }
.timetable-grid { display: grid; grid-template-columns: 60px repeat(5, 1fr); gap: 2px; background: #e2e8f0; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
.grid-header, .grid-time-label { background: #f1f5f9; padding: 10px; text-align: center; font-weight: bold; color: #475569; display: flex; align-items: center; justify-content: center; }
.grid-cell { background: white; height: 50px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; position: relative; }
.grid-cell .hover-text { display: none; font-weight: bold; color: #4338ca; font-size: 0.9em; }
.grid-cell:hover { background: #e0e7ff; }
.grid-cell:hover .hover-text { display: block; }
.grid-cell.is-noon { border-bottom: 3px solid #94a3b8; }
.courses-list-section { margin-top: 30px; border-top: 2px dashed #e2e8f0; padding-top: 20px; }
.courses-table { width: 100%; border-collapse: collapse; }
.courses-table th, .courses-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
.courses-table th { background: #f8fafc; color: #475569; }
.badge-purple { background: #f3e8ff; color: #7e22ce; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold; white-space: nowrap; }
.tags-container { display: flex; flex-wrap: wrap; gap: 4px; }
.class-tag { background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; border: 1px solid #cbd5e1; }
.delete-btn { background: #fee2e2; color: #dc2626; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
.delete-btn:hover { background: #fecaca; }
.text-ai { color: #10b981; font-weight: bold; background: #d1fae5; padding: 4px 8px; border-radius: 4px; display: inline-block; white-space: nowrap; }
.auto-class-badge { background: #d1fae5; color: #065f46; padding: 6px 10px; border-radius: 6px; font-weight: bold; font-size: 0.9em; border: 1px solid #34d399; display: inline-block; }
.auto-class-badge .sub-text { font-weight: normal; font-size: 0.9em; opacity: 0.9; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
</style>
