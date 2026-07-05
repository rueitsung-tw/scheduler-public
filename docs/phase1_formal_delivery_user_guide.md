# 第一期正式交付 — 產品說明

- Date: 2026-07-02
- Policy: `docs/20260701_phase1_formal_delivery_readiness_policy.yaml`
- Purpose: 滿足 A-03（交付範圍、已知限制、主展示案例、negative suite 說明）

---

## 1. 交付範圍

第一期正式交付涵蓋「排課引擎與核心排課結果驗收版」，具體包含：

### 包含

| 組件                  | 說明                                                            |
| --------------------- | --------------------------------------------------------------- |
| solver.py             | 主排課引擎；CP-SAT 建模、硬約束、Phase 2 調度                   |
| phase2_engine.py      | 軟約束與 penalty 目標函數                                       |
| preprocessor.py       | 排課前資料清洗與需求轉換                                        |
| repair_agent.py       | solver 後修補與 reject/repair 工作流                            |
| constraints/\*.py     | 細分規則：base_rules, class_rules, special_rules, teacher_rules |
| scheduler_policy.py   | 權重註冊中心與 runtime policy adapter                           |
| formal_feasible_suite | 5 個正式可行 payload 及其完整 evidence chain                    |

### 不屬於第一期交付

- public runtime sync 完成（stage 2）
- 全系統最終上線候選版（stage 2）
- 以 fallback / degraded 作為正式可交付結果

---

## 2. 已知限制

| #   | 限制                                 | 影響範圍                                                  | 因應措施                                                          |
| --- | ------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Grade 1 英語不佔用專科教室           | solver output 中 Grade 1 英語無 classroomId/classroomName | 這是預期行為；solver validation 不將其視為 specialty room subject |
| 2   | negative suite (R3/R7) 為 INFEASIBLE | 不可作為正式交付主證據                                    | 僅作為工程保險，證明系統能正確拒絕不可能輸入                      |
| 3   | coPlanning manualBlocks 需手動設定   | mode=manual 時需確保 day/startPeriod/length 合法          | 建議優先使用 mode=auto                                            |
| 4   | 前端匯出依賴 local server            | 需先啟動 `node server.js` 與 `npm run dev`                | A-02 / V-09 已完成最小 smoke test；實際使用時仍需先啟動本機服務   |
| 5   | 交替課 (odd/even) 需配合學期設定     | weekType 欄位需正確標記                                   | V-08 已驗證可讀性                                                 |

---

## 3. 正式展示主案例：R5 — `formal_end_to_end_acceptance`

### 概覽

R5 結合所有壓力類型，是第一期正式交付的主展示案例。

### 壓力組合

| 類型                    | 內容                                        |
| ----------------------- | ------------------------------------------- |
| Special-room pressure   | English 4 locks, Music 2 locks, Art 2 locks |
| Teacher-shared disjoint | 不同班級不同時段，零衝堂                    |
| Manual locks            | 2 筆一般 timetable anchors                  |
| coPlanning              | enabled, auto mode, grades [5,6]            |

### 結果

- Status: `FEASIBLE`
- SolverStatus: `FEASIBLE`
- Readiness: `READY`
- Six Hard Checks: All 0
- degraded: `false`
- scheduleLen: 1756

### 證據鏈

| 檔案                 | 路徑                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- |
| Payload              | `formal_feasible_suite/payload_formal_end_to_end_acceptance.json`                       |
| Output               | `formal_feasible_suite_outputs/payload_formal_end_to_end_acceptance_regression_r5.json` |
| Validation           | `formal_feasible_suite_outputs/debug_schedule_validation_report_regression_r5.json`     |
| Review               | `formal_feasible_suite_outputs/result_review_report_regression_r5.json`                 |
| Readiness            | `formal_feasible_suite_outputs/readiness_report_regression_r5.md`                       |
| Summary              | `formal_feasible_suite_outputs/summary_regression_r5.json`                              |
| Product Verification | `formal_feasible_suite_outputs/r5_product_acceptance_v05_v08_verification.json`         |

---

## 4. Negative Suite 說明

### 定位

R3 / R7（phase2 negative suite）是工程保險與拒絕不可能輸入的輔助證據。

### 為什麼存在

- 證明系統能正確拒絕 INFEASIBLE 輸入
- 防止 regressions 讓原本不可能的案例變成「看似可行」
- 不是正式交付主證據

### 確認狀態

- R3: confirmed INFEASIBLE (heavy manual locks causing conflicts)
- R7: confirmed INFEASIBLE (room pressure exceeding capacity)

### 檔案位置

- `payload_scenarios/2026-06-29/phase2/phase2_outputs/`
- `PHASE2_REGRESSION_FINAL_REPORT.md`
- `R3_R7_TRIAGE_REPORT.md`

---

## 5. 如何使用

### 重跑 formal suite

```bash
python scripts/regression_harness.py run ^
  --payload payload_scenarios/2026-06-29/phase2/formal_feasible_suite/payload_formal_end_to_end_acceptance.json ^
  --round 5 ^
  --output-dir payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs
```

### 驗證 evidence chain

```bash
python scripts/regression_harness.py verify ^
  --output payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/payload_formal_end_to_end_acceptance_regression_r5.json ^
  --validation payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/debug_schedule_validation_report_regression_r5.json ^
  --review payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/result_review_report_regression_r5.json
```

### 產品級檢查

```bash
python scratch_verify_r5_product.py
```

---

## 6. 相關文件

| 文件               | 路徑                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| Policy             | `docs/20260701_phase1_formal_delivery_readiness_policy.yaml`          |
| Acceptance Summary | `docs/phase1_formal_delivery_acceptance_summary.md`                   |
| Suite Manifest     | `formal_feasible_suite/formal_feasible_suite_manifest.md`             |
| Suite Final Report | `formal_feasible_suite_outputs/FORMAL_FEASIBLE_SUITE_FINAL_REPORT.md` |
| Handoff            | `docs/handoff_2026-07-01_formal_feasible_special_room_suite.md`       |

---

_Generated: 2026-07-02T12:09:00+08:00_
