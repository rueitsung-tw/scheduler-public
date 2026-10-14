# 快速測試套件基線失敗修復計畫

## 目的與範圍

本計畫處理 `npm run test:fast` 的三類既有基線失敗，依高至低優先順序逐一完成。前一個「智慧排課錯誤顯示修復」已結案；除非本計畫的可重現證據明確要求，禁止修改其 `server.js` 排課 worker、`src/stores/schedule.js` 或 `tests/scheduleStoreEngineErrors.test.js` 範圍。

調度規則：一次只執行一個步驟。AGY 必須先讀取調度檔，再讀本計畫；只有調度檔 `status: approved` 時可執行。每輪結束必須寫入指定回報檔，等待 Codex 審核後才可派下一步。

## 已確認的根因證據

### A. 高優先：特殊課程匯入持久化

- `prisma/schema.prisma` 的 `SpecialCourse` 已宣告 `projectName`、`sourceGroup`、`sourceKind`。
- migration `prisma/migrations/20260815000000_add_special_course_source_metadata/migration.sql` 已新增相同三欄。
- `node_modules/.prisma/client` 和 `node_modules/@prisma/client` 的 generated client 搜尋不到三欄；`POST /api/save-all` 因此收到 Prisma 的 `Unknown argument projectName` 並回傳 HTTP 500。
- 結論：schema 與 migration 已同步，但本機 generated Prisma Client 落後。

### B. 中優先：Movable Locks 設定面板

- `tests/movableLocksSettingsPanel.test.js` 以 `mount(AiSettingsView)` 掛載。
- `src/views/AiSettingsView.vue` 使用 `<RouterLink>`；測試未提供 router 或 stub。
- 錯誤為 Vue Router `useLink` 取得未定義 router 後讀取 `.resolve`。
- 結論：測試隔離不完整，不是產品行為錯誤。

### C. 低至中優先：Cline hook 的全套併發穩定性

- `tests/clineHarnessLifecycle.test.js` 與 `tests/clineHarnessPerformance.test.js` 各自單獨通過。
- lifecycle 每個案例會用同步子程序啟動 `powershell.exe`；performance 會另起 Node 子程序，並在 PowerShell 單程序內重複量測 50 次 hook。
- 只有在 `npm run test:fast` 的併發執行中才發生 hook timeout 或 benchmark 預算失敗。
- 結論：現有證據指向資源競爭，但尚不足以選擇修補策略；不得直接放寬 timeout 或 performance budget。

## 執行步驟

### Step 1 — Prisma client 同步與持久化回歸驗收（AGY）

**允許修改／產物範圍**

- 可執行 Prisma generated client 同步命令。
- 可寫入本輪指定回報檔。
- 不得修改 `prisma/schema.prisma`、migration、`server.js`、測試或任何產品來源碼；若 Prisma 指令造成版本控制中的非預期檔案變更，停止並回報。

**工作順序**

1. 確認 schema、migration 與 generated client 三者目前的欄位狀態。
2. 執行 `npx prisma generate`。
3. 確認 generated client 已含 `projectName`、`sourceGroup`、`sourceKind`。
4. 執行 `npx vitest run tests/specialCourseImportPersistence.test.js`。
5. 記錄實際命令、exit code、測試計數與所有檔案變更。

**驗收條件**

- 測試檔 1 passed、測試 3 passed、exit code 0。
- `POST /api/save-all` 不再回傳 HTTP 500。
- 不引入 schema 或 migration 的虛構欄位／路由／API。

### Step 2 — Router 測試隔離（待 Codex 審核後再派）

**預計檔案**：`tests/movableLocksSettingsPanel.test.js` 唯一允許的產品外修改檔。

**預計最小修補**：讓所有 `AiSettingsView` 的 mount 共用包含 `RouterLink` stub 的 `global.stubs` 設定，保留現有 Pinia setup；不修改 `AiSettingsView.vue`、router 定義或任何產品邏輯。

**驗證與驗收**

```powershell
npx vitest run tests/movableLocksSettingsPanel.test.js
```

- 5 tests passed，沒有 router injection warning 或 `undefined.resolve`。

### Step 3 — Cline hook 併發失敗可重現診斷（待 Codex 審核後再派）

**診斷原則**

- 不修改效能門檻、不直接延長 timeout。
- 先保留全套失敗日誌，再比較預設併發與受限 worker 執行的結果；記錄 CPU／hook 時間或可觀察的 worker 競爭證據。
- 若受限 worker 可穩定通過，才可提出最小且只隔離外部 PowerShell 測試的設定方案，交由 Codex 審核；不得在同一步驟實作。

**必要命令**

```powershell
npx vitest run tests/clineHarnessLifecycle.test.js
npx vitest run tests/clineHarnessPerformance.test.js
npm run test:fast
```

**診斷驗收**：回報包含至少一次預設全套失敗或成功的完整結果，以及與單獨執行／受限 worker 的可比較證據；若無足夠證據，不得猜測或實作修補。

### Step 4 — 經核准的 Cline 穩定性修補與全套驗收（待診斷後決定）

Step 3 已證實預設併發失敗、兩個 Cline 測試單獨通過，且單 worker 全套 673/673 通過。核准的最小方案如下：

- 僅修改 `package.json` 的 `test:fast` script。
- 主 Vitest 批次維持既有併發，但排除 `tests/clineHarnessLifecycle.test.js` 與 `tests/clineHarnessPerformance.test.js`。
- 以 `&&` 在主批次成功後依序執行這兩個測試檔，使外部 PowerShell hook 不再與整套 worker 競爭。
- 不使用全套 `--maxWorkers=1`，避免把全部快速測試降為單線程；不修改 timeout、hook timeout 或 benchmark budget。

驗證順序：先分別執行兩個 Cline 測試，再執行修改後的 `npm run test:fast`。

## 最終驗收順序

```powershell
npx vitest run tests/specialCourseImportPersistence.test.js
npx vitest run tests/movableLocksSettingsPanel.test.js
npx vitest run tests/clineHarnessLifecycle.test.js
npx vitest run tests/clineHarnessPerformance.test.js
npm run test:fast
```

完成標準：每個相關測試通過，最後一個 `npm run test:fast` exit code 為 0；任何未處理的失敗均須視為任務未完成並如實回報。

## 回報格式

每輪回報需列出：任務步驟、允許範圍、實際修改檔案、命令與 exit code、測試計數、未執行項目及原因、風險／阻塞、下一步建議。不得把未執行或未驗證的事項寫成完成。
