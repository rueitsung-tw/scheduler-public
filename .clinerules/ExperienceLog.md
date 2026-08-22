# Experience Log

這份文件只保留穩定教訓與最近訊號，避免把歷史流水帳塞進每次預讀。

完整歷史已封存到 `.clinerules/archive/ExperienceLog.full-2026-07-20.md`。

## Stable Lessons

- Solver / constraint 變更後，不要只看 source-inspection 或單元測試；正式結論必須回到同輪 evidence chain。
- UI 可輸入值若超出 parser / policy 支援範圍，後端很可能會靜默忽略；這類落差一律視為 bug。
- `manual_locks`、抽離課程、專科容量與教師可用時段是動態交互；修補不得綁固定班級、固定時段或單一樣本。
- 政策、驗證腳本、Rules、CodeMap 若不同步，規格與實作會快速分叉。
- `debug_payload.json` 只能用於診斷，不能當正式 workaround 或驗收證據。

## Escalate When

- 任務在判定正式交付、dual review、或 acceptance gating
- 任務涉及專科教室容量、repair/backfill、或 `INFEASIBLE`
- 任務要求同步 `F:\scheduler-public`

## Recent Signals

- 2026-08-22: rules/docs changed -> sync policy, validation, and map
- 2026-08-22: manual locks or room pressure touched -> avoid sample-specific fixes；rules/docs changed -> sync policy, validation, and map
- 2026-08-22: UI/store changed -> verify parser and policy alignment；rules/docs changed -> sync policy, validation, and map
- 2026-08-22: solver/constraint changed -> re-check same-round evidence chain；rules/docs changed -> sync policy, validation, and map
- 2026-08-21: rules/docs changed -> sync policy, validation, and map
- 2026-08-21: solver/constraint changed -> re-check same-round evidence chain
- 2026-08-21: UI/store changed -> verify parser and policy alignment
- 2026-08-20: manual locks or room pressure touched -> avoid sample-specific fixes
- 2026-08-14: rules/docs changed -> sync policy, validation, and map
- 2026-08-13: rules/docs changed -> sync policy, validation, and map
- 2026-08-13: UI/store changed -> verify parser and policy alignment；manual locks or room pressure touched -> avoid sample-specific fixes
- 2026-08-13: manual locks or room pressure touched -> avoid sample-specific fixes；rules/docs changed -> sync policy, validation, and map
