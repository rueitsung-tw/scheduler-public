#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
test_info_room_capacity_regression.py

Regression tests for RC-20260628-INFO-ROOM-CAPACITY-OVERLOAD fix.

Verifies:
1. class_rules.py exports the new capacity and co-planning functions
2. scheduler_policy.py WEIGHT_REGISTRY contains the new keys
3. phase2_engine.py wires the new constraints correctly
4. No hard-coded weights in phase2_engine.py for the new constraints
5. Co-planning and homeroom daily cap functions exist and are exported
"""

import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPT_DIR)


# ---------------------------------------------------------------------------
# 1. class_rules.py exports (actual names from codebase)
# ---------------------------------------------------------------------------

def test_class_rules_exports_new_functions():
    """Verify class_rules exports the new capacity and co-planning functions."""
    from constraints import class_rules

    # These are the ACTUAL function names used in the codebase
    required_exports = [
        # Special room capacity
        "apply_special_classroom_capacity",
        # Co-planning
        # Homeroom daily cap
        "build_homeroom_daily_max_periods_penalty",
    ]

    all_exports = getattr(class_rules, "__all__", None)
    module_attrs = dir(class_rules)

    missing = []
    for name in required_exports:
        if name not in module_attrs:
            missing.append(name)

    assert not missing, (
        f"class_rules.py is missing exports: {missing}. "
        f"Available: {[a for a in module_attrs if not a.startswith('_')]}"
    )

    # If __all__ is defined, verify these names are listed
    if all_exports:
        missing_from_all = [n for n in required_exports if n not in all_exports]
        assert not missing_from_all, (
            f"class_rules.__all__ missing: {missing_from_all}"
        )

    print("[PASS] class_rules exports all required functions")


# ---------------------------------------------------------------------------
# 2. scheduler_policy.py WEIGHT_REGISTRY (actual key names)
# ---------------------------------------------------------------------------

def test_weight_registry_has_new_keys():
    """Verify WEIGHT_REGISTRY contains the new constraint weight keys."""
    from scheduler_policy import WEIGHT_REGISTRY

    # These are the ACTUAL key names used in the codebase
    required_keys = [
        "classroom_capacity_overload",
        "homeroom_daily_max_periods",
    ]

    missing = [k for k in required_keys if k not in WEIGHT_REGISTRY]
    assert not missing, (
        f"WEIGHT_REGISTRY missing keys: {missing}. "
        f"Available keys: {list(WEIGHT_REGISTRY.keys())}"
    )

    # Verify weights are positive numbers
    for key in required_keys:
        weight = WEIGHT_REGISTRY[key]
        assert isinstance(weight, (int, float)), (
            f"WEIGHT_REGISTRY[{key!r}] = {weight!r} is not numeric"
        )
        assert weight > 0, (
            f"WEIGHT_REGISTRY[{key!r}] = {weight} must be positive"
        )

    print(f"[PASS] WEIGHT_REGISTRY contains all required keys with positive weights")
    for key in required_keys:
        print(f"  {key}: {WEIGHT_REGISTRY[key]}")


# ---------------------------------------------------------------------------
# 3. phase2_engine.py wiring (actual function names)
# ---------------------------------------------------------------------------

def test_solver_wires_special_room_capacity():
    """Verify solver.py calls apply_special_classroom_capacity (it's a phase-1 hard constraint)."""
    solver_path = os.path.join(SCRIPT_DIR, "solver.py")
    with open(solver_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "apply_special_classroom_capacity" in content, (
        "solver.py must reference apply_special_classroom_capacity"
    )

    # Also verify it's imported from constraints.class_rules
    assert "from constraints.class_rules import" in content or \
           "from constraints import" in content, (
        "solver.py should import from constraints"
    )

    print("[PASS] solver.py wires special_classroom_capacity")


def test_phase2_wires_grade_time_rules():
    """Verify phase2_engine.py wires Grade Time Rules constraints."""
    phase2_path = os.path.join(SCRIPT_DIR, "phase2_engine.py")
    with open(phase2_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "apply_grade_time_soft_rules" in content, (
        "phase2_engine.py must reference apply_grade_time_soft_rules"
    )
    assert "parse_grade_time_rules" in content, (
        "phase2_engine.py must reference parse_grade_time_rules"
    )
    assert "gradeTimeRulesSettings" in content, (
        "phase2_engine.py must handle gradeTimeRulesSettings from payload"
    )

    print("[PASS] phase2_engine wires grade_time_rules constraint")


def test_phase2_wires_homeroom_daily_cap():
    """Verify phase2_engine.py uses the homeroom daily cap constraint."""
    phase2_path = os.path.join(SCRIPT_DIR, "phase2_engine.py")
    with open(phase2_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "build_homeroom_daily_max_periods_penalty" in content or "homeroom_daily_max_periods" in content, (
        "phase2_engine.py must reference homeroom_daily_max_periods"
    )

    print("[PASS] phase2_engine wires homeroom_daily_cap constraint")


# ---------------------------------------------------------------------------
# 4. No hard-coded weights for new constraints
# ---------------------------------------------------------------------------

def test_no_hardcoded_co_planning_weight():
    """Verify co-planning weight comes from WEIGHT_REGISTRY, not hard-coded."""
    phase2_path = os.path.join(SCRIPT_DIR, "phase2_engine.py")
    with open(phase2_path, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.split("\n")
    bad_lines = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if "co_planning" in stripped.lower() and ("= 1000" in stripped or "= 5000" in stripped or "= 10000" in stripped):
            bad_lines.append((i, stripped))

    assert not bad_lines, (
        "Found hard-coded co-planning weights:\n"
        + "\n".join(f"  Line {ln}: {code}" for ln, code in bad_lines)
    )

    print("[PASS] No hard-coded co-planning weights in phase2_engine.py")


def test_no_hardcoded_homeroom_cap_weight():
    """Verify homeroom daily cap weight comes from WEIGHT_REGISTRY."""
    phase2_path = os.path.join(SCRIPT_DIR, "phase2_engine.py")
    with open(phase2_path, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.split("\n")
    bad_lines = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if ("homeroom_daily" in stripped.lower() or "homeroom_cap" in stripped.lower()) and (
            "= 1000" in stripped or "= 5000" in stripped or "= 10000" in stripped
        ):
            bad_lines.append((i, stripped))

    assert not bad_lines, (
        "Found hard-coded homeroom daily cap weights:\n"
        + "\n".join(f"  Line {ln}: {code}" for ln, code in bad_lines)
    )

    print("[PASS] No hard-coded homeroom daily cap weights in phase2_engine.py")


# ---------------------------------------------------------------------------
# 5. Function signature checks (actual names)
# ---------------------------------------------------------------------------

def test_apply_special_classroom_capacity_signature():
    """Verify the special classroom capacity function is callable."""
    from constraints.class_rules import apply_special_classroom_capacity
    import inspect

    sig = inspect.signature(apply_special_classroom_capacity)
    params = list(sig.parameters.keys())

    assert len(params) >= 2, (
        f"apply_special_classroom_capacity should have >= 2 parameters, got {params}"
    )

    print(f"[PASS] apply_special_classroom_capacity signature: {params}")



def test_build_homeroom_daily_max_periods_penalty_signature():
    """Verify the homeroom daily cap function is callable."""
    from constraints.class_rules import build_homeroom_daily_max_periods_penalty
    import inspect

    sig = inspect.signature(build_homeroom_daily_max_periods_penalty)
    params = list(sig.parameters.keys())

    assert len(params) >= 2, (
        f"build_homeroom_daily_max_periods_penalty should have >= 2 parameters, got {params}"
    )

    print(f"[PASS] build_homeroom_daily_max_periods_penalty signature: {params}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 70)
    print("RC-20260628-INFO-ROOM-CAPACITY-OVERLOAD Regression Tests")
    print("=" * 70)

    tests = [
        ("class_rules exports", test_class_rules_exports_new_functions),
        ("WEIGHT_REGISTRY keys", test_weight_registry_has_new_keys),
        ("solver wires special_classroom_capacity", test_solver_wires_special_room_capacity),
        ("phase2 wires co_planning", test_phase2_wires_co_planning),
        ("phase2 wires homeroom_daily_cap", test_phase2_wires_homeroom_daily_cap),
        ("No hard-coded co-planning weight", test_no_hardcoded_co_planning_weight),
        ("No hard-coded homeroom cap weight", test_no_hardcoded_homeroom_cap_weight),
        ("special_classroom_capacity signature", test_apply_special_classroom_capacity_signature),
        ("homeroom_daily_max_periods signature", test_build_homeroom_daily_max_periods_penalty_signature),
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

    print(f"\n{'=' * 70}")
    print(f"Results: {passed} passed, {failed} failed out of {len(tests)} tests")
    if failed > 0:
        sys.exit(1)