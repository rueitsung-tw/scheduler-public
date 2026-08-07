import { createRouter, createWebHistory } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'

const routes = [
  {
    path: '/setup',
    name: 'SetupWizard',
    // 系統初始化設定頁面
    component: () => import('@/views/SetupWizardView.vue')
  },
  {
    path: '/',
    name: 'Dashboard',
    //首頁，系統總覽
    component: () => import('@/views/Dashboard.vue')
  },
  {
    path: '/teachers',
    name: 'Teachers',
    //教師管理頁面，包含教師列表、添加/編輯教師信息等功能
    component: () => import('@/views/TeachersView.vue')
  },
  {
    path: '/classes',
    name: 'Classes',
    // 課程管理頁面，包含課程列表、添加/編輯課程信息等功能
    component: () => import('@/views/ClassesView.vue')
  },
  {
    path: '/editor',
    name: 'TimetableEditor',
    // 課表編輯頁面，提供可視化的課表編輯界面，支持拖放操作和衝突檢測
    component: () => import('@/views/TimetableEditorView.vue')
  },
  {
    path: '/settings',
    name: 'SystemSettings',
    //  系統設置頁面，包含學期設置、假日設置、課程類型設置等功能
    component: () => import('@/views/SystemSettingsView.vue')
  },
  {
    path: '/special',
    name: 'SpecialCourses',
    // 特殊課程管理頁面，包含特殊課程列表、添加/編輯特殊課程信息等功能
    component: () => import('@/views/SpecialCourseView.vue')
  },
  {
    path: '/classrooms',
    name: 'ClassroomManager',
    // 教室管理頁面，包含教室列表、添加/編輯教室信息等功能
    component: () => import('@/views/ClassroomManagerView.vue')
  },
  {
    path: '/export',
    name: 'ExportHub',
    // 匯出中心頁面，提供多種格式的課表匯出選項，如PDF、Excel等
    component: () => import('@/views/ExportHubView.vue')
  },
  {
    path: '/validation',
    name: 'DataValidation',
    // 數據驗證頁面，提供數據完整性檢查和錯誤修正功能，確保課表數據的準確性和一致性
    component: () => import('@/views/DataValidationView.vue')
  },
  {
    path: '/teacher-board',
    name: 'TeacherBoard',
    //  教師看板頁面，提供教師個人課表、待辦事項和通知等信息的集中展示，方便教師快速查看和管理自己的課程安排
    component: () => import('@/views/TeacherBoardView.vue')
  },
  {
    path: '/teacher-quota',
    name: 'TeacherQuota',
    // 教師配額頁面，提供教師配額管理功能，允許管理員設置和調整教師的課程配額，以確保課表安排的合理性和公平性
    component: () => import('@/views/TeacherQuotaView.vue')
  },
  {
    path: '/ai-settings',
    name: 'AiSettings',
    // AI設置頁面，提供AI算法的配置選項，允許管理員調整算法參數以優化課表生成效果
    component: () => import('@/views/AiSettingsView.vue')
  },
  {
    path: '/prealloc-import',
    name: 'PreallocationImport',
    // 通用預排匯入頁面，支援任意科目的 Excel 課表匯入
    component: () => import('@/views/PreallocationImportView.vue')
  },
  {
    path: '/schedule',
    name: 'Schedule',
    component: () => import('@/views/ScheduleView.vue')
  },
  {
    path: '/class-settings',
    name: 'ClassSettings',
    // 班級設定頁面，支援透過 query string (?class=班級名稱) 自動載入指定班級
    component: () => import('@/views/ClassSettingsView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫：Setup Wizard 雙向鎖定 (Vue Router 5 return 語法)
router.beforeEach(async (to, _from) => {
  try {
    const res = await fetch('/api/system/status')
    if (!res.ok) return true

    const data = await res.json()
    const isSetup = data.isSetupComplete

    // 情境 A：未初始化 → 除了 /setup 以外一律強制跳轉到 /setup
    if (!isSetup && to.path !== '/setup') {
      return '/setup'
    }

    // 情境 C：已初始化 → 不准再進入 /setup
    if (isSetup && to.path === '/setup') {
      return '/'
    }

    // P0-1 修復：保護未套用的排課結果
    // 當使用者從 /schedule 離開，且存在 engineResult 但 engineStatus === 'COMPLETED'
    // 表示排課完成但尚未點擊「套用此課表並前往編輯器」
    if (_from?.path === '/schedule') {
      try {
        const dataStore = useScheduleStore();
        const hasUnappliedResult = dataStore.engineStatus === 'COMPLETED'
          && dataStore.engineResult
          && Array.isArray(dataStore.engineResult.schedule)
          && dataStore.engineResult.schedule.length > 0;

        // 如果目標頁面會 loadFromDB(true)，則會靜默覆蓋新結果
        const dangerousRoutes = ['/export', '/classrooms', '/editor', '/teachers', '/classes', '/validation', '/'];
        if (hasUnappliedResult && dangerousRoutes.includes(to.path)) {
          const confirmed = window.confirm(
            '⚠️ 你有一筆排課結果尚未套用。\n\n' +
            '如果你現在離開，這筆新課表會遺失。\n\n' +
            '確定要離開嗎？\n\n' +
            '按「確定」離開（新課表會遺失）\n' +
            '按「取消」返回排課頁面完成套用。'
          );
          if (!confirmed) return false;

          // 使用者明確選擇放棄這筆未套用結果，立即清掉暫存狀態，
          // 避免稍後回到 /schedule 時又看到舊的完成結果「幽靈復甦」。
          dataStore.resetEngineState();
        }
      } catch (_) {
        // store 可能尚未初始化，不阻擋
      }
    }

    // 允許導航 (return undefined 等同通過)
  } catch (error) {
    console.error('路由守衛檢查失敗：', error)
    return true
  }
})

export default router
