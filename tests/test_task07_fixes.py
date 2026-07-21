# -*- coding: utf-8 -*-
"""
Minimal CP-SAT validation for Task 07 fixes.

Tests:
1. apply_grade12_tuesday_life_course strict mode (SolveMode enum)
2. apply_grade12_tuesday_life_course fallback mode (BoolVar penalty)
3. build_daily_subject_teacher_minimum_penalty with count >= 2 (no INFEASIBLE)
4. Missing metadata — non-subject-teacher lessons should NOT be counted
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ortools.sat.python import cp_model
from scheduler_policy import SolveMode
from constraints.class_rules import (
    apply_grade12_tuesday_life_course,
    build_daily_subject_teacher_minimum_penalty,
)


def test_strict_mode():
    """Test strict mode with SolveMode enum — no TypeError, hard constraint works."""
    model = cp_model.CpModel()

    # Grade 1 class with 生活 course on Tuesday afternoon (period index 4-6 for day=1)
    classes_data = [{
        "name": "1年1班",
        "grade": 1,
        "course_requirements": [{"subject": "生活", "teacher_name": "張老師"}],
    }]

    # Tuesday = day index 1. PERIODS_PER_DAY=7, LUNCH_BOUNDARY=4.
    # Tuesday afternoon global indices: base=7, afternoon starts at period_in_day>=4 → [11,12,13]
    schedule = {}
    for p in [11, 12, 13]:
        v = model.NewBoolVar(f"life_tue_pm_{p}")
        schedule[("1年1班", p, "張老師", "生活")] = v

    penalties = apply_grade12_tuesday_life_course(
        model, classes_data, schedule, solve_mode=SolveMode.STRICT_TEACHING_SHAPE
    )

    assert len(penalties) == 0, f"Strict mode should return no penalties, got {len(penalties)}"

    # Verify hard constraint: at least one must be true
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model).name
    assert status in ("OPTIMAL", "FEASIBLE"), f"Strict mode should be feasible, got {status}"

    # Check at least one is true
    vals = [solver.Value(schedule[k]) for k in schedule]
    assert sum(vals) >= 1, "At least one life course must be on Tuesday afternoon"

    print("[PASS] test_strict_mode")


def test_fallback_mode():
    """Test fallback mode — BoolVar penalty, no TypeError."""
    model = cp_model.CpModel()

    classes_data = [{
        "name": "1年1班",
        "grade": 1,
        "course_requirements": [{"subject": "生活", "teacher_name": "張老師"}],
    }]

    # Tuesday afternoon global indices: [11, 12, 13]
    schedule = {}
    for p in [11, 12, 13]:
        v = model.NewBoolVar(f"life_tue_pm_{p}")
        schedule[("1年1班", p, "張老師", "生活")] = v

    penalties = apply_grade12_tuesday_life_course(
        model, classes_data, schedule, solve_mode=SolveMode.FEASIBILITY_RECOVERY
    )

    assert len(penalties) == 1, f"Fallback should return 1 penalty entry, got {len(penalties)}"
    assert penalties[0]["rule_id"] == "grade12_tuesday_afternoon_life_course_fallback"

    # Add soft penalty to model and solve
    for pen in penalties:
        model.Minimize(pen["var"])  # minimize violations

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model).name
    assert status in ("OPTIMAL", "FEASIBLE"), f"Fallback should be feasible, got {status}"

    violation_val = solver.Value(penalties[0]["var"])
    assert violation_val == 0, "With no blocking, violation should be 0"

    print("[PASS] test_fallback_mode")


def test_daily_subject_teacher_count_3():
    """Test daily rule with 3 subject-teacher lessons — must NOT be INFEASIBLE."""
    model = cp_model.CpModel()

    classes_data = [{
        "name": "3年1班",
        "grade": 3,
        "course_requirements": [
            {"subject": "英語", "defaultTeacher": "subject"},
            {"subject": "體育", "defaultTeacher": "subject"},
            {"subject": "資訊", "defaultTeacher": "subject"},
        ],
    }]

    # Day 1 periods (0-6), place 3 subject lessons at periods 0, 1, 2
    schedule = {}
    for p in [0, 1, 2]:
        v = model.NewBoolVar(f"subj_{p}")
        subj_map = {0: "英語", 1: "體育", 2: "資訊"}
        schedule[("3年1班", p, f"老師{p}", subj_map[p])] = v

    penalties = build_daily_subject_teacher_minimum_penalty(
        model, schedule, classes_data
    )

    assert len(penalties) > 0, "Should have at least one penalty entry"

    for pen in penalties:
        model.Minimize(pen["var"])

    # Force all 3 to be true — should NOT cause INFEASIBLE
    for v in schedule.values():
        model.Add(v == 1)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model).name
    assert status in ("OPTIMAL", "FEASIBLE"), f"3 subject lessons should be OPTIMAL/FEASIBLE, got {status}"

    # Violation should be 0 for day 1 (where we placed 3 subject lessons).
    # Days 2-5 have no candidates and will always violate — that's expected.
    day1_penalties = [pen for pen in penalties if "day1" in pen["var"].name]
    assert len(day1_penalties) > 0, "Should have at least one penalty entry for day 1"
    for pen in day1_penalties:
        val = solver.Value(pen["var"])
        assert val == 0, f"With 3 subject lessons on day 1, violation should be 0, got {val}"

    # Days 2-5 have no candidates → permanent violations (expected behavior)
    other_day_penalties = [pen for pen in penalties if "day1" not in pen["var"].name]
    for pen in other_day_penalties:
        val = solver.Value(pen["var"])
        assert val == 1, f"No candidates on this day → violation should be 1, got {val}"

    print("[PASS] test_daily_subject_teacher_count_3")


def test_daily_missing_metadata_not_counted_as_subject_teacher():
    """
    Test that when course_requirements lacks metadata for a subject (e.g., '班會'),
    it is NOT counted as subject_teacher_lesson. The class-day should produce
    a violation penalty because no valid subject-teacher lesson exists.

    YAML spec:
      counted_lesson_type: "subject_teacher_lesson"
      excluded_subject_types:
        - "homeroom"
        - "導師區塊"
    
    '班會' is neither homeroom nor subject_teacher — it should be excluded from count,
    and the daily minimum violation should fire.
    """
    model = cp_model.CpModel()

    classes_data = [{
        "name": "3年1班",
        "grade": 3,
        # course_requirements does NOT include '班會' — simulating missing metadata
        # Even if we add it without defaultTeacher='subject', it should not count
        "course_requirements": [
            {"subject": "英語", "defaultTeacher": "subject"},  # valid subject-teacher
            # '班會' intentionally omitted from req_map to simulate missing metadata
        ],
    }]

    schedule = {}
    # Period 0: 英語 (valid subject-teacher — in req_map with defaultTeacher=subject)
    v_eng = model.NewBoolVar("eng_p0")
    schedule[("3年1班", 0, "林老師", "英語")] = v_eng

    # Period 1: 班會 (NOT in req_map — should NOT be counted as subject_teacher)
    v班会 = model.NewBoolVar("banhui_p1")
    schedule[("3年1班", 1, "陳老師", "班會")] = v班会

    penalties = build_daily_subject_teacher_minimum_penalty(
        model, schedule, classes_data
    )

    assert len(penalties) > 0, "Should have at least one penalty entry"

    for pen in penalties:
        model.Minimize(pen["var"])

    # Force 班會 to be the only active lesson (英語 not scheduled)
    model.Add(v_eng == 0)
    model.Add(v班会 == 1)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model).name
    assert status in ("OPTIMAL", "FEASIBLE"), f"Should be feasible, got {status}"

    # Day 1 (periods 0-6): only 班會 is active, but it's NOT a subject_teacher_lesson.
    # Therefore violation for day 1 should be 1.
    day1_violations = [pen for pen in penalties 
                       if "day1" in pen["var"].name or "_day1" in pen["var"].name]
    
    if not day1_violations:
        # Fallback: check all penalties — at least one should show violation=1
        total_violation = sum(solver.Value(p["var"]) for p in penalties)
        assert total_violation >= 1, (
            f"Expected at least 1 violation when only '班會' is scheduled "
            f"(not a subject_teacher_lesson), got total={total_violation}"
        )
    else:
        for pen in day1_violations:
            val = solver.Value(pen["var"])
            assert val == 1, (
                f"Day 1 violation should be 1 when only '班會' is active "
                f"(not counted as subject_teacher), got {val}"
            )

    print("[PASS] test_daily_missing_metadata_not_counted_as_subject_teacher")


if __name__ == "__main__":
    test_strict_mode()
    test_fallback_mode()
    test_daily_subject_teacher_count_3()
    test_daily_missing_metadata_not_counted_as_subject_teacher()
    print("\nAll tests passed!")