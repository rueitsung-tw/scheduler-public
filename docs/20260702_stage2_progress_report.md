# Stage 2 Progress Report (2026-07-03)

## Executive Summary

| Item                                | Status                               |
| ----------------------------------- | ------------------------------------ |
| A-02 前端與匯出最小驗證             | ✅ 完成                              |
| V-09 最小前端/匯出驗證              | ✅ 完成                              |
| Runtime sync check                  | ✅ 完成 (87 allowed, 0 unclassified) |
| Runtime sync dry-run                | ✅ 完成 (87 copy, 0 stale prune)     |
| Runtime sync true sync              | ✅ 完成 (87 copied, 0 stale removed) |
| `stage_2_system_delivery_candidate` | ✅ 條件已滿足                        |

## 1. A-02: 前端與匯出最小驗證 ✅

**證據:** `docs/phase1_frontend_smoke_test_report.md`, `smoke_evidence/`

- 使用 R5 `formal_end_to_end_acceptance` payload (非 DB 既有資料)
- `/classrooms` 成功載入 61 班級 R5 timetable 資料 → `smoke_evidence/classrooms_r5.png`
- `/export` 成功載入 61 班級並完成 XLSX 匯出 → `smoke_evidence/export_view.png`
- Export 下載檔 → `smoke_evidence/r5_export_xlsx.xlsx`

## 2. V-09: 最小前端/匯出驗證 ✅

**證據:** `docs/phase1_frontend_smoke_test_report.md`

- 至少一輪 formal showcase case 在前端可讀: ✅ (R5 via `/classrooms`)
- 至少一輪 formal showcase case 可成功匯出: ✅ (XLSX download)
- 資料來源為 R5 formal payload: ✅ (via `scripts/load_r5_fixture.py`)

## 3. Runtime Sync Check ✅

**證據:** `scripts/sync_public_runtime.py check` 輸出

```
Public runtime allowlist check
- Allowed files: 87
- Ignored files: 753
- Unclassified files: 0
```

### 3.1 修正項目

| 問題                                             | 修正                                                   | 檔案                                            |
| ------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------- |
| `is_hard_ignored()` 缺少 `ignored_patterns` 檢查 | 補上 `matches_pattern(rel, manifest.ignored_patterns)` | `scripts/sync_public_runtime.py` L103-104       |
| `repair_agent.py` 被錯誤排除                     | 從 `ignoredPatterns` 移除，加入 `includeFiles`         | `F:/scheduler-public/public-repo.manifest.json` |
| `constraints/*.py` 被 dry-run 刪除               | 6 個 constraints .py 檔加入 `includeFiles`             | `F:/scheduler-public/public-repo.manifest.json` |

### 3.2 Manifest 變更

**加入 `includeFiles`:**

- `repair_agent.py` — 排課引擎核心修復模組
- `constraints/__init__.py` — 約束模組入口
- `constraints/base_rules.py` — 基礎硬約束
- `constraints/class_rules.py` — 班級面規則
- `constraints/special_rules.py` — 高壓資源規則
- `constraints/teacher_rules.py` — 教師面限制
- `constraints/utils.py` — 約束 helper

**加入 `ignoredRoots`:**

- `smoke_evidence/` — 本地測試截圖，不該公開

**加入 `ignoredPatterns`:**

- `*.r5-backup` — 本地 DB 備份，不該公開

## 4. 最小 public/runtime/部署層驗證 ✅

### 4.1 Check 通過 ✅

- 86 allowed files, 0 unclassified
- 無安全風險檔案被放行

### 4.2 Dry-run 完成 ✅

```
Public runtime sync dry-run
- Source: F:\scheduler-frontend
- Target: F:\scheduler-public
- Copied files: 87
- Ignored files: 753
- Would remove stale files: 0
```

目前 stale list 已清空，代表 public target 與 source allowlist 已完全對齊。

### 4.3 True Sync 已執行 ✅

```
Public runtime sync complete
- Copied files: 87
- Ignored files: 753
- Removed stale files: 0
```

真實 sync 已完成，`scheduler-public` 已同步到最新的 phase 1 交付候選內容，後續只剩 target repo 的 git commit / release 整理。

## 5. `stage_2_system_delivery_candidate` 判定

根據 `docs/20260701_phase1_formal_delivery_readiness_policy.yaml`:

| 條件                                  | 狀態                                  |
| ------------------------------------- | ------------------------------------- |
| stage_1_engine_formal_delivery 已完成 | ✅                                    |
| A-02 完成                             | ✅                                    |
| A-03 完成                             | ✅                                    |
| V-09 完成                             | ✅                                    |
| 完成最小 public/runtime/部署層驗證    | ✅ (check + dry-run + true sync 完成) |

**結論:** `stage_2_system_delivery_candidate` **條件已滿足**，且 true sync 已完成。

## 6. 新增/修改檔案清單

| 檔案                                            | 類型 | 說明                                                  |
| ----------------------------------------------- | ---- | ----------------------------------------------------- |
| `scripts/sync_public_runtime.py`                | 修改 | 補上 `ignored_patterns` 檢查                          |
| `F:/scheduler-public/public-repo.manifest.json` | 修改 | repair_agent.py + constraints/\*.py 加入 includeFiles |
| `scripts/load_r5_fixture.py`                    | 新增 | R5 fixture 載入腳本                                   |
| `docs/phase1_frontend_smoke_test_report.md`     | 修改 | R5 正式驗證報告 + evidence artifacts                  |
| `docs/20260702_stage2_progress_report.md`       | 新增 | 本報告                                                |
| `smoke_evidence/classrooms_r5.png`              | 新增 | /classrooms 截圖                                      |
| `smoke_evidence/export_view.png`                | 新增 | /export 截圖                                          |
| `smoke_evidence/r5_export_xlsx.xlsx`            | 新增 | R5 export 下載檔                                      |
| `smoke_evidence/r5_smoke_evidence_summary.md`   | 新增 | Evidence summary                                      |

## 7. 關鍵命令執行紀錄

```bash
python .\scripts\sync_public_runtime.py check
# Result: 87 allowed, 753 ignored, 0 unclassified

python .\scripts\load_r5_fixture.py
# Result: 61 classes updated, 1756 entries loaded

python .\scripts\sync_public_runtime.py sync --dry-run
# Result: 87 copied, 753 ignored, 0 stale removed

python .\scripts\sync_public_runtime.py sync
# Result: 87 copied, 753 ignored, 0 stale removed
```

## 8. 剩餘事項

1. **scheduler-public git commit / release 整理:** true sync 已完成，target repo 尚待提交與整理 release 說明
