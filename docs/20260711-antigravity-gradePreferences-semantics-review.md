# gradePreferences 系統語意與資料路徑核對報告

## 1. Scope

本次調查聚焦於系統中 `gradePreferences` (以及其衍生或舊有變體 `pref_grade`) 欄位的資料生命週期。核對範圍包含：

- 教師名單 CSV 匯入時的欄位映射與解析 (`CsvImport.vue`)。
- 前端全校科任智慧自動配課時的實際讀取邏輯 (`SubjectAssignmentForm.vue`)。
- 實際送往後端的 payload 資料結構 (`debug_payload.json`)。
- 後端演算法（`solver.py`, `preprocessor.py`, `repair_agent.py`）是否讀取並應用該欄位。
- 教師 (Teacher) 與專科教室 (Room) 兩者身上 `gradePreferences` 欄位的語意區分。

## 2. CSV Mapping Path

**證據來源**：`src/components/CsvImport.vue`
在解析 CSV 時，系統會讀取 `志願1`、`志願2`、`志願3` 等欄位。
但系統的映射方式並不乾淨。它會**同時**在教師物件上建立兩種欄位：

1. `pref_grade1`, `pref_grade2`, `pref_grade3` (獨立的整數欄位)
2. `gradePreferences` (由上述三個值組合而成的陣列)

程式碼片段：

```javascript
// CsvImport.vue
gradePreferences: [
  ...(pref_grade1 && pref_grade1 >= 1 && pref_grade1 <= 6 ? [pref_grade1] : []),
  // ...
],
pref_grade1,
pref_grade2,
pref_grade3,
```

這導致同一份意圖（教師志願序）在前端 Store 裡被冗餘儲存了兩套格式。

## 3. Frontend Field Usage

**證據來源**：`src/components/SubjectAssignmentForm.vue`
在執行「全校科任智慧自動配課」(`smartSubjectAssignment`) 時，系統需要為班級找出最適合的科任老師。
在排序與配對優先級的函式 `getGradePreferenceRank` 中，實際的讀取邏輯如下：

```javascript
function getGradePreferenceRank(teacher, grade) {
  const pref1 = teacher.pref_grade1 ?? teacher.gradePreferences?.[0] ?? null
  const pref2 = teacher.pref_grade2 ?? teacher.gradePreferences?.[1] ?? null
  const pref3 = teacher.pref_grade3 ?? teacher.gradePreferences?.[2] ?? null
  // ...
}
```

**結論**：前端自動配課時，**高度混用了這兩組欄位**。它優先讀取舊版的 `pref_grade1`，若無值才 fallback 去讀取陣列版的 `gradePreferences`，顯示前端狀態中存在語意遺留與邊界不清的問題。

## 4. Payload Field Shape

**證據來源**：`debug_payload.json`
當資料被打包成 payload 送給 Python 後端時，觀察 `teachers` 陣列中的物件：

```json
{
  "id": 100661,
  "name": "廖尉淵",
  "type": "subject",
  "gradePreferences": [6],
  "expertiseSubjects": ["自然科學"]
  // ... 沒有 pref_grade1 等欄位
}
```

**結論**：Payload 確實保留了 `teacher.gradePreferences` (陣列格式)，但 `pref_grade1/2/3` 這組 flat 欄位並沒有被送進後端。這表示 `pref_grade` 純粹是前端的暫時狀態與技術債。

## 5. Backend / Solver Read Boundary

**證據來源**：`solver.py`, `preprocessor.py`, `phase2_engine.py`, `repair_agent.py` 等
在後端原始碼中，對 `gradePreferences` 的存取極度頻繁，**但全部都是針對 Room (專科教室)**。
例如在 `solver.py` 中：

```python
gp = room.get("gradePreferences", []) or []
```

我們透過全域檢索與追蹤，**確認後端沒有任何一行程式碼讀取 `teacher.get("gradePreferences")` 或 `teacher["gradePreferences"]`**。
**結論**：Solver / constraints / phase2 / repair 路徑**完全不讀** `teacher.gradePreferences`。對於後端排課引擎而言，教師的年級志願序是不存在的；教師配課是前端在產生 course_requirements 時就決定好的（透過前端的 smart assign），後端只負責把「已經指派好教師的課程」排入課表。

## 6. Teacher vs Room gradePreferences Distinction

這個系統中，同一個欄位名稱 `gradePreferences` 發生了嚴重的領域模型碰撞與語意分歧：

- **`teacher.gradePreferences`**：
  - **語意**：教師「希望教哪幾個年級」的志願序。
  - **作用邊界**：僅存在於前端。用於 `SubjectAssignmentForm.vue` 幫科任老師自動關聯班級時的配對優先度計算。
  - **後端狀態**：存在於 Payload 中，但被 Solver 徹底無視。
- **`room.gradePreferences`**：
  - **語意**：專科教室「優先讓哪個年級使用」的硬性/軟性約束（Affinity）。
  - **作用邊界**：由後端 Solver 深度依賴。用於計算 `GRADE_AFFINITY_MISS_PENALTY`，懲罰那些不符合年級優先權的排課安排。
  - **前端狀態**：在 `ClassroomManagerView.vue` 中不僅有陣列版，還有一個 `gradePreferencesRaw` (例如 `"shared"` 或單一數字字串) 來輔助 UI 綁定。

## 7. Final Judgment

「`gradePreferences` 在本系統中，是一個高度混亂的欄位。」

同一個欄位名稱在 Teacher 與 Room 身上代表了截然不同的商業邏輯，且前後端使用邊界斷裂（教師版只在前端用，專科教室版只在後端用）；同時，前端還殘留著 `pref_grade` 的多欄位 fallback 讀取邏輯。這種語意重載與資料路徑的不一致，非常容易在後續修改中引發嚴重 Bug。
