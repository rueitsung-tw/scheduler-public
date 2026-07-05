<template>
  <div class="setup-page">
    <div class="setup-container">
      <!-- 學校 Logo 圖標 -->
      <div class="setup-icon">
        <div class="icon-circle">
          <span>🏫</span>
        </div>
      </div>

      <h1 class="setup-title">首次安裝與基本資料設定</h1>
      <p class="setup-subtitle">請輸入學校名稱與初始管理員資料，完成系統初始化。</p>

      <!-- 錯誤訊息顯示 -->
      <div v-if="errorMessage" class="alert alert-error">
        <span>⚠️</span>
        <span>{{ errorMessage }}</span>
      </div>

      <!-- 表單區域 -->
      <div class="settings-card">
        <form @submit.prevent="handleSetup">
          <!-- 學校名稱 -->
          <div class="form-group">
            <label for="schoolName">
              <span class="label-icon">🏛️</span>
              學校名稱
              <span class="required">*</span>
            </label>
            <input
              id="schoolName"
              v-model="schoolName"
              type="text"
              placeholder="例如：東門國小"
              required
              :class="{ 'input-error': errors.schoolName }"
            />
            <span v-if="errors.schoolName" class="error-text">{{ errors.schoolName }}</span>
          </div>

          <!-- 管理員帳號 -->
          <div class="form-group">
            <label for="username">
              <span class="label-icon">👤</span>
              初始管理員帳號
              <span class="required">*</span>
            </label>
            <input
              id="username"
              v-model="username"
              type="text"
              placeholder="請輸入初始管理員帳號"
              required
              :class="{ 'input-error': errors.username }"
            />
            <span v-if="errors.username" class="error-text">{{ errors.username }}</span>
            <small class="field-note">此為初始管理員資料，供未來登入功能使用。正式登入機制尚未啟用。</small>
          </div>

          <!-- 初始密碼 -->
          <div class="form-group">
            <label for="password">
              <span class="label-icon">🔒</span>
              初始密碼
              <span class="required">*</span>
            </label>
            <input
              id="password"
              v-model="password"
              type="password"
              placeholder="請輸入密碼（至少 6 碼）"
              required
              :class="{ 'input-error': errors.password }"
            />
            <span v-if="errors.password" class="error-text">{{ errors.password }}</span>
          </div>

          <!-- 確認初始密碼 -->
          <div class="form-group">
            <label for="confirmPassword">
              <span class="label-icon">🔒</span>
              確認初始密碼
              <span class="required">*</span>
            </label>
            <input
              id="confirmPassword"
              v-model="confirmPassword"
              type="password"
              placeholder="請再次輸入密碼"
              required
              :class="{ 'input-error': errors.confirmPassword }"
            />
            <span v-if="errors.confirmPassword" class="error-text">{{ errors.confirmPassword }}</span>
          </div>

          <!-- 提交按鈕 -->
          <button type="submit" class="setup-btn" :disabled="isLoading">
            <span v-if="!isLoading">🚀 開始初始化系統</span>
            <span v-else>⏳ 初始化中...</span>
          </button>
        </form>
      </div>

      <p class="setup-footer">
        初始化完成後即可進入主系統設定排課參數。初始管理員資料已保存，正式登入功能將於後續啟用。
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '../stores/schedule'

const router = useRouter()
const scheduleStore = useScheduleStore()

// --- 響應式變數 ---
const schoolName = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMessage = ref('')
const isLoading = ref(false)

// --- 表單驗證錯誤訊息 ---
const errors = reactive({
  schoolName: '',
  username: '',
  password: '',
  confirmPassword: ''
})

// --- 驗證邏輯 ---
const validate = () => {
  let isValid = true

  // 重置錯誤
  errors.schoolName = ''
  errors.username = ''
  errors.password = ''
  errors.confirmPassword = ''

  // 學校名稱驗證
  if (!schoolName.value.trim()) {
    errors.schoolName = '請輸入學校名稱'
    isValid = false
  }

  // 帳號驗證
  if (!username.value.trim()) {
    errors.username = '請輸入管理員帳號'
    isValid = false
  }

  // 密碼驗證
  if (!password.value) {
    errors.password = '請輸入密碼'
    isValid = false
  } else if (password.value.length < 6) {
    errors.password = '密碼至少需要 6 碼'
    isValid = false
  }

  // 確認密碼驗證（雙密碼比對）
  if (password.value !== confirmPassword.value) {
    errors.confirmPassword = '兩次輸入的密碼不一致'
    isValid = false
  }

  return isValid
}

// --- 提交處理：發送 API 請求並跳轉 ---
const handleSetup = async () => {
  if (!validate()) {
    return
  }

  isLoading.value = true
  errorMessage.value = ''

  try {
    const response = await fetch('/api/system/setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        schoolName: schoolName.value,
        username: username.value,
        password: password.value
      })
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || '初始化失敗')
    }

    // P2 修復：setup 成功後主動刷新全域狀態，讓首頁 schoolInfo 立即更新
    try {
      await scheduleStore.loadFromDB(true)
    } catch (e) {
      console.warn('[SetupWizard] 無法在 setup 後立即刷新 store:', e)
    }

    // 成功後跳轉回首頁
    router.push('/')
  } catch (error) {
    console.error('初始化失敗：', error)
    errorMessage.value = error.message || '初始化過程中發生錯誤，請稍後再試。'
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.setup-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.setup-container {
  width: 100%;
  max-width: 480px;
  text-align: center;
}

/* 圖標區域 */
.setup-icon {
  margin-bottom: 20px;
}

.icon-circle {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
}

.icon-circle span {
  font-size: 40px;
}

/* 標題區域 */
.setup-title {
  font-size: 28px;
  font-weight: 800;
  color: white;
  margin-bottom: 8px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.setup-subtitle {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 30px;
  line-height: 1.5;
}

/* 卡片樣式 */
.settings-card {
  background: white;
  border-radius: 16px;
  padding: 30px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  text-align: left;
}

/* 表單群組 */
.form-group {
  margin-bottom: 22px;
}

.form-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 8px;
  font-size: 14px;
}

.label-icon {
  font-size: 16px;
}

.required {
  color: #ef4444;
  margin-left: 2px;
}

.form-group input {
  width: 100%;
  padding: 12px 14px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  font-size: 15px;
  transition: all 0.2s;
  box-sizing: border-box;
  font-family: inherit;
}

.form-group input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}

.form-group input.input-error {
  border-color: #ef4444;
}

.form-group input.input-error:focus {
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
}

/* 錯誤訊息 */
.error-text {
  display: block;
  color: #ef4444;
  font-size: 13px;
  margin-top: 6px;
  font-weight: 500;
}

/* 欄位備註 */
.field-note {
  display: block;
  color: #94a3b8;
  font-size: 12px;
  margin-top: 4px;
  font-style: italic;
}

/* 警告框 */
.alert {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
  font-size: 14px;
}

.alert-error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}

/* 按鈕 */
.setup-btn {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s;
  margin-top: 10px;
  box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);
}

.setup-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
}

.setup-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Footer */
.setup-footer {
  margin-top: 20px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.5;
}
</style>
