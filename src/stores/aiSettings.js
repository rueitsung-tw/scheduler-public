import { defineStore } from 'pinia'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:3000/api`

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

const VALID_SERVICE_TYPES = ['ollama', 'llama.cpp', 'lmstudio']
const DEFAULT_MAX_OUTPUT_TOKENS = 8192

function normalizeServiceType(value) {
  return VALID_SERVICE_TYPES.includes(value) ? value : 'ollama'
}

export const useAiStore = defineStore('aiSettings', {
  state: () => ({
    enabled: JSON.parse(localStorage.getItem('dongmen_ai_enabled') ?? 'false'),
    serviceType: normalizeServiceType(localStorage.getItem('dongmen_ai_service_type') || 'ollama'),
    apiUrl: localStorage.getItem('dongmen_ai_url') || 'http://172.20.199.150:11434/api/generate',
    model: localStorage.getItem('dongmen_ai_model') || 'gemma4:e4b',
    systemPrompt:
      localStorage.getItem('dongmen_ai_prompt') ||
      '你是學校課表微調引擎，請只回傳 JSON。若提供 candidateMoves，請只從候選池選擇 candidateId，不可自行發明座標。只能提出同一班內的 swap moves，不能改變各班總節數。優先處理教師衝堂、教室容量超額、需求節數不符。',
    // 本地模型進階參數 (Qwen Thinking 模式穩定化)
    // 建議值：maxOutputTokens=8192, temperature=0, disableThinking=true
    disableThinking: JSON.parse(localStorage.getItem('dongmen_ai_disable_thinking') ?? 'true'),
    maxOutputTokens: Number(localStorage.getItem('dongmen_ai_max_output_tokens') ?? String(DEFAULT_MAX_OUTPUT_TOKENS)),
    temperature: Number(localStorage.getItem('dongmen_ai_temperature') ?? '0'),
  }),
  actions: {
    async loadFromApi() {
      try {
        const { data } = await api.get('/ai-system-settings')
        this.enabled = data.enabled ?? false
        this.serviceType = normalizeServiceType(data.serviceType)
        this.apiUrl = data.apiUrl ?? this.apiUrl
        this.model = data.model ?? this.model
        this.systemPrompt = data.systemPrompt ?? this.systemPrompt
        this.disableThinking = data.disableThinking !== undefined ? data.disableThinking : true
        this.maxOutputTokens = data.maxOutputTokens !== undefined ? Number(data.maxOutputTokens) : DEFAULT_MAX_OUTPUT_TOKENS
        this.temperature = data.temperature !== undefined ? Number(data.temperature) : 0
        this.saveSettings()
      } catch (error) {
        console.warn('AI 設定 API 載入失敗，改用 localStorage', error)
      }
    },

    async saveToApi() {
      try {
        await api.put('/ai-system-settings', {
          enabled: this.enabled,
          serviceType: normalizeServiceType(this.serviceType),
          apiUrl: this.apiUrl,
          model: this.model,
          systemPrompt: this.systemPrompt,
          disableThinking: this.disableThinking,
          maxOutputTokens: this.maxOutputTokens,
          temperature: this.temperature,
        })
      } catch (error) {
        console.error('儲存 AI 設定失敗:', error)
        throw error
      }
    },

    saveSettings() {
      localStorage.setItem('dongmen_ai_enabled', JSON.stringify(this.enabled))
      localStorage.setItem('dongmen_ai_service_type', normalizeServiceType(this.serviceType))
      localStorage.setItem('dongmen_ai_url', this.apiUrl)
      localStorage.setItem('dongmen_ai_model', this.model)
      localStorage.setItem('dongmen_ai_prompt', this.systemPrompt)
      localStorage.setItem('dongmen_ai_disable_thinking', JSON.stringify(this.disableThinking))
      localStorage.setItem('dongmen_ai_max_output_tokens', String(this.maxOutputTokens))
      localStorage.setItem('dongmen_ai_temperature', String(this.temperature))
    },
  },
})
