# AGY 任務執行回報 (report-agy-0006)

- **執行者**: AGY
- **task_id**: `smart-scheduling-error-fix-0006`
- **開始時間**: 2026-08-22T15:27:55+08:00
- **結束時間**: 2026-08-22T15:31:40+08:00
- **執行步驟**: `npm run test:fast` 既有失敗原因獨立診斷與關聯性分析

---

## 1. 診斷總結與關聯性判定

經深入對 4 個測試檔案進行獨立執行、日誌擷取、程式碼追蹤與實證抽樣，判定結果如下：

- 本次智慧排課錯誤處理修復 (`server.js` 之 `runSchedulingWorker` 錯誤訊息 fallback / `GET /api/debug/validation-report` 與 `src/stores/schedule.js` 之 `processFailedResult` / `normalizeValidationReportDetails`) **與此 4 個失敗測試均無直接關聯**。
- 專屬排課測試 `tests/scheduleStoreEngineErrors.test.js` (6 passed) 與相關 store 回歸測試均 100% 通過。
- 建議：**將本排課修復以「專屬驗證通過、全套快速測試受既有環境與舊測試失敗阻塞」結案**。

---

## 2. 測試失敗逐項診斷與證據

### 2.1 `tests/clineHarnessLifecycle.test.js`

1. **確切失敗測試名稱與位置**:
   - 於全套併發測試時在 `beforeAll` / `it` 階段產生 `Hook timed out in 20000ms` 逾時中斷。
   - 檔案位置：[`tests/clineHarnessLifecycle.test.js`](file:///F:/scheduler-frontend/tests/clineHarnessLifecycle.test.js)
2. **直接依賴的模組／服務**:
   - `.clinerules/hooks/UserPromptSubmit.ps1`
   - `.clinerules/hooks/TaskResume.ps1`
   - `.clinerules/hooks/PreToolUse.ps1`
   - [`tests/helpers/clineHarness.js`](file:///F:/scheduler-frontend/tests/helpers/clineHarness.js) (經 `node:child_process` 呼叫 PowerShell)
3. **可驗證的程式與執行證據**:
   - 單獨執行測試：`npx vitest run tests/clineHarnessLifecycle.test.js` $\rightarrow$ **1 passed (7.80s)**。
   - 測試中多次調用 `runHookScript` 啟動外部 `powershell.exe -ExecutionPolicy Bypass` 進程。在全套 65 個測試檔高併發執行時，系統 CPU 與 disk I/O 負載增加，導致 PowerShell 啟動與通訊時間超過 Vitest 預設的 20 秒 hook timeout。
4. **排課修復直接關聯性**:
   - **無直接關聯**。本測試僅為 Cline Agent 鉤子腳本的生命週期測試，不依賴 `server.js` 或 `schedule.js` 的排課運算。
5. **下一步建議**:
   - 可增加 Vitest 測試套件的 `testTimeout` / `hookTimeout` 設定，或在獨立環境單獨執行 Hook 測試。

---

### 2.2 `tests/clineHarnessPerformance.test.js`

1. **確切失敗測試名稱與位置**:
   - 測試名稱：`stays within no-op-relative latency budgets`
   - 檔案位置：[`tests/clineHarnessPerformance.test.js:L5-L11`](file:///F:/scheduler-frontend/tests/clineHarnessPerformance.test.js#L5-L11)
2. **直接依賴的模組／服務**:
   - [`scripts/hooks/benchmark-cline-harness.mjs`](file:///F:/scheduler-frontend/scripts/hooks/benchmark-cline-harness.mjs)
   - `.clinerules/hooks/*.ps1`
   - `node:child_process` 的 `spawnSync`
3. **可驗證的程式與執行證據**:
   - 單獨執行測試：`npx vitest run tests/clineHarnessPerformance.test.js` $\rightarrow$ **1 passed (8.80s)**。
   - 程式碼第 6 行以子進程執行評測：`const result = spawnSync('node', ['scripts/hooks/benchmark-cline-harness.mjs'], { encoding: 'utf8' })`。當在高併發測試環境時，子進程內評測之 Hook 延遲超出門檻值，`benchmark-cline-harness.mjs` 以 exit code 1 退出，引發 `expect(result.status).toBe(0)` 斷言失敗。
4. **排課修復直接關聯性**:
   - **無直接關聯**。此為 Hook 效能門檻測試，與智慧排課引擎及 store 邏輯無關。
5. **下一步建議**:
   - 調整評測門檻或限制 VitestWorker 執行數量 (`--maxThreads=2`) 避免 CPU 搶佔。

---

### 2.3 `tests/movableLocksSettingsPanel.test.js`

1. **確切失敗測試名稱與位置**:
   - 測試名稱：
     1. `2. 開啟主開關但沒有白名單：顯示 warning，isMovableLocksActive === false` ([L25](file:///F:/scheduler-frontend/tests/movableLocksSettingsPanel.test.js#L25))
     2. `3. 選擇一個科目 + maxMovesTotal > 0：movableSubjects 正確更新且 isMovableLocksActive === true` ([L52](file:///F:/scheduler-frontend/tests/movableLocksSettingsPanel.test.js#L52))
   - 檔案位置：[`tests/movableLocksSettingsPanel.test.js`](file:///F:/scheduler-frontend/tests/movableLocksSettingsPanel.test.js)
2. **直接依賴的模組／服務**:
   - [`src/views/AiSettingsView.vue`](file:///F:/scheduler-frontend/src/views/AiSettingsView.vue)
   - `@vue/test-utils` (`mount`)
   - `vue-router` (`RouterLink` 與 `useLink`)
3. **可驗證的程式與執行證據**:
   - 執行時拋出錯誤：`TypeError: Cannot read properties of undefined (reading 'resolve') at useLink (node_modules/vue-router/dist/vue-router.js:910:18)`
   - 伴隨 Vue 警告：`[Vue warn]: injection "Symbol(router)" not found. at <RouterLink to="/prealloc-import">`
   - 原因為 [`tests/movableLocksSettingsPanel.test.js:L39`](file:///F:/scheduler-frontend/tests/movableLocksSettingsPanel.test.js#L39) 使用 `mount(AiSettingsView)` 時，`AiSettingsView.vue` 包含 `<RouterLink>` 組件，但測試的 `global.stubs` 未模擬 `RouterLink` 或提供 `vue-router` 實體。
4. **排課修復直接關聯性**:
   - **無直接關聯**。此失敗為前端 UI 元件測試欠缺 Vue Router 測試 Stub，非排課邏輯或 store 變更所致。
5. **下一步建議**:
   - 於 `mount(AiSettingsView)` 設定中加入 `global: { stubs: { RouterLink: true } }` 或注入 Router 實體。

---

### 2.4 `tests/specialCourseImportPersistence.test.js`

1. **確切失敗測試名稱與位置**:
   - 測試名稱：
     1. `round-trips gifted source metadata with a null source group` ([L100](file:///F:/scheduler-frontend/tests/specialCourseImportPersistence.test.js#L100))
     2. `round-trips learning-center source metadata` ([L120](file:///F:/scheduler-frontend/tests/specialCourseImportPersistence.test.js#L120))
     3. `loads legacy special-course rows with missing source metadata as null` ([L140](file:///F:/scheduler-frontend/tests/specialCourseImportPersistence.test.js#L140))
   - 檔案位置：[`tests/specialCourseImportPersistence.test.js`](file:///F:/scheduler-frontend/tests/specialCourseImportPersistence.test.js)
2. **直接依賴的模組／服務**:
   - [`server.js:L296-522`](file:///F:/scheduler-frontend/server.js#L296-L522) 的 `POST /api/save-all` 端點
   - `@prisma/client` (`prisma.specialCourse.create()`)
   - `prisma/schema.prisma`
3. **可驗證的程式與執行證據**:
   - 測試在 `beforeAll` 中獨立 `spawn` 啟動 `server.js` 實體，並在測試案例中對 `POST /api/save-all` 發送請求。
   - 實際擷取到的 HTTP 500 伺服器內部日誌與錯誤回應：
     ```json
     {
       "error": "儲存失敗",
       "details": "\nInvalid `prisma.specialCourse.create()` invocation:\n\n{\n  data: {\n    type: \"pullout\",\n    name: \"特教\",\n    targetSubject: \"\",\n    teacher: \"\",\n    targetClasses: \"[]\",\n    lockedSlots: \"[]\",\n    isAutoTime: false,\n    isAutoClass: false,\n    autoClassConfig: \"null\",\n    projectName: \"專案A\",\n    ~~~~~~~~~~~\n    sourceGroup: null,\n    sourceKind: null\n  }\n}\n\nUnknown argument `projectName`. Available options are marked with ?."
     }
     ```
   - **500 錯誤真實根因**：
     `server.js` 第 517-519 行於寫入 `specialCourse` 時嘗試存取 `projectName`, `sourceGroup`, `sourceKind`。雖然 `prisma/schema.prisma` 檔案已更新，但 local 環境未重新執行 `npx prisma generate`，導致 `node_modules/@prisma/client` 生成碼中尚無 `projectName` 屬性，引發 Prisma 驗證例外。
4. **排課修復直接關聯性**:
   - **無直接關聯**。此 500 錯誤出現在 `POST /api/save-all` 寫入特殊課程設定時的 Prisma Client 版本發散，與本次 `runSchedulingWorker` 求解錯誤 fallback 及 `schedule.js` 的 `processFailedResult` 無關。
5. **下一步建議**:
   - 在本機或 CI 流程中執行 `npx prisma generate` 更新 Prisma Client 即可解決此測試失敗。

---

AGY_DONE
