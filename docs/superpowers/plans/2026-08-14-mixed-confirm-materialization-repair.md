# 混合配課確認與一般物化衝突修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓混合配課確認後的「年級＋科目」只由混合決議寫入班級，其他 Excel 規則才由一般物化器寫入；若套用失敗，必須在混合對話框直接顯示原因。

**Architecture:** 系統初始化時帶入的「該班導師」是可被 Excel 科任規則取代的預設值，不是手動鎖定；物化器在目標範圍內必須能將它視為可用需求，同時保持真正手動、鎖定與混合結果不可覆寫。`buildMixedTeachingPlans()` 與 `applyResolvedMixedTeachingPlans()` 已負責將完整班級依混合決議分給導師、科任與行政教師。新增一個純函式，從「本次要物化的教師規則」排除已完成混合決議的 `grade + subject`，但不從最後儲存的教師 `assignment_rules` 移除該規則。`SubjectExcelImport.vue` 在呼叫一般物化器前使用這個過濾結果；對話框透過明確的 `applyError` 與 `isApplying` props 顯示寫入失敗並防止重複送出。

**Tech Stack:** Vue 3、JavaScript、Vitest、Vue Test Utils。

## Global Constraints

- 混合配課決議已涵蓋的 `年級＋科目`，確認套用後是該組班級授課教師的唯一寫入來源；一般 Excel 物化器不得再次碰觸該組班級需求。
- 若課程需求未鎖定、未標示 `assignmentSource`，且 `defaultTeacher: 'homeroom'` 的目前 `teacher`／`teacher_name` 均等於該班 `homeroom_teacher`（或 `homeroomTeacher`），該教師是可覆寫的系統預設導師。僅在本次 Excel 規則的 scope 內，物化器可將它改為科任／行政教師。
- `isLocked`、含 `assignmentSource: 'mixed-import'` 或 `assignmentSource: 'subject-excel-import'`、以及不符合上述系統預設導師條件的既有教師，均不可被一般物化器覆寫。
- 仍必須完整儲存 Excel 匯入教師的全部 `assignment_rules`，包括由混合配課處理的規則；只過濾「傳入一般物化器的暫存教師規則」。
- 非混合科目仍必須由 `materializeImportedAssignmentRules()` 正常寫入班級，不能因有任何混合計畫而被整批略過。
- 既有 `mixed-import`、手動指定與鎖定課程不得被覆寫。
- 一般物化失敗時，不得修改 store 或同步雲端；混合對話框必須保持開啟，並在對話框內顯示具體錯誤。
- 不修改 `E:\Backup\asus\Downloads\115科任配課(已自動修復).xlsx` 或 `F:\系統設定備份_2026-08-14.json`。

---

## File Structure

- Modify: `src/utils/subjectAssignmentMaterializer.js` — 新增純函式以排除已由混合決議處理的物化規則。
- Modify: `src/components/SubjectExcelImport.vue` — 將混合決議傳入規則過濾、保留對話框並傳遞套用狀態／錯誤。
- Modify: `src/components/MixedTeachingResolutionDialog.vue` — 顯示父元件傳入的套用錯誤並在提交中停用確認按鈕。
- Modify: `src/utils/mixedTeachingPlan.js` — 混合決議寫入時同步更新 `teacher` 與 `teacher_name`。
- Modify: `tests/SubjectAssignmentIntegration.test.js` — 驗證規則過濾與混合班級分配不會被一般物化覆蓋。
- Modify: `tests/subjectExcelImport.test.js` — 驗證完整元件流程、混合錯誤的可見性與無 store／雲端寫入。

### Task 1: 讓 Excel 規則可覆寫系統預設導師，但不覆寫真正指定結果

**Files:**

- Modify: `src/utils/subjectAssignmentMaterializer.js`
- Test: `tests/SubjectAssignmentIntegration.test.js`

**Interfaces:**

- Produce: `isReplaceableDefaultHomeroomRequirement(cls, req)`，回傳是否為可由 Excel 規則替換的系統預設導師需求。
- Existing: `preflightValidateDemand()` 與 `materializeImportedAssignmentRules()` 必須以此 helper 將此類需求計為可用，並在寫入時安全覆蓋。

- [x] **Step 1: 先寫失敗的二年級健康規則物化測試**

在 `tests/SubjectAssignmentIntegration.test.js` 建立二年級 8 個班，每班一筆：

```js
{
  subject: '健康', periods: 1, defaultTeacher: 'homeroom',
  teacher: '原班導師', teacher_name: '原班導師', isLocked: false,
}
```

每班 `homeroom_teacher` 與該需求教師相同。建立三位科任的規則 `2健*4`、`2健*1`、`2健*3` 等值規則（規則節數分別為 4、1、3，候選範圍均含 8 班）。呼叫 `materializeImportedAssignmentRules()` 後斷言成功、三位教師分別得到 4／1／3 班、每班健康課仍只有一筆需求且 `assignmentSource: 'subject-excel-import'`。

再加入三個保護案例：`isLocked: true`、`assignmentSource: 'mixed-import'`，以及已指定非班導的手動教師；它們都不可覆蓋，若導致配額不足則整批失敗且輸入陣列不變。

- [x] **Step 2: 執行測試確認目前失敗**

Run: `npx vitest run tests/SubjectAssignmentIntegration.test.js`

Expected: FAIL，現行預檢將所有已帶入導師姓名的二年級健康課當作不可用，回傳「可分派需求節數不足」。

- [x] **Step 3: 實作可覆寫預設導師辨識並套用至預檢與物化**

在 `subjectAssignmentMaterializer.js` 實作並匯出：

```js
export function isReplaceableDefaultHomeroomRequirement(cls, req) {
  const homeroomName = String(cls?.homeroom_teacher || cls?.homeroomTeacher || '').trim()
  const assignedName = String(req?.teacher || '').trim()
  const storedName = String(req?.teacher_name || '').trim()
  return Boolean(
    homeroomName &&
    req?.defaultTeacher === 'homeroom' &&
    !req?.isLocked &&
    !req?.assignmentSource &&
    assignedName === homeroomName &&
    (!storedName || storedName === homeroomName),
  )
}
```

在 scope 中，`preflightValidateDemand()` 把此類需求加入 `availableUnassignedPeriods`；`materializeImportedAssignmentRules()` 與 `materializeExactRules()` 把它當成可指派項，寫入新教師、`isAutoAssigned: true` 與 `assignmentSource: 'subject-excel-import'`。不得把它拆成兩筆相同 1 節需求；若部分配額才需要時沿用既有 split 行為。

- [x] **Step 4: 執行聚焦測試**

Run: `npx vitest run tests/SubjectAssignmentIntegration.test.js`

Expected: PASS；`2健*1` 可得到一個完整班級，全部二年級健康規則合計正好覆蓋 8 班，而保護案例維持不可覆寫。

### Task 2: 將混合決議的科目從一般物化輸入排除

**Files:**

- Modify: `src/utils/subjectAssignmentMaterializer.js`
- Test: `tests/SubjectAssignmentIntegration.test.js`

**Interfaces:**

- Produce: `filterRulesForImportedMaterialization(teachers, resolutions)`。
- Consumes: `teachers`（含 `assignment_rules`）與 `resolutions`（每筆含 `grade`、`subject`、`resolution.assignments`）。
- Returns: 新的教師陣列；教師其他欄位與原始規則順序不變，僅移除與任一已確認混合 `grade + subject` 相符的 `assignment_rules`。

- [x] **Step 1: 先寫失敗的規則過濾測試**

在 `tests/SubjectAssignmentIntegration.test.js` 新增一個教師，其中有三筆規則：`2年級健康 1 節`、`2年級體育 2 節`、`3年級健康 1 節`。傳入一筆 `resolutions`：`{ grade: 2, subject: '健康', resolution: { assignments: [...] } }`。斷言回傳教師仍有「2年級體育」與「3年級健康」，但沒有「2年級健康」；原始教師物件及原始三筆規則不被突變。

再建立二年級健康 8 個班、每班 1 節且預設導師已有姓名的情境；用 `applyResolvedMixedTeachingPlans()` 將一班指派給科任、其餘班維持導師，將過濾後教師傳入 `materializeImportedAssignmentRules()`。斷言：

```js
expect(materialized.success).toBe(true)
expect(materialized.assignedCount).toBe(0)
expect(materialized.classes.find((c) => c.name === '2年5班').course_requirements[0]).toMatchObject({
  teacher: '謝純雅',
  assignmentSource: 'mixed-import',
})
```

- [x] **Step 2: 執行測試確認目前失敗**

Run: `npx vitest run tests/SubjectAssignmentIntegration.test.js`

Expected: FAIL，因為過濾函式尚不存在，且現行一般物化會再次嘗試二年級健康而回傳需求不足。

- [x] **Step 3: 實作不可變規則過濾函式**

在 `src/utils/subjectAssignmentMaterializer.js` 匯出：

```js
export function filterRulesForImportedMaterialization(teachers = [], resolutions = []) {
  const mixedPairs = resolutions
    .filter((item) => item?.resolution && Array.isArray(item.resolution.assignments))
    .map((item) => ({
      grade: Number(item.grade),
      subject: String(item.subject || item.resolution.subject || '').trim(),
    }))
    .filter((pair) => pair.grade > 0 && pair.subject)

  return teachers.map((teacher) => ({
    ...teacher,
    assignment_rules: Array.isArray(teacher.assignment_rules)
      ? teacher.assignment_rules.filter(
          (rule) =>
            !mixedPairs.some(
              (pair) =>
                Number(rule.grade) === pair.grade && isSubjectMatch(rule.subject, pair.subject),
            ),
        )
      : [],
  }))
}
```

使用既有 `isSubjectMatch()`，使「自然」與「自然科學」等同現有規則比對邏輯。空的 `resolutions` 必須保留所有規則。不得改動傳入的教師物件或規則陣列。

- [x] **Step 4: 執行聚焦測試**

Run: `npx vitest run tests/SubjectAssignmentIntegration.test.js`

Expected: PASS，並證明二年級健康混合決議後不再由一般物化器造成「可分派需求節數不足」。

### Task 3: 在確認匯入串接規則過濾與對話框可見錯誤

**Files:**

- Modify: `src/components/SubjectExcelImport.vue`
- Modify: `src/components/MixedTeachingResolutionDialog.vue`
- Modify: `src/utils/mixedTeachingPlan.js`
- Test: `tests/subjectExcelImport.test.js`

**Interfaces:**

- `SubjectExcelImport.vue` 保有完整 `nextTeachers` 作為 store 最終值；僅將 `filterRulesForImportedMaterialization(participatingTeachers, resolutions)` 傳入 `materializeImportedAssignmentRules()`。
- `MixedTeachingResolutionDialog.vue` 新增 props：`applyError: String`（預設 `''`）與 `isApplying: Boolean`（預設 `false`）。
- 元件仍 emit `confirm({ resolutions })`；提交時按鈕 disabled，按鈕文字為「套用中…」。

- [x] **Step 1: 寫完整元件失敗測試**

在 `tests/subjectExcelImport.test.js` 建立二年級 8 班健康課（每班 1 節、`defaultTeacher: 'homeroom'`、已有不同導師姓名）、一位科任「謝純雅」及一筆 `2健*1` Excel 資料。

依序上傳、勾選覆寫、按「確認匯入配課」、確認混合對話框、按「確認套用」。斷言：

```js
expect(store.syncToCloud).toHaveBeenCalledTimes(1)
expect(store.teachers.find((t) => t.name === '謝純雅').assignment_rules).toEqual(
  expect.arrayContaining([expect.objectContaining({ grade: 2, subject: '健康', periods: 1 })]),
)
const subjectAssigned = store.classes.filter(
  (cls) => cls.course_requirements[0].teacher === '謝純雅',
)
expect(subjectAssigned).toHaveLength(1)
expect(subjectAssigned[0].course_requirements[0].assignmentSource).toBe('mixed-import')
```

另新增一個 mock `materializeImportedAssignmentRules()` 失敗的混合確認案例；確認按下後，斷言對話框仍存在、`[data-testid="mixed-apply-error"]` 顯示「無法套用班級配課」、store 保持原值且 `syncToCloud` 未被呼叫。

- [x] **Step 2: 執行測試確認目前失敗**

Run: `npx vitest run tests/subjectExcelImport.test.js`

Expected: FAIL，二年級健康在一般物化預檢回傳不足，且對話框沒有可見錯誤區塊。

- [x] **Step 3: 串接過濾結果並管理提交狀態**

在 `SubjectExcelImport.vue`：

1. 匯入 `filterRulesForImportedMaterialization`。
2. 新增 `mixedApplyError = ref('')`、`isApplyingMixed = ref(false)`；重新上傳、取消混合對話框、開啟新的混合對話框時清空錯誤。
3. 在 `handleMixedConfirm` 設定 `isApplyingMixed = true`、清空錯誤，`await commitImport({ resolutions })`，並在 `finally` 設回 `false`。
4. 在 `commitImport` 建立完整 `nextTeachers` 後，建立 `materializationTeachers = filterRulesForImportedMaterialization(participatingTeachers, resolutions)`，只以它呼叫 `materializeImportedAssignmentRules()`。
5. 一般物化失敗且這次有 `resolutions` 時，設定 `mixedApplyError.value = \`無法套用班級配課：${materialized.error || '未知錯誤'}\``，保留 `showMixedDialog`；無混合流程時，沿用既有頁面 `statusMessage`。
6. 將 `:apply-error="mixedApplyError"` 與 `:is-applying="isApplyingMixed"` 傳入 `MixedTeachingResolutionDialog`。

在 `applyResolvedMixedTeachingPlans()` 寫入每一筆 `mixed-import` 決議時，同步設 `req.teacher_name = assign.teacherName`；對「科任／行政尚未指定具名教師」的空字串決議，同步設為空字串，避免持久化資料於重新載入後仍顯示原班導。

在 `MixedTeachingResolutionDialog.vue` 的 footer 前加入：

```vue
<div v-if="applyError" class="error-box" data-testid="mixed-apply-error">⚠️ {{ applyError }}</div>
```

確認按鈕的 disabled 條件改為 `!isAllValid || isApplying`，文字以 `{{ isApplying ? '套用中…' : '確認套用' }}` 顯示。父元件錯誤清空後，重試必須可再次按下。

- [x] **Step 4: 執行元件與整合測試**

Run: `npx vitest run tests/subjectExcelImport.test.js tests/SubjectAssignmentIntegration.test.js`

Expected: PASS；二年級健康案例同步一次、剛好一班授課教師為謝純雅；非混合物化測試仍通過；錯誤不再被對話框遮住。

### Task 4: 讓混合配課可選按班級順序或一次性隨機分配

**Files:**

- Modify: `src/utils/mixedTeachingPlan.js`
- Modify: `src/components/MixedTeachingResolutionDialog.vue`
- Test: `tests/mixedTeachingPlan.test.js`
- Test: `tests/subjectExcelImport.test.js`

**Interfaces:**

- `resolveMixedTeachingPlan(plan, options)` 新增可選 `autoAllocation: { strategy: 'class-order' | 'random', seed: number }`；未傳時必須與既有按班級自然順序行為完全一致。
- `MixedTeachingResolutionDialog.vue` 對每個 plan 保存 `autoAllocation`；預設 `{ strategy: 'class-order' }`。隨機模式初次選擇時建立 seed，直到關閉該對話框前不得變動。

- [x] **Step 1: 寫出順序與可重現隨機分配的失敗測試**

在混合規劃測試中建立 8 個 `periods: 1` 班級與科任配額 4／1／3。驗證：

```js
const byOrder = resolveMixedTeachingPlan(plan, {
  mode: 'auto',
  autoAllocation: { strategy: 'class-order' },
})
expect(
  byOrder.resolution.assignments
    .filter((a) => a.teacherName === '健康科任甲')
    .map((a) => a.className),
).toEqual(['2年1班', '2年2班', '2年3班', '2年4班'])

const randomOne = resolveMixedTeachingPlan(plan, {
  mode: 'auto',
  autoAllocation: { strategy: 'random', seed: 20260814 },
})
const randomTwo = resolveMixedTeachingPlan(plan, {
  mode: 'auto',
  autoAllocation: { strategy: 'random', seed: 20260814 },
})
expect(randomTwo.resolution.assignments).toEqual(randomOne.resolution.assignments)
expect(randomOne.resolution.assignments).not.toEqual(byOrder.resolution.assignments)
```

在元件測試確認：預設顯示「按班級順序」且預覽為順序結果；切換「隨機分配」後，預覽改變；切回手動再切回隨機時，預覽仍等於剛剛的隨機結果；關閉後重開才允許產生新 seed。

- [x] **Step 2: 執行測試確認目前失敗**

Run: `npx vitest run tests/mixedTeachingPlan.test.js tests/subjectExcelImport.test.js`

Expected: FAIL，因 `autoAllocation`、隨機 seed 與 UI 選擇器尚不存在。

- [x] **Step 3: 實作可重現的一次性隨機順序**

在 `mixedTeachingPlan.js` 實作無副作用 seeded shuffle（不得直接使用 `Math.random()` 作為解析結果來源）：

```js
function createSeededRandom(seed) {
  let state = Number(seed) >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}
```

`resolveMixedTeachingPlan()` 的 `mode: 'auto'`：

1. `strategy` 缺省或為 `'class-order'` 時，維持既有 `classBlocks` 自然順序。
2. `strategy: 'random'` 時，以 `seed` 對「供 `allocateClassesToQuotas()` 選擇」的 class blocks 做 Fisher–Yates shuffle。
3. 回傳的 `assignments` 仍以原本 `plan.classBlocks` 的班級順序顯示，僅教師分配結果改變；所以預覽易於閱讀。
4. `allocatedClassNames` 的既有明確預約資料不重排；它必須比隨機策略優先。

在 `MixedTeachingResolutionDialog.vue`：

1. 對每個 plan 保存 `autoAllocationStates`，預設 strategy 為 `'class-order'`。
2. 在「自動分配」下顯示兩個 radio：`按班級順序（預設）` 與 `隨機分配`，測試識別碼分別為 `auto-strategy-order-<planKey>`、`auto-strategy-random-<planKey>`。
3. 選擇隨機時僅在沒有 seed 時用 `Date.now()` 與 plan key 產生一個數值 seed；之後切換手動或重複點選隨機不可重新抽選。
4. 將目前 `autoAllocation` 傳入 `resolveMixedTeachingPlan()`；`handleConfirm()` 仍 emit 已計算出的固定 `resolution`。

- [x] **Step 4: 執行聚焦驗收**

Run: `npx vitest run tests/mixedTeachingPlan.test.js tests/subjectExcelImport.test.js tests/SubjectAssignmentIntegration.test.js`

Expected: PASS；預設順序可預期，隨機同 seed 可重現，對話框內結果穩定，手動指定與既有混合套用流程不退化。

### Task 5: 一般物化跨教師優先保留明確班級規則

**Files:**

- Modify: `src/utils/subjectAssignmentMaterializer.js`
- Test: `tests/SubjectAssignmentIntegration.test.js`

**Interfaces:**

- `materializeImportedAssignmentRules({ classes, teachers, confirmedHomeroomTeacherIds })` 必須以跨教師的規則優先序物化；不改變呼叫介面與回傳格式。
- 優先序：`class-specific`（含非空 `targetClassNames`）優先於 `all-eligible`，`all-eligible` 優先於 `grade-batch`／無明確標的規則；同一層級維持輸入教師與規則的原始順序。

- [x] **Step 1: 寫出跨教師指定班級保留的失敗測試**

在 `tests/SubjectAssignmentIntegration.test.js` 建立五年級 11 班、每班自然 4 節空白需求，並建立三位教師的規則，輸入順序故意為：

```js
// 兩筆批次規則先出現；若依既有教師順序，會先占用 5年5班。
{ name: '蔡明容', assignment_rules: [{ grade: 5, subject: '自然科學', periods: 20, sourceKind: 'grade-batch', candidateClassNames: allClasses }] }
{ name: '林皎汝', assignment_rules: [{ grade: 5, subject: '自然科學', periods: 20, sourceKind: 'grade-batch', candidateClassNames: allClasses }] }
{ name: '陳陵', assignment_rules: [{ grade: 5, subject: '自然科學', periods: 4, sourceKind: 'class-specific', targetClassNames: ['5年5班'] }] }
```

斷言物化成功、`5年5班` 由陳陵授課、蔡明容與林皎汝各得到 5 個其餘班級、三人指派節數合計為 44。再加入 `all-eligible` 與 `grade-batch` 同科規則，驗證 all-eligible 在 batch 前執行。不得改變輸入 teacher／classes。

- [x] **Step 2: 執行測試確認目前失敗**

Run: `npx vitest run tests/SubjectAssignmentIntegration.test.js`

Expected: FAIL，陳陵的指定 5年5班被前兩個 batch 規則占用而回傳不足。

- [x] **Step 3: 實作跨教師穩定優先排序**

在 `materializeImportedAssignmentRules()` 將 eligible teachers 的規則攤平成保有 `teacher`、`rule`、`teacherIndex`、`ruleIndex` 的陣列。依下列 rank 穩定排序：

```js
function getImportedRulePriority(rule) {
  if (Array.isArray(rule.targetClassNames) && rule.targetClassNames.length > 0) return 0
  if (rule.sourceKind === 'all-eligible') return 1
  return 2
}
```

以排序後條目取代既有巢狀教師／規則回圈來計算 scope 已指派節數、寫入需求與 postcondition。不得改變 preflight、重匯重設、split、`subject-excel-import` 標記或失敗時回傳原始 classes 的行為。

- [x] **Step 4: 執行聚焦測試**

Run: `npx vitest run tests/SubjectAssignmentIntegration.test.js`

Expected: PASS；指定班級永遠先保留，其他相同優先層規則結果維持輸入順序且既有重匯／預設導師保護測試不退化。

### Task 6: 使用真實檔案進行只讀回放與建置驗收

**Files:**

- Modify: none
- Test: `tests/subjectExcelImport.test.js`、`tests/SubjectAssignmentIntegration.test.js`、`tests/subjectAssignmentExcelParser.test.js`

- [x] **Step 1: 建立不寫檔的回放命令或暫存 Vitest harness**

使用 `F:\系統設定備份_2026-08-14.json` 與 `E:\Backup\asus\Downloads\115科任配課(已自動修復).xlsx`，依 UI 順序呼叫：解析、建立混合計畫、自動解析、套用混合決議、過濾一般物化規則、物化。harness 結束後必須刪除，不得留下測試檔或改動兩份使用者資料。

- [x] **Step 2: 驗證回放結果**

Assert：解析與混合計畫沒有 blocker；整體物化成功；二年級健康由科任／行政教師承擔全部 8 節需求（第 4、20、47 列合計為 4 + 1 + 3），每個班級仍只有一個明確教師；無「可分派需求節數不足」錯誤。

- [x] **Step 3: 執行完整聚焦驗收與建置**

Run: `npx vitest run tests/subjectExcelImport.test.js tests/SubjectAssignmentIntegration.test.js tests/subjectAssignmentExcelParser.test.js`

Run: `npm run build`

Expected: 全部通過；僅既有 Vite bundle-size 警告可保留。

## Self-Review

- Spec coverage: 計畫涵蓋混合科目不重複物化、非混合科目維持物化、教師規則完整保存、失敗時對話框直接可見、重試時防重複送出，以及真實 Excel／設定回放。
- Placeholder scan: 無 TBD、TODO 或未定義的「適當處理」。
- Type consistency: 混合決議沿用既有 `{ grade, subject, resolution: { assignments } }`；一般物化仍使用既有 `{ classes, teachers, confirmedHomeroomTeacherIds }` 入口。

## Execution Handoff

依使用者指定採 **Subagent-Driven**：由 Antigravity 依序完成 Task 1–6；主管每一任務檢查實際 diff、測試輸出、保護條件與回放結果後，才允許下一任務。
