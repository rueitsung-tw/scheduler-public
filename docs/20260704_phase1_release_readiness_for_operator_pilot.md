# 第一期交付最終判定 — 可否進行實際人員操作實驗

日期: 2026-07-04
依據政策: `docs/20260701_phase1_formal_delivery_readiness_policy.yaml`

---

## 1. 結論

**可以。**

截至 2026-07-04，專案已達到：

1. `stage_1_engine_formal_delivery` 完成
2. `stage_2_system_delivery_candidate` 完成
3. `scheduler-public` true sync 完成

因此本系統已可進入 **受控的實際人員操作實驗**。

但截至 **2026-07-04**，仍**不建議直接對不特定對象公開釋出**，作為可自行上手的廣泛排課產品。

---

## 2. 這裡所說的「可操作實驗」是什麼

本結論指的是：

- 可交由實際承辦人員在本機或受控環境中操作
- 可驗證真實設定流程、排課流程、教室分配、前端閱讀與匯出流程
- 可蒐集操作回饋、UI 痛點、資料輸入錯誤型態與流程阻塞點

本結論 **不等同於**：

- 已完成大規模正式上線
- 已完成多人同時操作驗證
- 已完成長期營運監控、備援、權限控管、或部署自動化
- 已完成面向不特定外部使用者的公開產品化釋出

---

## 2.1 公開釋出判定

### 是否可交給不特定對象直接進行排課工作？

**目前不建議。**

比較準確的狀態是：

- **可以進入受控真人操作 pilot**
- **尚不建議直接面向不特定對象廣泛釋出**

### 主要原因

1. 已完成的是「第一期正式交付」與「上線候選 gate」，不是完整營運產品 gate
2. 雖然 formal suite、frontend smoke、runtime sync 都已收斂，但仍缺少：
   - 多人並行操作驗證
   - 長時間穩定度驗證
   - 正式維運 SOP / 回復 SOP
   - 權限、稽核、部署與備援層面的產品化驗證
3. 目前最合適的下一步，是由熟悉業務的實際承辦人員進行受控操作實驗，先驗證真實流程與人機互動摩擦點

---

## 3. 目前已完成的關鍵 gate

### 3.1 Formal Delivery Gate

- `F-01 ~ F-04` 完成
- `N-01 ~ N-02` 完成
- `A-01 ~ A-03` 完成
- `V-01 ~ V-09` 完成

對應證據：

- `docs/phase1_formal_delivery_acceptance_summary.md`
- `docs/phase1_formal_delivery_user_guide.md`
- `docs/phase1_frontend_smoke_test_report.md`

### 3.2 System Delivery Candidate Gate

- R5 formal showcase case 已完成前端驗證
- R5 formal showcase case 已完成匯出驗證
- public runtime allowlist check 通過
- public runtime dry-run 通過
- true sync 已完成

對應證據：

- `docs/20260702_stage2_progress_report.md`
- `docs/20260703_scheduler_public_reconciliation_report.md`
- `docs/20260704_antigravity_scheduler_public_review_report.md`

---

## 4. 為何現在可以進真人操作實驗

目前已具備以下條件：

1. **引擎正式證據鏈完整**
   - formal feasible suite 5/5 `FEASIBLE + READY`
   - same-round evidence chain 完整
   - 無 degraded 正式交付污染
2. **產品級可用性已過最小門檻**
   - R5 正式展示案例可被 `/classrooms` 消費
   - R5 正式展示案例可成功匯出 XLSX
3. **public/runtime 交付面已對齊**
   - `requirements.txt`
   - `package.json` 的 `start` / `postinstall`
   - `server.js` 啟動提示
   - `README.md` 安裝指引
4. **sync 風險已收斂**
   - `Unclassified files = 0`
   - `stale files = 0`

---

## 5. 建議的實驗邊界

建議採用 **受控 pilot**，而不是直接宣稱全面上線。

### 建議納入的實驗內容

1. 系統初始化與基本資料建立
2. 真實班級/教師/教室資料輸入
3. 排課引擎執行與結果檢視
4. Classroom Manager 閱讀與專科教室檢查
5. Export Hub 匯出
6. 承辦人對 UI 與流程的實際操作回饋

### 建議暫不宣稱已涵蓋的範圍

1. 多人並行操作
2. 長時間壓力測試
3. 正式部署維運 SOP
4. 權限、稽核、備援、還原演練

---

## 6. 進入操作實驗前的實務前提

每次實驗前，仍建議確認：

1. `node server.js` / `npm start` 可正常啟動
2. `npm run dev` 可正常進入前端
3. DB 已初始化
4. 承辦人使用的是受控測試資料或可回復的資料集
5. 匯出檔案與操作記錄有留存位置

---

## 7. 最終判定

**第一期交付工作可以視為完成到「可進入實際人員操作實驗」的程度。**

比較準確的說法是：

- **不是全面正式上線完成**
- **但已足以進入受控真人操作 pilot**

下一步應聚焦在：

1. `scheduler-public` 的 git commit / release 整理
2. 實際承辦人 pilot 回饋蒐集
3. 若 pilot 穩定，再規劃下一階段的營運與部署驗證
