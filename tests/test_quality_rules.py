from pathlib import Path
from ortools.sat.python import cp_model
from scheduler_policy import WEIGHT_REGISTRY, SolveMode, get_active_policy
from phase2_engine import SchedulePhase2Engine
from grade_time_rules import GradeTimeRule
from constraints.class_rules import apply_grade_time_hard_constraints


def test_quality_rule_penalty_keys_registered():
    required = {
        "soft_slot_rule_avoid",
        "teacher_daily_load_smoothing",
        "same_teacher_grade_consistency",
        "period7_flexible_preference",
        "pe_avoid_period_45",
    }

    missing = required - set(WEIGHT_REGISTRY)
    assert missing == set()
    assert WEIGHT_REGISTRY["pe_avoid_period_45"] == 20
    assert WEIGHT_REGISTRY["period7_flexible_preference"] == 20


def test_lowest_weight_rules_are_lowest_tier():
    assert WEIGHT_REGISTRY["period7_flexible_preference"] <= WEIGHT_REGISTRY["teacher_daily_load_smoothing"]
    assert WEIGHT_REGISTRY["pe_avoid_period_45"] <= WEIGHT_REGISTRY["teacher_daily_load_smoothing"]


def test_phase2_engine_wires_quality_builders_into_objective():
    source = Path("phase2_engine.py").read_text(encoding="utf-8")
    required_calls = [
        "_build_soft_slot_rule_penalty(",
        "_build_teacher_daily_load_smoothing(",
        "_build_grade_consistency_penalty(",
        "_build_period7_flexible_preference(",
        "_build_pe_avoid_45(",
    ]
    missing = [call for call in required_calls if source.count(call) < 2]
    assert missing == []


def test_grade_time_rules_do_not_disable_pe_avoid_45():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "5年1班"
    p_idx = 3  # day 1 period 4
    v_pe = model.NewBoolVar("pe_var")
    schedule[(c_name, p_idx, "體育老師", "體育")] = v_pe

    engine = SchedulePhase2Engine(
        model=model,
        schedule=schedule,
        classes=[c_name],
        teachers=["體育老師"],
        total_periods=35,
        classes_data=[{"name": c_name, "grade": 5}],
        build_level="quality",
    )
    engine.build_soft_constraints()
    assert any(engine._penalty_expr(p) is not None and "20 *" in str(engine._penalty_expr(p)) for p in engine.penalty_vars)


def test_grade_time_rules_do_not_disable_period7_flexible_preference():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "5年1班"
    p_idx = 6  # day 1 period 7
    v_math = model.NewBoolVar("math_var")
    schedule[(c_name, p_idx, "數學老師", "數學")] = v_math

    engine = SchedulePhase2Engine(
        model=model,
        schedule=schedule,
        classes=[c_name],
        teachers=["數學老師"],
        total_periods=35,
        classes_data=[{"name": c_name, "grade": 5}],
        build_level="quality",
    )
    engine.build_soft_constraints()
    assert any(engine._penalty_expr(p) is not None and "20 *" in str(engine._penalty_expr(p)) for p in engine.penalty_vars)


def test_hard_pe_at_period_4_keeps_pe_penalty_in_breakdown():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "5年1班"
    p_idx = 3  # day 1 period 4 (P4)
    v_pe = model.NewBoolVar("pe_var")
    schedule[(c_name, p_idx, "體育老師", "體育")] = v_pe

    classes_data = [{"name": c_name, "grade": 5}]

    # Apply Hard Grade Time Rule requiring PE at P4
    rule = GradeTimeRule(
        id="hard-pe-p4",
        enabled=True,
        enforcement_mode="hard",
        grades=(5,),
        day=1,
        periods=(4,),
        rule_type="require_subject",
        subject_name="體育",
    )
    apply_grade_time_hard_constraints(model, schedule, classes_data, [rule])

    # Build Phase 2 quality constraints
    school_info = {"gradeTimeRulesSettings": {"enabled": True, "rules": [rule]}}
    engine = SchedulePhase2Engine(
        model=model,
        schedule=schedule,
        classes=[c_name],
        teachers=["體育老師"],
        total_periods=35,
        classes_data=classes_data,
        school_info=school_info,
        build_level="quality",
    )
    engine.build_soft_constraints()

    # Even though hard rule enforces PE at P4, pe_avoid_45 penalty builder MUST still create its penalty term
    pe_penalties = [p for p in engine.penalty_vars if engine._penalty_expr(p) is not None and "20 *" in str(engine._penalty_expr(p))]
    assert len(pe_penalties) > 0


def test_hard_core_subject_at_period_7_keeps_period7_penalty_in_breakdown():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "4年1班"
    p_idx = 6  # day 1 period 7 (P7)
    v_math = model.NewBoolVar("math_var")
    schedule[(c_name, p_idx, "數學老師", "數學")] = v_math

    classes_data = [{"name": c_name, "grade": 4}]

    # Apply Hard Grade Time Rule requiring Math at P7
    rule = GradeTimeRule(
        id="hard-math-p7",
        enabled=True,
        enforcement_mode="hard",
        grades=(4,),
        day=1,
        periods=(7,),
        rule_type="require_subject",
        subject_name="數學",
    )
    apply_grade_time_hard_constraints(model, schedule, classes_data, [rule])

    # Build Phase 2 quality constraints
    school_info = {"gradeTimeRulesSettings": {"enabled": True, "rules": [rule]}}
    engine = SchedulePhase2Engine(
        model=model,
        schedule=schedule,
        classes=[c_name],
        teachers=["數學老師"],
        total_periods=35,
        classes_data=classes_data,
        school_info=school_info,
        build_level="quality",
    )
    engine.build_soft_constraints()

    # Even though hard rule enforces Math at P7, period7_flexible_preference penalty builder MUST still create its penalty term
    p7_penalties = [p for p in engine.penalty_vars if engine._penalty_expr(p) is not None and "20 *" in str(engine._penalty_expr(p))]
    assert len(p7_penalties) > 0
