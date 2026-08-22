---
name: agy-delegation
description: Codex plans and reviews while AGY implements bounded coding work in this repository. Use when a user asks to delegate a coding task to AGY or asks Codex to supervise AGY.
---

# AGY Delegation

Use `agy_delegate` for writes when it is available; otherwise use `agy_ask` and require the final response `AGY_DONE`. Use an isolated worktree, one microtask, narrow read/write paths, and one stated acceptance command. Never run Git commands or install packages. Codex independently checks changed paths, `git diff --check`, and the stated tests before accepting a diff. Apply an accepted patch to the primary worktree only in a separate AGY microtask. Classify failures; stop after three consecutive failures in the same category and never auto-switch executor. Cline uses this same controlled lifecycle only when the manifest explicitly specifies `executor: "cline"`.
