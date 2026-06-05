# 📖 某某國小智慧排課系統 - 資料字典與架構對照表 (Data Dictionary)

本文件紀錄了系統中 Vue 3 (前端)、Node.js (中介 API)、SQLite (資料庫) 與 Python (排課引擎) 之間的核心變數命名、資料流動與型別轉換規則。

---

## 🏗️ 1. 系統架構與資料流概覽

系統採用「前端全域狀態驅動，後端批量落地」的架構，並透過獨立的 Python 行程處理高算力排課。

* **🔄 基礎資料儲存流：**
  `前端 Pinia (schedule.js)` ➔ `POST /api/save-all` ➔ `server.js` ➔ `Prisma (dev.db)`
* **🧠 智慧排課任務流：**
  `前端發起` ➔ `POST /api/schedule` ➔ `server.js 產生 Job` ➔ `Python solver.py` ➔ `輸出 output.json` ➔ `前端 GET /api/schedule/:jobId` 輪詢結果
* **🧑‍🏫 人機協作編輯流 (TimetableEditorView)：**
  `AI 產出含「導師區塊」的骨架課表` ➔ `導師登入 (Google OAuth)` ➔ `從「背包」點選剩餘科目` ➔ `點擊「導師區塊」填寫血肉` ➔ `即時觸發 syncToCloud 儲存`

---

## 🗄️ 2. 資料庫 Schema 對照表 (Prisma)

以下為 SQLite 中定義的 7 個核心 Prisma Models 欄位：

| Model 名稱 | 說明 | 核心欄位與型別定義 |
| :--- | :--- | :--- |
| **`Teacher`** | 教師基本資料與排課條件 | `id` (Int, PK), `name` (String, @unique), **`google_account` (String?)**, `type` (String), `max_periods` (Int?), `reduction` (Int, default 0), `overtime` (Int, default 0), `expertise` (String? / JSON), `unavailable_slots` (String? / JSON) |
| **`Class`** | 班級資料與課表結果 | `id` (Int, PK, autoincrement), `name` (String, @unique), `grade` (Int), `timetable` (String? / JSON), `homeroom_teacher_id` (Int?, @unique FK) |
| **`CourseRequirement`** | 班級配課需求 (一對多) | `id` (Int, PK, autoincrement), `class_id` (Int, FK), `subject` (String), `periods` (Int), `teacher_name` (String?), `defaultTeacher` (String) |
| **`Classroom`** | 專科教室與教學空間 | `id` (Int, PK, autoincrement), `name` (String, @unique), `subject` (String?), `primaryTeacher` (String?), `allowSharing` (Boolean, default true) |
| **`SpecialCourse`** | 特殊課程與綁定時段 | `id` (Int, PK, autoincrement), `type` (String), `name` (String), `targetSubject` (String?), `teacher` (String?), `targetClasses` (String? / JSON), `lockedSlots` (String? / JSON), `isAutoTime` (Boolean), `isAutoClass` (Boolean), `autoClassConfig` (String? / JSON) |
| **`SystemSetting`** | 全校全域參數與矩陣 | `id` (Int, PK), `academic_year` (String), `semester` (String), `grade_settings` (String/JSON), `period_defaults` (String/JSON), `alternative_matrix` (String/JSON), `standard_domain_settings` (String/JSON), `class_exceptions` (String/JSON), **`ai_settings` (String/JSON)** |
| **`ScheduleJob`** | 非同步排課任務追蹤 | `id` (String, PK), `status` (String), `payload` (String/JSON), `result` (String/JSON), `createdAt`, `updatedAt` |

---

## 📦 3. 前端 Pinia Store 狀態對照 (`schedule.js`)

前端採用單一資料源 (Single Source of Truth)，所有核心資料均由 `useScheduleStore` 管理。

### 核心 State (狀態)
* `schoolInfo`：全校設定（包含學期、年級時數設定、`classExceptions` 班級例外）。
* `teachers` (Array)：全校教師名冊與禁排時段陣列。
* `classes` (Array)：全校班級設定，內含 `course_requirements` 與 `timetable`。
* `specialCourses` (Array)：全校特殊課程/抽離課程設定。
* `classrooms` (Array)：全校專科教室與主場教師設定。
* `standardDomainSettings`：108 課綱預設領域節數與顏色對應表。
* `syncStatus` (String)：當前與資料庫的同步狀態 (`'saved'` | `'unsaved'` | `'saving'`)。
* **`aiSettings` (Object)**：演算法硬約束控制開關 (包含自然連堂、下午禁排、游泳池容量限制等)。

### 核心 Computed (計算屬性)
* `teacherQuotas`：即時運算全校教師的 **配額健康度**（`base - reduction + overtime - used`）。
* `allAvailableSubjects`：將標準領域與自訂替換矩陣合併的可用科目清單。

### 核心 Methods (操作方法)
* `loadFromDB()`：初始化讀取，包含安全解析 JSON 字串的防彈裝甲。
* `syncToCloud()`：將所有 State 打包成 Payload 送至 `POST /api/save-all` 進行全面覆寫。
* `checkQuotaExceed(teacherName, periods)`：全域檢核該教師配額是否超載的 API。
* **`buildHomeroomBlockMap()`**：導師課區塊化預處理函數，將導師各科目整合為單一總節數區段。此資料作為 `TimetableEditorView` 中「待排科目背包」的資料來源。

---

## 🔗 4. 核心名詞統一表 (跨層對照)

系統中某些概念在不同語言層會以不同變數名稱或型態出現，開發時需嚴格對照此表：

| 業務概念 | 前端 Vue / Pinia | 後端 Node.js / API | 資料庫 SQLite (Prisma) | Python 演算法 |
| :--- | :--- | :--- | :--- | :--- |
| **禁排時段** | `teacher.unavailable_slots`<br>*(Array)* | `req.body.teachers[].unavailable_slots` | `Teacher.unavailable_slots`<br>*(Stringified JSON)* | `t_data["unavailable_slots"]`<br>*(List，支援兩種格式)* |
| **教師總配額** | `teacher.max_periods` +<br>`reduction`/`overtime` | `t.max_periods` | `Teacher.max_periods`<br>`reduction`<br>`overtime` | `t_data["max_periods"]`<br>*(Integer)* |
| **班級課表** | `class.timetable`<br>*(Object {day: {period: ...}})* | `cls.timetable` | `Class.timetable`<br>*(Stringified JSON)* | `schedule[(c, p, t, s)]`<br>*(OR-Tools BoolVar)* |
| **AI 硬約束設定** | `aiSettings`<br>*(Object)* | `req.body.aiSettings` | `SystemSetting.ai_settings`<br>*(Stringified JSON)* | `ai_settings`<br>*(Dict, 用於控制條件分支)* |
| **導師課區塊** | `buildHomeroomBlockMap()`<br>*(Object Map)* | 排課前預處理 Payload | 未直接存入 DB | 作為「單一總節數」處理<br>*(減輕演算法負載)* |
| **待排科目背包** | `backpackItems`<br>*(Computed Array)* | - | - | 前端編輯器填入畫布的來源 |
| **自動游泳引擎** | `aiSettings.swimmingCapEnabled` | `req.body.aiSettings` | `SystemSetting.ai_settings` | 自動從 4-6 年級抽取「1體育+1導師區塊」連堂，並受單時段 3 班限制。原 `體育 s` 手動 Hack 已廢除。 |
| **科任志願順序** | teacher.gradePreferences | - | Teacher.gradePreferences | 用於科任批次自動配課的三層優先級排序 (優先於剩餘節數)。 |

---

## 🌐 5. API Route 路由對照表 (`server.js`)

| HTTP Method | Route 路徑 | 負責功能 |
| :--- | :--- | :--- |
| **GET** | `/api/schedule` | 系統初始化，撈取所有 DB 資料 (`loadFromDB`)。 |
| **POST** | `/api/save-all` | 全局儲存，接收各項資料，執行 Prisma 事務進行覆寫。 |
| **PATCH** | `/api/teachers/:name` | 快速更新特定教師的減課 (`reduction`) 與超鐘點 (`overtime`) 欄位。 |
| **POST** | `/api/schedule` | 提交 AI 排課任務，建立 `ScheduleJob` 並啟動 Python Worker。 |
| **GET** | `/api/schedule/:jobId` | 前端輪詢用，檢查排課進度 (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`)。 |

---

## ⚠️ 6. 資料型別轉換與陷阱防護 (Critical Warnings)

因為 SQLite 原生不支援嚴格的 JSON 欄位型態，系統中大量使用了字串化儲存，開發時必須遵守以下防護規則：

1. **陣列/物件的讀取防彈衣 (`loadFromDB`)**
   當從資料庫讀取 `unavailable_slots`、`expertiseSubjects` 等 JSON 時，**必須**使用 `typeof data === 'string'` 進行檢查，並包裹在 `try...catch` 中執行 `JSON.parse()`。若解析失敗，必須提供合法的空陣列 `[]` 或空物件 `{}` 作為 Fallback。
   
2. **小數點節數的處理 (`solver.py` 支援浮點數)**
   台灣國小排課有「1.5節 (音樂/美勞)」的特例。`solver.py` 會**直接讀取浮點數 (`1.5`)**，無需前端提前轉為整數。排定回傳後，前端再於 `ScheduleView.vue` 攔截解析，將其合併渲染為單雙週課程。

3. **主鍵型別陷阱 (`String` vs `Int`)**
   資料庫產生的 ID 為 `Int` (如 `19`)，前端本地產生的 ID 通常為 `String` (如 `Date.now().toString()`)。在進行比對時，**務必使用 `String(id)` 強制轉型**，避免因型別不符導致無法刪除或更新。

 4. **特殊標籤的保留防護 (生活與游泳) 🚨**
     在 `solver.py` 將導師科目壓縮成「導師區塊」的預處理階段，**必須明確排除 `生活` 與 `游泳`** (游泳課已由自動游泳引擎 `aiSettings.swimmingCapEnabled` 處理，不再依賴手動 `體育 s` 標籤)。若盲目吞併，將導致 [硬約束 7] (低年級生活課綁定) 與 [硬約束 12] (游泳課湊班限制) 無法找到對應變數而發生嚴重錯誤！

---

## 📥 7. CSV 教師匯入格式規範 (`CsvImport.vue`)

系統提供 CSV 批次匯入教師名單功能，位於 `TeachersView.vue` 中。以下是 CSV 檔案格式與欄位對照說明：

### CSV 欄位定義

| 欄位序號 | 欄位名稱 | 說明 | 允許值 | 範例 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 姓名 | 教師姓名 | 任意字串 | `王大明` |
| 2 | 職務別 | 教師類型 | `導師`、`科任`、`行政`、`特教` | `導師` |
| 3 | 每週節數 | 教師每週可排課程節數 | 整數 | `17` |
| 4 | 職位 | 教師職位描述 | 任意字串 | `一年一班導師` |
| 5 | 帶領班級 | 教師所帶領的班級（僅導師需要填寫） | 3 位數字班級碼（如 `101`）或完整格式（如 `1年1班`） | `101` |
| 6 | 專長科目 | 教師專長的科目（多個科目用 `/`、`,`、`、` 分隔） | 任意字串 | `自然/健康` |
| 7 | 志願1 (年級) | 第一志願年級 | 1-6 的整數 | `5` |
| 8 | 志願2 (年級) | 第二志願年級 | 1-6 的整數 | `6` |
| 9 | 志願3 (年級) | 第三志願年級 | 1-6 的整數 | `4` |

### 職務別對應關係

| CSV 值 | 內部型別 | 說明 |
| :--- | :--- | :--- |
| `導師` | `homeroom` | 導師，可綁定班級 |
| `行政` | `admin` | 行政人員 |
| `科任` | `subject` | 科任教師 |
| `特教` | `subject` | 特教教師（與科任同型別） |

### 班級名稱匹配規則

系統支援智慧匹配班級名稱：

1. **直接匹配**：CSV 中的班級名稱與系統中的班級名稱完全一致
2. **數字碼轉換**：3 位數字碼（如 `101`）會轉換為完整格式（如 `1年1班`）再匹配
3. **完整格式轉換**：完整格式（如 `1年1班`）會轉換為數字碼（如 `101`）再匹配
4. **自動建立班級**：如果找不到對應班級，會自動建立新班級並綁定導師

### CSV 範例格式

```csv
姓名,職務別,每週節數,職位,帶領班級,專長科目,志願1 (年級),志願2 (年級),志願3 (年級)
王大明,導師,17,一年一班導師,101,,,,
李佳玲,導師,17,一年二班導師,102,,,,
李小華,科任,20,高年級自然專任教師,,自然/健康,5,6,4
```

### 注意事項

1. CSV 檔案必須包含 BOM (`\uFEFF`) 以支援中文編碼
2. 导师的「帶領班級」欄位為空時，不會進行班級綁定
3. 科任教師的「帶領班級」欄位通常留空
4. 專長科目可使用 `/`、`,`、`、` 等多種分隔符號
5. 志願年級欄位可留空，不填寫代表無志願偏好
