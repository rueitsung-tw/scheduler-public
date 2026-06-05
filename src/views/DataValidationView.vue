<template>
  <div class="report-container">
    <div class="header-actions">
      <h2>📊 配課檢核報告</h2>
      <div class="filter-toggle">
        <button :class="{ active: filterMode === 'all' }" @click="filterMode = 'all'">📋 顯示全部</button>
        <button :class="{ active: filterMode === 'issues' }" @click="filterMode = 'issues'">🚨 僅顯示異常清單</button>
      </div>
    </div>
    
    <div class="dashboard-card warnings-card">
      <h3>⚠️ 待處理事項與檢核結果 ({{ systemWarnings.length }} 件)</h3>
      <div v-if="systemWarnings.length === 0" class="all-clear">
        ✅ 太棒了！全校基礎設定與配課已 100% 完成，無任何衝突，可準備進入自動排課階段。
      </div>
      <ul v-else class="warning-list">
        <li v-for="(warn, index) in systemWarnings" :key="index" :class="`warn-item ${warn.type}`">
          <span class="icon">{{ warn.icon }}</span> {{ warn.msg }}
        </li>
      </ul>
    </div>

    <div class="grid-layout">
      <div class="dashboard-card">
        <h3>👨‍🏫 教師授課時數檢核</h3>
        <div class="scrollable-table">
          <table class="data-table">
            <thead>
              <tr>
                <th>教師姓名</th>
                <th>目標配額</th>
                <th>已配節數</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in filteredTeacherStats" :key="t.name">
                <td><strong>{{ t.name }}</strong><br><small style="color:#64748b">{{ t.role || '未定' }}</small></td>
                <td>{{ t.target }} 節 <br><small style="color:#94a3b8">(上限 {{ t.maxAllowed }} 節)</small></td>
                <td :class="{'text-error': t.status==='error', 'text-ok': t.status==='ok' || t.status==='info'}">
                  <strong>{{ t.assignedPeriods }} 節</strong>
                </td>
                <td>
                  <span :class="`badge badge-${t.status}`">{{ t.msg }}</span>
                </td>
              </tr>
              <tr v-if="filteredTeacherStats.length === 0">
                <td colspan="4" class="empty-state">目前無異常教師資料</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="dashboard-card">
        <h3>🏫 班級配課完整度</h3>
        <div class="scrollable-table">
          <table class="data-table">
            <thead>
              <tr>
                <th>班級</th>
                <th>導師</th>
                <th>配課進度</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in filteredClassStats" :key="c.name">
                <td><strong>{{ c.name }}</strong></td>
                <td>
                  <span v-if="c.homeroom_teacher">{{ c.homeroom_teacher }}</span>
                  <span v-else class="text-error">未設定</span>
                </td>
                <td>{{ c.assignedSubjects }} / {{ c.totalSubjects }} 科</td>
                <td>
                  <span v-if="c.status === 'ok'" class="badge badge-ok">✅ {{ c.msg }}</span>
                  <span v-else-if="c.status === 'warning'" class="badge badge-warning">{{ c.msg }}</span>
                  <span v-else class="badge badge-error">{{ c.msg }}</span>
                </td>
              </tr>
              <tr v-if="filteredClassStats.length === 0">
                <td colspan="4" class="empty-state">目前無異常班級資料</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const scheduleStore = useScheduleStore()
const filterMode = ref('issues') // 預設僅顯示異常，提升 UX

onMounted(async () => {
  console.log('📬 DataValidationView Mounted: 正在同步資料庫最新資料...');
  await scheduleStore.loadFromDB(true);
});

// ⚠️ 核心新增：根據系統參數算出「全校預期應有的班級名單」
const expectedClassNames = computed(() => {
  const list = []
  const configs = scheduleStore.schoolInfo?.gradeSettings || scheduleStore.schoolInfo?.gradeConfigs || {}
  for (let grade = 1; grade <= 6; grade++) {
    const count = Number(configs[grade]) || 0
    for (let i = 1; i <= count; i++) {
      list.push(`${grade}年${i}班`)
    }
  }
  return list
})

// 1. 計算班級配課完整度 (主動比對預期名單)
const classStats = computed(() => {
  return expectedClassNames.value.map(className => {
    const cData = scheduleStore.classes?.find(c => c.name === className)

    // 若大倉庫還沒有這班的資料，視為完全未設定
    if (!cData) {
      return { name: className, homeroom_teacher: null, totalSubjects: 0, assignedSubjects: 0, missingSubjects: [{subject: '全部科目'}], status: 'error', msg: '❌ 未建立資料' }
    }

    const reqs = cData.course_requirements || []
    const totalSubjects = reqs.length
    const assignedSubjects = reqs.filter(req => req.teacher && req.teacher.trim() !== '').length
    const missingSubjects = reqs.filter(req => !req.teacher || req.teacher.trim() === '')

    let status = 'ok'
    let msg = '完成'
    if (!cData.homeroom_teacher) {
      status = 'error'
      msg = '❌ 缺導師'
    } else if (assignedSubjects < totalSubjects) {
      status = 'warning'
      msg = `⚠️ 缺 ${missingSubjects.length} 科`
    }

    return { name: className, homeroom_teacher: cData.homeroom_teacher, totalSubjects, assignedSubjects, missingSubjects, status, msg }
  })
})

// 2. 計算教師授課時數與配額檢核
const teacherStats = computed(() => {
  if (!scheduleStore.teachers) return []
  
  return scheduleStore.teachers.map(t => {
    let assignedPeriods = 0
    let assignedClasses = []
    
    if (scheduleStore.classes) {
      scheduleStore.classes.forEach(c => {
        c.course_requirements?.forEach(req => {
          if (req.teacher === t.name) {
            assignedPeriods += Number(req.periods || 0)
            if (!assignedClasses.includes(c.name)) assignedClasses.push(c.name)
          }
        })
      })
    }

    const base = Number(t.base_periods || 20)
    const reduction = Number(t.reduction || 0)
    const overtimeLimit = Number(t.overtime || 0)
    const target = base - reduction
    const maxAllowed = target + overtimeLimit

    let status = 'ok'
    let msg = '節數吻合'
    
    if (assignedPeriods > maxAllowed) {
      status = 'error'
      msg = `嚴重超時 (+${assignedPeriods - maxAllowed})`
    } else if (assignedPeriods < target) {
      status = 'warning'
      msg = `節數不足 (-${target - assignedPeriods})`
    } else if (assignedPeriods > target) {
      status = 'info'
      msg = `含超鐘點 (+${assignedPeriods - target})`
    }

    return { ...t, assignedPeriods, target, maxAllowed, status, msg, assignedClasses }
  })
})

// 過濾邏輯
const filteredTeacherStats = computed(() => {
  if (filterMode.value === 'all') return teacherStats.value
  return teacherStats.value.filter(t => t.status !== 'ok' && t.status !== 'info')
})

const filteredClassStats = computed(() => {
  if (filterMode.value === 'all') return classStats.value
  return classStats.value.filter(c => c.status !== 'ok')
})

// 3. 系統矛盾與警告總覽
const systemWarnings = computed(() => {
  const warnings = []
  const missingHr = classStats.value.filter(c => c.status === 'error')
  if (missingHr.length > 0) {
    warnings.push({ type: 'error', icon: '🚨', msg: `${missingHr.map(c => c.name).join(', ')} 缺乏導師或班級基礎資料。` })
  }
  classStats.value.forEach(c => {
    if (c.status === 'warning' && c.missingSubjects.length > 0) {
      warnings.push({ type: 'warning', icon: '⚠️', msg: `${c.name} 尚有未配課科目：${c.missingSubjects.map(s => s.subject).join(', ')}。` })
    }
  })
  teacherStats.value.forEach(t => {
    if (t.status === 'error') {
      warnings.push({ type: 'error', icon: '💥', msg: `${t.name} 老師總配課 (${t.assignedPeriods} 節) 已超過法定上限 (${t.maxAllowed} 節)！` })
    }
  })
  return warnings
})
</script>

<style scoped>
.report-container { padding: 20px; max-width: 1200px; margin: 0 auto; }
.header-actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.header-actions h2 { margin: 0; }

.filter-toggle { display: flex; gap: 10px; }
.filter-toggle button { padding: 8px 16px; border: 2px solid #cbd5e1; background: white; border-radius: 8px; font-weight: bold; cursor: pointer; color: #64748b; transition: all 0.2s; }
.filter-toggle button.active { border-color: #3b82f6; background: #eff6ff; color: #1d4ed8; }

.dashboard-card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.warnings-card { border-left: 6px solid #ef4444; }
.grid-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 900px) { .grid-layout { grid-template-columns: 1fr; } }
.all-clear { padding: 15px; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; border-radius: 6px; font-weight: bold; text-align: center; }
.warning-list { list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto; }
.warn-item { padding: 12px 15px; margin-bottom: 8px; border-radius: 6px; display: flex; align-items: center; gap: 10px; font-weight: 500; }
.warn-item.error { background: #fee2e2; color: #991b1b; border: 1px solid #f87171; }
.warn-item.warning { background: #fef3c7; color: #92400e; border: 1px solid #fbbf24; }

/* 滾動表格容器與凍結表頭 */
.scrollable-table { max-height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.95em; }
.data-table th { background: #f8fafc; font-weight: bold; color: #475569; position: sticky; top: 0; z-index: 1; box-shadow: 0 1px 0 #e2e8f0; }
.data-table tbody tr:hover { background: #f8fafc; }
.empty-state { text-align: center; color: #94a3b8; font-weight: bold; padding: 30px !important; }

.text-error { color: #ef4444; font-weight: bold; }
.text-ok { color: #10b981; font-weight: bold; }
.badge { padding: 4px 8px; border-radius: 20px; font-size: 12px; font-weight: bold; display: inline-block; white-space: nowrap; }
.badge-ok { background: #d1fae5; color: #065f46; }
.badge-warning { background: #fef3c7; color: #92400e; }
.badge-error { background: #fee2e2; color: #991b1b; }
.badge-info { background: #dbeafe; color: #1e40af; }
</style>
