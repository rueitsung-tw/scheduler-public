import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '@/views/Dashboard.vue'
import TeachersView from '@/views/TeachersView.vue'
import ClassesView from '@/views/ClassesView.vue'
import ClassSettingsView from '@/views/ClassSettingsView.vue'
import TimetableEditorView from '@/views/TimetableEditorView.vue'
import SystemSettingsView from '@/views/SystemSettingsView.vue'
import SpecialCourseView from '@/views/SpecialCourseView.vue'
import ClassroomManagerView from '@/views/ClassroomManagerView.vue'
import ExportHubView from '@/views/ExportHubView.vue'
import DataValidationView from '@/views/DataValidationView.vue'
import TeacherBoardView from '@/views/TeacherBoardView.vue'
import TeacherQuotaView from '@/views/TeacherQuotaView.vue'
import SetupWizardView from '@/views/SetupWizardView.vue'
import ScheduleView from '@/views/ScheduleView.vue'

const routes = [
  {
    path: '/setup',
    name: 'SetupWizard',
    // 系統初始化設定頁面
    component: SetupWizardView
  },
  {
    path: '/',
    name: 'Dashboard',
    //首頁，系統總覽
    component: Dashboard
  },
  {
    path: '/teachers',
    name: 'Teachers',
    //教師管理頁面，包含教師列表、添加/編輯教師信息等功能
    component: TeachersView
  },
  {
    path: '/classes',
    name: 'Classes',
    // 課程管理頁面，包含課程列表、添加/編輯課程信息等功能
    component: ClassesView
  },
  {
    path: '/editor',
    name: 'TimetableEditor',
    // 課表編輯頁面，提供可視化的課表編輯界面，支持拖放操作和衝突檢測
    component: TimetableEditorView
  },
  {
    path: '/settings',
    name: 'SystemSettings',
    //  系統設置頁面，包含學期設置、假日設置、課程類型設置等功能
    component: SystemSettingsView
  },
  {
    path: '/special',
    name: 'SpecialCourses',
    // 特殊課程管理頁面，包含特殊課程列表、添加/編輯特殊課程信息等功能
    component: SpecialCourseView
  },
  {
    path: '/classrooms',
    name: 'ClassroomManager',
    // 教室管理頁面，包含教室列表、添加/編輯教室信息等功能
    component: ClassroomManagerView
  },
  {
    path: '/export',
    name: 'ExportHub',
    // 匯出中心頁面，提供多種格式的課表匯出選項，如PDF、Excel等
    component: ExportHubView
  },
  {
    path: '/validation',
    name: 'DataValidation',
    // 數據驗證頁面，提供數據完整性檢查和錯誤修正功能，確保課表數據的準確性和一致性
    component: DataValidationView
  },
  {
    path: '/teacher-board',
    name: 'TeacherBoard',
    //  教師看板頁面，提供教師個人課表、待辦事項和通知等信息的集中展示，方便教師快速查看和管理自己的課程安排
    component: TeacherBoardView
  },
  {
    path: '/teacher-quota',
    name: 'TeacherQuota',
    // 教師配額頁面，提供教師配額管理功能，允許管理員設置和調整教師的課程配額，以確保課表安排的合理性和公平性
    component: TeacherQuotaView
  },
  {
    path: '/ai-settings',
    name: 'AiSettings',
    // AI設置頁面，提供AI算法的配置選項，允許管理員調整算法參數以優化課表生成效果
    component: () => import('../views/AiSettingsView.vue')
  },
  {
      path: '/schedule',
      name: 'Schedule',
      component: ScheduleView
    },
  {
    path: '/class-settings',
    name: 'ClassSettings',
    // 班級設定頁面，支援透過 query string (?class=班級名稱) 自動載入指定班級
    component: ClassSettingsView
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

    // 允許導航 (return undefined 等同通過)
  } catch (error) {
    console.error('路由守衛檢查失敗：', error)
    return true
  }
})

export default router
