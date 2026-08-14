# 科任配課匯入既有資料比對與來源推導修復 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓科任配課 Excel 匯入可從 Excel／班導資料補足個別調整班級的教師來源，並將既有相同配課視為已完成、僅把真正差異交由操作員確認複寫。

**Architecture:** parser 將目前 Excel 列已唯一比對到的教師 ID／姓名傳給公式解析器，並一路保留至 rule；個別調整班級先建立可實際落班的 Excel 明示科任或班導預設 assignment，無法唯一推導才產生 blocker。物化器在清除舊 `subject-excel-import` 前建立 reconciliation ledger，明確區分本次新寫入、既有相同、與既有衝突；最終節數驗證採此 ledger，不能只統計 mutation。UI 以兩階段狀態機先顯示衝突、再依操作員確認複寫，完全相同資料則無提示略過。

**Tech Stack:** Vue 3 `<script setup>`、JavaScript utilities、Vitest。

## Global Constraints

- 不修改 `homeroom_teacher`；班導來源只用於填寫該班該科的 `course_requirements[].teacher`／`teacher_name`。
- 個別調整節數班級：Excel 可唯一解析到科任／行政，或系統可取得該班 `homeroom_teacher`（科目預設導師）時，不得要求使用者預先手填教師。
- 只有教師來源不存在、同名不唯一、科目／班級無法對應時才 blocker，訊息必須指出缺少哪個來源。
- 已有相同資料的判定必須同時比對班級、年級、科目、教師身分（ID 優先、姓名 fallback）與完整課程節數；相同資料不得重寫、不得出現警告、必須計入已配節數。
- 同班同科資料不同（教師不同、節數不同、或既有 assignment 無法辨識教師）必須形成 conflict，未確認複寫前不得套用；確認後只覆寫 Excel 明示涵蓋的需求。
- 衝突確認重試必須重用同一份不可變 import transaction（解析列、混合配課 resolutions、導師確認旗標及 seeded random 決議）；不得重建或重新隨機分班。
- reconciliation 必須先在獨立深拷貝草稿中，依班級、科目與 baseId 合併可合併的 `_split_` requirements；未確認 conflict 時回傳原始 classes／teachers references，完全無 mutation。
- 空白或 `-` 配課公式維持「不覆寫、僅提醒尚無任何既有配課」規則，不納入落地驗證。
- 不動 `.cmp/`、備份資料、範例 Excel；不要將真實姓名／資料檔提交測試。

---

## File Structure

- `src/utils/subjectAssignmentExcelParser.js`：將已唯一比對的 Excel 列教師 ID／姓名傳入 resolver，並把來源 metadata 保留至 `assignment_rules`。
- `src/utils/subjectAssignmentFormulaResolver.js`：個別調整班級的來源推導與可實際物化的專屬 rule／diagnostics。
- `src/utils/subjectAssignmentMaterializer.js`：reconciliation ledger、既有相同資料、衝突及確認複寫後的物化。
- `src/utils/mixedTeachingPlan.js`：將完整 reconciliation ledger 納入教師節數驗證。
- `src/components/SubjectExcelImport.vue`：呈現衝突摘要並將複寫確認傳給物化器；相同資料無提示。
- `tests/subjectAssignmentFormulaResolver.test.js`：來源推導的回歸測試。
- `tests/SubjectAssignmentIntegration.test.js`：materializer reconciliation 與 ledger 測試。
- `tests/mixedTeachingPlan.test.js`：既有相同資料納入驗證的測試。
- `tests/subjectExcelImport.test.js`：完整 UI 匯入／衝突確認測試。

### Task 1: 個別調整節數班級先推導教師來源

**Files:**

- Modify: `src/utils/subjectAssignmentExcelParser.js:324-420,508-540`
- Modify: `src/utils/subjectAssignmentFormulaResolver.js:332-455`
- Test: `tests/subjectAssignmentFormulaResolver.test.js`

**Interfaces:**

- Consumes: parser 已唯一比對的 `{ currentTeacherId, currentTeacherName }`。
- Produces: formula rule metadata `resolvedTeacherName`、`resolvedTeacherId`、`teacherSource` (`excel-explicit` | `homeroom-default`)；`deriveTeacherFieldsFromRules()` 不得丟失這些欄位；diagnostic 僅在無法推導時為 blocker。

- [ ] **Step 1: 寫失敗測試**

```js
const result = resolveAssignmentFormula({
  formulaStr: '505',
  title: '音樂科任',
  classes,
  codeMappings,
  teachers: [{ id: 10, name: '吳品璇', type: 'subject' }],
})
expect(result.diagnostics.filter((d) => d.severity === 'blocker')).toEqual([])
expect(result.rules[0]).toMatchObject({
  targetClassNames: ['5年5班'],
  resolvedTeacherName: '吳品璇',
  teacherSource: 'excel-explicit',
})
```

再加入 305／405 美勞案例：`defaultTeacher: 'homeroom'`、需求教師空白、班級 `homeroom_teacher: '三年5班導師'` 時不 blocker 並回傳 `homeroom-default`；沒有班導或 Excel 無法唯一推導時才保留 blocker。

- [ ] **Step 2: 執行紅燈測試**

Run: `npx vitest run tests/subjectAssignmentFormulaResolver.test.js`

Expected: FAIL，現況對所有個別調整且需求教師空白直接產生 `adjusted-periods-teacher-required`。

- [ ] **Step 3: 最小實作**

parser 呼叫 `resolveAssignmentFormula()` 時傳入唯一的 `matchedTeachers[0].id/name`；`deriveTeacherFieldsFromRules()` 亦逐欄保留 metadata。

resolver pre-check 改成：先檢查 requirement 已有教師；否則對 Excel 明示 class-specific token，使用 `currentTeacherId/currentTeacherName` 建立 `excel-explicit`；否則若 `req.defaultTeacher === 'homeroom'` 且 `class.homeroom_teacher` 非空，建立 `homeroom-default` class-specific rule；兩者皆無才 blocker。不得讓年級批次 token 自動搶走個別調整班；仍排除該班出一般 batch 候選集合。

materializer 必須將 `homeroom-default` rule 實際寫入該 class requirement 的 `teacher/teacher_name`（不改 `homeroom_teacher`），並寫入 ledger。測試需含「505 Excel explicit＋同年級 batch」不得雙重計數／搶班，以及「305 default homeroom 實際落班、批次美勞不得覆蓋」。

- [ ] **Step 4: 執行綠燈測試**

Run: `npx vitest run tests/subjectAssignmentFormulaResolver.test.js`

Expected: PASS；無來源案例仍 blocker。

### Task 2: 建立可判定相同、衝突與新增的 reconciliation ledger

**Files:**

- Modify: `src/utils/subjectAssignmentMaterializer.js:490-745`
- Test: `tests/SubjectAssignmentIntegration.test.js`

**Interfaces:**

- Produces: `materializeImportedAssignmentRules({ ..., overwriteConflicts })` 回傳 `assignmentLedger` entries，entry 包含 `status: 'created' | 'matched-existing' | 'overwritten' | 'conflict'`、`teacherId`、`teacherName`、`grade`、`subject`、`className`、`periods`、`existingTeacherName`。
- Produces: 回傳 `conflicts: Array`；未允許複寫且有衝突時 `{ success:false, error, conflicts }`，不修改 classes。

- [ ] **Step 1: 寫失敗測試**

```js
const same = materializeImportedAssignmentRules({ classes: alreadyAssigned, teachers: [wu] })
expect(same.success).toBe(true)
expect(same.assignmentLedger).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ status: 'matched-existing', teacherName: '吳品璇', periods: 1 }),
  ]),
)
expect(same.assignedCount).toBe(0)

const conflict = materializeImportedAssignmentRules({
  classes: assignedToOtherTeacher,
  teachers: [wu],
})
expect(conflict.success).toBe(false)
expect(conflict.conflicts[0]).toMatchObject({ className: '5年5班', subject: '音樂' })
```

加入同一班同科既有教師與 Excel 相同但 `assignmentSource` 不同仍 matched；節數不同或教師不同必須 conflict；`overwriteConflicts: true` 才覆寫並標記 `overwritten`。

- [ ] **Step 2: 執行紅燈測試**

Run: `npx vitest run tests/SubjectAssignmentIntegration.test.js`

Expected: FAIL，現況 ledger 只記錄新 mutation，既有相同資料沒有 entry。

- [ ] **Step 3: 最小實作**

在重設 `subject-excel-import` 資料以前，先對獨立的 classes draft 執行只針對本次 imported pairs 的可合併 `_split_` requirements 正規化：以班級＋科目＋baseId 合併未鎖定且無手動／mixed override 的 chunks，將其還原為完整 periods 後才比較。從 teachers 以 `req.teacher/teacher_name` 唯一反查既有教師；ID 相同才視為同人，僅在雙方皆無 ID 且姓名唯一時 fallback。找不到或同名多筆必須成為 conflict，不能以名稱誤判相同。比對亦要求 subject match 與完整 `req.periods` 相等。

```js
if (sameTeacher && samePeriods) {
  ledger.push({ status: 'matched-existing', ... })
  ruleAssigned += req.periods
  continue
}
if (existingTeacher || existingPeriodsConflict) {
  conflicts.push({ className, grade, subject, existingTeacherName, requestedTeacherName, existingPeriods, requestedPeriods })
  continue
}
```

未確認複寫時有任何 conflict 必須在 mutation 前回傳原始 classes／teachers references；確認複寫時僅從已正規化的 draft 對衝突 scope 寫入、紀錄 `overwritten`。不可把 matched-existing 清空重分配。batch rule 的候選班與 class-specific 預約必須在第一次規劃後保存為穩定 allocation plan，重試不可重新挑選班級或改變 conflict 集合。

- [ ] **Step 4: 執行綠燈測試**

Run: `npx vitest run tests/SubjectAssignmentIntegration.test.js`

Expected: PASS。

### Task 3: 讓落地驗證採計既有相同資料，並保持原子性

**Files:**

- Modify: `src/utils/mixedTeachingPlan.js:683-755`
- Modify: `src/components/SubjectExcelImport.vue:560-635`
- Test: `tests/mixedTeachingPlan.test.js`
- Test: `tests/subjectExcelImport.test.js`

**Interfaces:**

- Consumes: Task 2 ledger `created`、`matched-existing`、`overwritten`；`conflict` 不可計入。
- Produces: 合法既有相同資料通過驗證；未確認差異停留於匯入衝突確認畫面，不更新 store 或同步。

- [ ] **Step 1: 寫失敗測試**

```js
const validation = validateImportedTeacherAssignments({
  parsedRows,
  teachers,
  assignmentLedger: [
    {
      status: 'matched-existing',
      teacherId: 10,
      teacherName: '吳品璇',
      grade: 5,
      subject: '音樂',
      periods: 16,
    },
  ],
})
expect(validation.valid).toBe(true)
```

另加 UI 重複匯入案例：第二次匯入完全相同檔案，顯示成功／略過，不顯示「實際已配 0 節」，不產生衝突對話；不同教師時顯示差異與既有複寫確認，未確認不得同步。

- [ ] **Step 2: 執行紅燈測試**

Run: `npx vitest run tests/mixedTeachingPlan.test.js tests/subjectExcelImport.test.js`

Expected: FAIL，現況既有資料沒有 ledger entry，驗證顯示 0。

- [ ] **Step 3: 最小實作**

驗證器只計入 `created`、`matched-existing`、`overwritten`。新增 UI 狀態 `pendingImportConflicts` 與不可變 `pendingImportTransaction`：後者保存 `parsedRows` snapshot、`resolutions`、`confirmedHomeroomTeacherIds`、mixed auto allocation seed／已選班與第一次產生的 stable allocation plan。第一次 `commitImport({ transaction, overwriteConflicts:false })` 遇 conflict 時，materializer 回傳原 classes 與 conflicts，UI 不更新 store／不同步，只顯示「班級／科目／既有教師與節數／Excel 教師與節數」。操作員明確確認後才以**同一 transaction**呼叫 `commitImport({ transaction, overwriteConflicts:true })` 重試；取消時清空 pending 狀態且不變更 store。既有 `confirmOverwrite` 只維持教師規則資料覆寫 gate，不能作為每次相同匯入都需勾選的 conflict gate。所有早退分支保持 classes、teachers、sync 原子性不變。

- [ ] **Step 4: 執行綠燈測試**

Run: `npx vitest run tests/mixedTeachingPlan.test.js tests/subjectExcelImport.test.js`

Expected: PASS。

### Task 4: 完整案例回放與交付驗證

**Files:**

- Test: `tests/subjectAssignmentFormulaResolver.test.js`
- Test: `tests/SubjectAssignmentIntegration.test.js`
- Test: `tests/mixedTeachingPlan.test.js`
- Test: `tests/subjectExcelImport.test.js`

- [ ] **Step 1: 加入匿名化整體案例**

案例必須同時含：505／605 音樂個別節數且由 Excel 指定吳品璇、305／405 美勞個別節數且由班導來源推導並實際寫入、同科 batch 不搶指定班、第一次寫入、第二次相同匯入、以及同班同科不同教師／節數／無法唯一反查教師的複寫 conflict。另驗證既有 split requirement 完全相同時為 matched-existing，split 差異拒絕／確認覆寫皆無重複遺漏；拒絕 conflict 後 classes 與 teachers 深度相同，確認複寫只改精確 class＋subject；含 mixed plan 的 conflict 重試必須使用原 resolutions／seed，不能遺失或重新分班。

- [ ] **Step 2: 執行聚焦驗收**

Run: `npx vitest run tests/subjectAssignmentFormulaResolver.test.js tests/SubjectAssignmentIntegration.test.js tests/mixedTeachingPlan.test.js tests/subjectExcelImport.test.js tests/MixedTeachingResolutionDialog.test.js`

Expected: 全數 PASS；沒有合法既有資料被報為 0 節。

- [ ] **Step 3: 建置與範圍檢查**

Run: `npm run build`

Expected: exit 0；可接受既有 Vite bundle-size warning。

Run: `git diff --check`

Expected: 無輸出。

- [ ] **Step 4: 手動 UI 驗收清單**

在 `/classes` 匯入：未先手填 505／605 音樂與 305／405 美勞教師時，確認來源可被推導；再匯入相同檔案，確認同資料略過；將一筆既有教師改成不同姓名，確認顯示差異並經複寫確認才更新。

## Self-Review

- **Spec coverage:** Task 1 解決來源可得卻誤阻擋；Task 2 區分新增、相同與衝突；Task 3 修正 ledger 誤報及 UI 複寫決議；Task 4 覆蓋三項使用者回報案例。
- **Placeholder scan:** 無 TBD/TODO 或未定義的驗證行為。
- **Type consistency:** `status` 僅能是 `created`、`matched-existing`、`overwritten`、`conflict`；驗證器只採計前三者；UI 以 Task 2 `conflicts` 觸發複寫確認。
