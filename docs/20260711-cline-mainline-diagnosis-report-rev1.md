# 20260711 Cline 主線診斷報告 (Rev1)

**日期**: 2026-07-11
**版本**: Rev1 — 修正「學習中心固定時段」與「導師區塊」關係的表述
**範圍**: 原始主線4題 — 學習中心抽離、六年級固定時段、`teacher.grade`、`gradePreferences`
**排除**: room-conflict / 美勞 / 音樂支線（已移交其他 branch）

---

## 1. Mainline Scope

本報告只針對以下4個主題：

| #   | 主題                                                       | 狀態                  |
| --- | ---------------------------------------------------------- | --------------------- |
| 1   | 學習中心抽離課程是否把導師區塊鎖太死                       | ✅ 已證實             |
| 2   | 六年級學習中心固定時段（王美惠、6年7班、6年11班）的角色    | ✅ 已澄清 (Rev1 修正) |
| 3   | `teacher.grade` 是否影響正式排課                           | ✅ 已證實不影響       |
| 4   | CSV `志願1/2/3 -> gradePreferences` 映射與科任年級偏好排課 | ✅ 已證實運作         |

---

## 2. Sixth-Grade Learning Center Fixed Slots

### 2.1 學習中心抽離在 preprocess 前的語意

Payload 進入 `preprocessor.py` 之前，學習中心課程以一般課程需求的形式存在於 `class.course_requirements` 中：

```json
{
  "subject": "學習中心-國語",
  "teacher_name": "王美惠",
  "defaultTeacher": "homeroom",
  "periods": 1.5
}
```

**preprocess 前**：這只是一筆普通的課程需求，`defaultTeacher == "homeroom"` 表示它歸導師自授。

### 2.2 preprocess 後的語意 (`_homeroom_blockization`)

`preprocessor.py` 的 `_homeroom_blockization()` (L250-381) 執行以下邏輯：

1. 遍歷所有 `course_requirements`
2. 若 `defaultTeacher == "homeroom"` 且科目**不是**「生活」「游泳」「體育」→ 歸入 `homeroom_subs_to_block`
3. 將這些科目的 `periods` **累加合併**為單一「導師區塊」條目
4. 學習中心課程（國語/數學等）因為 `defaultTeacher == "homeroom"` 且非免於合併的科目，**會被合併進導師區塊**

**關鍵發現**：學習中心抽離課程在 preprocess 後**不再以原始科目獨立存在**。它們的節數被累加到「導師區塊」的總節數中。

```
preprocess 前: 國語(3) + 數學(2) + 學習中心-國語(1.5) = 6.5 節（分散）
preprocess 後: 導師區塊(6.5) = 6.5 節（單一區塊）
```

### 2.3 正式 solver 實際吃到的語意

Solver 收到的是 preprocess 後的 `classes_data`。此時：

- **沒有**「學習中心-國語」這個獨立科目存在於 solver 的 schedule variables 中
- 只有「導師區塊」作為單一 subject，帶有合併後的總節數
- 導師區塊排在哪個時段，學習中心課程就「隨之而定」

**六年級固定時段的角色（Rev1 修正）**：

六年級的學習中心課程（王美惠負責6年7班、6年11班等）在 preprocess 階段被合併進導師區塊後，其固定時段的語意**並未完全消失**，而是發生了**語意轉換**：

1. 學習中心課程的原始 `targetSubject`（如「學習中心-國語」）在 `_homeroom_blockization` 後不再獨立存在
2. **但是**，solver 仍會呼叫 `apply_special_course_locks(...)` 來處理 special course locks
3. `resolve_effective_special_course_subject(...)` 會把學習中心的原始 `targetSubject` 映射成 `導師區塊`
4. 因此，學習中心固定時段**以「導師區塊 的 special-course lock」形式**繼續作用於 solver

**換句話說**：學習中心固定時段不是完全消失，而是從「原始科目的獨立約束」轉換為「透過導師區塊的 locked slots 形成的時段壓力」。

### 2.4 六年級學習中心固定時段在正式 solver 語意下的角色（Rev1 修正）

**結論：六年級學習中心固定時段在正式 solver 中以轉換後的語意繼續發揮約束作用。**

具體而言：

1. 學習中心課程被 `_homeroom_blockization` 合併進「導師區塊」
2. Solver **不再看到**「學習中心-國語」或「學習中心-數學」作為獨立 subject
3. **但是**，透過 `special_course_locks -> resolve_effective_special_course_subject -> 導師區塊` 的路徑，學習中心固定時段仍以 locked slots 的形式影響 solver
4. 因此**不能說**學習中心固定時段在 solver 中「完全不扮演約束角色」
5. **正確說法**：學習中心固定時段的約束語意已從「原始科目獨立約束」轉換為「導師區塊的 special-course lock」

---

## 3. Formal Solver Semantics vs Old Misdiagnosis

### 3.1 舊診斷：「學習中心抽離課程把導師區塊鎖太死」

這個說法需要**精確化**，而非簡單否定：

1. **學習中心課程不獨立存在於 solver**：preprocess 後，學習中心課程已合併為導師區塊的一部分 — **這一點正確**
2. **但並非「沒有固定時段約束」**：透過 `special_course_locks` 路徑，學習中心固定時段仍以「導師區塊 locked slots」的形式存在 — **原報告此處下得太滿**
3. **導師區塊的 locked slots 確實可能產生硬鎖定效果**：若學習中心設定了固定時段，這些時段會透過 special-course lock 機制轉換為導師區塊的 locked slots

### 3.2 什麼情況下會感覺「鎖太死」

可能的真正原因：

1. **special-course locks 轉換為導師區塊 locked slots**：學習中心固定時段透過語意映射成為導師區塊的硬鎖定
2. **co-planning 下午區塊 penalty 過高**：若 `WEIGHT_REGISTRY.get("grade_co_planning_afternoon_block", 2500)` 的權重太高，會強迫導師區塊集中在下午特定區塊
3. **manual_locks 與導師區塊交互**：若 manual locks 佔用了大量下午時段，導師區塊的可排空間會被壓縮
4. **總節數壓力**：六年級若學習中心節數多，合併後導師區塊總節數大，在有限時段內確實可能產生排課壓力

### 3.3 舊診斷工具的問題

`diagnose_infeasible_v2.py` 等診斷腳本可能：

1. 在**preprocess 前**的 payload 層級分析學習中心課程
2. 假設學習中心有獨立時段約束
3. 這種分析與正式 solver 實際行為不一致

**Rev1 修正結論**：「學習中心把導師區塊鎖太死」這個說法，**並非完全誤判**。正確的理解是：學習中心固定時段在 preprocess 後不再以原始科目（如國語/數學）獨立存在，但會透過 `special_course_locks -> effective subject = 導師區塊` 的路徑，以 locked slots 的形式影響 solver。因此它確實可能產生時段鎖定效果，只是約束的語意已從原始科目轉換為導師區塊層級。

---

## 4. teacher.grade Impact Check

### 4.1 `teacher.grade` 哪裡出現

`teacher.grade` 出現在以下地方：

1. **前端 CSV 匯入** (`src/components/CsvImport.vue`)：CSV 匯入時可能帶入 `grade` 欄位
2. **前端 store** (`src/stores/schedule.js`)：教師資料載入/儲存時保留 `grade` 欄位
3. **payload teachers 陣列**：前端組裝 payload 時，`teacher.grade` 會一併送出

### 4.2 `teacher.grade` 哪裡被讀取

**前端**：

- `scratch_check_teacher_grade.py` 顯示有檢查 `t.get("grade")` 的腳本
- 但前端主要邏輯**沒有使用** `teacher.grade` 做排課判斷

**後端**：

經過對 `solver.py`、`constraints/*.py`、`preprocessor.py`、`phase2_engine.py`、`repair_agent.py` 的完整搜尋：

**正式 solver 從未讀取 `teacher.grade`。**

Solver 從 `teachers_data` 讀取的欄位：

- `t_data.get("name")` — 教師姓名（用於匹配）
- `t_data.get("_safe_max_quota")` — 配額上限（由 `apply_teacher_quota` 計算後寫入）
- `t_data.get("unavailable_slots")` — 不排課時段
- `t_data.get("base_periods")` / `t_data.get("max_periods")` — 配額基礎

**`teacher.grade` 不在上述任何一個讀取點。**

### 4.3 `teacher.grade` 哪裡未被讀取

| 模組                           | 是否讀取 `teacher.grade` |
| ------------------------------ | ------------------------ |
| `solver.py`                    | ❌ 否                    |
| `constraints/base_rules.py`    | ❌ 否                    |
| `constraints/teacher_rules.py` | ❌ 否                    |
| `constraints/class_rules.py`   | ❌ 否                    |
| `constraints/special_rules.py` | ❌ 否                    |
| `preprocessor.py`              | ❌ 否                    |
| `phase2_engine.py`             | ❌ 否                    |
| `repair_agent.py`              | ❌ 否                    |

### 4.4 `teacher.grade` 是否影響正式排課

**結論：`teacher.grade` 是匯入殘值（import residual），不影響正式 solver 判斷。**

- 它可能從 CSV 匯入時帶入
- 它會經過 payload 傳遞到後端
- 但 solver 的整個約束系統從未讀取它
- 它對排課結果**零影響**

---

## 5. gradePreferences Mapping and Runtime Behavior

### 5.1 CSV 匯入對應關係

**CSV 標頭** → **前端欄位** 的映射（`src/components/CsvImport.vue`）：

```
CSV 標頭                    → 前端欄位
────────────────────────────────────────
志願1 (年級) / 志願1年級   → pref_grade1Raw → pref_grade1
志願2 (年級) / 志願2年級   → pref_grade2Raw → pref_grade2
志願3 (年級) / 志願3年級   → pref_grade3Raw → pref_grade3
```

解析後寫入 `gradePreferences` 陣列：

```javascript
gradePreferences: [
  ...(pref_grade1 && pref_grade1 >= 1 && pref_grade1 <= 6 ? [pref_grade1] : []),
  ...(pref_grade2 && pref_grade2 >= 1 && pref_grade2 <= 6 ? [pref_grade2] : []),
  ...(pref_grade3 && pref_grade3 >= 1 && pref_grade3 <= 6 ? [pref_grade3] : []),
]
```

**映射正確**：CSV 的志願1/2/3 正確映射為 `gradePreferences` 陣列。

### 5.2 前端自動配課使用點

`src/components/SubjectAssignmentForm.vue` 的 `smartSubjectAssignment()`：

```javascript
function getGradePreferenceRank(teacher, grade) {
  const pref1 = teacher.pref_grade1 ?? teacher.gradePreferences?.[0] ?? null
  const pref2 = teacher.pref_grade2 ?? teacher.gradePreferences?.[1] ?? null
  const pref3 = teacher.pref_grade3 ?? teacher.gradePreferences?.[2] ?? null

  if (pref1 !== null && Number(pref1) === Number(grade)) return 1
  if (pref2 !== null && Number(pref2) === Number(grade)) return 2
  if (pref3 !== null && Number(pref3) === Number(grade)) return 3
  return 4
}

// 排序：志願序優先 → 負載平衡 → 姓名穩定排序
candidates.sort((a, b) => {
  const rankA = getGradePreferenceRank(a, grade)
  const rankB = getGradePreferenceRank(b, grade)
  if (rankA !== rankB) return rankA - rankB
  // ... load balance tie-break
})
```

**前端自動配課確實使用 `gradePreferences`**：志願序優先，同志願序時負載平衡。

### 5.3 正式 solver 是否使用 `teacher.gradePreferences`

**正式 solver 不使用 `teacher.gradePreferences`。**

Solver 中使用 `gradePreferences` 的地方：

1. **`constraints/class_rules.py`** — `room.get("gradePreferences")`：這是**教室**的優先年級，不是教師的
2. **`solver.py`** — `room.get("gradePreferences")`：同上，教室層級
3. **`repair_agent.py`** — `room.get("gradePreferences")`：同上

**`teacher.gradePreferences` 在 solver 中完全未被讀取。**

### 5.4 科任年級偏好排課是否真的在實務流程中生效

**分兩層回答**：

| 層級             | 是否使用 `gradePreferences` | 說明                                      |
| ---------------- | --------------------------- | ----------------------------------------- |
| **前端自動配課** | ✅ 是                       | `smartSubjectAssignment()` 使用志願序排序 |
| **正式 solver**  | ❌ 否                       | solver 不讀取 `teacher.gradePreferences`  |

**實務流程**：

1. 使用者在前端點擊「全校科任智慧自動配課」
2. `smartSubjectAssignment()` 根據 `gradePreferences` 志願序分配教師到科目
3. 分配結果寫入 `course_requirements[].teacher`
4. Payload 送出後，solver 只看到「誰教什麼」，不再考慮志願序
5. Solver 的排課只關心硬約束（衝堂、配額、不排課時段、特殊課程鎖定）

**結論：科任年級偏好排課在前端配課階段確實運作，但正式 solver 階段不再參考志願序。這是一個兩階段流程：前端配課（考慮志願）→ solver 排課（只考慮硬約束）。**

---

## 6. Whether Subject-Teacher Grade Preference Scheduling Is Actually Working

### 6.1 前端配課層級

**運作正常。** `smartSubjectAssignment()` 的排序邏輯：

1. 過濾掉導師 (`type === 'homeroom'`)
2. 過濾掉配額不足的教師
3. 按志願序排序（志願1 > 志願2 > 志願3 > 無志願）
4. 同志願序時按目前負載排序（負載低優先）
5. 同負載時按姓名穩定排序

### 6.2 Solver 層級

**不參考志願序。** Solver 只消費：

- `teacher.name` — 匹配教師
- `teacher._safe_max_quota` — 配額上限
- `teacher.unavailable_slots` — 不排課時段

### 6.3 教室層級的 `gradePreferences`

**這是不同的東西。** `room.gradePreferences` 是專科教室的優先年級設定，在 solver 中作為 soft penalty 使用（`constraints/class_rules.py` 的 grade affinity penalty）。這與教師的 `gradePreferences` 無關。

---

## 7. Final Mainline Conclusion

### 7.1 四題主線結論摘要

| #   | 問題                             | 結論                                                                                                                                                                                                                                      |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 學習中心抽離是否把導師區塊鎖太死 | **部分成立**。preprocess 後學習中心合併為導師區塊的一部分，但透過 `special_course_locks` 路徑仍以 locked slots 形式影響 solver。感覺「鎖太死」的真正原因可能是 special-course lock 轉換、co-planning penalty 過高或 manual_locks 交互壓力 |
| 2   | 六年級學習中心固定時段的角色     | **以轉換後語意繼續發揮約束作用**。學習中心固定時段不再以原始科目獨立存在，但透過 `special_course_locks -> effective subject = 導師區塊` 的路徑影響 solver                                                                                 |
| 3   | `teacher.grade` 是否影響排課     | **完全不影響**。`teacher.grade` 是匯入殘值，solver 的整個約束系統從未讀取它                                                                                                                                                               |
| 4   | `gradePreferences` 映射與運作    | **CSV 映射正確，前端配課運作正常，但 solver 不參考**。志願序只在前端 `smartSubjectAssignment()` 生效                                                                                                                                      |

### 7.2 原始主線最穩的正式結論（Rev1 修正）

1. **「學習中心抽離課程把導師區塊鎖太死」這個原始診斷在正式 solver 語意下需要精確化。** 學習中心課程在 preprocess 階段被合併進導師區塊後，不再作為原始科目（如國語/數學）的獨立約束存在。但透過 `apply_special_course_locks(...)` 與 `resolve_effective_special_course_subject(...)` 的路徑，學習中心固定時段仍以「導師區塊的 special-course lock」形式影響 solver。因此不能說它在 solver 中完全沒有約束角色，只能說它的作用語意已從原始科目轉換為導師區塊層級。

2. **`teacher.grade` 是無效欄位。** 它從 CSV 匯入帶入，經過 payload 傳遞，但 solver 完全忽略它。任何基於 `teacher.grade` 的排課判斷都是錯誤的。

3. **`gradePreferences` 只在前端配課階段生效。** 這是一個兩階段流程：前端根據志願序分配教師 → solver 根據硬約束排課。Solver 不參考教師志願序。

4. **如果排課結果不理想（INFEASIBLE 或品質差），原因可能包含：**
   - 學習中心固定時段透過 special-course lock 轉換為導師區塊 locked slots 產生的時段壓力
   - co-planning penalty 權重是否過高
   - manual_locks 是否佔用過多時段
   - 專科教室容量是否不足
   - 教師配額是否合理

### 7.3 證據鏈

| 主張                                                  | 證據位置                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 學習中心合併進導師區塊                                | `preprocessor.py` L250-381 `_homeroom_blockization()`                                                |
| 學習中心固定時段透過 special-course locks 影響 solver | `solver.py` — `apply_special_course_locks(...)` 與 `resolve_effective_special_course_subject(...)`   |
| solver 不讀取 `teacher.grade`                         | `solver.py`、`constraints/*.py` 完整搜尋結果                                                         |
| solver 讀取的 teacher 欄位                            | `solver.py` — `t_data.get("name")`, `"_safe_max_quota"`, `"unavailable_slots"`                       |
| `gradePreferences` CSV 映射                           | `src/components/CsvImport.vue`                                                                       |
| 前端配課使用志願序                                    | `src/components/SubjectAssignmentForm.vue` L378-426 `getGradePreferenceRank()` / `findBestTeacher()` |
| solver 不參考 `teacher.gradePreferences`              | `constraints/class_rules.py` 只讀 `room.get("gradePreferences")`                                     |

---

**報告結束。本報告嚴格聚焦原始主線4題，未涉及 room-conflict / 美勞 / 音樂支線。**

---

### Rev1 修正摘要

本次修正只針對「學習中心固定時段」與「導師區塊」關係的表述：

- **原表述問題**：原報告說「六年級學習中心固定時段在正式 solver 中不扮演獨立約束角色」、「solver 看不到學習中心固定在某時段」、「不存在 solver 層級的鎖定問題」——這些說法下得太滿
- **修正後**：學習中心固定時段不是完全消失，而是透過 `special_course_locks -> resolve_effective_special_course_subject -> 導師區塊` 的路徑，以 locked slots 的形式繼續影響 solver。因此不能說它在 solver 中完全沒有約束角色，只能說它的作用語意已從原始科目轉換為導師區塊層級。
