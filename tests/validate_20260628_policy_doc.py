# -*- coding: utf-8 -*-
"""
Validate the 2026-06-28 co-planning / homeroom daily cap policy document.

Purpose:
1. Ensure the new YAML policy file exists.
2. Ensure key policy IDs and contracts are present.
3. Catch obvious omissions or contradictory requirements before implementation.

No PyYAML dependency required.

Usage:
    python tests/validate_20260628_policy_doc.py
"""

from __future__ import annotations

import os
import sys


POLICY_REL_PATH = os.path.join(
    "docs",
    "2026-06-28_co_planning_manual_block_and_homeroom_daily_cap_policy.yaml",
)


def _repo_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    return root


def _read_policy_text() -> str:
    path = os.path.join(_repo_root(), POLICY_REL_PATH)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Missing policy file: {POLICY_REL_PATH}")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _require_contains(text: str, needle: str, errors: list[str]) -> None:
    if needle not in text:
        errors.append(f"Missing required content: {needle}")


def check_policy_document() -> list[str]:
    errors: list[str] = []
    text = _read_policy_text()

    required_literals = [
        '標題: "五六年級共備人工指定時段與導師每日四節上限政策"',
        'id: "KEEP-01"',
        'id: "KEEP-02"',
        'id: "NEW-03"',
        'id: "NEW-04"',
        'id: "DROP-05-07"',
        'id: "POLICY-CP-01"',
        'id: "POLICY-CP-02"',
        'id: "POLICY-CP-03"',
        'id: "POLICY-CP-04"',
        'id: "POLICY-HR-01"',
        'id: "P0-06"',
        'id: "P0-07"',
        'id: "P0-08"',
        '報告檔案: "F:\\\\AI課表分析報告_2026-06-28T00-46-09-239Z.json"',
        'subject: "資訊"',
        'configured_capacity: 2',
        'slot: "D1P5"',
        'slot: "D2P3"',
        'slot: "D5P4"',
        'manual locks / 抽離課程鎖定造成的動態擠壓',
        'id: "AC-BASE-ROOM-01"',
        'id: "AC-BASE-ROOM-02"',
        'id: "AC-BASE-ROOM-03"',
        'id: "AC-BASE-ROOM-04"',
        'id: "AC-BASE-ROOM-05"',
        'allowed_grades: [5, 6]',
        'forbidden_grades: [1, 2, 3, 4]',
        'mode: "auto"',
        'manualBlocks:',
        '"5": null',
        '"6": null',
        'block_selection: "hard_constraint"',
        'lesson_during_block: "near_hard_soft_constraint"',
        'registry_key: "homeroom_daily_max_periods"',
        'recommended_numeric_weight: 3200',
        'key: "manual_co_planning_subject_teacher_lesson"',
        'numeric_weight: 9000',
        '檔案: "src/views/AiSettingsView.vue"',
        'mode 允許值：auto | manual',
        '不得讓 1-4 年級出現在共備啟用年級。',
        'id: "AC-CP-05"',
        'id: "AC-HR-03"',
        'python tests/test_info_room_capacity_regression.py',
        'id: "TASK-BASE-INFO-ROOM"',
        'id: "TASK-BASE-MANUAL-LOCK-AUDIT"',
        'id: "TASK-BASE-CONFLICT-FIX-AUDIT"',
    ]

    for needle in required_literals:
        _require_contains(text, needle, errors)

    if 'grade_co_planning_afternoon_block' not in text or 'co_planning_subject_teacher_lesson' not in text:
        errors.append("Existing co-planning soft rule keys must be preserved in the new policy.")

    if 'Prisma schema migration' not in text and 'prisma/schema.prisma' not in text:
        errors.append("Policy must explicitly state that Prisma migration is out of scope.")

    if text.count('allowed_grades: [5, 6]') != 1:
        errors.append("allowed_grades: [5, 6] should appear exactly once to avoid conflicting grade scopes.")

    if text.count('subject: "資訊"') != 1:
        errors.append('The info-room baseline issue should be declared exactly once to avoid conflicting hard-issue summaries.')

    if '不得再出現 subject=資訊 且 severity=hard 的 room issue。' not in text:
        errors.append("Policy must explicitly require clearing the existing hard info room issues before sign-off.")

    if '不得針對固定班級、固定時段或單一報告樣本硬編碼修補衝堂' not in text:
        errors.append("Policy must explicitly forbid hard-coded fixes tied to fixed classes/slots/report samples.")

    if '必須一併改成對普遍情況成立的通則修補' not in text:
        errors.append("Policy must require generalizing any previously sample-specific conflict fixes.")

    if 'manual mode should' in text.lower():
        errors.append("Policy should use finalized normative language, not draft-style 'should' wording in English.")

    return errors


def main() -> int:
    try:
        errors = check_policy_document()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}")
        return 1

    if errors:
        print("ERRORS:")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("OK: 2026-06-28 policy document checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
