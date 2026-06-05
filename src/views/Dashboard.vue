<template>
  <div class="dashboard-container">
    <div class="welcome-banner">
      <h2>🎉 歡迎使用東門國小智慧排課系統</h2>
      <p>整合 108 課綱法定節數、動態師資配額與 AI 演算法的新世代校務排課引擎。</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">👨‍🏫</div>
        <div class="stat-info">
          <span class="stat-label">已建檔教師</span>
          <span class="stat-value">{{ scheduleStore.teachers ? scheduleStore.teachers.length : 0 }} <small>人</small></span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏫</div>
        <div class="stat-info">
          <span class="stat-label">已設定班級</span>
          <span class="stat-value">{{ scheduleStore.classes ? scheduleStore.classes.length : 0 }} <small>班</small></span>
        </div>
      </div>
      <div class="stat-card status-ready">
        <div class="stat-icon">⚡</div>
        <div class="stat-info">
          <span class="stat-label">演算法引擎狀態</span>
          <span class="stat-value">準備就緒</span>
        </div>
      </div>
    </div>

    <div class="guide-section">
      <h3>📑 排課標準作業流程 (SOP)</h3>
      <div class="steps-container">

        <div class="step-card">
          <div class="step-header">
            <div class="step-number">1</div>
            <h4>系統參數與配額設定</h4>
          </div>
          <ul class="step-list">
            <li>至<strong>「系統參數設定」</strong>確認各年級班級數。</li>
            <li>設定 108 課綱各科法定節數矩陣。</li>
            <li>至<strong>「教師配額管理」</strong>設定個人減課與超鐘點。</li>
          </ul>
        </div>

        <div class="step-card">
          <div class="step-header">
            <div class="step-number">2</div>
            <h4>師資建檔與三軌課程</h4>
          </div>
          <ul class="step-list">
            <li>匯入本學期最新<strong>「教師名單 CSV」</strong>。</li>
            <li>建立<strong>「校訂彈性課程」</strong>(如：智慧達人)。</li>
            <li>建立<strong>「特殊專案課程」</strong>(如：資源班抽離、游泳課模塊)。</li>
          </ul>
        </div>

        <div class="step-card">
          <div class="step-header">
            <div class="step-number">3</div>
            <h4>雙向配課作業</h4>
          </div>
          <ul class="step-list">
            <li><strong>導師縱向：</strong>由系統依據範本自動展開班級科目。</li>
            <li><strong>科任橫向：</strong>使用批次派送，可選「鎖定班級」或「鎖定年級」。</li>
            <li>系統將自動檢查是否超過該教師之「授課配額」。</li>
          </ul>
        </div>

        <div class="step-card">
          <div class="step-header">
            <div class="step-number">4</div>
            <h4>AI 運算與微調發布</h4>
          </div>
          <ul class="step-list">
            <li>點擊啟動 <strong>AI 演算法</strong> 進行最佳化排課。</li>
            <li>至<strong>「人工微調編輯器」</strong>進行微調與連堂確認。</li>
            <li>鎖定課表並發布至各班級與教師。</li>
          </ul>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { useScheduleStore } from '../stores/schedule'
const scheduleStore = useScheduleStore()
</script>

<style scoped>
.dashboard-container { padding: 10px 20px; max-width: 1200px; margin: 0 auto; }
.welcome-banner { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 25px 30px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.welcome-banner h2 { margin: 0 0 10px 0; font-size: 1.8rem; }
.welcome-banner p { margin: 0; color: #cbd5e1; font-size: 1.1rem; }

/* 統計卡片 */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
.stat-card { background: white; padding: 20px; border-radius: 10px; display: flex; align-items: center; gap: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
.stat-icon { font-size: 2.5rem; background: #f1f5f9; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
.stat-info { display: flex; flex-direction: column; }
.stat-label { color: #64748b; font-size: 0.9rem; font-weight: bold; margin-bottom: 5px; }
.stat-value { font-size: 1.8rem; font-weight: 900; color: #0f172a; }
.stat-value small { font-size: 1rem; color: #94a3b8; font-weight: normal; }
.status-ready { border-left: 5px solid #10b981; }
.status-ready .stat-icon { background: #d1fae5; }
.status-ready .stat-value { color: #10b981; font-size: 1.4rem; }

/* SOP 流程指引 */
.guide-section { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
.guide-section h3 { margin-top: 0; color: #1e293b; font-size: 1.4rem; border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px; }
.steps-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
.step-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; position: relative; transition: transform 0.2s; }
.step-card:hover { transform: translateY(-3px); box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
.step-header { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
.step-number { background: #3b82f6; color: white; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: bold; font-size: 1.2rem; }
.step-header h4 { margin: 0; color: #334155; font-size: 1.1rem; }
.step-list { margin: 0; padding-left: 20px; color: #475569; font-size: 0.95rem; line-height: 1.6; }
.step-list li { margin-bottom: 8px; }
</style>
