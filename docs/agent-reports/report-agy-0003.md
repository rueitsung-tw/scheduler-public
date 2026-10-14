# AGY 任務執行回報 (report-agy-0003)

- **執行者**: AGY
- **task_id**: `smart-scheduling-error-fix-0003`
- **開始時間**: 2026-08-22T14:58:27+08:00
- **結束時間**: 2026-08-22T14:58:53+08:00
- **執行步驟**: Step 3 (`src/stores/schedule.js` 重構 `pollJobStatus` 失敗處理邏輯)

---

## 1. 實際修改檔案

- [`src/stores/schedule.js`](file:///F:/scheduler-frontend/src/stores/schedule.js)

---

## 2. Diff 摘要

1. **建立共用失敗處理函式 `processFailedResult`**:
   - 在 `pollJobStatus` 可見作用域建立非同步函式 `processFailedResult(resultObj, fallbackMsg, dataObj)`。
   - 統一更新 store 狀態：`engineStatus.value = 'ERROR'`、`enginePhase.value = 'FAILED'`，並於 `dataObj` 包含時間戳記時計算耗時與完成時間。

2. **精確分支處置 6 大 solver 狀態**:
   - **`INVALID_INPUT`**: 提取 `classLoadTrace` 填入 `CLASS_LOAD` 診斷警示，解析 `gradeCapacityMap` 同步至 `schoolInfo.value.gradeMaxPeriods`。
   - **`INVALID` / `INVALID_VALIDATION`**: 優先呼叫 `normalizeValidationReportDetails(resultObj.validationReport)` 解析，若無報告內容則 safe-fetch `/api/debug/validation-report` 經正規化填入診斷警示。
   - **`TIMEOUT_NO_SOLUTION` / `UNKNOWN_TIMEOUT`**: 呈現逾時提示，帶入 `diagnosticWarnings` 與 `aiAnalysis`。
   - **`INFEASIBLE`**: 設定無可行解訊息，若預設警示為空則呼叫 `loadDiagnosticWarningsFromReport()` 載入 fallback 分析。
   - **`ERROR` / 通用狀態**: 依 `resultObj.error` $\rightarrow$ `resultObj.message` $\rightarrow$ `fallbackMsg` $\rightarrow$ `'排課引擎執行失敗'` 優先順序建立錯誤訊息。

3. **統一 `COMPLETED` 失敗與 `FAILED` 分支入口**:
   - 在 `COMPLETED` 分支中，過濾包含失敗狀態或空課表的 solver 結果，與 `data.status === 'FAILED'` 分支統一呼叫 `processFailedResult` 並以 `reject(new Error(engineErrorMessage.value))` 拒絕，徹底終止錯誤輪詢。

---

## 3. 驗收命令與完整結果

- **驗收命令**: `npx eslint src/stores/schedule.js`
- **執行結果**:
  - Exit Code: `0`
  - Output: 通過，零 Lint 錯誤與警告

---

## 4. 未完成項目

- **Step 4**: 新增單元測試套件 `tests/scheduleStoreEngineErrors.test.js` (待下一階段派發)

---

## 5. 風險或阻塞原因

- 無風險或阻塞。已嚴格遵循 `codex-task-dispatch.md` 與任務要求，僅修改 `src/stores/schedule.js`，無創造新 ref，亦未修改 `server.js` 或 `solver.py`。

---

AGY_DONE
