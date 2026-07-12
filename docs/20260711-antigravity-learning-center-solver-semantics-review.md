# 學習中心固定時段在正式 solver 作用語意核對報告

## 1. Scope

本報告專注於核對「學習中心固定時段」從 payload 進入 preprocess、再進入 formal solver 約束（`apply_special_course_locks`）的完整語意鏈，釐清其究竟在 OR-Tools 模型中扮演什麼角色。本報告不涉及教師配額、gradePreferences 或其他支線問題。

## 2. Preprocess-Before Shape

在 payload 剛進入系統時：

- **原始型態與典型欄位**：學習中心會對應到班級 `classes[].course_requirements` 中的原始科目，如「語文-國語」或「數學」。其典型欄位包含 `subject` (如 "語文-國語"), `periods` (節數), `defaultTeacher`, `teacher_name` 等。
- **角色定義**：
  - `subject`：標示原始學科（例如國語）。
  - `defaultTeacher`：標記為 `"homeroom"`，表示此為導師自授科目。
  - `teacher_name`：班級導師姓名（例如六年級的王美惠）。

## 3. Homeroom Blockization Trace Semantics

在 `preprocessor._homeroom_blockization` 的處理中：

- **處理邏輯**：系統會掃描班級的 `course_requirements`。只要 `defaultTeacher == "homeroom"` 且科目不是「生活」、「游泳」、「體育」，該科目就會被抽離，其節數被累加，然後合併成單一的「導師區塊」(`subject="導師區塊"`)。
- **Trace 保留機制**：合併後，原始科目資訊會被寫入 `metadata["homeroomBlockizationTrace"]` 的 `mergedSubjects` 陣列中。
- **六年級學習中心案例語意**：以 6年7班/6年11班 王美惠老師為例，其「語文-國語」或「數學」因為是導師自授，會被整併進「導師區塊」。在 `homeroomBlockizationTrace` 中，該班的 trace entry 會明確記錄 `mergedSubjects` 包含了「語文-國語」與「數學」，而在班級實體的 `course_requirements` 中，這些科目已被抹除，只剩下總量變大的「導師區塊」。

## 4. Special Course Lock Mapping to Homeroom Block

當進入 OR-Tools 建模，呼叫 `constraints.teacher_rules.apply_special_course_locks` 時：

- **`resolve_effective_special_course_subject()` 的角色**：這個 helper 負責把特教/學習中心課程的原始 `targetSubject`，動態映射到 schedule dict 實際存在的科目上。
- **metadata 的應用**：該函數會讀取 `preprocess_metadata` 中的 `homeroomBlockizationTrace`。如果發現學習中心要求的 `targetSubject`（例如「語文-國語」）存在於該班級 trace 的 `mergedSubjects` 裡，就會攔截並將其轉換。
- **映射結果**：原始的 `targetSubject`（如「語文-國語」）會被轉變成 `effective subject = "導師區塊"`，回傳給 `apply_special_course_locks` 使用。

## 5. Formal Solver Constraint Semantics

在 formal solver 中，學習中心的固定時段形成的作用如下：

- solver **已經看不到** 原始「國語/數學」型態的學習中心科目。因為在建立 schedule boolean 變數時，這些科目已經被合併成導師區塊。
- 然而，solver **確實會對 `導師區塊` 施加來自 special course 的鎖定壓力**。在 `apply_special_course_locks` 中，會生成 `sum(class_p_subj_vars) >= sub_event_vars[p]` 的約束。因為 `effective_subj` 被映射為「導師區塊」，這裡的 `class_p_subj_vars` 抓取的正是導師區塊的排課變數。
- **最終判定**：它是 **導師區塊時段壓力** 的具體展現，更精確地說，是一種 **轉換語意的強制約束**。只要學習中心在某個時段發生（包含 fixed locked slots），該班的「導師區塊」就必須被強制排在同一個時段。

## 6. Final Judgment

**學習中心固定時段在正式 solver 中，不是原始科目（如國語/數學）的獨立約束，而是透過語意映射，轉化為對『導師區塊』的強制同步排課與時段鎖定壓力。**
