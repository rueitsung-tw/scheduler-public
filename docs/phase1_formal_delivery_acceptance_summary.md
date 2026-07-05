# 第一期正式交付 — Acceptance Summary

- Date: 2026-07-02
- Policy: `docs/20260701_phase1_formal_delivery_readiness_policy.yaml`
- Purpose: 產品級 acceptance summary，滿足 A-01

---

## 1. 交付範圍

本文件確認「排課系統第一期正式交付」的引擎與核心排課結果驗收版已達到可提出正式場合使用的標準。

### 包含

- 排課引擎（solver.py + phase2_engine.py + constraints/\*.py + preprocessor.py + repair_agent.py）
- formal_feasible_suite：5 個正式可行 payload 及其完整 evidence chain
- 專科教室 assignment 可落地、可匯出、可由前端消費
- zero teacher_conflicts、zero room_conflicts、zero class_slot_conflicts

### 不包含

- public runtime sync 完成（這是 stage 2 目標）
- 全系統最終上線候選版（這是 stage 2 目標）
- 以 fallback / degraded 作為正式可交付結果

---

## 2. Formal Feasible Suite 結果

| Round | Payload                                 | Status   | SolverStatus | Readiness | Six Hard Checks | degraded |
| ----- | --------------------------------------- | -------- | ------------ | --------- | --------------- | -------- |
| R1    | baseline_formal_acceptance              | FEASIBLE | FEASIBLE     | READY     | All 0           | false    |
| R2    | special_room_pressure_balanced          | FEASIBLE | FEASIBLE     | READY     | All 0           | false    |
| R3    | teacher_shared_but_time_disjoint        | FEASIBLE | FEASIBLE     | READY     | All 0           | false    |
| R4    | mixed_manual_locks_with_feasible_margin | FEASIBLE | FEASIBLE     | READY     | All 0           | false    |
| R5    | formal_end_to_end_acceptance            | FEASIBLE | FEASIBLE     | READY     | All 0           | false    |

**Suite Verdict: 5/5 FEASIBLE + READY + ZERO HARD CHECKS + NO DEGRADATION**

---

## 3. Evidence Chain 完整性

每一輪皆具備 same-round evidence chain：

| Round | Payload | Output | Validation | Review | Readiness | sameRound |
| ----- | ------- | ------ | ---------- | ------ | --------- | --------- |
| R1    | ✅      | ✅     | ✅         | ✅     | ✅ READY  | true      |
| R2    | ✅      | ✅     | ✅         | ✅     | ✅ READY  | true      |
| R3    | ✅      | ✅     | ✅         | ✅     | ✅ READY  | true      |
| R4    | ✅      | ✅     | ✅         | ✅     | ✅ READY  | true      |
| R5    | ✅      | ✅     | ✅         | ✅     | ✅ READY  | true      |

所有 evidence 檔案位於：`payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/`

### Evidence Chain 格式修正

- 已修正 `sourceValidationFile` 從泛用 `debug_schedule_validation_report.json` 改為 round-specific 名稱
- `evidenceChain.validationReport` 已使用 round-specific 名稱
- `evidenceChain.sameRound` 全部為 `true`

---

## 4. 六大硬檢查

| 檢查項                   | R1  | R2  | R3  | R4  | R5  |
| ------------------------ | --- | --- | --- | --- | --- |
| class_slot_conflicts     | 0   | 0   | 0   | 0   | 0   |
| room_overloads           | 0   | 0   | 0   | 0   | 0   |
| unassigned_special_rooms | 0   | 0   | 0   | 0   | 0   |
| grade_subject_issues     | 0   | 0   | 0   | 0   | 0   |
| teacher_conflicts        | 0   | 0   | 0   | 0   | 0   |
| room_conflicts           | 0   | 0   | 0   | 0   | 0   |

---

## 5. 正式展示主案例

**R5 — `formal_end_to_end_acceptance`** 為正式展示主案例。

理由：

1. 結合所有壓力類型（special-room + teacher-shared + manual locks + coPlanning）
2. 完整驗證端到端 consumer shape
3. 零衝堂、零降級、完整證據鏈
4. 最具說服力的綜合壓力測試

---

## 6. Negative Suite 定位

R3 / R7（phase2 negative suite）明確標記為：

- confirmed INFEASIBLE legitimate negative cases
- 工程保險與拒絕不可能輸入的輔助證據
- 不混用於正式交付主證據

---

## 7. 對齊 README 與 Acceptance Policy

本 summary 對齊：

- `README.md` 專案入口說明
- `docs/20260621-schedule-result-acceptance-review-policy.yaml` 驗收政策
- `docs/20260701_phase1_formal_delivery_readiness_policy.yaml` 第一期正式交付判定清單

---

## 8. Acceptance 判定

基於以上證據，第一期正式交付的引擎層面（stage_1_engine_formal_delivery）達到以下條件：

- [x] F-01 ~ F-04 完成
- [x] N-01 ~ N-02 完成
- [x] A-01 完成（本文件）
- [x] V-01 ~ V-04 完成（formal suite 5/5 FEASIBLE + READY + 零硬檢查 + same-round evidence chain）
- [x] V-05 ~ V-08 完成（見 R5 產品級檢查報告）

**Acceptance Verdict: Stage 1 Engine Formal Delivery — PASS**

---

## 9. 證據檔案路徑

| 項目                         | 路徑                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Policy                       | `docs/20260701_phase1_formal_delivery_readiness_policy.yaml`                                                                |
| Suite manifest               | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite/formal_feasible_suite_manifest.md`                               |
| Suite generation report      | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite/formal_feasible_suite_generation_report.md`                      |
| Suite final report           | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/FORMAL_FEASIBLE_SUITE_FINAL_REPORT.md`                   |
| R5 output                    | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/payload_formal_end_to_end_acceptance_regression_r5.json` |
| R5 validation                | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/debug_schedule_validation_report_regression_r5.json`     |
| R5 review                    | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/result_review_report_regression_r5.json`                 |
| R5 readiness                 | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/readiness_report_regression_r5.md`                       |
| R5 summary                   | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/summary_regression_r5.json`                              |
| R5 product acceptance        | `payload_scenarios/2026-06-29/phase2/formal_feasible_suite_outputs/r5_product_acceptance_v05_v08_verification.json`         |
| Acceptance summary（本文件） | `docs/phase1_formal_delivery_acceptance_summary.md`                                                                         |
| Product user guide           | `docs/phase1_formal_delivery_user_guide.md`                                                                                 |

---

_Generated: 2026-07-02T10:48:00+08:00_
