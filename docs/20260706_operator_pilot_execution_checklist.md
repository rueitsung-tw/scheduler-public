# 2026-07-06 週一實際人員操作實驗執行清單與回饋表

目的: 讓行政組長在單人單機、受控環境中完成第一輪真人操作 pilot，確認第一期交付是否已足以支撐真實排課工作流程。

適用日期: **2026-07-06（週一）**

---

## 1. 實驗定位

本次是 **單人單機、受控真人操作實驗**，不是公開上線，也不是多人登入協作驗證。

建議參與角色：

1. 1 位主要操作承辦人（行政組長）
2. 1 位旁站記錄者
3. 1 位技術支援待命人員

---

## 2. 實驗前準備

### 2.1 環境檢查

- [v ] `scheduler-public` 使用最新已整理版本
- [v ] `npm install` 可完成
- [x ] `python -m venv venv` 與 `pip install -r requirements.txt` 可完成
  啟動 Python 虛擬環境失敗
  您執行了 python -m venv venv 來建立虛擬環境，接著嘗試執行 .\venv\Scripts\Activate.ps1 來啟動它，但出現了**「系統找不到指定的路徑」**。
  修改完 README.md 了！
  現在的寫法不僅特別加上了使用 py 的防呆提示，也把 PowerShell 和傳統 cmd 兩種不同使用者的指令分開來寫，這樣之後不管是哪種系統環境都不容易出錯了。
  另外，為了幫您接續完成剛剛被中止的環境安裝，我也把後續的套件安裝 (pip install) 以及資料庫初始化 (npx prisma db push) 指令打包發送給您了。請點選 Approve 讓它跑完，您的開發環境就會正式設定完成！
- [v ] `npm start` 可啟動後端
- [ v] `npm run dev` 可啟動前端
- [v ] `http://localhost:3000/api/system/status` 可回應
- [v ] `http://localhost:5173` 可正常載入

### 2.2 資料準備

- [v ] 使用受控測試資料或可回復資料集
- [v ] 確認 DB 可在實驗後回復
- [v ] 準備至少 1 組貼近真實學校情境的資料
- [ v] 準備匯出檔案留存資料夾

### 2.3 紀錄準備

- [v ] 指定記錄者
- [ v] 準備螢幕截圖或錄影方式
- [ v] 準備問題回報表
- [ v] 記錄本次實驗開始時間與環境版本

---

## 3. 建議操作流程

### Phase A：初始化與基本資料確認

- [v ] 進入系統首頁
- [v ] 完成或確認 setup 狀態
- [v ] 檢查學校基本設定是否可閱讀 / 編輯
- [v ] 檢查班級、教師、教室資料是否可正常顯示

### Phase B：需求輸入與資料調整

- [v ] 操作班級需求設定
- [v ] 操作教師設定
- [ v] 操作教室 / 專科教室設定
- [ x] 若有共備或特殊設定，確認可正常保存
  AI輔助設定(AISSettingview.vue):五六年級共備設定 (Co-Planning)->啟用五六年級共備的選項勾選【儲存】後，會退回未儲存的狀態。
  在【手動指定共備區塊】選擇開始節次的選項只有一個選項:【第5節(下午第1節)】，沒有其他的選項。

### Phase C：排課主流程

- [V ] 執行排課
- [ X] 確認系統有回傳結果
  [INFO] Python Resolver: 使用 venv E:\scheduler-public-main\venv\Scripts\python.exe
  [INFO] Spawn Solver: E:\scheduler-public-main\venv\Scripts\python.exe E:\scheduler-public-main\solver.py E:\scheduler-public-main\input_72d18f7f-9612-49e9-804f-bae6b28be704.json E:\scheduler-public-main\output_72d18f7f-9612-49e9-804f-bae6b28be704.json
  [Python 輸出]: [PHASE] main 開始執行, 已掛載 faulthandler

[Python 輸出]: [PHASE] 載入 payload 完成

[Python 輸出]: [LINK] [Homeroom Blockization] 1年1班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 1年2班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 1年3班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 1年4班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 1年5班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 1年6班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 1年7班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 1年8班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年1班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年2班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年3班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年4班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年5班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年6班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年7班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年8班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 2年9班: 已合併 3 個導師科目，共 11.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 3年1班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 3年1班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9448e67e] (invariant OK)
[LINK] [Homeroom Blockization] 3年2班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 3年2班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_f8420cad] (invariant OK)
[LINK] [Homeroom Blockization] 3年3班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 3年3班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_f8db6983] (invariant OK)
[LINK] [Homeroom Blockization] 3年4班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 3年4班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9448e67e] (invariant OK)
[LINK] [Homeroom Blockization] 3年5班: 已合併 6 個導師科目，共 15.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 3年6班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 3年6班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_f8420cad] (invariant OK)
[LINK] [Homeroom Blockization] 3年7班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 3年7班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_f8db6983] (invariant OK)
[LINK] [Homeroom Blockization] 3年8班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 3年8班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9448e67e] (invariant OK)
[LINK] [Homeroom Blockization] 3年9班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 3年9班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_f8420cad] (invariant OK)
[LINK] [Homeroom Blockization] 3年10班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 3年10班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_f8db6983] (invariant OK)
[LINK] [Homeroom Blockization] 3年11班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 3年11班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9448e67e] (invariant OK)
[LINK] [Homeroom Blockization] 4年1班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年1班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年2班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年2班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年3班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年3班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年4班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年4班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年5班: 已合併 6 個導師科目，共 15.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 4年6班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年6班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年7班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年7班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年8班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年8班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年9班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年9班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年10班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年10班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 4年11班: 已合併 6 個導師科目，共 16.0 節課至「導師區塊」
[Arts Split] 4年11班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9ecf56ad] (invariant OK)
[LINK] [Homeroom Blockization] 5年1班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年1班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年2班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年2班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年3班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年3班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年4班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年4班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年5班: 已合併 4 個導師科目，共 15.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 5年6班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年6班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年7班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年7班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年8班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年8班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年9班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年9班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年10班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年10班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 5年11班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 5年11班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_1e2abcbb] (invariant OK)
[LINK] [Homeroom Blockization] 6年1班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年1班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年2班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年2班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年3班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年3班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年4班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年4班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年5班: 已合併 4 個導師科目，共 16.0 節課至「導師區塊」
[LINK] [Homeroom Blockization] 6年6班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年6班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年7班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年7班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年8班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年8班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年9班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年9班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年10班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年10班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[LINK] [Homeroom Blockization] 6年11班: 已合併 5 個導師科目，共 15.0 節課至「導師區塊」
[Arts Split] 6年11班: 音樂 1.5 + 美勞 1.5 音樂*固定(1) + 美勞*固定(1) + 交替(1) [group=g_9dfe9b33] (invariant OK)
[PHASE] preprocessing 完成

[Python 輸出]: [ERROR] [Preflight] 6年5班: 總節數 33 > 容量 32！

[ERROR] [Preflight] 1 個班級輸入驗證失敗，不進 solver

- 6年5班: 總節數 33 > 容量 32 (超限 1)

[INFO] Python Resolver: 使用 venv E:\scheduler-public-main\venv\Scripts\python.exe
[ERROR] Python 腳本不存在: E:\scheduler-public-main\diagnostic_stats.py
[Diagnostic] preRepair 統計失敗: Error: [ERROR] Python 腳本不存在: E:\scheduler-public-main\diagnostic_stats.py
at spawnPython (file:///E:/scheduler-public-main/server.js:219:15)
at file:///E:/scheduler-public-main/server.js:3167:22
at new Promise (<anonymous>)
at runDiagnosticStats (file:///E:/scheduler-public-main/server.js:3166:12)
at ChildProcess.<anonymous> (file:///E:/scheduler-public-main/server.js:3563:48)
at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
[INFO] Python Resolver: 使用 venv E:\scheduler-public-main\venv\Scripts\python.exe
[ERROR] Python 腳本不存在: E:\scheduler-public-main\repair_agent.py
排課任務處理失敗: Error: [ERROR] Python 腳本不存在: E:\scheduler-public-main\repair_agent.py
at spawnPython (file:///E:/scheduler-public-main/server.js:219:15)
at file:///E:/scheduler-public-main/server.js:3600:44
at new Promise (<anonymous>)
at ChildProcess.<anonymous> (file:///E:/scheduler-public-main/server.js:3599:53)
at process.processTicksAndRejections (node:internal/process/task_queues:104:5)

- [V ] 檢查結果頁面是否可閱讀
- [V ] 若操作員需要，進行至少 1 次人工微調或檢視
- [ ] 判斷結果是否屬於「可使用」而非「看似接近但實際不可用」

### Phase D：專科教室與結果閱讀

- [V ] 開啟 Classroom Manager
- [V ] 檢查專科教室分配是否可閱讀
- [ ] 抽查至少 3 個班級的關鍵課程
- [ ] 抽查 alternating / odd-even 呈現是否可理解

### Phase E：匯出

- [ ] 進入 Export Hub
- [ ] 至少完成 1 次 XLSX 匯出
- [ ] 檢查匯出檔案是否可開啟
- [ ] 確認匯出內容與畫面資料大致一致

### Phase F：回饋蒐集

- [ ] 記錄哪一步最卡
- [ ] 記錄哪一段文案最不清楚
- [ ] 記錄有沒有需要技術人員介入的步驟
- [ ] 記錄是否有任何匯出、畫面、資料保存異常

---

## 4. 成功判定

本次 pilot 可視為成功，至少需滿足：

1. 操作員能獨立完成主要流程的大部分步驟
2. 系統能完成至少一輪真實排課與閱讀
3. 至少一種匯出可成功完成
4. 沒有出現阻斷型錯誤導致整個流程無法繼續
5. 操作員主觀判定結果已接近「可拿給校長看」的可用程度

---

## 5. 若出現問題，如何分類

### P0 阻斷

- 無法啟動
- 無法進入系統
- 無法完成排課
- 無法讀取結果
- 無法匯出

### P1 高摩擦

- 能完成，但操作步驟容易卡住
- 文案讓承辦人無法理解
- 需要技術人員頻繁協助

### P2 可延後

- 介面不夠直覺
- 回饋資訊不夠清楚
- 操作上有繞路，但不阻斷

---

## 6. 實驗後回報模板

### 基本資訊

- 操作日期:
- 操作人員:
- 記錄人員:
- 使用資料集:
- 操作模式: `單人 / 單機 / 行政組長`

### 結果摘要

- 是否完成主要流程:
- 是否成功排課:
- 是否成功閱讀專科教室結果:
- 是否成功匯出:
- 最終課表是否「可使用」:
- 若不可使用，最主要原因:

### 發現問題

1. 問題:
   - 分類: `P0 / P1 / P2`
   - 發生步驟:
   - 現象:
   - 是否可重現:

2. 問題:
   - 分類: `P0 / P1 / P2`
   - 發生步驟:
   - 現象:
   - 是否可重現:

### 操作回饋

- 最卡的一步:
- 最需要說明的一步:
- 最有幫助的畫面:
- 建議優先改善項目:
- 哪一段最接近真實學校排課需求:
- 哪一段最像「做出來但不能用」:

### 可用性評語

- 若今天就要拿這套系統排一份可交付課表，你敢不敢用:
- 若不敢用，最關鍵的 1 個 blocker 是什麼:
- 若勉強可用，最需要技術團隊立刻補強的是什麼:

### Pilot Verdict

- [ ] 可進下一輪 pilot
- [ ] 可考慮擴大到更多內部使用者
- [ ] 需先修正 blocker 後再進行下一輪

---

## 7. 建議現場回饋表（可直接複製填寫）

```md
# 單人單機操作實驗回饋表

- 日期：
- 操作人：
- 記錄人：
- 使用資料：

## 一、流程結果

- 是否完成初始化：
- 是否完成資料檢查：
- 是否成功執行排課：
- 是否成功閱讀結果：
- 是否成功匯出：

## 二、可用性判定

- 這份課表是「可使用」還是「垃圾」：
- 你的判定理由：
- 若不可使用，最主要的 1-3 個原因：

## 三、操作痛點

1. 痛點：
   - 發生位置：
   - 現象：
   - 嚴重度：`P0 / P1 / P2`

2. 痛點：
   - 發生位置：
   - 現象：
   - 嚴重度：`P0 / P1 / P2`

3. 痛點：
   - 發生位置：
   - 現象：
   - 嚴重度：`P0 / P1 / P2`

## 四、真實性評估

- 哪一部分最貼近學校真實排課情境：
- 哪一部分最不貼近真實情境：
- 哪一個結果最不能接受：

## 五、總評

- 下週是否願意繼續用這套系統做下一輪：
- 若只能改 1 件事，最該優先修哪裡：
- 其他補充：
```
