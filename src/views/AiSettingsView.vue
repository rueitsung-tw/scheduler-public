<template>
  <div class="settings-page">
    <div class="ai-settings-container">
      <h2>AI 連線設定</h2>
      <p class="desc">
        這裡可以切換你要連線的本地 LLM 服務，並針對不同服務自動套用對應的端點與測試方式。
      </p>

      <div class="settings-card">
        <div class="form-group toggle-group">
          <label class="switch">
            <input type="checkbox" v-model="aiStore.enabled" />
            <span class="slider round"></span>
          </label>
          <span class="toggle-label">啟用 AI 連線服務</span>
        </div>

        <div :class="{ 'disabled-section': !aiStore.enabled }">
          <div class="form-group">
            <label>服務類型</label>
            <div class="service-grid">
              <button
                v-for="service in serviceOptions"
                :key="service.type"
                type="button"
                class="service-card"
                :class="{ active: aiStore.serviceType === service.type }"
                @click="selectServiceType(service.type)"
                :disabled="!aiStore.enabled"
              >
                <div class="service-head">
                  <span class="service-title">{{ service.label }}</span>
                  <span class="service-chip">{{ service.defaultPort }}</span>
                </div>
                <p class="service-desc">{{ service.description }}</p>
                <code class="service-url">{{ service.defaultUrl }}</code>
              </button>
            </div>
          </div>

          <div class="form-group">
            <label>API 端點</label>
            <input
              type="text"
              v-model="aiStore.apiUrl"
              :placeholder="activeService.defaultUrl"
              :disabled="!aiStore.enabled"
            />
            <small>
              {{ activeService.hint }} 若只填主機名稱，系統會自動補上協定、預設 Port 與路徑。
            </small>
          </div>

          <div class="form-group">
            <label>Model ID</label>
            <input
              type="text"
              v-model="aiStore.model"
              :placeholder="activeService.defaultModel"
              :disabled="!aiStore.enabled"
            />
            <small>
              {{ activeService.modelHint }}
            </small>
          </div>

          <div class="form-group">
            <label>System Prompt</label>
            <textarea
              v-model="aiStore.systemPrompt"
              rows="6"
              :disabled="!aiStore.enabled"
              placeholder="輸入給 AI 的系統提示詞"
            ></textarea>
            <small>這段提示詞會跟著送到你選的 LLM 服務。</small>
          </div>

          <!-- 本地模型進階參數 (Qwen Thinking 模式穩定化) -->
          <div class="advanced-settings" :class="{ 'disabled-section': !aiStore.enabled }">
            <h3>本地模型進階設定</h3>
            <p class="desc">針對 Qwen3.6 等大模型的 Thinking 模式與輸出控制。</p>

            <div class="form-group toggle-group" style="border-bottom: none; padding-bottom: 0;">
              <label class="switch">
                <input type="checkbox" v-model="aiStore.disableThinking" />
                <span class="slider round"></span>
              </label>
              <span class="toggle-label">關閉 Thinking 模式（支援的本地模型才會套用 /no_think）</span>
            </div>
            <small style="margin-bottom: 16px; display: block;">啟用時會對支援的本地模型服務加入 /no_think；目前預設的 ollama 不會套用此處理，可用來降低 reasoning_content 過長導致 content 為空的機率。</small>

            <div class="form-group">
              <label>最大輸出 Token 數 (max_tokens)</label>
              <input
                type="number"
                v-model.number="aiStore.maxOutputTokens"
                min="256"
                max="8192"
                step="256"
                :disabled="!aiStore.enabled"
              />
               <small>預設 8192。若模型回應被截斷（finish_reason=length），可再依模型狀況調高。</small>
            </div>

            <div class="form-group">
              <label>Temperature (隨機性)</label>
              <input
                type="number"
                v-model.number="aiStore.temperature"
                min="0"
                max="2"
                step="0.1"
                :disabled="!aiStore.enabled"
              />
              <small>預設 0（最確定性）。排課 JSON 輸出建議保持 0。</small>
            </div>
          </div>

          <div class="action-buttons">
            <button @click="testConnection" class="test-btn" :disabled="!aiStore.enabled || isTesting">
              {{ isTesting ? '測試中...' : `測試 ${activeService.label} 連線` }}
            </button>
            <button @click="saveAiSettings" class="save-btn">儲存 AI 設定</button>
          </div>

          <div v-if="testResult" :class="['test-result', testStatus]">
            {{ testResult }}
          </div>
        </div>
      </div>
    </div>

    <div class="ai-settings-container">
      <div class="settings-card algorithm-controls">
        <h3>演算法硬約束控制 (鐵律開關)</h3>
        <p class="desc">
          這些開關會直接影響排課引擎的建模與前處理流程。
        </p>

        <div class="control-item">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.naturalConsecutive" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">中年級自然科強制連堂</span>
            <span class="sub">3-4 年級自然課是否強制以連堂形式建模。</span>
          </div>
        </div>

        <div class="control-item">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.swimmingCapEnabled" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">啟用 4-6 年級自動游泳連堂</span>
            <span class="sub">自動從 4-6 年級抽取「1 體育 + 1 導師區塊」連堂，並套用單時段上限。</span>
          </div>
        </div>

        <div class="control-item">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.artsClassEnabled" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">啟用藝才班特規排課</span>
            <span class="sub">允許藝才班的虛擬 / 外聘 / 待排教師套用特規排課邏輯。</span>
          </div>
        </div>

        <div
          class="arts-class-list"
          v-if="scheduleStore.aiSettings.artsClassEnabled"
        >
          <p><strong>目前系統中的藝才班：</strong></p>
          <div class="class-chip-wrap">
            <span
              v-for="cls in artsClasses"
              :key="cls.id"
              class="class-chip"
            >
              {{ cls.name }}
            </span>
            <span v-if="artsClasses.length === 0" class="empty-warning">
              尚未指定任何藝才班
            </span>
          </div>
        </div>

        <div class="control-item">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.grade12TuesdayAfternoonHomeroom" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">低年級週二下午排導師課</span>
            <span class="sub">1-2 年級週二下午強制保留給導師區塊，不排科任課。</span>
          </div>
        </div>

        <div class="control-item">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.homeroomBlockizationEnabled" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">導師科目自動區塊化</span>
            <span class="sub">將國語、數學等導師負責的科目，合併成導師區塊後再排課。</span>
          </div>
        </div>
      </div>

      <!-- [2026-06-28] 五六年級共備設定 -->
      <div class="settings-card co-planning-controls">
        <h3>五六年級共備設定 (Co-Planning)</h3>
        <p class="desc">
          控制五六年級導師共備區塊的排課策略，包含自動候選區塊與手動指定區塊兩種模式。
        </p>

        <div class="control-item">
          <label class="switch">
            <input type="checkbox" v-model="coPlanningEnabled" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">啟用五六年級共備</span>
            <span class="sub">啟用後，5/6 年級導師將依設定模式安排共備區塊。</span>
          </div>
        </div>

        <!-- Grades selector -->
        <div class="control-item" v-if="coPlanningEnabled">
          <div class="label-box" style="flex-direction: row; align-items: center; gap: 12px;">
            <span class="title" style="margin: 0;">啟用年級</span>
            <label class="grade-checkbox">
              <input type="checkbox" :value="5" v-model="coPlanningGrades" />
              <span>5 年級</span>
            </label>
            <label class="grade-checkbox">
              <input type="checkbox" :value="6" v-model="coPlanningGrades" />
              <span>6 年級</span>
            </label>
          </div>
        </div>

        <div class="control-item" v-if="coPlanningEnabled">
          <label class="switch">
            <input type="checkbox" v-model="coPlanningManualMode" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">手動指定共備區塊</span>
            <span class="sub">關閉時使用自動模式；開啟時需手動指定各年級共備時段。</span>
          </div>
        </div>

        <!-- Candidate Blocks editor (auto mode) -->
        <div v-if="coPlanningEnabled && !coPlanningManualMode" class="candidate-blocks-section">
          <h4>候選區塊 (自動模式)</h4>
          <p class="desc">新增下午連續 2 節的候選區塊，solver 會從中偏好選擇。</p>

          <div class="candidate-block-row" v-for="(block, idx) in coPlanningCandidateBlocks" :key="idx">
            <span class="block-index">#{{ idx + 1 }}</span>
            <select :value="block.day" @change="updateCandidateBlockField(idx, 'day', $event)">
              <option :value="null" disabled>星期</option>
              <option v-for="d in 5" :key="'cb_d' + idx + '_' + d" :value="d">{{ dayLabel(d) }}</option>
            </select>
            <select :value="block.startPeriod" @change="updateCandidateBlockField(idx, 'startPeriod', $event)">
              <option :value="null" disabled>開始節次</option>
              <option :value="5">第 5 節（下午第 1 節）</option>
              <option :value="6">第 6 節（下午第 2 節）</option>
            </select>
            <span class="block-length-badge">連續 2 節</span>
            <button class="btn-remove" @click="removeCandidateBlock(idx)" :disabled="coPlanningCandidateBlocks.length <= 1">✕</button>
          </div>

          <button class="btn-add" @click="addCandidateBlock">＋ 新增候選區塊</button>
        </div>

        <div v-if="coPlanningEnabled && coPlanningManualMode" class="manual-blocks-section">
          <h4>手動指定共備區塊</h4>
          <p class="desc">為 5 年級與 6 年級分別指定共備時段（固定連續 2 節）。</p>

          <div class="manual-block-row">
            <label>5 年級共備時段</label>
            <div class="block-selectors">
              <select v-model="manualBlock5Day">
                <option :value="null" disabled>選擇星期</option>
                <option v-for="d in 5" :key="'d5_' + d" :value="d">{{ dayLabel(d) }}</option>
              </select>
              <select v-model="manualBlock5Period">
                <option :value="null" disabled>選擇開始節次</option>
                <option :value="5">第 5 節（下午第 1 節）</option>
              </select>
              <span class="block-length-badge">連續 2 節</span>
            </div>
          </div>

          <div class="manual-block-row">
            <label>6 年級共備時段</label>
            <div class="block-selectors">
              <select v-model="manualBlock6Day">
                <option :value="null" disabled>選擇星期</option>
                <option v-for="d in 5" :key="'d6_' + d" :value="d">{{ dayLabel(d) }}</option>
              </select>
              <select v-model="manualBlock6Period">
                <option :value="null" disabled>選擇開始節次</option>
                <option :value="5">第 5 節（下午第 1 節）</option>
              </select>
              <span class="block-length-badge">連續 2 節</span>
            </div>
          </div>

          <div class="manual-block-warning" v-if="manualBlocksConflict">
            ⚠️ 5 年級與 6 年級的共備時段重疊，請調整為不同時段。
          </div>
        </div>
      </div>

      <button @click="saveSettings" class="main-save-btn">儲存所有設定</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { useAiStore } from '../stores/aiSettings'
import { useScheduleStore } from '../stores/schedule'

const aiStore = useAiStore()
const scheduleStore = useScheduleStore()

const API_BASE = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:3000/api`
const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

const isTesting = ref(false)
const testResult = ref('')
const testStatus = ref('')

const serviceOptions = [
  {
    type: 'ollama',
    label: 'Ollama',
    defaultUrl: 'http://172.20.199.150:11434/api/generate',
    defaultModel: 'gemma4:e4b',
    defaultPort: '11434',
    path: '/api/generate',
    description: '最適合目前系統預設流程的本地模型服務。',
    hint: 'Ollama 會使用 /api/generate。',
    modelHint: 'Ollama 會把 Model ID 帶到 generate request 中。',
  },
  {
    type: 'llama.cpp',
    label: 'llama.cpp',
    defaultUrl: 'http://127.0.0.1:8080/v1/chat/completions',
    defaultModel: 'llama',
    defaultPort: '8080',
    path: '/v1/chat/completions',
    description: '使用 OpenAI 相容介面時，最容易和前端共用。',
    hint: 'llama.cpp 會使用 /v1/chat/completions。',
    modelHint: '通常可以填你啟動伺服器時使用的模型名稱或別名。',
  },
  {
    type: 'lmstudio',
    label: 'LM Studio',
    defaultUrl: 'http://127.0.0.1:1234/v1/chat/completions',
    defaultModel: 'lmstudio',
    defaultPort: '1234',
    path: '/v1/chat/completions',
    description: 'OpenAI 相容的聊天完成介面，適合桌面端模型管理。',
    hint: 'LM Studio 使用 OpenAI 相容的 chat completions。',
    modelHint: 'LM Studio 通常直接填你載入模型的名稱。',
  },
]

const activeService = computed(() => {
  return serviceOptions.find((item) => item.type === normalizeServiceType(aiStore.serviceType)) || serviceOptions[0]
})

const artsClasses = computed(() => {
  return scheduleStore.classes.filter((cls) => cls.isArtsClass)
})

// [2026-06-28] Co-Planning UI state
const coPlanningSettings = computed(() => {
  return scheduleStore.schoolInfo.coPlanningSettings || {
    enabled: false,
    grades: [5, 6],
    mode: 'auto',
    candidateBlocks: [],
    manualBlocks: { '5': null, '6': null }
  }
})

const coPlanningEnabled = computed({
  get: () => coPlanningSettings.value.enabled,
  set: (val) => {
    scheduleStore.schoolInfo.coPlanningSettings = {
      ...coPlanningSettings.value,
      enabled: val,
      mode: val ? coPlanningSettings.value.mode : 'auto',
    }
    scheduleStore.markScheduleDirty()
  }
})

const coPlanningManualMode = computed({
  get: () => coPlanningSettings.value.mode === 'manual',
  set: (val) => {
    scheduleStore.schoolInfo.coPlanningSettings = {
      ...coPlanningSettings.value,
      mode: val ? 'manual' : 'auto',
    }
    scheduleStore.markScheduleDirty()
  }
})

const manualBlock5Day = computed({
  get: () => coPlanningSettings.value.manualBlocks?.['5']?.day ?? null,
  set: (val) => {
    const current = coPlanningSettings.value.manualBlocks?.['5']
    scheduleStore.schoolInfo.coPlanningSettings = {
      ...coPlanningSettings.value,
      manualBlocks: {
        ...coPlanningSettings.value.manualBlocks,
        '5': current ? { ...current, day: val } : (val ? { day: val, startPeriod: null, length: 2 } : null),
      }
    }
    scheduleStore.markScheduleDirty()
  }
})

const manualBlock5Period = computed({
  get: () => coPlanningSettings.value.manualBlocks?.['5']?.startPeriod ?? null,
  set: (val) => {
    const current = coPlanningSettings.value.manualBlocks?.['5']
    scheduleStore.schoolInfo.coPlanningSettings = {
      ...coPlanningSettings.value,
      manualBlocks: {
        ...coPlanningSettings.value.manualBlocks,
        '5': current ? { ...current, startPeriod: val } : (val ? { day: null, startPeriod: val, length: 2 } : null),
      }
    }
    scheduleStore.markScheduleDirty()
  }
})

const manualBlock6Day = computed({
  get: () => coPlanningSettings.value.manualBlocks?.['6']?.day ?? null,
  set: (val) => {
    const current = coPlanningSettings.value.manualBlocks?.['6']
    scheduleStore.schoolInfo.coPlanningSettings = {
      ...coPlanningSettings.value,
      manualBlocks: {
        ...coPlanningSettings.value.manualBlocks,
        '6': current ? { ...current, day: val } : (val ? { day: val, startPeriod: null, length: 2 } : null),
      }
    }
    scheduleStore.markScheduleDirty()
  }
})

const manualBlock6Period = computed({
  get: () => coPlanningSettings.value.manualBlocks?.['6']?.startPeriod ?? null,
  set: (val) => {
    const current = coPlanningSettings.value.manualBlocks?.['6']
    scheduleStore.schoolInfo.coPlanningSettings = {
      ...coPlanningSettings.value,
      manualBlocks: {
        ...coPlanningSettings.value.manualBlocks,
        '6': current ? { ...current, startPeriod: val } : (val ? { day: null, startPeriod: val, length: 2 } : null),
      }
    }
    scheduleStore.markScheduleDirty()
  }
})

const manualBlocksConflict = computed(() => {
  const b5 = coPlanningSettings.value.manualBlocks?.['5']
  const b6 = coPlanningSettings.value.manualBlocks?.['6']
  if (!b5 || !b6 || !b5.day || !b5.startPeriod || !b6.day || !b6.startPeriod) return false
  // Conflict if same day and overlapping periods (length=2 for both)
  if (b5.day !== b6.day) return false
  const s5Start = b5.startPeriod, s5End = b5.startPeriod + 1
  const s6Start = b6.startPeriod, s6End = b6.startPeriod + 1
  return s5Start <= s6End && s6Start <= s5End
})

// [2026-06-28] Grades selector
const coPlanningGrades = computed({
  get: () => {
    const grades = coPlanningSettings.value.grades
    if (Array.isArray(grades)) return grades.filter(g => g === 5 || g === 6)
    return [5, 6]
  },
  set: (val) => {
    const grades = Array.isArray(val) ? val : []
    // Ensure at least one grade is selected; if empty, default to [5,6]
    const effective = grades.length > 0 ? grades : [5, 6]
    scheduleStore.schoolInfo.coPlanningSettings = {
      ...coPlanningSettings.value,
      grades: effective,
    }
    scheduleStore.markScheduleDirty()
  }
})

// [2026-06-28] Candidate Blocks reactive array
const coPlanningCandidateBlocks = computed({
  get: () => {
    const blocks = coPlanningSettings.value.candidateBlocks
    if (Array.isArray(blocks)) return blocks
    return []
  },
  set: (val) => {
    scheduleStore.schoolInfo.coPlanningSettings = {
      ...coPlanningSettings.value,
      candidateBlocks: val,
    }
    scheduleStore.markScheduleDirty()
  }
})

function addCandidateBlock() {
  const current = coPlanningCandidateBlocks.value
  const newBlock = { day: null, startPeriod: 5, length: 2 }
  scheduleStore.schoolInfo.coPlanningSettings = {
    ...coPlanningSettings.value,
    candidateBlocks: [...current, newBlock],
  }
  scheduleStore.markScheduleDirty()
}

/**
 * [2026-06-29] Immutable update for candidate block fields.
 * Ensures Vue/Pinia detects the change and marks schedule dirty.
 * Validates: day in 1..5, startPeriod in {5, 6}, length always 2.
 */
function updateCandidateBlockField(idx, field, event) {
  const blocks = coPlanningCandidateBlocks.value
  if (idx < 0 || idx >= blocks.length) return

  let rawVal = event.target?.value ?? event
  // Convert string from select to number
  const val = rawVal === '' || rawVal === null || rawVal === undefined ? null : Number(rawVal)

  // Validate day: must be 1-5
  if (field === 'day') {
    if (val !== null && (val < 1 || val > 5)) return
  }
  // Validate startPeriod: must be 5 or 6 (afternoon periods)
  if (field === 'startPeriod') {
    if (val !== null && !([5, 6].includes(val))) return
  }

  // Immutable update: clone array, clone block, set field
  const newBlocks = blocks.map((b, i) => {
    if (i !== idx) return b
    return { ...b, [field]: val }
  })

  scheduleStore.schoolInfo.coPlanningSettings = {
    ...coPlanningSettings.value,
    candidateBlocks: newBlocks,
  }
  scheduleStore.markScheduleDirty()
}

function removeCandidateBlock(idx) {
  const current = coPlanningCandidateBlocks.value
  if (current.length <= 1) return
  const next = current.filter((_, i) => i !== idx)
  scheduleStore.schoolInfo.coPlanningSettings = {
    ...coPlanningSettings.value,
    candidateBlocks: next,
  }
  scheduleStore.markScheduleDirty()
}

function dayLabel(d) {
  return ['週一', '週二', '週三', '週四', '週五'][d - 1] || `第 ${d} 天`
}

onMounted(() => {
  aiStore.loadFromApi()
})

function normalizeServiceType(value) {
  return serviceOptions.some((item) => item.type === value) ? value : 'ollama'
}

function getServicePreset(serviceType) {
  return serviceOptions.find((item) => item.type === normalizeServiceType(serviceType)) || serviceOptions[0]
}

function normalizeServiceUrl(rawUrl, serviceType) {
  const preset = getServicePreset(serviceType)
  let url = String(rawUrl || '').trim()

  if (!url) {
    return preset.defaultUrl
  }

  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`
  }

  try {
    const parsed = new URL(url)
    if (!parsed.port) {
      parsed.port = preset.defaultPort
    }

    if (parsed.pathname === '/' || parsed.pathname === '/api' || !parsed.pathname.startsWith('/')) {
      parsed.pathname = preset.path
    } else if (parsed.pathname !== preset.path) {
      parsed.pathname = preset.path
    }

    return parsed.toString().replace(/\/$/, '')
  } catch {
    return rawUrl
  }
}

function selectServiceType(type) {
  const nextType = normalizeServiceType(type)
  const prevPreset = getServicePreset(aiStore.serviceType)
  const nextPreset = getServicePreset(nextType)

  const urlWasDefault = !aiStore.apiUrl || aiStore.apiUrl === prevPreset.defaultUrl
  const modelWasDefault = !aiStore.model || aiStore.model === prevPreset.defaultModel

  aiStore.serviceType = nextType

  if (urlWasDefault) {
    aiStore.apiUrl = nextPreset.defaultUrl
  }
  if (modelWasDefault) {
    aiStore.model = nextPreset.defaultModel
  }
}

function extractResponseText(serviceType, data) {
  if (serviceType === 'llama.cpp') {
    return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.content || data?.response || ''
  }

  if (serviceType === 'lmstudio') {
    return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.content || ''
  }

  return data?.response || data?.message || data?.content || ''
}

function classifyError(error, status, serviceType) {
  const label = getServicePreset(serviceType).label

  if (status === 405) {
    return `❌ ${label} API 方法錯誤 (405)：請確認端點與請求格式是否正確。`
  }
  if (status === 404) {
    return `❌ ${label} 端點不存在 (404)：請確認網址、Port 與路徑。`
  }
  if (status >= 500) {
    return `❌ ${label} 伺服器錯誤 (${status})：請檢查服務是否正常運作。`
  }
  if (error?.name === 'TypeError' || String(error?.message || '').includes('Failed to fetch')) {
    return `❌ ${label} 連線失敗：請確認後端 API 與目標模型服務都已啟動，且網路可達。`
  }
  if (String(error?.message || '').toLowerCase().includes('timeout')) {
    return `❌ ${label} 連線逾時：請確認服務負載與網路狀態。`
  }
  return `❌ ${label} 連線失敗：${error?.message || '未知錯誤'}`
}

async function testConnection() {
  isTesting.value = true
  testResult.value = ''

  const serviceType = normalizeServiceType(aiStore.serviceType)
  const targetUrl = normalizeServiceUrl(aiStore.apiUrl, serviceType)

  try {
    const { data } = await api.post('/ai-test-connection', {
      serviceType,
      apiUrl: targetUrl,
      model: aiStore.model,
    })
    if (!data?.ok) {
      throw new Error(classifyError(new Error('HTTP error'), data?.status, serviceType))
    }

    const reply = extractResponseText(serviceType, data?.data).slice(0, 200)
    testStatus.value = 'success'
    testResult.value = reply ? `✅ 連線成功：${reply}` : '✅ 連線成功'
  } catch (error) {
    console.error('AI 連線測試失敗:', error)
    testStatus.value = 'error'
    if (error?.response?.status === 404) {
      if (error?.response?.data?.source === 'server') {
        testResult.value = '❌ AI 測試路由不存在：請先重啟後端 server.js，確認 /api/ai-test-connection 已載入。'
      } else if (error?.response?.data?.source === 'upstream') {
        testResult.value = `❌ llama.cpp 上游端點回傳 404：請確認服務端實際路徑、Port 與啟動模式。目標 URL：${error.response.data.targetUrl || targetUrl}`
      } else {
        testResult.value = classifyError(error, error?.response?.status || error?.status, serviceType)
      }
      return
    }

    testResult.value = error?.message?.startsWith('❌')
      ? error.message
      : classifyError(error, error?.response?.status || error?.status, serviceType)
  } finally {
    isTesting.value = false
  }
}

async function saveAiSettings() {
  try {
    aiStore.apiUrl = normalizeServiceUrl(aiStore.apiUrl, aiStore.serviceType)
    await aiStore.saveToApi()
    aiStore.saveSettings()
    alert('AI 連線設定已儲存，下次重新整理後也會保留。')
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      alert('儲存逾時：後端可能暫時沒有回應。')
    } else if (error.code === 'ERR_NETWORK' || (!error.response && error.message)) {
      alert('儲存失敗：請確認後端 API 服務正在執行。')
    } else if (error.response) {
      const { status, data } = error.response
      if (status === 404) {
        alert('儲存失敗 (404)：後端路由 /api/ai-system-settings 不存在。')
      } else if (status === 500) {
        alert(`儲存失敗 (500)：${data?.details || data?.message || '伺服器錯誤'}`)
      } else {
        alert(`儲存失敗 (${status})：${data?.message || data?.details || '未知錯誤'}`)
      }
    } else {
      alert(`儲存失敗：${error.message || '未知錯誤'}`)
    }
  }
}

async function saveSettings() {
  const ok = await scheduleStore.syncToCloud()
  if (ok) {
    alert('演算法硬約束設定已儲存。')
  }
}
</script>

<style scoped>
.settings-page {
  padding-bottom: 50px;
}

.ai-settings-container {
  padding: 20px;
  max-width: 920px;
  margin: 0 auto;
}

.desc {
  color: #64748b;
  margin-bottom: 25px;
}

.settings-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.form-group {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
}

.form-group label {
  font-weight: 700;
  color: #334155;
  margin-bottom: 8px;
}

.form-group input[type='text'],
.form-group textarea {
  padding: 12px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.form-group small {
  color: #64748b;
  margin-top: 6px;
  font-size: 0.85em;
  line-height: 1.5;
}

.disabled-section {
  opacity: 0.55;
  pointer-events: none;
}

.toggle-group {
  flex-direction: row !important;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 20px;
  margin-bottom: 22px;
}

.toggle-label {
  font-size: 1.05em;
  font-weight: 800;
  color: #0f172a;
}

.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 28px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #cbd5e1;
  transition: 0.25s;
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 4px;
  bottom: 4px;
  background-color: white;
  transition: 0.25s;
}

input:checked + .slider {
  background-color: #10b981;
}

input:checked + .slider:before {
  transform: translateX(22px);
}

.slider.round {
  border-radius: 34px;
}

.slider.round:before {
  border-radius: 50%;
}

.service-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.service-card {
  text-align: left;
  border: 1px solid #cbd5e1;
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff, #f8fafc);
  padding: 14px;
  cursor: pointer;
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
}

.service-card:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: #818cf8;
  box-shadow: 0 10px 18px rgba(99, 102, 241, 0.12);
}

.service-card.active {
  border-color: #4f46e5;
  box-shadow: 0 10px 20px rgba(79, 70, 229, 0.18);
}

.service-card:disabled {
  cursor: not-allowed;
}

.service-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.service-title {
  font-weight: 800;
  color: #0f172a;
}

.service-chip {
  font-size: 0.78em;
  background: #e0e7ff;
  color: #3730a3;
  padding: 2px 8px;
  border-radius: 999px;
}

.service-desc {
  margin: 0 0 10px 0;
  color: #475569;
  font-size: 0.88em;
  line-height: 1.5;
}

.service-url {
  display: block;
  color: #475569;
  background: #f8fafc;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.82em;
  overflow: auto;
}

.algorithm-controls {
  border-top: 4px solid #f59e0b;
}

.control-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid #f8fafc;
}

.control-item:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.label-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label-box .title {
  font-weight: 800;
  color: #1e293b;
  font-size: 1.05em;
}

.label-box .sub {
  color: #64748b;
  font-size: 0.9em;
  line-height: 1.5;
}

.arts-class-list {
  margin: 10px 0 20px 64px;
  padding: 12px;
  background: #f8fafc;
  border-left: 3px solid #8b5cf6;
  border-radius: 0 10px 10px 0;
}

.class-chip-wrap {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.class-chip {
  background: #ede9fe;
  color: #5b21b6;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.85em;
}

.empty-warning {
  color: #ef4444;
  font-size: 0.85em;
}

.action-buttons {
  display: flex;
  gap: 14px;
  margin-top: 28px;
}

.test-btn,
.save-btn {
  flex: 1;
  border: none;
  padding: 12px 14px;
  border-radius: 10px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.2s, background 0.2s;
}

.test-btn {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
}

.test-btn:hover:not(:disabled) {
  background: #e2e8f0;
  transform: translateY(-1px);
}

.save-btn {
  background: #6366f1;
  color: white;
}

.save-btn:hover {
  background: #4f46e5;
  transform: translateY(-1px);
}

.main-save-btn {
  display: block;
  width: 100%;
  margin-top: 22px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  border: none;
  padding: 14px;
  border-radius: 10px;
  font-weight: 800;
  font-size: 1.05em;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 6px 14px rgba(245, 158, 11, 0.24);
}

.main-save-btn:hover {
  transform: translateY(-2px);
}

.test-result {
  margin-top: 18px;
  padding: 14px;
  border-radius: 10px;
  font-weight: 700;
  line-height: 1.5;
}

.test-result.success {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #10b981;
}

.test-result.error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #ef4444;
}

.advanced-settings {
  margin-top: 20px;
  padding: 20px;
  background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
  border: 1px solid #bae6fd;
  border-radius: 12px;
}

.advanced-settings h3 {
  margin: 0 0 8px 0;
  font-size: 1.05em;
  color: #0c4a6e;
}

.advanced-settings .desc {
  margin: 0 0 16px 0;
  font-size: 0.9em;
  color: #0369a1;
}

.advanced-settings .form-group input[type='number'] {
  padding: 12px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.advanced-settings .form-group input[type='number']:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.co-planning-controls {
  border-top: 4px solid #8b5cf6;
}

.manual-blocks-section {
  margin: 16px 0 0 64px;
  padding: 16px;
  background: #f8fafc;
  border-left: 3px solid #8b5cf6;
  border-radius: 0 10px 10px 0;
}

.manual-blocks-section h4 {
  margin: 0 0 8px 0;
  font-size: 0.95em;
  color: #5b21b6;
}

.manual-block-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.manual-block-row label {
  min-width: 120px;
  font-weight: 700;
  font-size: 0.9em;
  color: #334155;
}

.block-selectors {
  display: flex;
  gap: 8px;
  align-items: center;
}

.block-selectors select {
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.9em;
  background: white;
}

.block-length-badge {
  font-size: 0.78em;
  background: #ede9fe;
  color: #5b21b6;
  padding: 2px 8px;
  border-radius: 999px;
}

.manual-block-warning {
  margin-top: 12px;
  padding: 10px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 8px;
  font-size: 0.85em;
  border: 1px solid #f59e0b;
}

/* [2026-06-28] Grade checkboxes */
.grade-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 0.9em;
  color: #334155;
  font-weight: 600;
}

.grade-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #8b5cf6;
}

/* [2026-06-28] Candidate blocks section */
.candidate-blocks-section {
  margin: 16px 0 0 64px;
  padding: 16px;
  background: #f8fafc;
  border-left: 3px solid #8b5cf6;
  border-radius: 0 10px 10px 0;
}

.candidate-blocks-section h4 {
  margin: 0 0 8px 0;
  font-size: 0.95em;
  color: #5b21b6;
}

.candidate-blocks-section .desc {
  margin: 0 0 12px 0;
  font-size: 0.85em;
  color: #64748b;
}

.candidate-block-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.block-index {
  font-size: 0.8em;
  font-weight: 700;
  color: #8b5cf6;
  min-width: 20px;
}

.candidate-block-row select {
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.9em;
  background: white;
}

.btn-add {
  margin-top: 8px;
  padding: 6px 14px;
  background: #ede9fe;
  color: #5b21b6;
  border: 1px dashed #c4b5fd;
  border-radius: 8px;
  font-size: 0.85em;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-add:hover {
  background: #ddd6fe;
}

.btn-remove {
  padding: 4px 10px;
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  font-size: 0.8em;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-remove:hover:not(:disabled) {
  background: #fecaca;
}

.btn-remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 860px) {
  .service-grid {
    grid-template-columns: 1fr;
  }

  .action-buttons {
    flex-direction: column;
  }
}
</style>
