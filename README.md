# 🏫 國小智慧排課系統 (Primary School Smart Scheduling System)

國小智慧排課系統是一個面向台灣國小排課情境的智慧排課與課表編排平台。系統以前端資料設定、Node.js API、SQLite/Prisma 資料層，以及 Python OR-Tools CP-SAT 求解器為核心，支援全校排課、自動求解、人工微調與多格式課表匯出。

![Vue](https://img.shields.io/badge/Frontend-Vue%203-42b883.svg)
![Vite](https://img.shields.io/badge/Build-Vite%208-646cff.svg)
![Express](https://img.shields.io/badge/Backend-Express%205-black.svg)
![Prisma](https://img.shields.io/badge/ORM-Prisma%207-2D3748.svg)
![SQLite](https://img.shields.io/badge/Database-SQLite-003B57.svg)
![Python](https://img.shields.io/badge/Solver-Python%203.9%2B-3776AB.svg)
![OR-Tools](https://img.shields.io/badge/Engine-OR--Tools_CP--SAT-f4b400.svg)
![License](https://img.shields.io/badge/License-AGPL--3.0-red.svg)

> 本倉庫是公開版工作目錄，只保留允許公開的程式碼、文件與測試。
> 私人開發工作區中的本機資料庫、debug payload、未公開筆記與其他敏感內容不會同步到這裡。
> 公開同步規則請參考 [PUBLIC_REPO_INDEX.md](./PUBLIC_REPO_INDEX.md) 與 [public-repo.manifest.json](./public-repo.manifest.json)。

## ⚠️ 實驗性質警語

本軟體目前仍屬實驗性質，演算法與功能尚在持續更新與驗證中。由於排課條件十分複雜，且每新增一項個人要求，都可能影響既有約束並造成原有演算法失效或排課失敗，因此請勿將目前的排課結果視為絕對正確。建議搭配 Gemini 3.5、GPT-5.5 等模型進行根因分析，協助釐清衝突條件與改善排課設定。

---

## 🛠️ 核心技術棧 (Technology Stack)

| 分層 | 技術 | 說明 |
| :--- | :--- | :--- |
| 前端 UI | Vue 3 + Vite | 採用 Composition API 與 Vue Router 建立操作介面 |
| 狀態管理 | Pinia | 由 `useScheduleStore` 管理全校設定、教師、班級與排課任務狀態 |
| 後端 API | Express.js (Node.js) | 提供 REST API，並透過 `child_process.spawn` 橋接 Python 求解器 |
| 資料庫 & ORM | SQLite + Prisma ORM | 使用 Prisma 管理本機資料結構與持久化 |
| 排課引擎 | Python + OR-Tools CP-SAT | 處理硬約束、群組規則、資源容量與教師負載 |
| 後處理優化 | Python | 透過 `repair_agent.py` 做求解後調整與修補 |
| 報表匯出 | XLSX / DOCX | 匯出班級課表、教師彙整表與專科教室課表 |

---

## 📂 專案結構 (Project Structure)

```text
repository-root/
├── src/                         # Vue 前端程式碼
│   ├── components/              # 共用元件
│   ├── composables/             # 組合式邏輯
│   ├── router/                  # 前端路由
│   ├── services/                # 前後端橋接與輔助服務
│   ├── stores/                  # Pinia store
│   ├── utils/                   # 匯出、衝突檢查、格式化等工具
│   └── views/                   # 主要頁面（班級、教師、排課、匯出、驗證等）
├── constraints/                 # Python 排課規則模組
├── prisma/                      # Prisma schema 與資料設定
├── public/                      # 靜態資源
├── docs/                        # 公開文件、資料字典、引擎說明與交付文件
├── tests/                       # 公開版測試案例
├── scripts/public-repo-sync.mjs # 公開版同步腳本
├── server.js                    # Express API 與 Python 橋接入口
├── solver.py                    # 主求解器
├── phase2_engine.py             # 第二階段特殊規則求解
├── preprocessor.py              # 求解前資料預處理
├── repair_agent.py              # 求解後修補代理
├── scheduler_policy.py          # 排課政策與規則輔助邏輯
├── config.py                    # Python 端全域常數
├── utils.py                     # Python 共用工具
├── requirements.txt             # Python 依賴
├── package.json                 # Node.js 腳本與依賴
├── PUBLIC_REPO_INDEX.md         # 公開倉庫同步規則說明
└── public-repo.manifest.json    # 公開檔案 allowlist 清單
```

---

## 🧠 核心能力 (Core Capabilities)

1. 全校資料建模
   支援教師、班級、課程需求、專科教室、特殊課程與全校系統設定。
2. 智慧排課求解
   使用 OR-Tools CP-SAT 處理班級節數、教師配額、抽離課群組、專科教室與游泳池等資源限制。
3. 人工協作調整
   提供課表編輯器、衝突提示、手動預排與求解結果套用流程。
4. 匯出與交付
   支援 XLSX / DOCX 報表輸出，涵蓋班級、教師與教室視角。
5. 公開版同步治理
   透過 manifest allowlist 控制哪些檔案可以同步到公開 repo，避免私人資料誤上傳。

---

## 🧭 排課原則與年級同步規則

系統以「先確保可執行與可追溯，再共同最佳化品質」為原則。使用者設定的規則會先經前端即時檢查與後端權威 Preflight；確認存在的矛盾不會送入求解器，避免人工設定直接造成全校排課失敗。

| 層級 | 用途與行為 |
| :--- | :--- |
| **Hard** | 保護明確不可違反的條件，例如固定年級時段、人工鎖定與已確認的衝突邊界。此類規則會限制可行解；發現明確矛盾時只能保留為停用草稿。 |
| **Near-Hard** | 用於「應盡可能達成」的共備偏好。每個未達成課點都使用完整權重計分，不因全校班級數而稀釋。 |
| **Soft** | 用於排課品質偏好；求解器會與其他品質目標一起權衡，必要時可違反並在診斷與 penalty breakdown 中呈現。 |

### 年級同步與共備

- `gradeTimeRulesSettings` 是年級同步與 5、6 年級共備的唯一正式設定來源；舊版 `coPlanningSettings` 僅作一次性遷移輸入，遷移成功後會移除，避免雙重套用。
- 共備快速設定保留 **自動選擇**與**手動指定**兩種方式；門檻分為 `prefer`、`at_least_90`、`all`。其中 `at_least_90` 與 `all` 是硬性達成門檻，不會被降格為一般 Soft penalty。
- 一般年級規則可指定年級、時段與條件（例如科目類別或教師類型），並可選擇 Hard、Near-Hard 或 Soft 強度。
- 紅色矛盾禁止啟用並會在 Solver 建模前再次攔截；黃色容量或品質風險需要在每次排課前由使用者確認。

### 既有排課品質偏好持續生效

年級同步／共備規則不會關閉、覆蓋或清零既有品質設定。以下兩項仍會依原設定建立並計分：

1. **體育課避免安排在第 4、5 節**（`pe_avoid_period_45`）。
2. **第 7 節優先安排校本／彈性課程**（`period7_flexible_preference`）。

若 Hard 年級規則剛好要求相反時段，系統會提出品質風險提示；Hard 規則仍界定可行解範圍，但上述品質 penalty 會保留於診斷結果中，而不會被悄悄忽略。

---

## 🖥️ 主要前端頁面 (Key UI Areas)

- `SetupWizardView`：初始化與基本設定流程
- `TeachersView` / `TeacherQuotaView`：教師資料與配額管理
- `ClassesView` / `ClassSettingsView`：班級與配課需求設定
- `SpecialCourseView`：特殊課程、抽離課與群組規則設定
- `ClassroomManagerView`：專科教室與空間資源管理
- `ScheduleView`：啟動排課與查看排課任務結果
- `TimetableEditorView`：套用結果後的人工微調與衝突檢查
- `ExportHubView`：報表匯出中心
- `DataValidationView`：資料檢查與錯誤提示
- `AiSettingsView`：AI / 求解器行為設定

---

## 📘 公開文件索引 (Public Documentation)

- [`docs/國小排課系統_使用者操作手冊_含圖片標註版.pdf`](./docs/國小排課系統_使用者操作手冊_含圖片標註版.pdf)：操作員使用手冊，含實際畫面截圖、紅框與箭頭標註
- [docs/DataDictionary.md](./docs/DataDictionary.md)：資料模型、命名規則與前後端資料流對照
- [docs/Scheduler_Engine_Overview.md](./docs/Scheduler_Engine_Overview.md)：排課引擎整體說明
- [docs/藝才班特規排課模組_使用說明手冊.md](./docs/藝才班特規排課模組_使用說明手冊.md)：特規排課模組使用手冊
- [PUBLIC_REPO_INDEX.md](./PUBLIC_REPO_INDEX.md)：公開版同步與分類規則

---

## 🚀 本地開發 (Local Development)

### 先決條件

| 元件 | 建議版本 |
| :--- | :--- |
| Node.js | `20.19.0` 以上，或 `22.12.0` 以上 |
| npm | 隨 Node.js 一起安裝 |
| Python | `3.9+` |
| 作業系統 | Windows 10/11 64-bit 或 Ubuntu 24.04+ |

注意事項：

1. `node_modules` 與 `venv` 不能跨作業系統共用。
2. 每次換平台或重建環境時，都要重新 `npm install` 與重建 Python 虛擬環境。
3. `dev.db` 不會隨 repo 提供；執行 Prisma 初始化後會在本機建立。

### 儲存裝置建議

- 本專案使用 `SQLite + Prisma`，本機資料會直接寫入 `dev.db`。
- 強烈建議將專案資料夾與資料庫檔案放在 `SSD`，不要放在機械式 `HDD`。
- 若可選擇，優先使用 `NVMe/PCIe SSD`；至少也應使用 `SATA SSD`。
- 若使用較慢的儲存裝置，可能出現存檔延遲、寫入鎖等待，或讓使用者體感成「慢半拍」。

### Windows 安裝步驟
1. 先安裝 PowerShell 7。
   - Windows 預設的 Windows PowerShell 在處理 UTF-8 檔案與終端機編碼時較容易出現亂碼或相容性問題。
   - 建議先安裝 PowerShell 7，再進行後續安裝與啟動步驟，以確保 UTF-8 檔案與指令執行更穩定。
2. 安裝 Node.js 20.19+ 或 22.12+。
3. 安裝 Python 3.9+，並確認 PowerShell 可以執行 `python --version`。
4. 在專案根目錄執行：

**💡 提示**：在 Windows 系統，強烈建議使用 `py` 取代 `python` 指令，以避免微軟商店 (Windows Store) 的路徑攔截問題。
**👉 若您使用 PowerShell (推薦)**：
```powershell
npm install
python -m venv venv
py -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
npx prisma db push
```
**👉 若您使用 傳統命令提示字元 (cmd)**：
```cmd
npm install
py -m venv venv
venv\Scripts\activate.bat
pip install -r requirements.txt
npx prisma db push
```


啟動後端：

```powershell
npm start
```

啟動前端：

```powershell
npm run dev
```

### Ubuntu 安裝步驟

```bash
npm install
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
npx prisma db push
```

啟動後端：

```bash
npm start
```

啟動前端：

```bash
npm run dev
```

### 驗證與開發指令

```powershell
npm run lint
npm test
npm run test:run
```

### 啟動後驗證

- 後端狀態：<http://localhost:3000/api/system/status>
- 前端介面：<http://localhost:5173>

---

## ⚠️ 常見問題 (Troubleshooting)

- 如果出現 native binding 錯誤，通常代表 `node_modules` 是從不同作業系統複製過來的，請刪除後重新 `npm install`。
- 如果 Python 找不到，請確認專案內 `venv` 已建立，或系統 `python` / `python3` 已可直接執行。
- 若在 Windows 與 Ubuntu 間切換開發，建議同時重建 `node_modules` 與 `venv`。
- 公開 repo 不包含私人 debug 資料；若你需要同步新檔案到公開版，請先更新 `public-repo.manifest.json`。
