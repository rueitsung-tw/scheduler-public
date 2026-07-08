<template>
  <div class="dashboard-container">
    <div class="welcome-banner">
      <h2>排課作業首頁</h2>
      <p>請先確認基本資料是否完整，再依序完成設定、排課、檢查與匯出。</p>
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
          <span class="stat-label">目前作業提醒</span>
          <span class="stat-value">可開始檢查資料</span>
        </div>
      </div>
    </div>

    <div class="notice-section">
      <h3>開始前請先確認</h3>
      <ul class="notice-list">
        <li>若教師、班級、課程或教室資料尚未建立完成，請先補齊再開始排課。</li>
        <li>若本學期有固定時段、連堂或特殊課程需求，請先完成相關設定。</li>
        <li>排課完成後，請到課表編輯頁再次檢查，再進行匯出。</li>
      </ul>
    </div>

    <div class="guide-section">
      <h3>建議操作流程</h3>
      <div class="steps-container">

        <div class="step-card">
          <div class="step-header">
            <div class="step-number">1</div>
            <h4>先建立基本資料</h4>
          </div>
          <ul class="step-list">
            <li>先確認<strong>教師、班級、課程與教室</strong>資料都已建立完成。</li>
            <li>若有缺少資料，請先到左側選單補齊。</li>
            <li>資料不完整時先不要開始排課，以免後續需要重做。</li>
          </ul>
        </div>

        <div class="step-card">
          <div class="step-header">
            <div class="step-number">2</div>
            <h4>設定教師與課程</h4>
          </div>
          <ul class="step-list">
            <li>設定教師授課內容、班級需求與必要限制。</li>
            <li>若有固定時段、連堂或特殊課程，請先完成設定。</li>
            <li>完成後建議再檢查一次內容是否正確。</li>
          </ul>
        </div>

        <div class="step-card">
          <div class="step-header">
            <div class="step-number">3</div>
            <h4>開始自動排課</h4>
          </div>
          <ul class="step-list">
            <li>進入<strong>排課頁面</strong>後啟動排課，等待系統產生結果。</li>
            <li>若排課失敗，請先回頭檢查資料或限制設定是否完整。</li>
            <li>排課完成後，請先查看結果再離開頁面。</li>
          </ul>
        </div>

        <div class="step-card">
          <div class="step-header">
            <div class="step-number">4</div>
            <h4>檢查、微調與匯出</h4>
          </div>
          <ul class="step-list">
            <li>到<strong>課表編輯</strong>頁面檢查衝突、連堂與時段安排。</li>
            <li>確認內容無誤後，再前往<strong>匯出</strong>頁面輸出課表。</li>
            <li>若需要調整，請先完成修改後再匯出正式版本。</li>
          </ul>
        </div>

      </div>
    </div>

    <div class="shortcut-section">
      <h3>常用功能入口</h3>
      <div class="shortcut-grid">
        <div class="shortcut-card">
          <h4>教師管理</h4>
          <p>新增或檢查教師資料。</p>
        </div>
        <div class="shortcut-card">
          <h4>班級與課程</h4>
          <p>確認班級、課程與需求設定。</p>
        </div>
        <div class="shortcut-card">
          <h4>開始排課</h4>
          <p>啟動排課並查看結果。</p>
        </div>
        <div class="shortcut-card">
          <h4>課表編輯與匯出</h4>
          <p>微調課表並輸出正式版本。</p>
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

/* 操作提醒 */
.notice-section,
.guide-section { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
.notice-section { margin-bottom: 24px; }
.notice-section h3,
.guide-section h3,
.shortcut-section h3 { margin-top: 0; color: #1e293b; font-size: 1.4rem; border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px; }
.notice-list { margin: 0; padding-left: 20px; color: #475569; line-height: 1.7; }
.notice-list li { margin-bottom: 10px; }

/* 流程指引 */
.steps-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
.step-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; position: relative; transition: transform 0.2s; }
.step-card:hover { transform: translateY(-3px); box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
.step-header { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
.step-number { background: #3b82f6; color: white; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: bold; font-size: 1.2rem; }
.step-header h4 { margin: 0; color: #334155; font-size: 1.1rem; }
.step-list { margin: 0; padding-left: 20px; color: #475569; font-size: 0.95rem; line-height: 1.6; }
.step-list li { margin-bottom: 8px; }

/* 常用入口 */
.shortcut-section { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; margin-top: 24px; }
.shortcut-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.shortcut-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; }
.shortcut-card h4 { margin: 0 0 10px 0; color: #334155; font-size: 1.05rem; }
.shortcut-card p { margin: 0; color: #64748b; line-height: 1.6; }
</style>
