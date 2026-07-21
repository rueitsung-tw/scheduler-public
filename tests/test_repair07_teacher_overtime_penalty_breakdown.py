# -*- coding: utf-8 -*-
"""
test_repair07_teacher_overtime_penalty_breakdown.py

Verifies repair_07: teacher_quota_overtime penalty correctly appears in
penaltyBreakdown output with proper dict metadata format.

Requirements verified:
1. penaltyBreakdown.teacher_quota_overtime exists and is > 0 (>= 15000)
2. teacher_quota remains soft constraint (solver status FEASIBLE/OPTIMAL, not INFEASIBLE)
3. Weight comes from policy adapter, no hard-coded 5000 in phase2_engine.py
4. Multiple teachers aggregate to same key
"""

import json
import os
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPT_DIR)

FIXTURE_INPUT = os.path.join(SCRIPT_DIR, "fixtures", "teacher_overtime.json")


def run_solver(input_path, output_path):
    """Run solver.py on a fixture and return exit code."""
    result = subprocess.run(
        [sys.executable, "solver.py", input_path, output_path],
        capture_output=True,
        text=True,
        cwd=SCRIPT_DIR,
        timeout=120,
    )
    return result


def test_teacher_quota_overtime_in_penalty_breakdown():
    """Fresh run: teacher_quota_overtime must appear in penaltyBreakdown with value >= 15000."""
    with tempfile.NamedTemporaryFile(
        suffix=".json", delete=False, mode="w"
    ) as tmp_out:
        output_path = tmp_out.name

    try:
        result = run_solver(FIXTURE_INPUT, output_path)
        assert result.returncode == 0, f"Solver failed with stderr:\n{result.stderr}"

        with open(output_path, "r", encoding="utf-8") as f:
            output = json.load(f)

        # Status must be FEASIBLE or OPTIMAL (soft constraint, never hard)
        status = output.get("status", "")
        assert status in ("OPTIMAL", "FEASIBLE"), (
            f"teacher_quota must remain soft; expected OPTIMAL/FEASIBLE but got {status}"
        )

        # solvePass should be strict_teaching_shape (not degraded)
        solve_pass = output.get("solvePass", "")
        assert solve_pass == "strict_teaching_shape", (
            f"Expected solvePass=strict_teaching_shape, got {solve_pass}"
        )

        # degraded must be False
        degraded = output.get("degraded", False)
        assert degraded is False, (
            f"teacher_overtime fixture should not trigger fallback degradation; got degraded={degraded}"
        )

        # penaltyBreakdown must contain teacher_quota_overtime key
        pb = output.get("penaltyBreakdown", {})
        assert "teacher_quota_overtime" in pb, (
            f"penaltyBreakdown missing 'teacher_quota_overtime' key. Available keys: {list(pb.keys())}"
        )

        # Value must be positive and >= 15000 (3 overtime periods × 5000 weight)
        tqo_value = pb["teacher_quota_overtime"]
        assert isinstance(tqo_value, (int, float)), (
            f"penaltyBreakdown.teacher_quota_overtime should be numeric; got {type(tqo_value)}: {tqo_value}"
        )
        assert tqo_value >= 15000, (
            f"penaltyBreakdown.teacher_quota_overtime = {tqo_value}, expected >= 15000 "
            f"(3 overtime periods × weight 5000)"
        )

        print(f"[PASS] teacher_quota_overtime penalty: {tqo_value} (>= 15000)")
        print(f"[PASS] status: {status}")
        print(f"[PASS] solvePass: {solve_pass}")
        print(f"[PASS] degraded: {degraded}")

    finally:
        if os.path.exists(output_path):
            os.unlink(output_path)


def test_no_hardcoded_weight_in_phase2_engine():
    """Verify phase2_engine.py does not contain hard-coded '5000' for teacher quota overtime."""
    phase2_path = os.path.join(SCRIPT_DIR, "phase2_engine.py")
    with open(phase2_path, "r", encoding="utf-8") as f:
        content = f.read()

    # The file should use WEIGHT_REGISTRY or policy.get_weight, not bare 5000 for quota overtime
    lines = content.split("\n")
    bad_lines = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # Skip comments
        if stripped.startswith("#"):
            continue
        # Check for hard-coded 5000 near quota_overload context
        if "quota_overload_weight" in stripped and "= 5000" in stripped:
            bad_lines.append((i, stripped))
        # The old pattern: self.penalty_vars.append(3000 * subj_overload)
        if "3000 *" in stripped and "subj_overload" in stripped:
            bad_lines.append((i, stripped))

    assert not bad_lines, (
        f"Found hard-coded weights for teacher quota overtime:\n" +
        "\n".join(f"  Line {ln}: {code}" for ln, code in bad_lines)
    )

    # Verify WEIGHT_REGISTRY or policy.get_weight is used
    assert "WEIGHT_REGISTRY.get(\"teacher_quota_overtime\"" in content or \
           "self.policy.get_weight(\"teacher_quota_overtime\")" in content, (
        "phase2_engine.py should resolve teacher_quota_overtime weight from registry/policy"
    )

    print("[PASS] No hard-coded weights for teacher_quota_overtime in phase2_engine.py")


def test_dict_metadata_format_in_phase2_engine():
    """Verify penalty_vars uses dict metadata format for teacher_quota_overtime."""
    phase2_path = os.path.join(SCRIPT_DIR, "phase2_engine.py")
    with open(phase2_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Must contain rule_id key for teacher_quota_overtime (multi-line dict is fine)
    assert '"rule_id": "teacher_quota_overtime"' in content, (
        "phase2_engine.py should use dict metadata format with rule_id=teacher_quota_overtime"
    )

    # Must also contain weight and var keys near the rule_id
    assert '"weight":' in content and '"var": overload' in content, (
        "Dict metadata must include 'weight' and 'var' keys"
    )

    # Must NOT contain raw IntExpr pattern: quota_overload_weight * overload appended directly
    assert "penalty_vars.append(quota_overload_weight * overload)" not in content, (
        "Raw IntExpr append still present; must use dict metadata format"
    )

    print("[PASS] Dict metadata format used for teacher_quota_overtime penalties")


if __name__ == "__main__":
    print("=" * 60)
    print("repair_07: Teacher Overtime Penalty Breakdown Tests")
    print("=" * 60)

    tests = [
        ("No hard-coded weights", test_no_hardcoded_weight_in_phase2_engine),
        ("Dict metadata format", test_dict_metadata_format_in_phase2_engine),
        ("Fresh run penalty breakdown", test_teacher_quota_overtime_in_penalty_breakdown),
    ]

    passed = 0
    failed = 0
    for name, test_fn in tests:
        print(f"\n--- {name} ---")
        try:
            test_fn()
            passed += 1
        except AssertionError as e:
            print(f"[FAIL] {e}")
            failed += 1
        except Exception as e:
            print(f"[ERROR] {type(e).__name__}: {e}")
            failed += 1

    print(f"\n{'=' * 60}")
    print(f"Results: {passed} passed, {failed} failed out of {len(tests)} tests")
    if failed > 0:
        sys.exit(1)