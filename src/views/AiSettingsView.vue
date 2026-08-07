<template>
  <div class="settings-page">
    <div class="ai-settings-container">
      <h2>⚙️ 系統功能設定</h2>

      <div class="settings-card">
        <h3>AI 連線設定</h3>
        <p class="desc">
          這裡可以切換你要連線的本地 LLM 服務，並針對不同服務自動套用對應的端點與測試方式。
        </p>
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

      <!-- 🆕 預排課表匯入區塊 -->
      <div class="settings-card preallocation-import-card" style="margin-top: 24px;">
        <h3>預排課表匯入</h3>
        <p class="compat-notice" style="font-size: 12px; color: #6b7280; margin: 0 0 8px;">
          💡 本區塊保留本土語相容匯入路徑。其他科目請使用
          <RouterLink to="/prealloc-import" style="color: #2563eb;">通用預排匯入</RouterLink>。
        </p>
        <p class="desc">
          匯入外部預排課表（目前優先支援 native-language-scheduler 的 <code>native-language-exchange.json</code>）。匯入前進行班級、教師與時段對照與衝突診斷，請完成衝突決議後套用。
        </p>

        <div class="file-upload-row">
          <input
            type="file"
            accept=".json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ref="preallocationFileInput"
            @change="handlePreallocationFileUpload"
            style="display: none;"
          />
          <button @click="$refs.preallocationFileInput.click()" class="test-btn file-select-btn" type="button">
            📂 選擇預排課表檔 (.json / .xlsx)
          </button>
          <button @click="handleDownloadExcelTemplate" class="test-btn template-download-btn" type="button" style="margin-left: 8px;">
            📥 下載 Excel 範例檔
          </button>
          <span v-if="importFileName" class="file-name-text" style="margin-left: 8px;">已選擇：{{ importFileName }}</span>
        </div>

        <div v-if="importError" class="test-result error" style="margin-top: 12px;">
          ❌ {{ importError }}
        </div>

        <div v-if="preallocationPlan" class="preallocation-preview-section">
          <div class="summary-info-bar">
            <span>來源：<strong>{{ preallocationPlan.source?.sourceKind === 'excel-template' ? 'Excel 範例格式' : 'JSON 預排匯入' }}</strong></span>
            <span>預排項目總計：<strong>{{ preallocationPlan.summary.imported }}</strong> 筆</span>
            <span>強鎖：<strong>{{ preallocationPlan.summary.hardLocked }}</strong> 節</span>
            <span>可微調：<strong>{{ preallocationPlan.summary.movable }}</strong> 節</span>
            <span>其他母語綁定保護：<strong>{{ preallocationPlan.summary.protectedByPullout }}</strong> 節</span>
            <span :class="{ 'warning-text': preallocationPlan.summary.conflicts > 0 }">
              衝突班級數：<strong>{{ preallocationPlan.classPlans.filter(p => p.conflicts.length > 0).length }}</strong> 班
            </span>
          </div>

          <div v-for="classPlan in preallocationPlan.classPlans" :key="classPlan.className" class="class-plan-card">
            <div class="class-plan-header">
              <span class="class-title">🏫 {{ classPlan.className }}</span>
              <span v-if="classPlan.conflicts.length > 0" class="conflict-badge">
                ⚠️ {{ classPlan.conflicts.length }} 項衝突
              </span>
              <span v-else class="success-badge">
                ✅ 無衝突
              </span>
            </div>

            <table class="conflict-detail-table">
              <thead>
                <tr>
                  <th>科目</th>
                  <th>原有教師 → 匯入教師</th>
                  <th>原有時段內容 → 匯入時段</th>
                  <th>人工鎖定</th>
                  <th>微調 / 保護</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in classPlan.importedEntries" :key="entry.id">
                  <td>{{ entry.subject }}</td>
                  <td>
                    <span v-if="getTeacherDiff(classPlan.className, entry.subject)" class="diff-text">
                      {{ getTeacherDiff(classPlan.className, entry.subject).original }} → <strong>{{ entry.teacher }}</strong>
                    </span>
                    <span v-else>{{ entry.teacher }}</span>
                  </td>
                  <td>
                    <span>週{{ ['一','二','三','四','五'][entry.originalSlot.day - 1] || entry.originalSlot.day }} 第{{ entry.originalSlot.period }}節</span>
                  </td>
                  <td>
                    <span v-if="entry.sourceLocked || entry.protectedByPullout">🔒 強鎖</span>
                    <span v-else>解鎖</span>
                  </td>
                  <td>
                    <span v-if="entry.protectedByPullout" class="tag-protected">
                      其他母語綁定保護 (強制強鎖)
                    </span>
                    <label v-else-if="!entry.sourceLocked" class="inline-checkbox">
                      <input
                        type="checkbox"
                        :checked="entry.lockMode === 'movable'"
                        @change="toggleEntryMovable(entry.id, $event.target.checked)"
                      />
                      <span>允許微調</span>
                    </label>
                    <span v-else>來源強鎖</span>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="classPlan.conflicts.length > 0" class="resolution-choice-box">
              <div class="choice-title">🚨 衝突決議選項 (此班必須選擇一項方可匯入)：</div>
              <label class="choice-option">
                <input
                  type="radio"
                  :name="`resolution_${classPlan.className}`"
                  value="overwrite_imported_fields"
                  v-model="classPlan.resolution"
                />
                <span><strong>以匯入資料複寫此班衝突欄位</strong> (僅更新匯入明示的該班科目教師與衝突時段)</span>
              </label>
              <label class="choice-option">
                <input
                  type="radio"
                  :name="`resolution_${classPlan.className}`"
                  value="keep_existing_skip_import"
                  v-model="classPlan.resolution"
                />
                <span><strong>維持此班既有資料，跳過匯入</strong> (保留該班所有既有課表與教師指派)</span>
              </label>
            </div>
          </div>

          <div class="apply-actions" style="margin-top: 20px;">
            <button
              @click="confirmApplyPreallocationImport"
              class="main-save-btn apply-import-btn"
              :disabled="!canApplyPlan"
              type="button"
            >
              {{ canApplyPlan ? '確認套用匯入' : '請先完成所有衝突班級決議' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 🆕 預排事件設定 -->
      <div class="settings-card prealloc-event-settings-card" style="margin-top: 24px;">
        <h3>預排事件設定</h3>
        <p class="desc">
          控制新版通用預排匯入的解析行為與微調範圍。
          <RouterLink to="/prealloc-import">前往通用預排匯入頁面</RouterLink>
        </p>

        <div class="prealloc-event-adjustment-panel">
          <h4>事件微調管理</h4>
          <p class="sub">僅「已套用」且尚未完成的事件可啟用。一次只能選取一個事件交給智慧排課微調。</p>
          <p v-if="adjustableEvents.length === 0" class="empty-notice">目前沒有可微調的預排事件。</p>
          <div v-for="event in adjustableEvents" :key="event.id" class="prealloc-event-row">
            <label>
              <input
                type="radio"
                name="activePreallocEvent"
                :value="event.id"
                :checked="scheduleStore.schoolInfo.preallocEventSettings?.activePreallocEventId === event.id"
                @change="selectActivePreallocEvent(event.id)"
              />
              {{ event.subject }}｜{{ event.sourceFileName }}
            </label>
            <label class="inline-checkbox-label">
              <input
                type="checkbox"
                :checked="event.allowAdjustment"
                @change="setEventAdjustment(event.id, $event.target.checked)"
              />
              允許微調
            </label>
            <span>人工鎖定 {{ event.summary?.manualLockedCount || 0 }} 節</span>
          </div>
        </div>

        <div class="control-item">
          <label class="switch">
            <input
              type="checkbox"
              :checked="scheduleStore.schoolInfo.preallocEventSettings?.allowMorningSession"
              @change="updatePreallocEventSetting('allowMorningSession', $event.target.checked)"
            />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">允許匯入「早」時段</span>
            <span class="sub">啟用後，Excel 中標記為「早」的列視為有效課次（period=0）。</span>
          </div>
        </div>

        <div class="control-item">
          <label class="switch">
            <input
              type="checkbox"
              :checked="scheduleStore.schoolInfo.preallocEventSettings?.allowNoonBreakSession"
              @change="updatePreallocEventSetting('allowNoonBreakSession', $event.target.checked)"
            />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">允許匯入「午休」時段</span>
            <span class="sub">啟用後，Excel 中標記為「午休」的列視為有效課次（period=8）。</span>
          </div>
        </div>

        <div class="apply-actions" style="margin-top: 16px;">
          <button @click="saveSettings" class="main-save-btn" type="button">儲存預排事件設定</button>
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

      <!-- 時段規則編輯器 (Slot Rule Editor) -->
      <div class="settings-card">
        <SlotRuleEditor />
      </div>

      <!-- 排課品質軟約束控制 (Quality Rules) -->
      <div class="settings-card quality-rules-controls">
        <h3>排課品質軟約束設定</h3>
        <p class="desc">控制排課最佳化的品質權重與偏好規則。</p>

        <div class="control-item" v-if="scheduleStore.aiSettings.qualityRules?.teacherDailyLoadSmoothing">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.qualityRules.teacherDailyLoadSmoothing.enabled" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">教師每日授課負擔平滑化</span>
            <span class="sub">盡量平攤教師每日授課節數，避免單日負擔過重。</span>
          </div>
        </div>

        <div class="control-item" v-if="scheduleStore.aiSettings.qualityRules?.sameTeacherGradeConsistency">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.qualityRules.sameTeacherGradeConsistency.enabled" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">跨班同教師授課進度一致性</span>
            <span class="sub">盡量將同教師跨班授課安排在相近節次。</span>
          </div>
        </div>

        <div class="control-item" v-if="scheduleStore.aiSettings.qualityRules?.period7FlexiblePreference">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.qualityRules.period7FlexiblePreference.enabled" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">第 7 節優先安排彈性/校本課程</span>
            <span class="sub">第 7 節優先安排彈性與資訊等課程，避開主科。</span>
          </div>
        </div>

        <div class="control-item" v-if="scheduleStore.aiSettings.qualityRules?.peAvoidPeriod45">
          <label class="switch">
            <input type="checkbox" v-model="scheduleStore.aiSettings.qualityRules.peAvoidPeriod45.enabled" />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">體育課避開第 4、5 節</span>
            <span class="sub">避開午休前後的高溫與消化時段排體育課。</span>
          </div>
        </div>
      </div>

      <!-- 年級時段與共備規則單一整合介面 -->
      <GradeTimeRuleEditor
        :grade-time-rules-settings="scheduleStore.schoolInfo.gradeTimeRulesSettings"
        :warning-confirmed="scheduleStore.gradeTimeRuleWarningConfirmed"
        @update:grade-time-rules-settings="onUpdateGradeTimeRulesSettings"
        @update:warning-confirmed="scheduleStore.updateGradeTimeRuleWarningConfirmed"
      />

      <!-- 🆕 Movable Locks 鎖定課微調建議設定 -->
      <div class="settings-card movable-locks-controls">
        <div class="card-header-with-badge">
          <h3>鎖定課微調建議設定 (Movable Locks Policy)</h3>
          <span v-if="movableLocksPolicy.movableLocksEnabled" class="status-badge" :class="{ active: isMovableLocksActive, inactive: !isMovableLocksActive }">
            {{ isMovableLocksActive ? '✅ 提案功能已生效 (Active)' : '⚠️ 條件未滿足 (Inactive)' }}
          </span>
        </div>
        <p class="desc">
          控制是否允許排課引擎在專科教室空間或時段擠壓時，針對指定白名單科目提出人工鎖定課微調建議。系統絕不靜謀移動，提案必須由人工審核同意後才可套用。
        </p>

        <!-- 主開關 -->
        <div class="control-item master-toggle-item">
          <label class="switch">
            <input
              type="checkbox"
              :checked="movableLocksPolicy.movableLocksEnabled"
              @change="toggleMovableLocksEnabled($event.target.checked)"
            />
            <span class="slider round"></span>
          </label>
          <div class="label-box">
            <span class="title">允許系統提出鎖定課微調建議</span>
            <span class="sub">開啟後，Solver 可在白名單範圍與預算內嘗試微調人工鎖定位，並發起人工審核。</span>
          </div>
        </div>

        <div v-if="movableLocksPolicy.movableLocksEnabled" class="movable-locks-body">
          <!-- 警告訊息框 -->
          <div v-if="!isMovableLocksActive" class="movable-locks-warning-banner">
            <span v-if="movableLocksPolicy.maxMovesTotal <= 0">
              ⚠️ 總微調預算 (maxMovesTotal) 目前設為 0 節，功能暫不會生效。
            </span>
            <span v-else>
              ⚠️ 已開啟微調開關，但尚未勾選任何允許微調的科目或特殊課程類型。功能暫不會生效。
            </span>
          </div>

          <!-- 1. 科目白名單 -->
          <div class="movable-section">
            <div class="section-header">
              <span class="section-title">1. 允許微調的科目白名單 (movableSubjects)</span>
              <span class="section-count">已選擇 {{ (movableLocksPolicy.movableSubjects || []).length }} 個科目</span>
            </div>
            <p class="section-sub">勾選允許 Solver 嘗試微調移位的人工鎖定科目。未勾選科目之人動鎖定仍為絕對 Hard Lock。</p>
            <div class="subject-chips-grid">
              <label
                v-for="subj in availableSubjectsForWhitelist"
                :key="subj"
                class="subject-chip-item"
                :class="{ selected: (movableLocksPolicy.movableSubjects || []).includes(subj) }"
              >
                <input
                  type="checkbox"
                  :checked="(movableLocksPolicy.movableSubjects || []).includes(subj)"
                  @change="toggleSubjectWhitelist(subj, $event.target.checked)"
                />
                <span>{{ subj }}</span>
              </label>
            </div>
          </div>

          <!-- 2. 特殊課程類型白名單 -->
          <div class="movable-section">
            <div class="section-header">
              <span class="section-title">2. 允許微調的抽離 / 特殊課程類型 (movableSpecialCourseTypes)</span>
              <span class="section-count">已選擇 {{ (movableLocksPolicy.movableSpecialCourseTypes || []).length }} 個類型</span>
            </div>
            <p class="section-sub">勾選允許微調的特殊課程類型（如抽離課 pullout_lock）。</p>
            <div v-if="availableSpecialCourseTypes.length > 0" class="subject-chips-grid">
              <label
                v-for="typeName in availableSpecialCourseTypes"
                :key="typeName"
                class="subject-chip-item"
                :class="{ selected: (movableLocksPolicy.movableSpecialCourseTypes || []).includes(typeName) }"
              >
                <input
                  type="checkbox"
                  :checked="(movableLocksPolicy.movableSpecialCourseTypes || []).includes(typeName)"
                  @change="toggleSpecialCourseTypeWhitelist(typeName, $event.target.checked)"
                />
                <span>{{ typeName }}</span>
              </label>
            </div>
            <div v-else class="empty-notice">
              尚未建置特殊課程或抽離課類型資料。
            </div>
          </div>

          <!-- 🆕 人工鎖定課次清單 -->
          <div v-if="manualLockedSlotsBySubject.length > 0" class="manual-locked-slots-notice">
            <p style="font-size: 13px; color: #92400e; margin: 8px 0 4px;">
              ⚠️ 以下課次已人工鎖定，選擇允許微調後這些時段仍不會被移動：
            </p>
            <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #78716c;">
              <li v-for="entry in manualLockedSlotsBySubject" :key="entry.key">
                {{ entry.className }}｜週{{ ['一','二','三','四','五'][entry.day - 1] }}｜第{{ entry.period
                }}節
                <span style="color: #dc2626;">🔒</span>
              </li>
            </ul>
          </div>

          <!-- 3. 移動範圍參數 -->
          <div class="movable-section">
            <div class="section-header">
              <span class="section-title">3. 移動視窗與範圍參數 (moveWindow)</span>
            </div>
            <div class="params-row-grid">
              <div class="param-box">
                <label>微調範圍 (scope)</label>
                <select
                  :value="movableLocksPolicy.moveWindow?.scope || 'same_day'"
                  @change="updateMoveWindowField('scope', $event.target.value)"
                >
                  <option value="same_day">同日 (same_day - 推薦)</option>
                  <option value="same_halfday">同半天 (same_halfday)</option>
                  <option value="same_week">全週 (same_week)</option>
                </select>
              </div>

              <div class="param-box">
                <label>單次最大搬移節數 (maxPeriodDistance)</label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  :value="movableLocksPolicy.moveWindow?.maxPeriodDistance ?? 2"
                  @input="updateMoveWindowField('maxPeriodDistance', Number($event.target.value))"
                />
              </div>

              <div class="param-box checkbox-box">
                <label class="inline-checkbox-label">
                  <input
                    type="checkbox"
                    :checked="movableLocksPolicy.moveWindow?.allowCrossMorningAfternoon ?? false"
                    @change="updateMoveWindowField('allowCrossMorningAfternoon', $event.target.checked)"
                  />
                  <span>允許跨上下午 (早/午) 搬移</span>
                </label>
              </div>
            </div>
          </div>

          <!-- 4. 預算限制 -->
          <div class="movable-section">
            <div class="section-header">
              <span class="section-title">4. 微調預算限制 (Budget Caps)</span>
            </div>
            <div class="params-row-grid">
              <div class="param-box">
                <label>單次排課最大微調總數 (maxMovesTotal)</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  :value="movableLocksPolicy.maxMovesTotal ?? 0"
                  @input="updateBudgetField('maxMovesTotal', Number($event.target.value))"
                />
                <small>0 代表不允許任何搬移提案</small>
              </div>

              <div class="param-box">
                <label>單班最大微調節數 (maxMovesPerClass)</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  :value="movableLocksPolicy.maxMovesPerClass ?? 0"
                  @input="updateBudgetField('maxMovesPerClass', Number($event.target.value))"
                />
                <small>0 代表繼承全域最大微調總數</small>
              </div>

              <div class="param-box">
                <label>單科最大微調節數 (maxMovesPerSubject)</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  :value="movableLocksPolicy.maxMovesPerSubject ?? 0"
                  @input="updateBudgetField('maxMovesPerSubject', Number($event.target.value))"
                />
                <small>0 代表繼承全域最大微調總數</small>
              </div>
            </div>
          </div>

          <!-- 產品語意提示 -->
          <div class="movable-policy-notice-box">
            <div class="notice-title">💡 產品語意與防呆說明：</div>
            <ul>
              <li>這不是允許 Solver 靜謀移動人工鎖，系統提案絕不自動直接套用。</li>
              <li>若 Solver 提出移動建議，必須在結果頁面完成人工審核（全數 Accept）後方可套用或匯出封包。</li>
              <li>未納入白名單之人工鎖定課，仍為絕對 Hard Lock 鎖定，Solver 無權動用。</li>
            </ul>
          </div>
        </div>
      </div>

      <button @click="saveSettings" class="main-save-btn">儲存所有設定</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import axios from 'axios'
import { useAiStore } from '../stores/aiSettings'
import { useScheduleStore } from '../stores/schedule'
import SlotRuleEditor from '../components/SlotRuleEditor.vue'
import GradeTimeRuleEditor from '../components/GradeTimeRuleEditor.vue'
import {
  parseNativeLanguagePreallocation,
  buildNativeLanguagePreallocationPlan,
} from '../utils/nativeLanguagePreallocationImport.js'
import { parseNativeLanguagePreallocationExcel } from '../utils/nativeLanguagePreallocationExcelImport.js'
import { downloadNativeLanguagePreallocationExcelTemplate } from '../utils/nativeLanguagePreallocationExcelTemplate.js'
import { canApplyPreallocationConflictPlan } from '../utils/preallocationConflictResolution.js'

const aiStore = useAiStore()
const scheduleStore = useScheduleStore()

function onUpdateGradeTimeRulesSettings(newSettings) {
  scheduleStore.resetGradeTimeRuleWarningConfirmation()
  scheduleStore.schoolInfo.gradeTimeRulesSettings = newSettings
  scheduleStore.markScheduleDirty()
}

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



// --- 🆕 Movable Locks Policy UI State & Methods ---
const movableLocksPolicy = computed(() => {
  return scheduleStore.movableLocksPolicy || {
    movableLocksEnabled: false,
    movableSubjects: [],
    movableSpecialCourseTypes: [],
    movableCourseTags: [],
    moveWindow: {
      scope: 'same_day',
      allowCrossMorningAfternoon: false,
      maxPeriodDistance: 2
    },
    maxMovesTotal: 0,
    maxMovesPerClass: 0,
    maxMovesPerSubject: 0
  }
})

const isMovableLocksActive = computed(() => scheduleStore.isMovableLocksActive)

const availableSubjectsForWhitelist = computed(() => {
  const set = new Set()
  if (Array.isArray(scheduleStore.standardDomainSettings)) {
    scheduleStore.standardDomainSettings.forEach((s) => {
      if (s && s.name) set.add(s.name)
    })
  }
  const defaultList = ['語文-英語', '自然科學', '科技-資訊', '音樂', '美勞', '體育', '社會', '綜合活動', '數學']
  defaultList.forEach((s) => set.add(s))
  return Array.from(set)
})

const availableSpecialCourseTypes = computed(() => {
  const set = new Set()
  if (Array.isArray(scheduleStore.specialCourses)) {
    scheduleStore.specialCourses.forEach((sc) => {
      if (sc && sc.type) set.add(sc.type)
    })
  }
  if (set.size === 0) {
    return ['pullout_lock', 'resource_room', 'arts_special']
  }
  return Array.from(set)
})

function toggleMovableLocksEnabled(checked) {
  scheduleStore.setMovableLocksEnabled(checked)
}

function toggleSubjectWhitelist(subjName, isChecked) {
  const current = [...(movableLocksPolicy.value.movableSubjects || [])]
  let updated
  if (isChecked) {
    updated = Array.from(new Set([...current, subjName]))
  } else {
    updated = current.filter((s) => s !== subjName)
  }
  scheduleStore.updateMovableLocksPolicy({ movableSubjects: updated })
}

function toggleSpecialCourseTypeWhitelist(typeName, isChecked) {
  const current = [...(movableLocksPolicy.value.movableSpecialCourseTypes || [])]
  let updated
  if (isChecked) {
    updated = Array.from(new Set([...current, typeName]))
  } else {
    updated = current.filter((t) => t !== typeName)
  }
  scheduleStore.updateMovableLocksPolicy({ movableSpecialCourseTypes: updated })
}

function updateMoveWindowField(field, value) {
  scheduleStore.updateMovableLocksPolicy({
    moveWindow: {
      ...movableLocksPolicy.value.moveWindow,
      [field]: value
    }
  })
}

function updateBudgetField(field, value) {
  const numVal = Math.max(0, Number(value) || 0)
  scheduleStore.updateMovableLocksPolicy({
    [field]: numVal
  })
}

// --- 🆕 預排事件設定 ---
function updatePreallocEventSetting(field, value) {
  const current = scheduleStore.schoolInfo.preallocEventSettings || {}
  scheduleStore.schoolInfo.preallocEventSettings = {
    allowMorningSession: false,
    allowNoonBreakSession: false,
    activePreallocEventId: null,
    ...current,
    [field]: Boolean(value),
  }
  scheduleStore.markScheduleDirty()
}

const adjustableEvents = computed(() =>
  scheduleStore.preallocEvents?.filter((event) => event.status === 'applied') || [],
)

function setEventAdjustment(eventId, enabled) {
  scheduleStore.updatePreallocationEvent(eventId, { allowAdjustment: Boolean(enabled) })
  if (
    !enabled &&
    scheduleStore.schoolInfo.preallocEventSettings?.activePreallocEventId === eventId
  ) {
    updatePreallocEventSetting('activePreallocEventId', null)
  }
}

function selectActivePreallocEvent(eventId) {
  const event = scheduleStore.preallocEvents?.find((item) => item.id === eventId)
  if (!event?.allowAdjustment) return
  updatePreallocEventSetting('activePreallocEventId', eventId)
}

// --- 🆕 人工鎖定課次清單 (movableLocks) ---
const manualLockedSlotsBySubject = computed(() => {
  const subjects = new Set(movableLocksPolicy.value.movableSubjects || [])
  if (subjects.size === 0) return []
  const result = []
  for (const cls of scheduleStore.classes) {
    if (!cls.timetable) continue
    for (let d = 1; d <= 5; d++) {
      for (let p = 0; p <= 8; p++) {
        const cell = Array.isArray(cls.timetable)
          ? cls.timetable[d - 1]?.[p - 1]
          : cls.timetable[d]?.[p]
        if (!cell) continue
        if (cell.manualLocked && subjects.has(cell.subject)) {
          result.push({
            key: `${cls.name}-${d}-${p}`,
            className: cls.name,
            day: d,
            period: p,
            subject: cell.subject,
          })
        }
      }
    }
  }
  return result
})


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

// --- 🆕 預排課表匯入邏輯 ---
const preallocationFileInput = ref(null)
const rawPreallocationData = ref(null)
const importFileName = ref('')
const importError = ref('')
const movableEntryIds = ref([])
const preallocationPlan = ref(null)

const handleDownloadExcelTemplate = () => {
  downloadNativeLanguagePreallocationExcelTemplate()
}

const handlePreallocationFileUpload = (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  importFileName.value = file.name
  importError.value = ''

  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.json')) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        rawPreallocationData.value = parseNativeLanguagePreallocation(e.target.result)
        rebuildPlan()
      } catch (err) {
        importError.value = err.message || '檔案解析失敗'
        rawPreallocationData.value = null
        preallocationPlan.value = null
      }
    }
    reader.readAsText(file)
  } else if (lowerName.endsWith('.xlsx')) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        rawPreallocationData.value = parseNativeLanguagePreallocationExcel(e.target.result, {
          fileName: file.name,
        })
        rebuildPlan()
      } catch (err) {
        importError.value = err.message || '檔案解析失敗'
        rawPreallocationData.value = null
        preallocationPlan.value = null
      }
    }
    reader.readAsArrayBuffer(file)
  } else {
    importError.value = '僅支援 native-language-exchange.json 或 Excel 預排課表範例檔（.xlsx）。'
    rawPreallocationData.value = null
    preallocationPlan.value = null
  }
}

const rebuildPlan = () => {
  if (!rawPreallocationData.value) return
  preallocationPlan.value = buildNativeLanguagePreallocationPlan(
    rawPreallocationData.value,
    scheduleStore.classes,
    { movableEntryIds: movableEntryIds.value },
  )
}

const toggleEntryMovable = (entryId, isMovable) => {
  if (isMovable) {
    if (!movableEntryIds.value.includes(entryId)) {
      movableEntryIds.value.push(entryId)
    }
  } else {
    movableEntryIds.value = movableEntryIds.value.filter((id) => id !== entryId)
  }
  rebuildPlan()
}

const canApplyPlan = computed(() => {
  if (!preallocationPlan.value) return false
  return canApplyPreallocationConflictPlan(preallocationPlan.value)
})

const getTeacherDiff = (className, subject) => {
  const cls = (scheduleStore.classes || []).find((c) => c.name === className)
  if (!cls) return null
  const req = (cls.course_requirements || []).find(
    (r) => r.subject === subject || (subject === '語文-本土語' && r.subject === '本土語'),
  )
  if (req && req.teacher_name) {
    return { original: req.teacher_name }
  }
  return null
}

const confirmApplyPreallocationImport = () => {
  if (!canApplyPlan.value) return
  try {
    scheduleStore.applyNativeLanguagePreallocation(preallocationPlan.value)
    alert('預排課表已成功套用至系統！')
  } catch (err) {
    alert(`套用失敗：${err.message}`)
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

/* 🆕 Movable Locks Policy Styles */
.movable-locks-controls {
  margin-top: 24px;
}

.card-header-with-badge {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.card-header-with-badge h3 {
  margin: 0;
}

.status-badge {
  font-size: 0.82em;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 20px;
  white-space: nowrap;
}

.status-badge.active {
  background-color: #dcfce7;
  color: #15803d;
  border: 1px solid #86efac;
}

.status-badge.inactive {
  background-color: #fef3c7;
  color: #b45309;
  border: 1px solid #fde047;
}

.master-toggle-item {
  margin-bottom: 20px;
}

.movable-locks-body {
  border-top: 1px solid #f1f5f9;
  padding-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.movable-locks-warning-banner {
  background-color: #fffbeb;
  border: 1px solid #fde68a;
  color: #b45309;
  padding: 12px 16px;
  border-radius: 10px;
  font-size: 0.9em;
  font-weight: 600;
}

.movable-section {
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.section-title {
  font-weight: 700;
  color: #1e293b;
  font-size: 0.95em;
}

.section-count {
  font-size: 0.8em;
  color: #64748b;
  font-weight: 600;
}

.section-sub {
  font-size: 0.82em;
  color: #64748b;
  margin-bottom: 12px;
}

.subject-chips-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.subject-chip-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background-color: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  font-size: 0.88em;
  color: #334155;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.subject-chip-item:hover {
  border-color: #6366f1;
  background-color: #f0fdf4;
}

.subject-chip-item.selected {
  background-color: #e0e7ff;
  border-color: #6366f1;
  color: #3730a3;
  font-weight: 700;
}

.empty-notice {
  font-size: 0.85em;
  color: #94a3b8;
  font-style: italic;
}

.params-row-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.param-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-box label {
  font-size: 0.85em;
  font-weight: 700;
  color: #475569;
}

.param-box select,
.param-box input[type='number'] {
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.9em;
  background-color: #ffffff;
}

.param-box small {
  font-size: 0.78em;
  color: #64748b;
}

.checkbox-box {
  justify-content: center;
}

.inline-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88em;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}

.movable-policy-notice-box {
  background-color: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 12px;
  padding: 14px 18px;
  color: #166534;
  font-size: 0.85em;
  line-height: 1.6;
}

.notice-title {
  font-weight: 700;
  margin-bottom: 6px;
}

.movable-policy-notice-box ul {
  margin: 0;
  padding-left: 20px;
}

/* 🆕 預排課表匯入 CSS */
.preallocation-import-card {
  margin-top: 24px;
}

/* 🆕 預排事件設定 CSS */
.prealloc-event-settings-card {
  margin-top: 24px;
}

.prealloc-event-adjustment-panel {
  margin: 16px 0;
  padding: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

.prealloc-event-adjustment-panel h4 {
  margin: 0 0 4px 0;
  font-size: 0.95em;
  color: #1e293b;
}

.prealloc-event-adjustment-panel .sub {
  font-size: 0.82em;
  color: #64748b;
  margin: 0 0 12px 0;
}

.prealloc-event-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.9em;
}

.prealloc-event-row:last-child {
  border-bottom: none;
}

.prealloc-event-row label {
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}

.prealloc-event-row span {
  font-size: 0.82em;
  color: #64748b;
  margin-left: auto;
}

.manual-locked-slots-notice {
  background-color: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
  padding: 12px 16px;
  margin-top: 12px;
}

.file-upload-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.file-name-text {
  font-size: 0.9em;
  font-weight: 600;
  color: #334155;
}

.preallocation-preview-section {
  margin-top: 20px;
  border-top: 1px dashed #cbd5e1;
  padding-top: 20px;
}

.summary-info-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 18px;
  font-size: 0.9em;
  color: #334155;
  margin-bottom: 20px;
}

.warning-text {
  color: #dc2626;
  font-weight: 700;
}

.class-plan-card {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  background: #ffffff;
}

.class-plan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.class-title {
  font-size: 1.05em;
  font-weight: 700;
  color: #1e293b;
}

.conflict-badge {
  background-color: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85em;
  font-weight: 600;
}

.success-badge {
  background-color: #f0fdf4;
  color: #16a34a;
  border: 1px solid #bbf7d0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85em;
  font-weight: 600;
}

.conflict-detail-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 14px;
  font-size: 0.88em;
}

.conflict-detail-table th,
.conflict-detail-table td {
  border: 1px solid #e2e8f0;
  padding: 8px 12px;
  text-align: left;
}

.conflict-detail-table th {
  background-color: #f1f5f9;
  color: #475569;
}

.tag-protected {
  background-color: #fff7ed;
  color: #c2410c;
  border: 1px solid #ffedd5;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.82em;
  font-weight: 600;
}

.diff-text {
  color: #d97706;
}

.resolution-choice-box {
  background-color: #fefce8;
  border: 1px solid #fef08a;
  border-radius: 10px;
  padding: 12px 16px;
  margin-top: 10px;
}

.choice-title {
  font-size: 0.88em;
  font-weight: 700;
  color: #854d0e;
  margin-bottom: 8px;
}

.choice-option {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.88em;
  color: #334155;
  margin-bottom: 6px;
  cursor: pointer;
}

.apply-import-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

