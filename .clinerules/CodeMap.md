# CodeMap

這份索引是給 Codex 與 Cline 共用的 repo-local 快速地圖。

目標是幫你快速落點，不是取代 graph search 或完整文件。

## 使用方式

- 先讀 `Rules.md` 和 `.clinerules/PROJECT_RULES.md`。
- 再用這份索引找主要入口。
- 要做程式碼追蹤時，優先用 `codebase-memory-mcp`。

## Runtime Flow

1. `src/stores/schedule.js` 組裝前端 payload。
2. `server.js` 接收請求並啟動 Python solver。
3. `preprocessor.py` 清洗需求與補齊建模前資料。
4. `solver.py` 建模並呼叫 `phase2_engine.py`。
5. `constraints/*.py` 套用細分規則與資源限制。
6. `debug_schedule_validation_report.json`、`result_review_report.json`、readiness harness 完成正式驗收。

## Start Here

- `Rules.md`：精簡工作原則入口
- `.clinerules/PROJECT_RULES.md`：本專案專屬規則與 completion gate
- `.agents/AGENTS.md`：高層工作紀律與回報格式
- `README.md`：只在需要架構總覽或本地啟動時補讀

## Backend / Solver

- `server.js`：API 與 Python solver 橋接
- `preprocessor.py`：排課前資料清洗
- `solver.py`：排課主入口
- `phase2_engine.py`：Phase 2 目標函數與軟約束
- `constraints/class_rules.py`：班級面規則集中區
- `constraints/special_rules.py`：專科教室、交替配對等高壓資源規則
- `constraints/teacher_rules.py`：教師面限制

## Frontend / Payload

- `src/stores/schedule.js`：payload 組裝、engine polling、save/load
- `src/views/AiSettingsView.vue`：solver 規則設定入口
- `src/views/TimetableEditorView.vue`：全域課表編輯器與手動鎖定入口
- `src/views/ClassesView.vue`：班級需求與導師側資料編輯
- `src/views/TeachersView.vue`：教師資料維護
- `src/views/ExportHubView.vue`：匯出中心

## Harness / Automation

- `scripts/check-submission-readiness.ps1`：正式 readiness gate
- `scripts/sync_public_runtime.py`：同步公開版
- `.githooks/pre-commit`：repo-local hook 入口
- `scripts/hooks/generate-codemap.mjs`：重建精簡版 CodeMap
- `scripts/hooks/update-experience-log.mjs`：更新精簡版 ExperienceLog
- `scripts/hooks/update-change-log.mjs`：更新精簡版 ChangeLog

## Docs By Scenario

- 正式交付 / readiness：`docs/20260701_phase1_formal_delivery_readiness_policy.yaml`
- special-room / formal feasible suite / handoff：`docs/handoff_2026-07-01_formal_feasible_special_room_suite.md`
- 專科教室容量 / repair / `INFEASIBLE`：`docs/20260707-資訊課教室指派 — 架構風險說明.md`
- 一般 acceptance / review：`docs/20260621-schedule-result-acceptance-review-policy.yaml`

## Repo-local Rule Files

- `.clinerules/PROJECT_RULES.md`：專案專屬規則
- `.clinerules/ExperienceLog.md`：穩定教訓與近期訊號摘要
- `.clinerules/HOOKS.md`：hook 行為說明
- `.clinerules/archive/`：完整歷史封存

> 自動產生腳本：`node scripts/hooks/generate-codemap.mjs`
