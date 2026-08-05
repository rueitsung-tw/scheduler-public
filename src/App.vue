<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="logo-area">
        <h2>{{ scheduleStore.schoolInfo.name ? `${scheduleStore.schoolInfo.name}排課系統` : '學校排課系統' }}</h2>
      </div>
      <nav class="nav-menu">
        <router-link to="/" class="nav-item"><span>🏠</span> 系統總覽</router-link>
        <router-link to="/teachers" class="nav-item" v-if="currentUserRole === 'admin'"><span>👥</span> 教師名單管理</router-link>
        <router-link to="/classes" class="nav-item" v-if="currentUserRole === 'admin'"><span>📅</span> 班級與課程設定</router-link>

        <router-link to="/schedule" class="nav-item" v-if="currentUserRole === 'admin'"><span>🚀</span> 智慧排課引擎</router-link>

        <router-link to="/editor" class="nav-item" v-if="currentUserRole === 'admin'"><span>✍️</span> 人工微調編輯器</router-link>
        <router-link to="/classrooms" class="nav-item" v-if="currentUserRole === 'admin'"><span>🏫</span> 專科教室管理</router-link>
        <router-link to="/settings" class="nav-item" v-if="currentUserRole === 'admin'"><span>⚙️</span> 系統參數設定</router-link>
        <router-link to="/special" class="nav-item" v-if="currentUserRole === 'admin'"><span>🧩</span> 特殊專案與抽離</router-link>
        <router-link to="/export" class="nav-item" v-if="currentUserRole === 'admin'"><span>🖨️</span> 匯出與列印中心</router-link>
        <router-link to="/validation" class="nav-item" v-if="currentUserRole === 'admin'"><span>📊</span> 配課檢核報告</router-link>
        <router-link to="/teacher-board" class="nav-item" v-if="currentUserRole !== 'admin'"><span>👨‍🏫</span> 導師排課台</router-link>
        <router-link to="/ai-settings" class="nav-item" v-if="currentUserRole === 'admin'"><span>⚙️</span> 系統功能設定</router-link>

      </nav>
    </aside>

    <main class="main-content">
      <header class="top-header">
        <div class="header-left">
        </div>
        <div class="header-right" style="display: flex; align-items: center; gap: 15px;">
          <div class="system-status">
            <span class="semester-info">當前學期：{{ scheduleStore.schoolInfo.academic_year }}學年度 {{ scheduleStore.schoolInfo.semester }}</span>

            <span v-if="scheduleStore.syncStatus === 'unsaved'" class="status-warning">
              ⚠️ 有未儲存的變更
            </span>
            <span v-else-if="scheduleStore.syncStatus === 'saving'" class="status-saving">
              ⏳ 同步至資料庫中...
            </span>
            <span v-else class="status-success">
              ✅ 已與資料庫同步 <span v-if="scheduleStore.lastSavedTime" class="time-text">(最後儲存：{{ scheduleStore.lastSavedTime }})</span>
            </span>

            <button
              class="cloud-sync-btn"
              :class="{ 'btn-disabled': scheduleStore.syncStatus === 'saved' || scheduleStore.syncStatus === 'saving' }"
              @click="scheduleStore.syncToCloud"
              :disabled="scheduleStore.syncStatus === 'saved' || scheduleStore.syncStatus === 'saving'"
            >
              💾 儲存至資料庫
            </button>
          </div>
          <div class="role-switcher" style="display: flex; align-items: center; gap: 10px; background: #f1f5f9; padding: 5px 10px; border-radius: 6px;">
            <label style="font-size: 0.85em; color: #475569;">模擬登入身分：</label>
            <select v-model="currentUserRole" style="padding: 4px; border: 1px solid #cbd5e1;">
              <option value="admin">系統管理員 (教務處)</option>
              <option value="班級導師 (101 班)">班級導師 (101 班)</option>
              <option value="班級導師 (301 班)">班級導師 (301 班)</option>
            </select>
          </div>
        </div>
      </header>

      <div class="content-wrapper">
        <router-view></router-view>
      </div>
    </main>
  </div>

</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useScheduleStore } from './stores/schedule'

const scheduleStore = useScheduleStore()

const currentUserRole = ref('admin')
const currentTeacherClass = ref('301')

// 【新增】建立初始化鎖定，解決 Bug #8 (避免載入中途觸發 unsaved)
const isInitializing = ref(true)

const syncToGlobal = () => {
  scheduleStore.currentRole = currentUserRole.value
  window.currentTeacherRole = currentUserRole.value

  // 解決 Bug #3：如果不是 admin，自動從選單字串取出班級名稱 (例如從 "班級導師 (101 班)" 提取 "101")
  if (currentUserRole.value !== 'admin') {
    const match = currentUserRole.value.match(/\((\d+)\s*班\)/)
    window.currentTeacherClass = match ? match[1] : currentTeacherClass.value
  } else {
    window.currentTeacherClass = ''
  }
}

// 解決 Bug #2: 在 onMounted 內 await 確保非同步執行順序
onMounted(async () => {
  syncToGlobal() // 初始先同步一次身分

  try {
    await scheduleStore.loadFromDB()
  } catch (error) {
    console.error("載入資料庫失敗:", error)
  } finally {
    // 等資料確實載入完畢後，才解開鎖定，允許狀態變更為 unsaved
    isInitializing.value = false
  }
})

// 解決 Bug #4: 整合 watch，並移除 immediate (因為 onMounted 已經做過一次，避免觸發 3 次)
watch([currentUserRole, currentTeacherClass], () => {
  syncToGlobal()
})

// 解決 Bug #5 & #8: 精準且安全的狀態訂閱機制
scheduleStore.$subscribe((mutation, state) => {
  // 如果還在初始化階段，不理會任何變更
  if (isInitializing.value) return;

  // 🆕 核心修復：如果變動的目標是 syncStatus 或 lastSavedTime 本身，直接忽略！
  // 避免系統將「儲存成功」的狀態變更，誤認為是「資料被修改」
  if (mutation.events) {
    const keys = Array.isArray(mutation.events)
      ? mutation.events.map(e => e.key)
      : [mutation.events.key];
    if (keys.includes('syncStatus') || keys.includes('lastSavedTime')) return;
  }

  // 只要發現狀態是 saved (且變更的不是狀態本身)，就將其標記為未儲存
  if (state.syncStatus === 'saved') {
    scheduleStore.syncStatus = 'unsaved';
  }
})

</script>

<style>
body, html { margin: 0; padding: 0; height: 100%; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f2f5; }
#app { height: 100vh; }
.app-layout { display: flex; height: 100vh; overflow: hidden; }
.sidebar { width: 250px; background-color: #1e293b; color: white; display: flex; flex-direction: column; }
.logo-area { padding: 20px; text-align: center; border-bottom: 1px solid #334155; }
.logo-area h2 { margin: 0; font-size: 1.2rem; letter-spacing: 1px; color: #38bdf8; }
.nav-menu { display: flex; flex-direction: column; padding: 10px 0; }

/* ⚠️ 優化選單項目排版，使用 Flexbox 讓圖示與文字對齊 */
.nav-item {
  padding: 15px 25px;
  color: #cbd5e1;
  text-decoration: none;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1.05em;
}
.nav-item span { font-size: 1.2em; /* 讓圖示稍微大一點 */ }
.nav-item:hover, .router-link-active { background-color: #334155; color: #38bdf8; border-left: 4px solid #38bdf8; }

.main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.top-header { background-color: white; height: 60px; display: flex; justify-content: space-between; align-items: center; padding: 0 30px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); z-index: 10; }
.content-wrapper { padding: 20px; overflow-y: auto; flex: 1; }

.system-status { display: flex; align-items: center; gap: 16px; flex-wrap: nowrap; white-space: nowrap; }
.semester-info { font-weight: bold; color: #475569; font-size: 0.9em; }
.status-success, .status-warning, .status-saving { display: inline-flex; align-items: center; gap: 6px; font-weight: bold; }
.status-success { color: #16a34a; }
.status-warning { color: #d97706; }
.status-saving { color: #2563eb; }
.time-text { font-size: 0.85em; font-weight: normal; color: #64748b; }

.cloud-sync-btn { flex-shrink: 0; padding: 6px 12px; background: #1e293b; color: white; border: none; border-radius: 6px; cursor: pointer; transition: 0.3s; font-size: 0.9em; }
.cloud-sync-btn:hover:not(:disabled) { background: #334155; }
.btn-disabled { opacity: 0.5; cursor: not-allowed; }
</style>
