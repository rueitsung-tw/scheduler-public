# 混合配課具名教師落地與匯入驗證 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 混合配課確認必須將所有具配課公式的教師實際指派到完整班級並驗證節數；不得再以未具名的「科任／行政」寫入班級課程需求。

**Architecture:** `buildMixedTeachingPlans()` 將年級＋科目的所有 Excel 具名教師配額分成預設與例外角色群組，並以全體具名配額計算總量。`resolveMixedTeachingPlan()` 必須先將全部具名配額（含 class-specific／all-eligible 預約）配至完整班級，再處理剩餘預設容量；若剩餘預設容量是科任／行政且無具名教師，直接阻擋，絕不可建立空白教師。一般物化器必須回傳本次寫入 ledger，匯入套用前據此驗證每位非空白公式教師的實際落班節數。

**Tech Stack:** Vue 3 `<script setup>`、JavaScript utility modules、Vitest。

## Global Constraints

- 不修改班級的 `homeroom_teacher`；只更新 `course_requirements[].teacher`、`teacher_name` 與 `assignmentSource`。
- 配課公式為空白或 `-` 的教師不納入「必須落地」檢核，仍由其他配課流程處理。
- 同班同科只允許一筆明確 assignment；班級的整科節數不可拆分。
- 既有「按班級順序」與 seeded 隨機分配都必須保留。
- 任一有公式教師未完全落地、節數不符或教師名稱為空白時，阻擋「確認套用」，不可寫入或同步資料。
- `allNamedPeriods = defaultRoleNamedPeriods + exceptionRoleNamedPeriods`；以它進行超額檢查，並以 `implicitDefaultPeriods = totalDemandPeriods - allNamedPeriods` 計算預設角色的未具名餘額。
- 僅當導師實際節數與科任／行政實際節數皆大於 0 時建立 mixed plan；兩側統計相加必須等於總需求。
- 不動 `.cmp/`、資料備份或範例檔；不提交其他既有修改。

---

## File Structure

- `src/utils/mixedTeachingPlan.js`：建立雙角色具名配額、完整班級分配、套用前落地驗證。
- `src/components/MixedTeachingResolutionDialog.vue`：依角色群組顯示正確節數與每班具名教師；顯示驗證錯誤。
- `src/components/SubjectExcelImport.vue`：在混合決議＋一般物化後呼叫驗證器，失敗時保留對話框並阻擋同步。
- `tests/mixedTeachingPlan.test.js`：雙角色與無空白教師的單元測試。
- `tests/subjectExcelImport.test.js`：完整 UI 匯入路徑的阻擋／成功驗收。
- `tests/SubjectAssignmentIntegration.test.js`：混合決議與一般物化合併後的資料一致性驗收。

### Task 1: 建立雙角色具名配額與完整班級配置

**Files:**

- Modify: `src/utils/mixedTeachingPlan.js:199-405`
- Test: `tests/mixedTeachingPlan.test.js`

**Interfaces:**

- Produces: plan fields `namedTeacherQuotas`, `defaultRoleTeacherQuotas`, `exceptionTeacherQuotas`, `defaultRoleNamedPeriods`, `exceptionRoleNamedPeriods`, `allNamedPeriods`, `implicitDefaultPeriods`, `homeroomPeriods`, `subjectAdminPeriods`。
- Produces: `resolveMixedTeachingPlan(plan, options)` 的每一筆 assignment 都有 `teacherName`，或是明確標示由班導預設值帶入的具名導師。

- [x] **Step 1: 寫失敗測試，重現六年級自然預設科任／行政、施懿珊為導師例外**

```js
expect(plan.defaultRoleTeacherQuotas.map((q) => q.teacherName)).toEqual(['自然甲', '自然乙'])
expect(plan.exceptionTeacherQuotas).toMatchObject([{ teacherName: '施懿珊', periods: 4 }])
expect(resolveMixedTeachingPlan(plan, { mode: 'auto' }).resolution.assignments).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ className: '6年8班', teacherName: '施懿珊', periods: 4 }),
    expect.objectContaining({ teacherName: '自然甲', periods: 4 }),
  ]),
)
```

- [x] **Step 2: 執行紅燈測試**

Run: `npx vitest run tests/mixedTeachingPlan.test.js`

Expected: FAIL，因目前 plan 丟失預設科任／行政的具名配額，並產生空白 `teacherName`。

- [x] **Step 3: 最小實作雙角色配額、總量計算與分配**

```js
const allTeacherQuotas = Array.from(teacherQuotasMap.values())
const defaultRoleTeacherQuotas = allTeacherQuotas.filter((q) =>
  isRoleInGroup(q.teacherType, defaultRoleGroup),
)
const exceptionTeacherQuotas = allTeacherQuotas.filter((q) =>
  isRoleInGroup(q.teacherType, exceptionRoleGroup),
)
const namedTeacherQuotas = [...defaultRoleTeacherQuotas, ...exceptionTeacherQuotas]
const allNamedPeriods = namedTeacherQuotas.reduce((sum, q) => sum + q.periods, 0)
const implicitDefaultPeriods = totalDemandPeriods - allNamedPeriods
```

將超額檢查改為 `allNamedPeriods > totalDemandPeriods`。以具名導師＋預設導師餘額及具名科任／行政＋預設科任／行政餘額，判定兩角色是否均實際有課。

預約 Pass 1–3 改為對 `namedTeacherQuotas` 全部生效：先 class-specific、再 all-eligible、最後 grade-batch；每個指定班必須有單一對應需求，且完整 `req.periods` 與 rule 的單班節數相容。把 `allocatedClassNames` 回寫到所有具名 quota。

分配器先處理已預約班，再以既有順序或 seed 隨機順序將所有未完成的 `namedTeacherQuotas` 配到完整 class block。最後檢查每個 quota 的已配節數精確相等。僅當 `implicitDefaultPeriods > 0` 且預設角色為 homeroom 時，才以每班既有 `homeroomTeacherName` 補齊；若預設角色為 subject-admin，回傳「科任／行政剩餘 N 堂未指定教師」錯誤，絕不建立空白 assignment。

手動模式同樣先固定 class-specific／all-eligible 預約；使用者只選例外群組的其餘班。選定後先精確配置例外具名 quota，再將未選班依既有班序配置預設群組具名 quota，最後才由具名班導補足 `implicitDefaultPeriods`。任何具名 quota 無法完整分班均回傳驗證錯誤。

- [x] **Step 4: 執行綠燈與既有行為回歸測試**

Run: `npx vitest run tests/mixedTeachingPlan.test.js`

Expected: PASS；既有預設導師混合案例、預設班序及 seeded random 均仍通過。

### Task 2: 建立物化後的具名教師落地驗證器

**Files:**

- Modify: `src/utils/mixedTeachingPlan.js:after applyResolvedMixedTeachingPlans`
- Test: `tests/mixedTeachingPlan.test.js`
- Test: `tests/SubjectAssignmentIntegration.test.js`

**Interfaces:**

- Produces: `validateImportedTeacherAssignments({ classes, parsedRows, teachers }) => { valid, errors }`。
- `errors` 每一筆至少包含 `teacherName`、`subject`、`expectedPeriods`、`assignedPeriods`、`reason`。

- [x] **Step 1: 寫失敗測試**

```js
const result = validateImportedTeacherAssignments({ classes, parsedRows, teachers })
expect(result.valid).toBe(false)
expect(result.errors).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ teacherName: '自然甲', expectedPeriods: 20, assignedPeriods: 0 }),
  ]),
)
```

並加入成功案例：六年級自然每位具公式教師的 `teacher` 與 `teacher_name` 均非空、每位已配節數等於公式節數；空白／`-` formula row 不產生 error。再加入「同名教師既有舊 assignment、但本次並未寫入」不得誤通過的案例。

- [x] **Step 2: 執行紅燈測試**

Run: `npx vitest run tests/mixedTeachingPlan.test.js tests/SubjectAssignmentIntegration.test.js`

Expected: FAIL，因驗證器尚不存在。

- [x] **Step 3: 最小實作**

物化器擴充回傳不可變 `assignmentLedger`，每筆包含 `teacherId`、`teacherName`、`grade`、`subject`、`className`、`periods`、`source`（`mixed-import` 或 `subject-excel-import`）。混合套用也建立相同 ledger。驗證器僅以本次 ledger 計入 assigned，identity 優先以 `teacherId`、姓名僅 fallback；以每一條 parsed rule 的 `grade`、`systemSubject`、`periods` 加總 expected。任一差異、同班同科重複或具名 quota 寫出空白 teacher 皆回報可讀原因，絕不掃描舊 classes 來猜測本次成功。

- [x] **Step 4: 執行綠燈測試**

Run: `npx vitest run tests/mixedTeachingPlan.test.js tests/SubjectAssignmentIntegration.test.js`

Expected: PASS，並驗證不修改 `homeroom_teacher`。

### Task 3: 對話框文案與班級預覽正確呈現雙角色具名教師

**Files:**

- Modify: `src/components/MixedTeachingResolutionDialog.vue:18-103`
- Test: `tests/subjectExcelImport.test.js`

**Interfaces:**

- Consumes: Task 1 plan fields與具名 assignments。
- Produces: 同時列出「導師已配置 X 堂」與「科任／行政已配置 Y 堂」的群組無關文案。

- [x] **Step 1: 寫失敗 UI 測試**

```js
expect(wrapper.text()).toContain('導師已配置 4堂')
expect(wrapper.text()).toContain('科任／行政教師已配置 40堂')
expect(wrapper.text()).toContain('6年8班 施懿珊 (4堂)')
expect(wrapper.text()).toContain('6年1班 自然甲 (4堂)')
expect(wrapper.text()).not.toContain('6年1班 科任／行政 (4堂)')
```

- [x] **Step 2: 執行紅燈測試**

Run: `npx vitest run tests/subjectExcelImport.test.js`

Expected: FAIL，現況為預設科任／行政時錯誤顯示「科任／行政教師已配置 0堂」。

- [x] **Step 3: 最小實作**

改用 `homeroomPeriods` 與 `subjectAdminPeriods` 的實際雙群組統計，強制 `homeroomPeriods + subjectAdminPeriods === totalDemandPeriods`。預覽不再將空白姓名 fallback 成一般成功狀態；若解析後存在空白具名 assignment，將該 plan 的 validation error 顯示並禁用確認鈕。

- [x] **Step 4: 執行綠燈測試**

Run: `npx vitest run tests/subjectExcelImport.test.js`

Expected: PASS；按班序／隨機按鈕與手動例外班級流程仍可用。

### Task 4: 將驗證接到確認套用的原子性流程

**Files:**

- Modify: `src/components/SubjectExcelImport.vue:550-635`
- Test: `tests/subjectExcelImport.test.js`

**Interfaces:**

- Consumes: Task 2 `validateImportedTeacherAssignments` 與 materializer 回傳的 `assignmentLedger`。
- Produces: 驗證失敗時 `mixedApplyError`，對話框保持開啟，不呼叫 store 同步。

- [x] **Step 1: 寫失敗整合測試**

```js
await wrapper.get('[data-testid="mixed-confirm"]').trigger('click')
expect(wrapper.get('[data-testid="mixed-apply-error"]').text()).toContain('自然甲')
expect(mockUpdateClasses).not.toHaveBeenCalled()
```

並加入成功案例，確認非空白公式教師完成落地後只同步一次，且 `homeroom_teacher` 與套用前一致。

- [x] **Step 2: 執行紅燈測試**

Run: `npx vitest run tests/subjectExcelImport.test.js`

Expected: FAIL，現況未在 UI 入口檢查整體物化結果。

- [x] **Step 3: 最小實作**

在 `commitImport()` 中依序完成 mixed apply（收集 mixed ledger）、過濾一般物化規則、一般物化（收集 materializer ledger），再呼叫驗證器。失敗時設定 `mixedApplyError` 並 return；僅 valid 時才更新 classes、teachers 與持久化。同步失敗時仍維持既有 rollback，並新增測試驗證不會留下部分資料。

- [x] **Step 4: 執行綠燈測試**

Run: `npx vitest run tests/subjectExcelImport.test.js tests/SubjectAssignmentIntegration.test.js`

Expected: PASS。

### Task 5: 真實資料回放與交付驗證

**Files:**

- Modify: `tests/subjectExcelImport.test.js`（必要時加入可長期保留的資料縮小 fixture；不得提交個資或實體 Excel/JSON）

- [x] **Step 1: 建立匿名化的六年級自然回放 fixture**

fixture 必須含 11 個四節班級、至少兩位科任／行政具名教師與一位導師例外（4 節）。

- [x] **Step 2: 執行完整聚焦驗收**

Run: `npx vitest run tests/mixedTeachingPlan.test.js tests/subjectExcelImport.test.js tests/SubjectAssignmentIntegration.test.js tests/subjectAssignmentExcelParser.test.js`

Expected: 全數 PASS；無混合 assignment 的空白教師名稱。

- [x] **Step 3: 執行建置與變更範圍檢查**

Run: `npm run build`

Expected: exit 0；可接受既有 Vite bundle-size warning。

Run: `git diff --check`

Expected: 無輸出。

- [x] **Step 4: 人工 UI 驗收清單**

以實際 Excel 在「科任教師批次配課與規則設定」匯入：檢查六年級自然同時顯示所有具名教師、施懿珊與各科任／行政的正確節數；點擊確認套用後，至「班級課程列表」確認班導姓名未改、但各班自然課已填正確具名教師。

## Self-Review

- **Spec coverage:** Task 1 修正雙角色具名配額、總需求計算、class-specific 預約與手動模式；Task 2 以本次 ledger 落實「所有有公式教師必須實際分班」；Task 3 修正摘要與可視化；Task 4 防止驗證失敗資料寫入；Task 5 以匿名 fixture、測試、建置與 UI 清單驗收。
- **Placeholder scan:** 已無 TBD/TODO 或未指定的驗證行為。
- **Type consistency:** 所有後續任務共用 `namedTeacherQuotas`、雙角色 quota 與 `validateImportedTeacherAssignments` 介面；UI 僅在 Task 1 完成後取用其 plan 欄位。
