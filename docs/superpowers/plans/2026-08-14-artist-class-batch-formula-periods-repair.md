# 藝才班例外與批次配課公式修復 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓已在「課程管理 → 班級課程列表」個別調整節數且指定教師的班級，不會使一般班的「年級＋科目＊班級數」匯入公式遭到錯誤阻擋；個別調整節數但未指定教師時，阻擋匯入並要求先完成班級設定。

**Architecture:** 對 Excel 實際涉及的每個「年級＋科目」，解析器以正數 `periods` 的唯一眾數作為該年級該科的基準節數；與基準不同者視為個別調整。公式解析器在選擇批次或全班候選班級時，除了排除同一公式已明確指定的班級，也排除「班級課程列表 → 班級課程需求列表」中同時符合「個別調整節數」且已指定 `teacher` 的班級。若個別調整節數卻未指定老師，回傳檔案檢核 blocker；眾數並列時亦 blocker，避免以猜測決定基準。

**Tech Stack:** Vue 3、JavaScript、Vitest。

## Global Constraints

- Excel 匯入只能分配教師；不得改寫 `course_requirements`、課程開設狀態或每班節數。
- 「個別調整節數」定義為：該班在「班級課程列表 → 班級課程需求列表」中，此科正數 `periods` 不同於同年級同科正數節數的唯一眾數。
- 只有同時符合「個別調整節數」及該科 `teacher`／`teacher_name` 任一非空白值的班級，才是預先指定例外；批次／全班公式不可覆寫。
- 個別調整節數但 `teacher` 與 `teacher_name` 皆空白者，對任何引用到該年級＋科目的 Excel 公式產生 blocker：「班級『○』科目『○』的每週節數已個別調整為 ○ 節，但尚未於班級課程列表指定授課老師；請先指定老師後再匯入。」
- 同一年級同科的正數節數若無唯一眾數（最高次數並列），產生 blocker，明確要求操作員先於班級課程列表確認各班節數與教師；不可自動排除或選取。
- 明確班級公式（如 `505音`）維持可直接指定該班；本修復只影響批次 `5音*10` 與全班 `5美` 的候選集。
- 仍須在「可分配候選班級」中檢查節數一致性；不可用靜默取第一個節數掩蓋真實設定錯誤。
- 不修改使用者提供的 `E:\Backup\asus\Downloads\115科任配課(已自動修復).xlsx` 或 `F:\系統設定備份_2026-08-14.json`。

---

## File Structure

- Modify: `src/utils/subjectAssignmentFormulaResolver.js` — 計算同年級同科的基準節數／個別調整班級、產生未指定教師 blocker，並回傳批次公式的候選班級與節數。
- Modify: `tests/subjectAssignmentExcelParser.test.js` — 對含預先指定藝才班的批次／全班公式建立回歸測試。
- Do not modify: parser、materializer、UI、資料庫 schema；其介面已接收 resolver 的 `candidateClassNames`／`targetClassNames`。

### Task 1: 鎖定預先指定藝才班的解析器行為

**Files:**

- Modify: `tests/subjectAssignmentExcelParser.test.js`（`subjectAssignmentFormulaResolver` 測試區塊）

**Interfaces:**

- Consumes: `resolveAssignmentFormula({ formulaStr, title, codeMappings, classes })`
- Produces: 通過下列實際資料型態的回歸測試；只有「個別調整節數」且 `course_requirements[].teacher` 或 `teacher_name` 非空白者為不可覆寫的預先指定班級。

- [ ] **Step 1: 新增會失敗的批次公式測試**

在 resolver 測試區塊新增一筆六年級音樂資料：10 班 `periods: 1.5, teacher: ''`，`6年5班` 為 `periods: 1, teacher: '吳品璇'`。執行：

```js
const res = resolveAssignmentFormula({
  formulaStr: '6音*10+3音*2',
  title: '音樂科任',
  codeMappings: DEFAULT_SUBJECT_CODE_MAPPINGS,
  classes,
})
expect(res.diagnostics.filter((d) => d.severity === 'blocker')).toHaveLength(0)
expect(res.totalPeriods).toBe(18)
expect(res.rules[0]).toMatchObject({
  sourceKind: 'grade-batch',
  periods: 15,
  periodsPerClass: 1.5,
})
expect(res.rules[0].candidateClassNames).not.toContain('6年5班')
```

另加入三年級美勞：9 班 `1.5`、`3年5班` 為 `1, teacher: '洪靖雅'`，驗證 `5美+3美*3` 等同概念的 `3美*3` 可得 `4.5` 且不包含 `3年5班`。

再加入「3年5班 `periods: 1, teacher: '' , teacher_name: ''`」變體：任何引用 `3美` 的公式都必須回傳一次 `adjusted-periods-teacher-required` blocker，訊息須包含班級、科目、調整後節數與「請先指定老師後再匯入」。不可退化為一般 `inconsistent-periods`。

最後加入正數節數最高次數並列（例如兩班 `1`、兩班 `1.5`）的變體，驗證回傳 `ambiguous-baseline-periods` blocker，而非任意選取基準。

- [ ] **Step 2: 執行測試確認目前失敗**

Run: `npx vitest run tests/subjectAssignmentExcelParser.test.js`

Expected: 已指定教師的個別調整班級案例以 `inconsistent-periods` blocker 失敗；未指定教師的個別調整班級案例尚未得到要求先指定老師的 blocker。

### Task 2: 判定個別調整節數、阻擋未指定老師，並修正候選篩選

**Files:**

- Modify: `src/utils/subjectAssignmentFormulaResolver.js`（基準節數判定、`grade-batch` 與 `all-eligible` 的候選篩選）
- Test: `tests/subjectAssignmentExcelParser.test.js`

**Interfaces:**

- Consumes: 每班 `course_requirements` 的 `systemSubject || subject`、正數 `periods`、可選 `teacher` 與 `teacher_name`。
- Produces: 每個被公式引用的年級＋科目先得到唯一基準節數；只有非「個別調整節數且已指定老師」且非明確保留的班級，才會進入 `candidateClassNames` 或 `targetClassNames`。個別調整但未指定老師時不產生規則，直接 blocker。

- [ ] **Step 1: 寫出基準節數與例外班級判定**

在 resolver 內建立局部 helper（例如 `getPeriodBaseline(classesInGrade, systemSubject)`），只統計該科正數 `periods`，回傳 `{ baselinePeriods, ambiguous }`。最高出現次數必須唯一；沒有正數課程或最高次數並列時不可回傳基準。另建立 `hasAssignedTeacher(requirement)`，檢查 `teacher` 與 `teacher_name` 任一去除空白後是否有值；再建立 `isIndividuallyAdjusted(requirement, baselinePeriods)`，以數值不相等判定。

- [ ] **Step 2: 對每個被引用的年級＋科目先發出阻擋診斷**

在解析每個已對照成功的公式 token 時，先計算基準。`ambiguous` 時回傳一次 `ambiguous-baseline-periods` blocker；若有個別調整且未指定老師的班級，逐班回傳 `adjusted-periods-teacher-required` blocker。相同年級＋科目出現於多個 token 時，diagnostic 必須去重。此步驟不因公式是批次、全班或明確班級而略過。

- [ ] **Step 3: 將兩種候選集均套用精確排除規則**

在 `grade-batch` 的 `remainingCandidates` 和 `all-eligible` 的 `eligibleClasses` 中，保留既有的 `reservedSet` 排除。只有同時 `isIndividuallyAdjusted(requirement, baselinePeriods)` 與 `hasAssignedTeacher(requirement)` 為真時排除。後續 `periodValues` 一致性檢查只對篩選後候選集執行；不可因單純「已指定老師但節數未個別調整」而排除。

- [ ] **Step 4: 修正班級數不足訊息的可用班級數**

當 `desc.classCount > remainingCandidates.length` 時，錯誤訊息的「系統僅有」必須使用 `remainingCandidates.length`，避免把已預先指定的藝才班誤報為可供匯入分配的班級。

- [ ] **Step 5: 執行聚焦測試**

Run: `npx vitest run tests/subjectAssignmentExcelParser.test.js`

Expected: PASS，包含「未預先指定教師的混合節數仍 blocker」、「個別調整未指定老師是明確 blocker」及「並列基準 blocker」測試。

### Task 3: 以使用者資料完成不寫檔的驗收

**Files:**

- Modify: none
- Test: `tests/subjectAssignmentExcelParser.test.js`

**Interfaces:**

- Consumes: `F:\系統設定備份_2026-08-14.json` 的 `classes` 和 `E:\Backup\asus\Downloads\115科任配課(已自動修復).xlsx` 的第 27、29–31 列。
- Produces: 下列公式不再有 `inconsistent-periods`、`adjusted-periods-teacher-required` 或 `ambiguous-baseline-periods` blocker，且總節數等於 Excel F 欄：第 27 列 18；第 29–31 列各 19.5。

- [ ] **Step 1: 以唯讀短暫 harness 逐列呼叫既有解析器**

以 Node 或 Vitest 讀取真實 JSON 的 `classes`，使用目前設定中的科目代碼對照呼叫解析器；不得修改 JSON、XLSX 或專案資料。

- [ ] **Step 2: 驗證四列結果**

Assert：

```js
expect(totalPeriodsByFormula).toEqual({
  '6音*10+3音*2': 18,
  '5美+3美*3': 19.5,
  '6美+3美*3': 19.5,
  '4美+3美*3': 19.5,
})
expect(blockers).not.toContain('inconsistent-periods')
expect(blockers).not.toContain('adjusted-periods-teacher-required')
expect(blockers).not.toContain('ambiguous-baseline-periods')
```

- [ ] **Step 3: 執行 build 與完整公式測試**

Run: `npx vitest run tests/subjectAssignmentExcelParser.test.js tests/subjectExcelImport.test.js`

Run: `npm run build`

Expected: 都成功；若完整 fast suite 的既有 5 項失敗仍存在，須獨立呈報，不可歸因於此修復。

## Self-Review

- Spec coverage: 計畫涵蓋四個實際阻擋列、以唯一眾數辨識個別節數調整、僅排除「個別調整且已指定教師」班級、未指定教師時的檔案檢核 blocker、批次與全班兩種候選集、真實不一致／基準並列仍應阻擋，以及不覆寫班級課程設定。
- Placeholder scan: 無 TBD／TODO／「適當處理」等未定義工作。
- Type consistency: 所有任務均使用現有 `resolveAssignmentFormula`、`classes`、`course_requirements`、`teacher`、`candidateClassNames` 與 `targetClassNames` 欄位；不改變 parser 或 materializer 的介面。

## Execution Handoff

依使用者指定採 **Subagent-Driven**：由 Antigravity 逐一完成 Task 1–3；主管在每一任務後檢查實際 diff、測試輸出與真實資料回放，才允許下一任務。

---

## 已確認缺口：確認匯入後未物化班級教師

**Observed behavior:** `SubjectExcelImport.vue` 的 `commitImport()` 目前只以 `applyImportToTeachers()` 更新教師 `assignment_rules`，並以空白 `resolutions` 呼叫 `applyResolvedMixedTeachingPlans()`。因此非混合配課的班級 `course_requirements[].teacher` 不會變更；使用者必須額外按「智慧自動配課」才可能看到教師，這不符合「確認套用後正式更新各班授課教師」的功能需求。

**Root-cause constraints:** `deriveTeacherFieldsFromRules()` 現在丟棄 `sourceKind`、`targetClassNames` 與 `candidateClassNames`。即使接著呼叫現有物化器，明確班級規則與藝才班排除候選集也會遺失，造成錯配風險。`runSmartSubjectAssignment()` 的 Phase B 會分配所有未指派科目，不能在 Excel 確認匯入時呼叫。

### Task 4: 確認匯入時安全物化本次 Excel 規則

**Files:**

- Modify: `src/utils/subjectAssignmentExcelParser.js`（規則衍生時完整保留班級目標資訊）
- Modify: `src/utils/subjectAssignmentMaterializer.js`（建立只處理匯入規則的物化入口，並限制候選班級）
- Modify: `src/components/SubjectExcelImport.vue`（在確認匯入的暫存資料上執行匯入規則物化，成功後才同步）
- Modify: `tests/subjectAssignmentExcelParser.test.js`
- Modify: `tests/SubjectAssignmentIntegration.test.js`

**Interfaces:**

- `deriveTeacherFieldsFromRules(rules)` 必須在每個 `assignment_rules` 項目保留：`grade`、`subject`、`periods`、`excelCode`、`classCount`、`periodsPerClass`、`sourceKind`、`targetClassNames`、`candidateClassNames`。
- 新增並匯出 `materializeImportedAssignmentRules({ classes, teachers, confirmedHomeroomTeacherIds })`，回傳 `{ success, classes, assignedCount, error }`。此函式只使用傳入的 `teachers` 規則，不能呼叫或模擬 Phase B fallback。
- 班級規則優先順序：`targetClassNames` 是明確班級清單；否則 `candidateClassNames` 是批次規則可選範圍；兩者皆無時才使用同年級、同科未指派班級的既有排序。
- `targetClassNames` 與 `candidateClassNames` 必須由同一個 `getRuleScopeClassNames(rule)` 解讀，並同時用於 preflight 與物化；不得只在物化階段限制候選班級。
- 同一「年級＋科目」重新匯入前，只清除 `assignmentSource === 'subject-excel-import'` 的既有物化結果；鎖定、手動指定及 `mixed-import` 結果絕不可清除或覆寫。
- 每一條本次匯入規則物化後，都必須驗證該教師在規則範圍內的已指派節數等於 `rule.periods`；不足即為整批失敗，不可保存部分班級教師。

- [x] **Step 1: 寫出會失敗的規則保留與物化測試**

在 `tests/subjectAssignmentExcelParser.test.js` 新增斷言，確認：

```js
const derived = deriveTeacherFieldsFromRules([
  {
    grade: 5,
    subject: '音樂',
    periods: 1.5,
    sourceKind: 'class-specific',
    targetClassNames: ['5年5班'],
    candidateClassNames: [],
  },
])
expect(derived.assignment_rules[0]).toMatchObject({
  sourceKind: 'class-specific',
  targetClassNames: ['5年5班'],
  candidateClassNames: [],
})
```

在 `tests/SubjectAssignmentIntegration.test.js` 新增下列獨立案例：

```js
// A. 5年5班的明確音樂規則只寫入 5年5班，不寫入 5年1班。
// B. 6音*10 的 candidateClassNames 不包含 6年5班時，10 個普通班被寫入，6年5班原有藝才班教師保留。
// C. 同一教師重新匯入較小配額時，先前 assignmentSource: 'subject-excel-import' 的超額班級會被清除；mixed-import 與手動／鎖定班級不變。
// D. candidateClassNames 只有 2 節可用需求卻要求 3 節時，函式失敗且所有班級保持原狀。
```

兩案都必須驗證被寫入的 requirement 有 `teacher`、`isAutoAssigned: true`、`assignmentSource: 'subject-excel-import'`。

- [x] **Step 2: 寫出禁止智慧自動配課副作用的失敗測試**

建立一筆本次匯入只有「3 年級健康」規則、但班級另有未指派「自然」需求的測試；呼叫 `materializeImportedAssignmentRules()` 後，健康課可被指派，自然課必須仍為空白。此測試防止以 `runSmartSubjectAssignment()` 取代匯入物化入口。

- [x] **Step 3: 保留完整匯入規則欄位**

修改 `deriveTeacherFieldsFromRules()`，以不可變複製保留上述欄位；`targetClassNames` 與 `candidateClassNames` 均須為陣列（不存在時為 `[]`）。不可保留引用原始 `parsedRows` 的可變陣列。

- [x] **Step 4: 實作受限的匯入物化入口**

在 `subjectAssignmentMaterializer.js` 建立 `materializeImportedAssignmentRules()`：

1. 以傳入教師陣列與班級陣列建立深拷貝，失敗時不得突變呼叫端資料。
2. 新增 `getRuleScopeClassNames(rule)`，優先回傳 `targetClassNames`，其次回傳 `candidateClassNames`；擴充 `preflightValidateDemand()`，讓指定／候選範圍都只計算該範圍內的可用需求。若失敗，回傳 `success: false` 與精確錯誤，不寫入任何教師。
3. 僅執行 Exact Rules 物化，不得執行 `runSmartSubjectAssignment()` 或其 fallback。
4. 在 Exact Rules 的班級篩選中，優先使用 `targetClassNames`，其次使用 `candidateClassNames`；候選外班級永遠不可接受該規則。
5. 在暫存深拷貝上，針對本次匯入涉及的年級＋科目，重設既有 `assignmentSource: 'subject-excel-import'` 的班級需求；若是 split chunks，合併回同一基底需求與總節數。不得觸及 `isLocked`、手動指定或 `mixed-import`。
6. 物化成功的 requirement 設定 `teacher`、`isAutoAssigned: true`、`assignmentSource: 'subject-excel-import'`；若須拆分，教師 chunk 設定來源，未配 chunk 的 `teacher` 必須為空白且不得標示為匯入來源。
7. 物化後逐條驗證本次匯入規則在其 scope 內達到完整 `rule.periods`；不足時回傳失敗並丟棄整份暫存深拷貝。

- [x] **Step 5: 在確認匯入的暫存資料上呼叫物化入口**

在 `SubjectExcelImport.vue` 的 `commitImport()` 中：

1. 先建立 `nextTeachers`、套用混合決議的 `nextClasses`。
2. 僅找出本次 `parsedRows` 對應的 `nextTeachers`，傳入 `materializeImportedAssignmentRules()` 與已確認的導師 ID。
3. 物化失敗時顯示 `❌ 無法套用班級配課：${error}`，不改寫 `scheduleStore.teachers` 或 `scheduleStore.classes`，不呼叫雲端同步。
4. 物化成功時才將回傳 `classes` 與 `nextTeachers` 一起寫入 store、標記 dirty、同步雲端；同步失敗仍保留現有的 teachers/classes rollback。
5. 成功訊息必須包含已寫入班級的節數，例如「已套用並指派 X 節班級課程」。

- [x] **Step 6: 驗收測試**

Run: `npx vitest run tests/subjectAssignmentExcelParser.test.js tests/SubjectAssignmentIntegration.test.js tests/subjectExcelImport.test.js`

Expected: PASS，且新增案例證明確認匯入後無需按智慧自動配課即可在班級課程需求看見科任教師；未匯入的自然等科目維持不變。

Run: `npm run build`

Expected: 成功；Vite chunk size 警告可保留但不可有編譯錯誤。

## Task 4 Self-Review

- Excel 規則、班級候選集與物化流程均涵蓋，沒有只寫教師規則而遺漏班級資料的斷點。
- 明確班級、藝才班候選排除、混合配課、鎖定／手動指定需求與導師確認均有保護。
- 匯入時只物化本次 Excel 規則，不誤用智慧自動配課的全校 fallback。
- 預檢、候選範圍與物化使用同一 scope；若同步、物化或配額驗證失敗，store 與雲端均不留下半完成狀態。
