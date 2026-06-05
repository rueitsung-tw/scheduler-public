# Scheduler Engine Overview

> 這份文件整理目前 Python 排課引擎的實際結構與責任分工，作為 `DataDictionary_2.md` 的延伸說明。  
> 對照基準：`solver.py`、`preprocessor.py`、`phase2_engine.py`、`config.py`、`utils.py`、`constraints/*.py`

## 1. 定位

排課引擎目前採用 Python + OR-Tools CP-SAT。

整體策略分成兩層：

1. **Phase 1：硬約束建模**
   先建立一個「不能違反」的可行解空間，例如教師衝堂、班級下午禁排、專科教室容量、預排鎖定等。
2. **Phase 2：軟約束優化**
   在可行解空間內，透過 penalty 最小化進一步改善課表品質，例如教師連堂疲勞、午休跨堂、跨專長遞補、負載平衡等。

## 2. 邏輯目錄結構

```text
scheduler-engine/
├── solver.py
├── config.py
├── utils.py
├── preprocessor.py
├── phase2_engine.py
└── constraints/
    ├── __init__.py
    ├── base_rules.py
    ├── teacher_rules.py
    ├── class_rules.py
    └── special_rules.py
```

補充：`scheduler-engine/` 是邏輯上的說明名稱，實際 repo 中這些檔案目前位於專案根目錄與 `constraints/` 子目錄。

## 3. 模組責任

### `solver.py`

主入口，負責：

- 接收 CLI 參數 `input_path`、`output_path`
- 載入 JSON payload
- 呼叫 `preprocess_classes()`
- 整理班級、教師、教室與 AI 設定等建模前資料
- 建立 `CpModel`
- 依序套用 Phase 1 / Phase 2 規則
- 呼叫 `CpSolver.Solve()`
- 將結果寫入輸出 JSON
- 在 `INFEASIBLE` 時輸出診斷檔

主要入口：

- `main()`
- `_write_infeasible_report()`

### `config.py`

集中管理引擎共用常數與 fallback 設定。

目前包含：

- `DAYS`
- `PERIODS_PER_DAY`
- `TOTAL_PERIODS`
- `LUNCH_BOUNDARY`
- `VIRTUAL_TEACHER_KEYWORDS`
- `CLASSROOM_LIMITS_FALLBACK`

### `utils.py`

提供多個規則模組會共用的純函式。

主要內容：

- `parse_grade()`：安全解析班級年級
- `is_virtual_teacher()`：判斷虛擬 / 外聘 / 待排教師
- `normalize_room_name()`：教室名稱正規化
- `get_subject_capacity()`：推導科目可用場地容量
- `add_consecutive_constraint()`：建立通用連堂約束

### `preprocessor.py`

專責輸入資料清理，不直接操作 OR-Tools `model`。

目前前處理內容：

- `_fix_grade()`：修正 `grade` 與班級名稱不一致
- `_clean_ghost_art()`：清除重複的音樂 / 美勞需求
- `_homeroom_blockization()`：合併低年級多筆導師區塊
- `_split_arts_15_15()`：將音樂 1.5 + 美勞 1.5 拆成固定課 + 交替課

對外入口：

- `preprocess_classes()`

### `constraints/base_rules.py`

建立最基礎的建模骨架。

主要責任：

- 建立 `schedule[(class, period, teacher, subject)] -> BoolVar`
- 為各班課程需求加上節數等式約束
- 建立 `alternating_class_is_music_odd` 共享 BoolVar
- 掃描前端 `isLocked=true` 的預排資料
- 產生 `debug_lock_audit.txt`

主要函式：

- `create_schedule_vars_and_course_demands()`
- `create_alternating_vars()`
- `apply_preallocation_locks()`

### `constraints/teacher_rules.py`

處理教師維度硬約束與教師 metadata。

主要責任：

- `apply_anti_collision()`：教師與班級同時段衝堂防護
- `apply_teacher_unavailable_slots()`：教師不排課時段
- `apply_teacher_quota()`：整理 `_safe_max_quota`、`_expertise_quotas`
- `apply_special_course_locks()`：特殊課程或專案時段鎖定

### `constraints/class_rules.py`

處理班級節奏與場地容量相關的硬約束。

主要責任：

- `apply_daily_subject_limit()`
- `apply_afternoon_prohibition()`
- `apply_no_consecutive_subject()`
- `apply_special_classroom_capacity()`
- `apply_science_habits()`

### `constraints/special_rules.py`

收攏例外型與專題型規則。

主要責任：

- `apply_english_capacity()`：處理語文-英語容量
- `apply_no_consecutive_pe()`
- `apply_art_consecutive_constraint()`
- `apply_alternating_perfect_pairing()`
- `apply_swimming_engine_v2()`

### `phase2_engine.py`

負責目標函數與軟約束優化。

目前涵蓋：

- 教師連堂疲勞管理
- 科目分散懲罰
- 午休跨堂懲罰
- 跨專長遞補懲罰
- 負載平衡機制
- 交替課對齊懲罰
- 最終 `model.Minimize(sum(self.penalty_vars))`

主要類別：

- `SchedulePhase2Engine`

主要方法：

- `build_soft_constraints()`

## 4. 執行流程

```text
CLI args
  → JSON load
  → preprocess_classes()
  → 統計 class_names / teacher_names / aiSettings
  → 統計 classrooms_count_map / subject_demand_count / subject_room_count
  → 建立 CpModel()
  → create_schedule_vars_and_course_demands()
  → create_alternating_vars()
  → apply_preallocation_locks()
  → apply_anti_collision()
  → apply_teacher_quota()
  → apply_teacher_unavailable_slots()
  → apply_special_course_locks()
  → apply_daily_subject_limit()
  → apply_afternoon_prohibition()
  → apply_no_consecutive_subject()
  → apply_special_classroom_capacity()
  → apply_science_habits()
  → apply_english_capacity() (語文-英語容量)
  → apply_no_consecutive_pe()
  → apply_art_consecutive_constraint()
  → apply_alternating_perfect_pairing()
  → apply_swimming_engine_v2()
  → add_consecutive_constraint() 掃描通用連堂需求
  → SchedulePhase2Engine.build_soft_constraints()
  → CpSolver.Solve()
  → FEASIBLE / OPTIMAL：輸出課表 JSON
  → INFEASIBLE：輸出診斷報告與 debug payload
  → ERROR：輸出錯誤結果 JSON
```

## 5. 設計原則

1. **前處理與建模分離**
   `preprocessor.py` 不碰 OR-Tools model，避免資料清理與數學建模互相糾纏。

2. **硬約束先保可行，軟約束再拚品質**
   `constraints/*.py` 先決定什麼絕對不能違反，`phase2_engine.py` 再決定可行解之間誰更好。

3. **交替課使用共享 BoolVar**
   `alternating_class_is_music_odd` 由 `base_rules.py` 建立，供輸出與配對規則共用，避免交替課週次語意漂移。

4. **教師配額改走 metadata + penalty**
   配額不是直接硬砍，而是先整理成 metadata，再由 Phase 2 決定如何施加懲罰，讓 solver 有更高機會找到可行解。

5. **診斷輸出是常態工具，不是例外工具**
   `debug_lock_audit.txt`、`debug_infeasible_report.txt`、`debug_payload.json` 都是目前排查問題的重要依據。

## 6. Smoke Test 習慣

目前團隊常用兩種方式：

```bash
python quick_test_solver.py
python solver.py debug_payload.json output.json
```

說明：

- `quick_test_solver.py` 固定讀取 repo 根目錄的 `debug_payload.json`
- `debug_payload.json` 常被當成可重現問題的回歸樣本
- 若要驗證新案例，仍建議使用正式入口：

```bash
python solver.py input.json output.json
```

## 7. 維護建議

當以下任一項目變動時，應同步更新這份文件：

- `solver.py` 新增或移除規則呼叫
- `constraints/` 新增模組或調整責任分層
- `phase2_engine.py` 更改 penalty 結構或目標函數
- `quick_test_solver.py` 更改 smoke test 樣本來源
- `debug_*` 檔案的輸出策略改變
