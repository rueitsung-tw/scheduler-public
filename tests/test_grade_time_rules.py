import importlib.util
import json
from pathlib import Path
import pytest

from grade_time_rules import (
    GradeTimeRule,
    GradeTimeRuleIssue,
    GradeTimeRuleValidationResult,
    parse_grade_time_rules,
    validate_grade_time_rules,
)


def test_legacy_src_config_parser_is_not_importable():
    """The root module is the only supported Python grade-time-rule parser."""
    try:
        legacy_spec = importlib.util.find_spec("src.config.grade_time_rules")
    except ModuleNotFoundError:
        legacy_spec = None
    assert legacy_spec is None


def test_parse_grade_time_rules_ignores_disabled_rules():
    settings = {
        "enabled": True,
        "version": 2,
        "rules": [
            {
                "id": "rule-1",
                "enabled": True,
                "purpose": "general",
                "grades": [1],
                "day": 2,
                "periods": [1],
                "ruleType": "require_subject",
                "subjectName": "校本",
            },
            {
                "id": "rule-2",
                "enabled": False,
                "purpose": "general",
                "grades": [2],
                "day": 3,
                "periods": [2],
                "ruleType": "require_subject",
                "subjectName": "國語",
            },
        ],
    }
    rules = parse_grade_time_rules(settings)
    assert len(rules) == 1
    assert rules[0].id == "rule-1"

    # Also test top-level settings disabled
    disabled_settings = {"enabled": False, "rules": settings["rules"]}
    assert len(parse_grade_time_rules(disabled_settings)) == 0


def test_parse_grade_time_rules_keeps_periods_5_and_6():
    settings = {
        "enabled": True,
        "rules": [
            {
                "id": "rule-coplanning-1",
                "enabled": True,
                "purpose": "co_planning",
                "grades": [5, 6],
                "timeSelectionMode": "fixed",
                "day": 4,
                "periods": [5, 6],
                "fulfillmentThreshold": "all",
            }
        ],
    }
    rules = parse_grade_time_rules(settings)
    assert len(rules) == 1
    assert rules[0].periods == (5, 6)
    assert rules[0].grades == (5, 6)


def test_general_candidate_rule_is_rejected():
    settings = {
        "enabled": True,
        "rules": [
            {
                "id": "bad-general-rule",
                "enabled": True,
                "purpose": "general",
                "timeSelectionMode": "candidate",
                "grades": [3],
                "day": 1,
                "periods": [1],
                "candidateBlocks": [{"day": 1, "startPeriod": 1, "length": 2}],
            }
        ],
    }
    rules = parse_grade_time_rules(settings)
    res = validate_grade_time_rules(rules)
    assert not res.is_valid
    assert any(i.code == "GTR_EMPTY_CANDIDATE_BLOCKS" or i.code == "GTR_INVALID_DAY_OR_PERIOD" for i in res.blocking_issues)


def test_co_planning_strength_is_derived_from_threshold():
    settings_all = {
        "enabled": True,
        "rules": [
            {
                "id": "cp-all",
                "enabled": True,
                "purpose": "co_planning",
                "fulfillmentThreshold": "all",
                "grades": [5],
                "day": 1,
                "periods": [1, 2],
            }
        ],
    }
    settings_90 = {
        "enabled": True,
        "rules": [
            {
                "id": "cp-90",
                "enabled": True,
                "purpose": "co_planning",
                "fulfillmentThreshold": "at_least_90",
                "grades": [5],
                "day": 1,
                "periods": [1, 2],
            }
        ],
    }
    settings_prefer = {
        "enabled": True,
        "rules": [
            {
                "id": "cp-pref",
                "enabled": True,
                "purpose": "co_planning",
                "fulfillmentThreshold": "prefer",
                "grades": [5],
                "day": 1,
                "periods": [1, 2],
            }
        ],
    }

    r_all = parse_grade_time_rules(settings_all)[0]
    r_90 = parse_grade_time_rules(settings_90)[0]
    r_pref = parse_grade_time_rules(settings_prefer)[0]

    assert r_all.enforcement_mode == "hard"
    assert r_all.weight == 9000

    assert r_90.enforcement_mode == "near_hard"
    assert r_90.weight == 6000

    assert r_pref.enforcement_mode == "soft"
    assert r_pref.weight == 3000


def test_validation_state_is_not_part_of_the_dataclass():
    fields = [f.name for f in GradeTimeRule.__dataclass_fields__.values()]
    assert "validationState" not in fields
    assert "validation_state" not in fields
    assert "validationIssues" not in fields
    assert "validation_issues" not in fields


def test_deterministic_conflicts_same_grade_different_subjects():
    r1 = GradeTimeRule(
        id="r1",
        enabled=True,
        grades=(3,),
        day=1,
        periods=(2,),
        rule_type="require_subject",
        subject_name="國語",
    )
    r2 = GradeTimeRule(
        id="r2",
        enabled=True,
        grades=(3,),
        day=1,
        periods=(2,),
        rule_type="require_subject",
        subject_name="數學",
    )
    res = validate_grade_time_rules([r1, r2])
    assert not res.is_valid
    blocking = res.blocking_issues
    assert len(blocking) >= 1
    issue = next(i for i in blocking if i.code == "GTR_REQUIRE_SUBJECT_CONFLICT")
    assert "r1" in issue.rule_ids
    assert "r2" in issue.rule_ids
    assert issue.grade == 3
    assert issue.day == 1
    assert issue.period == 2


def test_deterministic_conflicts_require_and_forbid_teacher_type():
    r1 = GradeTimeRule(
        id="r1",
        enabled=True,
        grades=(4,),
        day=2,
        periods=(3,),
        rule_type="require_teacher_type",
        teacher_type="subject",
    )
    r2 = GradeTimeRule(
        id="r2",
        enabled=True,
        grades=(4,),
        day=2,
        periods=(3,),
        rule_type="forbid_teacher_type",
        teacher_type="subject",
    )
    res = validate_grade_time_rules([r1, r2])
    assert not res.is_valid
    issue = next(i for i in res.blocking_issues if i.code == "GTR_TEACHER_TYPE_CONFLICT")
    assert "r1" in issue.rule_ids and "r2" in issue.rule_ids
    assert issue.grade == 4
    assert issue.day == 2
    assert issue.period == 3


def test_duplicate_rule_conflict():
    r1 = GradeTimeRule(
        id="r1",
        enabled=True,
        grades=(1,),
        day=2,
        periods=(1,),
        rule_type="require_subject",
        subject_name="校本",
    )
    r2 = GradeTimeRule(
        id="r2",
        enabled=True,
        grades=(1,),
        day=2,
        periods=(1,),
        rule_type="require_subject",
        subject_name="校本",
    )
    res = validate_grade_time_rules([r1, r2])
    assert not res.is_valid
    issue = next(i for i in res.blocking_issues if i.code == "GTR_DUPLICATE_RULE")
    assert "r1" in issue.rule_ids and "r2" in issue.rule_ids


def test_invalid_day_or_period():
    r1 = GradeTimeRule(id="r1", enabled=True, grades=(1,), day=6, periods=(1,))
    r2 = GradeTimeRule(id="r2", enabled=True, grades=(1,), day=1, periods=(8,))
    res = validate_grade_time_rules([r1, r2])
    assert not res.is_valid
    codes = [i.code for i in res.blocking_issues]
    assert "GTR_INVALID_DAY_OR_PERIOD" in codes


def test_missing_candidate_blocks():
    r1 = GradeTimeRule(
        id="r1",
        enabled=True,
        purpose="co_planning",
        time_selection_mode="candidate",
        grades=(5,),
        candidate_blocks=(),
    )
    res = validate_grade_time_rules([r1])
    assert not res.is_valid
    issue = next(i for i in res.blocking_issues if i.code == "GTR_EMPTY_CANDIDATE_BLOCKS")
    assert "r1" in issue.rule_ids


def test_hard_pe_at_period_4_is_warning_not_blocking():
    rule = GradeTimeRule(
        id="r-pe",
        enabled=True,
        enforcement_mode="hard",
        grades=(5,),
        day=1,
        periods=(4,),
        rule_type="require_subject",
        subject_name="體育",
    )
    result = validate_grade_time_rules([rule])
    assert len(result.blocking_issues) == 0
    assert len(result.warnings) == 1
    assert result.warnings[0].code == "GTR_PE_PERIOD_45_QUALITY_RISK"
    assert result.warnings[0].grade == 5
    assert result.warnings[0].day == 1
    assert result.warnings[0].period == 4


def test_hard_non_flexible_at_period_7_is_warning_not_blocking():
    rule = GradeTimeRule(
        id="r-p7",
        enabled=True,
        enforcement_mode="hard",
        grades=(4,),
        day=3,
        periods=(7,),
        rule_type="require_subject",
        subject_name="數學",
    )
    result = validate_grade_time_rules([rule])
    assert len(result.blocking_issues) == 0
    assert len(result.warnings) == 1
    assert result.warnings[0].code == "GTR_PERIOD7_FLEXIBLE_QUALITY_RISK"


def test_contract_parity_all_issued_codes_exist_in_contract_json():
    contract_path = Path(__file__).parent.parent / "contracts" / "grade_time_rule_issue_codes.json"
    assert contract_path.exists(), "Contract JSON file must exist"
    with open(contract_path, "r", encoding="utf-8") as f:
        contract = json.load(f)

    # Validate with rules triggering various issues
    r_pe = GradeTimeRule(id="r1", enabled=True, enforcement_mode="hard", grades=(5,), day=1, periods=(4,), rule_type="require_subject", subject_name="體育")
    r_dup1 = GradeTimeRule(id="r2", enabled=True, grades=(1,), day=2, periods=(1,), rule_type="require_subject", subject_name="校本")
    r_dup2 = GradeTimeRule(id="r3", enabled=True, grades=(1,), day=2, periods=(1,), rule_type="require_subject", subject_name="校本")
    r_cand = GradeTimeRule(id="r4", enabled=True, purpose="co_planning", time_selection_mode="candidate", candidate_blocks=())

    result = validate_grade_time_rules([r_pe, r_dup1, r_dup2, r_cand])
    for issue in result.issues:
        assert issue.code in contract, f"Issued code '{issue.code}' not found in contract JSON"
        assert issue.severity == contract[issue.code], f"Severity mismatch for '{issue.code}': got {issue.severity}, expected {contract[issue.code]}"


# --- Task 5: Hard Constraints & Preflight Tests ---
from unittest.mock import patch
from ortools.sat.python import cp_model
from grade_time_rules import required_count_for_threshold
from constraints.class_rules import apply_grade_time_hard_constraints
from solver import run_grade_time_rules_preflight


def test_at_least_90_uses_ceiling():
    assert required_count_for_threshold(11, "at_least_90") == 10
    assert required_count_for_threshold(10, "at_least_90") == 9
    assert required_count_for_threshold(1, "at_least_90") == 1


def test_all_requires_every_target_class():
    assert required_count_for_threshold(11, "all") == 11
    assert required_count_for_threshold(5, "all") == 5


def test_prefer_does_not_create_hard_cardinality():
    assert required_count_for_threshold(11, "prefer") == 0
    assert required_count_for_threshold(5, "prefer") == 0


def test_require_subject_blocks_nonmatching_subjects_at_target_slot():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "3年1班"
    p_idx = 1  # day 1 period 2
    v_chinese = model.NewBoolVar("chinese")
    v_math = model.NewBoolVar("math")
    schedule[(c_name, p_idx, "張老師", "國語")] = v_chinese
    schedule[(c_name, p_idx, "李老師", "數學")] = v_math

    classes_data = [{"name": c_name, "grade": 3}]
    rule = GradeTimeRule(
        id="r-req-subj",
        enabled=True,
        enforcement_mode="hard",
        grades=(3,),
        day=1,
        periods=(2,),
        rule_type="require_subject",
        subject_name="國語",
    )

    metadata = apply_grade_time_hard_constraints(model, schedule, classes_data, [rule])
    assert len(metadata) == 1
    assert metadata[0]["ruleId"] == "r-req-subj"
    assert metadata[0]["constraintCount"] == 1

    # Solve model setting math var to 1 -> should be INFEASIBLE
    model.Add(v_math == 1)
    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status == cp_model.INFEASIBLE


def test_require_subject_category_blocks_nonmatching_categories():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "4年1班"
    p_idx = 0  # day 1 period 1
    v_school = model.NewBoolVar("school_course")
    v_math = model.NewBoolVar("math_course")
    schedule[(c_name, p_idx, "張老師", "校本課程")] = v_school
    schedule[(c_name, p_idx, "李老師", "數學")] = v_math

    classes_data = [{"name": c_name, "grade": 4}]
    rule = GradeTimeRule(
        id="r-cat",
        enabled=True,
        enforcement_mode="hard",
        grades=(4,),
        day=1,
        periods=(1,),
        rule_type="require_subject_category",
        subject_category="校本",
    )

    category_lookup = {"校本課程": "校本", "數學": "一般"}
    metadata = apply_grade_time_hard_constraints(
        model, schedule, classes_data, [rule], subject_category_lookup=category_lookup
    )
    assert metadata[0]["constraintCount"] == 1

    model.Add(v_math == 1)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) == cp_model.INFEASIBLE


def test_forbid_teacher_type_blocks_subject_teacher_lessons():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "5年1班"
    p_idx = 4  # day 1 period 5
    v_subject_t = model.NewBoolVar("subj_t")
    schedule[(c_name, p_idx, "專任老師A", "體育")] = v_subject_t

    classes_data = [{"name": c_name, "grade": 5, "homeroom_teacher": "導師A"}]
    rule = GradeTimeRule(
        id="r-forbid-tt",
        enabled=True,
        enforcement_mode="hard",
        grades=(5,),
        day=1,
        periods=(5,),
        rule_type="forbid_teacher_type",
        teacher_type="subject",
    )

    teacher_type_lookup = {"專任老師A": "subject", "導師A": "homeroom"}
    metadata = apply_grade_time_hard_constraints(
        model, schedule, classes_data, [rule], teacher_type_lookup=teacher_type_lookup
    )
    assert metadata[0]["constraintCount"] == 1

    model.Add(v_subject_t == 1)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) == cp_model.INFEASIBLE


def test_require_teacher_type_blocks_homeroom_lessons():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "5年1班"
    p_idx = 4  # day 1 period 5
    v_homeroom_t = model.NewBoolVar("home_t")
    schedule[(c_name, p_idx, "導師A", "國語")] = v_homeroom_t

    classes_data = [{"name": c_name, "grade": 5, "homeroom_teacher": "導師A"}]
    rule = GradeTimeRule(
        id="r-req-tt",
        enabled=True,
        enforcement_mode="hard",
        grades=(5,),
        day=1,
        periods=(5,),
        rule_type="require_teacher_type",
        teacher_type="subject",
    )

    teacher_type_lookup = {"導師A": "homeroom"}
    metadata = apply_grade_time_hard_constraints(
        model, schedule, classes_data, [rule], teacher_type_lookup=teacher_type_lookup
    )
    assert metadata[0]["constraintCount"] == 1

    model.Add(v_homeroom_t == 1)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) == cp_model.INFEASIBLE


def test_two_period_rule_applies_to_both_periods():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "6年1班"
    v_p1_invalid = model.NewBoolVar("p1_inv")
    v_p2_invalid = model.NewBoolVar("p2_inv")
    schedule[(c_name, 0, "導師A", "國語")] = v_p1_invalid  # day 1 period 1
    schedule[(c_name, 1, "導師A", "數學")] = v_p2_invalid  # day 1 period 2

    classes_data = [{"name": c_name, "grade": 6}]
    rule = GradeTimeRule(
        id="r-2p",
        enabled=True,
        enforcement_mode="hard",
        grades=(6,),
        day=1,
        periods=(1, 2),
        rule_type="require_subject",
        subject_name="校本",
    )

    metadata = apply_grade_time_hard_constraints(model, schedule, classes_data, [rule])
    assert len(metadata) == 1
    assert metadata[0]["constraintCount"] == 2
    assert "W1P1" in metadata[0]["targetPeriods"]
    assert "W1P2" in metadata[0]["targetPeriods"]


def test_at_least_90_coplan_model_cardinality_with_parsed_settings():
    # Canonical raw settings with fulfillmentThreshold "at_least_90"
    raw_settings = {
        "enabled": True,
        "rules": [
            {
                "id": "cp-90-rule",
                "enabled": True,
                "purpose": "co_planning",
                "timeSelectionMode": "fixed",
                "fulfillmentThreshold": "at_least_90",
                "grades": [5],
                "day": 2,
                "periods": [3],
            }
        ],
    }
    rules = parse_grade_time_rules(raw_settings)
    assert len(rules) == 1
    # Parser converts at_least_90 to near_hard
    assert rules[0].enforcement_mode == "near_hard"

    # 11 classes in Grade 5: target threshold ceil(11 * 0.9) = 10 classes
    classes_data = [{"name": f"5年{i}班", "grade": 5, "homeroom_teacher": f"導師{i}"} for i in range(1, 12)]

    # Case 1: Only 9 classes have subject teacher lessons -> should be INFEASIBLE
    model_9 = cp_model.CpModel()
    sched_9 = {}
    p_idx = (2 - 1) * 7 + (3 - 1)  # W2P3
    for i in range(1, 12):
        c_name = f"5年{i}班"
        v_subj = model_9.NewBoolVar(f"c{i}_subj")
        v_home = model_9.NewBoolVar(f"c{i}_home")
        sched_9[(c_name, p_idx, f"專任{i}", "體育")] = v_subj
        sched_9[(c_name, p_idx, f"導師{i}", "國語")] = v_home
        # Exactly one lesson per class at this slot
        model_9.Add(v_subj + v_home == 1)
        if i <= 9:
            model_9.Add(v_subj == 1)
        else:
            model_9.Add(v_home == 1)

    t_lookup = {f"專任{i}": "subject" for i in range(1, 12)}
    t_lookup.update({f"導師{i}": "homeroom" for i in range(1, 12)})

    metadata_9 = apply_grade_time_hard_constraints(
        model_9, sched_9, classes_data, rules, teacher_type_lookup=t_lookup
    )
    assert len(metadata_9) == 1
    solver_9 = cp_model.CpSolver()
    assert solver_9.Solve(model_9) == cp_model.INFEASIBLE

    # Case 2: 10 classes have subject teacher lessons (satisfies >= 10) -> should be FEASIBLE
    model_10 = cp_model.CpModel()
    sched_10 = {}
    for i in range(1, 12):
        c_name = f"5年{i}班"
        v_subj = model_10.NewBoolVar(f"c{i}_subj")
        v_home = model_10.NewBoolVar(f"c{i}_home")
        sched_10[(c_name, p_idx, f"專任{i}", "體育")] = v_subj
        sched_10[(c_name, p_idx, f"導師{i}", "國語")] = v_home
        model_10.Add(v_subj + v_home == 1)
        if i <= 10:
            model_10.Add(v_subj == 1)
        else:
            model_10.Add(v_home == 1)

    metadata_10 = apply_grade_time_hard_constraints(
        model_10, sched_10, classes_data, rules, teacher_type_lookup=t_lookup
    )
    assert len(metadata_10) == 1
    solver_10 = cp_model.CpSolver()
    assert solver_10.Solve(model_10) == cp_model.OPTIMAL or solver_10.Solve(model_10) == cp_model.FEASIBLE


def test_all_coplan_model_cardinality_with_parsed_settings():
    raw_settings = {
        "enabled": True,
        "rules": [
            {
                "id": "cp-all-rule",
                "enabled": True,
                "purpose": "co_planning",
                "timeSelectionMode": "fixed",
                "fulfillmentThreshold": "all",
                "grades": [5],
                "day": 2,
                "periods": [3],
            }
        ],
    }
    rules = parse_grade_time_rules(raw_settings)
    assert len(rules) == 1
    assert rules[0].enforcement_mode == "hard"

    classes_data = [{"name": f"5年{i}班", "grade": 5, "homeroom_teacher": f"導師{i}"} for i in range(1, 12)]
    p_idx = (2 - 1) * 7 + (3 - 1)
    t_lookup = {f"專任{i}": "subject" for i in range(1, 12)}
    t_lookup.update({f"導師{i}": "homeroom" for i in range(1, 12)})

    # Case 1: 10 classes have subject teacher, 1 class has homeroom teacher -> INFEASIBLE for "all"
    model_10 = cp_model.CpModel()
    sched_10 = {}
    for i in range(1, 12):
        c_name = f"5年{i}班"
        v_subj = model_10.NewBoolVar(f"c{i}_subj")
        v_home = model_10.NewBoolVar(f"c{i}_home")
        sched_10[(c_name, p_idx, f"專任{i}", "體育")] = v_subj
        sched_10[(c_name, p_idx, f"導師{i}", "國語")] = v_home
        model_10.Add(v_subj + v_home == 1)
        if i <= 10:
            model_10.Add(v_subj == 1)
        else:
            model_10.Add(v_home == 1)

    apply_grade_time_hard_constraints(model_10, sched_10, classes_data, rules, teacher_type_lookup=t_lookup)
    solver_10 = cp_model.CpSolver()
    assert solver_10.Solve(model_10) == cp_model.INFEASIBLE

    # Case 2: All 11 classes have subject teacher -> FEASIBLE for "all"
    model_11 = cp_model.CpModel()
    sched_11 = {}
    for i in range(1, 12):
        c_name = f"5年{i}班"
        v_subj = model_11.NewBoolVar(f"c{i}_subj")
        sched_11[(c_name, p_idx, f"專任{i}", "體育")] = v_subj
        model_11.Add(v_subj == 1)

    apply_grade_time_hard_constraints(model_11, sched_11, classes_data, rules, teacher_type_lookup=t_lookup)
    solver_11 = cp_model.CpSolver()
    res_status = solver_11.Solve(model_11)
    assert res_status == cp_model.OPTIMAL or res_status == cp_model.FEASIBLE


def test_prefer_coplan_model_cardinality_with_parsed_settings():
    raw_settings = {
        "enabled": True,
        "rules": [
            {
                "id": "cp-pref-rule",
                "enabled": True,
                "purpose": "co_planning",
                "timeSelectionMode": "fixed",
                "fulfillmentThreshold": "prefer",
                "grades": [5],
                "day": 2,
                "periods": [3],
            }
        ],
    }
    rules = parse_grade_time_rules(raw_settings)
    assert len(rules) == 1
    assert rules[0].enforcement_mode == "soft"

    classes_data = [{"name": f"5年{i}班", "grade": 5, "homeroom_teacher": f"導師{i}"} for i in range(1, 12)]
    p_idx = (2 - 1) * 7 + (3 - 1)
    t_lookup = {f"導師{i}": "homeroom" for i in range(1, 12)}

    # All 11 classes have homeroom teacher (0 subject teachers) -> FEASIBLE because prefer creates no hard cardinality
    model_0 = cp_model.CpModel()
    sched_0 = {}
    for i in range(1, 12):
        c_name = f"5年{i}班"
        v_home = model_0.NewBoolVar(f"c{i}_home")
        sched_0[(c_name, p_idx, f"導師{i}", "國語")] = v_home
        model_0.Add(v_home == 1)

    metadata = apply_grade_time_hard_constraints(model_0, sched_0, classes_data, rules, teacher_type_lookup=t_lookup)
    solver_0 = cp_model.CpSolver()
    res_status = solver_0.Solve(model_0)
    assert res_status == cp_model.OPTIMAL or res_status == cp_model.FEASIBLE


def test_real_solver_main_preflight_blocks_invalid_configuration_without_cpsat_model(tmp_path):
    import sys
    import solver as solver_module

    input_file = tmp_path / "input.json"
    output_file = tmp_path / "output.json"

    bad_payload = {
        "jobId": "test-job-preflight",
        "schoolInfo": {
            "gradeTimeRulesSettings": {
                "enabled": True,
                "version": 2,
                "rules": [
                    {
                        "id": "rule-invalid-day",
                        "enabled": True,
                        "grades": [1],
                        "day": 99,  # invalid day -> blocking
                        "periods": [1],
                    }
                ],
            }
        },
        "classes": [
            {
                "name": "1年1班",
                "grade": 1,
                "course_requirements": [
                    {"subject": "國語", "periods": 1, "teacher": "導師A"}
                ],
            }
        ],
        "teachers": [{"name": "導師A"}],
        "classrooms": [],
    }

    with open(input_file, "w", encoding="utf-8") as f:
        json.dump(bad_payload, f, ensure_ascii=False)

    with patch.object(sys, "argv", ["solver.py", str(input_file), str(output_file)]):
        with patch("solver.cp_model.CpModel") as mock_cp_model:
            with pytest.raises(SystemExit) as exc_info:
                solver_module.main()

            assert exc_info.value.code == 0

            assert output_file.exists()
            with open(output_file, "r", encoding="utf-8") as f:
                out_data = json.load(f)

            assert out_data["status"] == "INVALID_GRADE_TIME_RULE_CONFIGURATION"
            assert out_data["solverStatus"] == "INVALID_GRADE_TIME_RULE_CONFIGURATION"
            assert len(out_data["gradeTimeRuleIssues"]) > 0
            assert any(i["code"] == "GTR_INVALID_DAY_OR_PERIOD" for i in out_data["gradeTimeRuleIssues"])

            mock_cp_model.assert_not_called()


# --- Task 6: Soft, Near-Hard, Prefer & Candidate Selector Tests ---
from constraints.class_rules import apply_grade_time_soft_rules


def test_soft_rule_creates_penalties_never_hard_constraints():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "3年1班"
    p_idx = 0  # day 1 period 1
    v_math = model.NewBoolVar("math")
    schedule[(c_name, p_idx, "張老師", "數學")] = v_math

    classes_data = [{"name": c_name, "grade": 3}]
    rule = GradeTimeRule(
        id="soft-rule-1",
        enabled=True,
        enforcement_mode="soft",
        grades=(3,),
        day=1,
        periods=(1,),
        rule_type="require_subject",
        subject_name="國語",
        weight=9000,
    )

    penalties, selector_meta = apply_grade_time_soft_rules(model, schedule, classes_data, [rule])
    assert len(penalties) == 1
    assert penalties[0]["rule_id"] == "soft-rule-1"
    assert penalties[0]["penalty_key"] == "grade_time_require_subject"
    assert penalties[0]["weight"] == 9000

    # Add penalty to objective and force v_math == 1 (unfulfilled require_subject) -> must remain FEASIBLE
    model.Minimize(penalties[0]["weight"] * penalties[0]["var"])
    model.Add(v_math == 1)

    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status == cp_model.OPTIMAL or status == cp_model.FEASIBLE
    assert solver.Value(penalties[0]["var"]) == 1


def test_near_hard_rule_uses_max_configured_weight_and_no_dilution():
    model = cp_model.CpModel()
    schedule = {}
    c1 = "4年1班"
    c2 = "4年2班"
    p_idx = 0
    v1 = model.NewBoolVar("c1_homeroom")
    v2 = model.NewBoolVar("c2_homeroom")
    schedule[(c1, p_idx, "導師1", "國語")] = v1
    schedule[(c2, p_idx, "導師2", "國語")] = v2

    classes_data = [{"name": c1, "grade": 4}, {"name": c2, "grade": 4}]
    rule = GradeTimeRule(
        id="near-hard-1",
        enabled=True,
        enforcement_mode="near_hard",
        grades=(4,),
        day=1,
        periods=(1,),
        rule_type="forbid_teacher_type",
        teacher_type="homeroom",
        weight=6000,  # configured lower than 9000
    )

    penalties, _ = apply_grade_time_soft_rules(model, schedule, classes_data, [rule])
    assert len(penalties) == 2
    for p in penalties:
        assert p["weight"] == 9000  # max(6000, 9000)

    # Prove each unfulfilled slot has full single-term weight 9000
    model.Add(v1 == 1)
    model.Add(v2 == 1)
    expr = sum(p["weight"] * p["var"] for p in penalties)
    model.Minimize(expr)
    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status == cp_model.OPTIMAL
    assert solver.ObjectiveValue() == 18000.0  # 2 * 9000, no dilution!


def test_hard_rule_produces_no_penalty_metadata():
    model = cp_model.CpModel()
    schedule = {}
    classes_data = [{"name": "5年1班", "grade": 5}]
    rule = GradeTimeRule(
        id="hard-rule-1",
        enabled=True,
        enforcement_mode="hard",
        grades=(5,),
        day=1,
        periods=(1,),
        rule_type="require_subject",
        subject_name="國語",
    )

    penalties, selector_meta = apply_grade_time_soft_rules(model, schedule, classes_data, [rule])
    assert len(penalties) == 0
    assert len(selector_meta) == 0


def test_prefer_co_planning_creates_penalty_no_hard_cardinality():
    model = cp_model.CpModel()
    schedule = {}
    c1 = "5年1班"
    c2 = "5年2班"
    p_idx = (4 - 1) * 7 + (5 - 1)  # W4P5
    v_c1_sub = model.NewBoolVar("c1_sub")
    schedule[(c1, p_idx, "科任A", "自然")] = v_c1_sub

    classes_data = [
        {"name": c1, "grade": 5, "homeroom_teacher": "導師1"},
        {"name": c2, "grade": 5, "homeroom_teacher": "導師2"},
    ]
    rule = GradeTimeRule(
        id="cp-pref-1",
        enabled=True,
        purpose="co_planning",
        time_selection_mode="fixed",
        fulfillment_threshold="prefer",
        grades=(5,),
        day=4,
        periods=(5,),
    )

    # Hard builder should return 0 constraints
    hard_meta = apply_grade_time_hard_constraints(model, schedule, classes_data, [rule])
    assert len(hard_meta) == 0

    # Soft builder creates 2 penalties, weight 9000 each
    penalties, _ = apply_grade_time_soft_rules(model, schedule, classes_data, [rule])
    assert len(penalties) == 2
    for p in penalties:
        assert p["penalty_key"] == "grade_time_co_planning_prefer"
        assert p["weight"] == 9000

    # Solve setting c1 sub=1, c2 sub=0 -> c2 violates, objective = 9000
    model.Add(v_c1_sub == 1)
    model.Minimize(sum(p["weight"] * p["var"] for p in penalties))
    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status == cp_model.OPTIMAL
    assert solver.ObjectiveValue() == 9000.0


def test_candidate_rule_selects_exactly_one_block():
    model = cp_model.CpModel()
    schedule = {}
    classes_data = [{"name": "5年1班", "grade": 5}]
    b1 = {"day": 2, "periods": [1, 2]}
    b2 = {"day": 4, "periods": [5, 6]}
    rule = GradeTimeRule(
        id="cand-rule-1",
        enabled=True,
        purpose="co_planning",
        time_selection_mode="candidate",
        fulfillment_threshold="all",
        grades=(5,),
        candidate_blocks=(b1, b2),
    )

    penalties, selector_meta = apply_grade_time_soft_rules(model, schedule, classes_data, [rule])
    assert len(selector_meta) == 2
    sel1 = selector_meta[0]["selector"]
    sel2 = selector_meta[1]["selector"]

    # Solve model -> exactly one selector must be 1
    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status == cp_model.OPTIMAL
    val1 = solver.Value(sel1)
    val2 = solver.Value(sel2)
    assert val1 + val2 == 1


def test_grade_5_and_6_candidate_rules_can_select_different_blocks():
    model = cp_model.CpModel()
    schedule = {}
    classes_data = [{"name": "5年1班", "grade": 5}, {"name": "6年1班", "grade": 6}]
    b1 = {"day": 2, "periods": [1]}
    b2 = {"day": 4, "periods": [5]}
    r5 = GradeTimeRule(
        id="cand-g5",
        enabled=True,
        purpose="co_planning",
        time_selection_mode="candidate",
        fulfillment_threshold="prefer",
        grades=(5,),
        candidate_blocks=(b1, b2),
    )
    r6 = GradeTimeRule(
        id="cand-g6",
        enabled=True,
        purpose="co_planning",
        time_selection_mode="candidate",
        fulfillment_threshold="prefer",
        grades=(6,),
        candidate_blocks=(b1, b2),
    )

    penalties, selector_meta = apply_grade_time_soft_rules(model, schedule, classes_data, [r5, r6])
    meta_g5 = [m for m in selector_meta if m["rule_id"] == "cand-g5"]
    meta_g6 = [m for m in selector_meta if m["rule_id"] == "cand-g6"]

    assert len(meta_g5) == 2
    assert len(meta_g6) == 2

    # Force G5 to select block 1 (b1) and G6 to select block 2 (b2)
    model.Add(meta_g5[0]["selector"] == 1)
    model.Add(meta_g6[1]["selector"] == 1)

    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status == cp_model.OPTIMAL
    assert solver.Value(meta_g5[0]["selector"]) == 1
    assert solver.Value(meta_g6[1]["selector"]) == 1


def test_unselected_block_adds_no_threshold_or_prefer_penalty():
    model = cp_model.CpModel()
    schedule = {}
    c_name = "5年1班"
    p_b1 = (2 - 1) * 7 + (1 - 1)  # W2P1
    p_b2 = (4 - 1) * 7 + (5 - 1)  # W4P5
    v_b1 = model.NewBoolVar("sub_b1")
    v_b2 = model.NewBoolVar("sub_b2")
    schedule[(c_name, p_b1, "科任A", "自然")] = v_b1
    schedule[(c_name, p_b2, "科任B", "美勞")] = v_b2

    classes_data = [{"name": c_name, "grade": 5, "homeroom_teacher": "導師1"}]
    b1 = {"day": 2, "periods": [1]}
    b2 = {"day": 4, "periods": [5]}
    rule = GradeTimeRule(
        id="cand-prefer",
        enabled=True,
        purpose="co_planning",
        time_selection_mode="candidate",
        fulfillment_threshold="prefer",
        grades=(5,),
        candidate_blocks=(b1, b2),
    )

    penalties, selector_meta = apply_grade_time_soft_rules(model, schedule, classes_data, [rule])
    # Force selector to b1 (W2P1)
    model.Add(selector_meta[0]["selector"] == 1)
    # Satisfy b1, leave b2 unsatisfied
    model.Add(v_b1 == 1)
    model.Add(v_b2 == 0)

    model.Minimize(sum(p["weight"] * p["var"] for p in penalties))
    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status == cp_model.OPTIMAL
    # Unselected block b2 should contribute 0 penalty!
    assert solver.ObjectiveValue() == 0.0


def test_selector_metadata_contains_rule_id_and_selected_block():
    model = cp_model.CpModel()
    schedule = {}
    classes_data = [{"name": "5年1班", "grade": 5}]
    b1 = {"day": 1, "periods": [1, 2]}
    rule = GradeTimeRule(
        id="rule-meta-test",
        enabled=True,
        purpose="co_planning",
        time_selection_mode="candidate",
        fulfillment_threshold="all",
        grades=(5,),
        candidate_blocks=(b1,),
    )

    _, selector_meta = apply_grade_time_soft_rules(model, schedule, classes_data, [rule])
    assert len(selector_meta) == 1
    item = selector_meta[0]
    assert "rule_id" in item and item["rule_id"] == "rule-meta-test"
    assert "block" in item and item["block"] == b1
    assert "selector" in item


# ============================================================
# Task 7-A: Grade Time Rules Diagnostics Contract Tests (RED)
# ============================================================
from grade_time_rule_diagnostics import (
    compute_grade_time_rule_diagnostics,
    DIAGNOSTICS_SCHEMA_KEYS,
    RULE_RESULT_SCHEMA_KEYS,
)


def _make_settings(rules_list):
    """Helper: wrap rules into a canonical settings dict."""
    return {"enabled": True, "version": 2, "rules": rules_list}


def _make_tiny_solution(schedule_entries):
    """
    Represents a solved schedule as a plain dict:
    key = (className, periodIndex, teacherName, subject), value = 1 (assigned)
    This replaces solver BoolVar values with plain ints.
    """
    return {k: 1 for k in schedule_entries}


def test_grade_time_rule_diagnostics_has_stable_schema():
    """
    validationReport.grade_time_rule_diagnostics must have exactly the keys
    defined in DIAGNOSTICS_SCHEMA_KEYS. No extra keys, no missing keys.
    """
    settings = _make_settings([
        {
            "id": "gen-1",
            "enabled": True,
            "purpose": "general",
            "grades": [1],
            "day": 2,
            "periods": [1],
            "ruleType": "require_subject",
            "subjectName": "校本",
        }
    ])
    diag = compute_grade_time_rule_diagnostics(
        raw_settings=settings,
        selector_values={},
        solution_entries=[],
    )
    assert set(diag.keys()) == set(DIAGNOSTICS_SCHEMA_KEYS), (
        f"Schema mismatch: got {set(diag.keys())}, expected {set(DIAGNOSTICS_SCHEMA_KEYS)}"
    )
    # Verify no BoolVar or non-JSON-serialisable objects leaked
    json.dumps(diag)  # must not raise


def test_diagnostics_counts_active_and_draft_rules():
    """
    totalRules = all rules in settings.
    activeRules = enabled rules.
    draftRules  = disabled rules.
    """
    settings = _make_settings([
        {
            "id": "active-1",
            "enabled": True,
            "purpose": "general",
            "grades": [3],
            "day": 1,
            "periods": [1],
            "ruleType": "require_subject",
            "subjectName": "校本",
        },
        {
            "id": "active-2",
            "enabled": True,
            "purpose": "co_planning",
            "grades": [5, 6],
            "timeSelectionMode": "fixed",
            "day": 3,
            "periods": [5, 6],
            "fulfillmentThreshold": "all",
        },
        {
            "id": "draft-1",
            "enabled": False,
            "purpose": "general",
            "grades": [2],
            "day": 2,
            "periods": [1],
            "ruleType": "require_subject",
            "subjectName": "國語",
        },
    ])
    diag = compute_grade_time_rule_diagnostics(
        raw_settings=settings,
        selector_values={},
        solution_entries=[],
    )
    assert diag["totalRules"] == 3
    assert diag["activeRules"] == 2
    assert diag["draftRules"] == 1


def test_candidate_diagnostics_uses_selected_selector_from_current_solution():
    """
    selectedCandidateBlocks must reflect the block whose selector was set to 1
    in the current solver solution — NOT from any external file.

    Two candidate blocks; we fix block index 0 to selected (value=1),
    block index 1 to unselected (value=0).
    Diagnostics must report block index 0 as selected for this rule.
    """
    b1 = {"day": 2, "periods": [1, 2]}
    b2 = {"day": 4, "periods": [5, 6]}
    rule_id = "cand-cp-56"
    settings = _make_settings([
        {
            "id": rule_id,
            "enabled": True,
            "purpose": "co_planning",
            "grades": [5, 6],
            "timeSelectionMode": "candidate",
            "fulfillmentThreshold": "prefer",
            "candidateBlocks": [b1, b2],
        }
    ])
    # Block 0 selected, block 1 not selected
    selector_values = {
        (rule_id, 0): 1,
        (rule_id, 1): 0,
    }
    diag = compute_grade_time_rule_diagnostics(
        raw_settings=settings,
        selector_values=selector_values,
        solution_entries=[],
    )
    selected_blocks = diag["selectedCandidateBlocks"]
    assert rule_id in selected_blocks, f"Expected rule_id in selectedCandidateBlocks, got {selected_blocks}"
    assert selected_blocks[rule_id] == b1, (
        f"Expected block {b1} to be selected, got {selected_blocks[rule_id]}"
    )


def test_rule_result_is_correlated_by_rule_id():
    """
    Each ruleResult must have ruleId as the unique correlation key.
    All required RULE_RESULT_SCHEMA_KEYS must be present.
    No two ruleResults share the same ruleId for active rules.
    """
    settings = _make_settings([
        {
            "id": "gen-fixed-1",
            "enabled": True,
            "purpose": "general",
            "grades": [1],
            "day": 2,
            "periods": [1],
            "ruleType": "require_subject",
            "subjectName": "校本",
        },
        {
            "id": "cp-fixed-2",
            "enabled": True,
            "purpose": "co_planning",
            "grades": [5, 6],
            "timeSelectionMode": "fixed",
            "day": 4,
            "periods": [5, 6],
            "fulfillmentThreshold": "all",
        },
    ])
    diag = compute_grade_time_rule_diagnostics(
        raw_settings=settings,
        selector_values={},
        solution_entries=[],
    )
    rule_results = diag["ruleResults"]
    # Each rule result must have all required keys
    for rr in rule_results:
        missing = set(RULE_RESULT_SCHEMA_KEYS) - set(rr.keys())
        assert not missing, f"ruleResult missing keys: {missing}"
    # ruleId is unique across active rule results
    ids = [rr["ruleId"] for rr in rule_results]
    assert len(ids) == len(set(ids)), f"Duplicate ruleIds in ruleResults: {ids}"
    # Both active rules appear in results
    assert "gen-fixed-1" in ids
    assert "cp-fixed-2" in ids


def test_disabled_rule_does_not_create_active_rule_result():
    """
    A disabled (draft) rule must be counted in draftRules
    but must NOT appear in ruleResults.
    """
    settings = _make_settings([
        {
            "id": "active-rule",
            "enabled": True,
            "purpose": "general",
            "grades": [2],
            "day": 1,
            "periods": [2],
            "ruleType": "require_subject",
            "subjectName": "數學",
        },
        {
            "id": "disabled-rule",
            "enabled": False,
            "purpose": "co_planning",
            "grades": [5, 6],
            "timeSelectionMode": "fixed",
            "day": 3,
            "periods": [5, 6],
            "fulfillmentThreshold": "all",
        },
    ])
    diag = compute_grade_time_rule_diagnostics(
        raw_settings=settings,
        selector_values={},
        solution_entries=[],
    )
    assert diag["draftRules"] == 1
    rule_ids_in_results = [rr["ruleId"] for rr in diag["ruleResults"]]
    assert "disabled-rule" not in rule_ids_in_results, (
        f"Disabled rule must not appear in ruleResults; got {rule_ids_in_results}"
    )
    assert "active-rule" in rule_ids_in_results


def test_diagnostics_never_reads_global_debug_report(tmp_path, monkeypatch):
    """
    compute_grade_time_rule_diagnostics must not open or depend on
    debug_schedule_validation_report.json in the working directory.
    Even if that file contains stale/wrong data, the diagnostics
    output must be determined solely by the arguments passed in.
    """
    import builtins

    stale_report = tmp_path / "debug_schedule_validation_report.json"
    stale_report.write_text(json.dumps({
        "grade_time_rule_diagnostics": {
            "totalRules": 99,
            "activeRules": 88,
        }
    }), encoding="utf-8")

    # Redirect cwd to tmp_path so if the module tries to open the stale file,
    # it would see 99/88 — which would cause the assertion to fail.
    monkeypatch.chdir(tmp_path)

    # Also intercept open() to detect any attempt to open the debug report file
    _original_open = builtins.open
    opened_files = []

    def _tracking_open(name, *args, **kwargs):
        opened_files.append(str(name))
        return _original_open(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", _tracking_open)

    settings = _make_settings([
        {
            "id": "r-diag-isolation",
            "enabled": True,
            "purpose": "general",
            "grades": [1],
            "day": 1,
            "periods": [1],
            "ruleType": "require_subject",
            "subjectName": "校本",
        }
    ])
    diag = compute_grade_time_rule_diagnostics(
        raw_settings=settings,
        selector_values={},
        solution_entries=[],
    )
    # Verify the result is based on our input, not the stale file
    assert diag["totalRules"] == 1
    assert diag["activeRules"] == 1

    # Verify no debug report file was opened
    debug_opened = [f for f in opened_files if "debug_schedule_validation_report" in f]
    assert not debug_opened, (
        f"compute_grade_time_rule_diagnostics must not open debug_schedule_validation_report.json; "
        f"found opens: {debug_opened}"
    )


# ============================================================
# Task 7-A (follow-up): Candidate Selector Helper Pipeline Unit Test
# Proves that extract_selector_values_from_metadata converts
# selector_metadata into plain ints for diagnostics.
# ============================================================

def test_extract_selector_values_helper_pipeline_unit_test():
    """
    Helper pipeline unit test for candidate selector metadata extraction.

    Simulates the pipeline:
        Phase2Engine.build_soft_constraints()
            → engine.gtr_selector_metadata = [...]   (list of {rule_id, block, selector: BoolVar})
        _solve_attempt() return dict
            → attempt["gtr_selector_metadata"] = engine.gtr_selector_metadata
        extract_selector_values_from_metadata(attempt["gtr_selector_metadata"], attempt_solver.Value)
            → {(rule_id, block_index): int}           (plain ints, no BoolVar)
        compute_grade_time_rule_diagnostics(raw_settings, selector_values, solution_entries)
            → diagnostics["selectedCandidateBlocks"][rule_id] == b1  (the selected block)
    """
    from grade_time_rule_diagnostics import (
        compute_grade_time_rule_diagnostics,
        extract_selector_values_from_metadata,
    )

    rule_id = "cand-integration-test"
    b1 = {"day": 2, "periods": [1, 2]}
    b2 = {"day": 4, "periods": [5, 6]}

    # Step 1: Build a tiny CP-SAT model with real BoolVars
    model = cp_model.CpModel()
    sel_b1 = model.NewBoolVar(f"gtr_cand_sel_{rule_id}_b0")
    sel_b2 = model.NewBoolVar(f"gtr_cand_sel_{rule_id}_b1")
    # Exactly one selector must be 1
    model.AddExactlyOne([sel_b1, sel_b2])
    # Force b1 selected
    model.Add(sel_b1 == 1)

    # Step 2: Build selector_metadata as the engine would (list of dicts with BoolVar)
    engine_selector_metadata = [
        {"rule_id": rule_id, "block": b1, "selector": sel_b1},
        {"rule_id": rule_id, "block": b2, "selector": sel_b2},
    ]

    # Step 3: Solve the model
    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), (
        f"Tiny CP-SAT model should be feasible, got status={status}"
    )

    # Verify the solver correctly picks sel_b1=1, sel_b2=0
    assert solver.Value(sel_b1) == 1
    assert solver.Value(sel_b2) == 0

    # Step 4: Extract selector values using the production function
    selector_values = extract_selector_values_from_metadata(
        engine_selector_metadata,
        solver.Value,   # real solver.Value — same as production
    )

    # Verify selector_values are plain ints, not BoolVars
    for key, val in selector_values.items():
        assert isinstance(val, int), (
            f"selector_values must contain plain ints, got {type(val)} for key {key}"
        )
    assert selector_values.get((rule_id, 0)) == 1, "Block 0 (b1) should be selected"
    assert selector_values.get((rule_id, 1)) == 0, "Block 1 (b2) should not be selected"

    # Step 5: Build raw_settings for the candidate rule
    raw_settings = _make_settings([
        {
            "id": rule_id,
            "enabled": True,
            "purpose": "co_planning",
            "grades": [5, 6],
            "timeSelectionMode": "candidate",
            "fulfillmentThreshold": "prefer",
            "candidateBlocks": [b1, b2],
        }
    ])

    # Step 6: Run diagnostics with the plain int selector_values (no BoolVars)
    diag = compute_grade_time_rule_diagnostics(
        raw_settings=raw_settings,
        selector_values=selector_values,
        solution_entries=[],
    )

    # Step 7: Assert selectedCandidateBlocks[rule_id] == b1 (the selector=1 block)
    selected = diag["selectedCandidateBlocks"]
    assert rule_id in selected, (
        f"Expected rule_id '{rule_id}' in selectedCandidateBlocks, got keys: {list(selected.keys())}"
    )
    assert selected[rule_id]["day"] == b1["day"], (
        f"Selected block day should be {b1['day']}, got {selected[rule_id].get('day')}"
    )
    assert list(selected[rule_id]["periods"]) == list(b1["periods"]), (
        f"Selected block periods should be {b1['periods']}, got {selected[rule_id].get('periods')}"
    )

    # Step 8: b2 must NOT be the selected block
    assert selected[rule_id]["day"] != b2["day"] or \
           list(selected[rule_id].get("periods", [])) != list(b2["periods"]), (
        f"b2 must not be the selected block; got {selected[rule_id]}"
    )

    # Step 9: Verify no raw BoolVar leaked into diagnostics
    diag_json = json.dumps(diag)  # must not raise TypeError
    assert "BoolVar" not in diag_json
    assert "CpModel" not in diag_json

    # Step 10: Schema completeness check
    assert set(diag.keys()) == set(DIAGNOSTICS_SCHEMA_KEYS)


# ============================================================
# Task 7-A (production regression test): End-to-end solver.main()
# Proves selectedCandidateBlocks in output JSON originates from
# actual solver.main() attempt execution.
# ============================================================

def test_real_solver_main_produces_selected_candidate_blocks_in_diagnostics(tmp_path):
    """
    Production-flow regression test for Task 7-A candidate diagnostics.

    Verifies that running solver.main() end-to-end yields selectedCandidateBlocks
    in output["validationReport"]["grade_time_rule_diagnostics"] populated from
    the actual solver.main() attempt solution.
    """
    import sys
    import solver as solver_module

    input_file = tmp_path / "input.json"
    output_file = tmp_path / "output.json"

    rule_id = "cp-cand-rule-prod"
    b1 = {"day": 2, "periods": [1]}
    b2 = {"day": 4, "periods": [5]}

    payload = {
        "jobId": "test-job-cand-prod-flow",
        "schoolInfo": {
            "gradeTimeRulesSettings": {
                "enabled": True,
                "version": 2,
                "rules": [
                    {
                        "id": rule_id,
                        "enabled": True,
                        "purpose": "co_planning",
                        "timeSelectionMode": "candidate",
                        "fulfillmentThreshold": "all",
                        "grades": [1],
                        "candidateBlocks": [b1, b2],
                    }
                ],
            }
        },
        "classes": [
            {
                "name": "1年1班",
                "grade": 1,
                "course_requirements": [
                    {"subject": "國語", "periods": 1, "teacher": "導師A"}
                ],
            }
        ],
        "teachers": [{"name": "導師A"}],
        "classrooms": [],
    }

    with open(input_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    with patch.object(sys, "argv", ["solver.py", str(input_file), str(output_file)]):
        try:
            solver_module.main()
        except SystemExit as exc:
            assert exc.code in (0, None)

    assert output_file.exists(), "Output JSON file must be generated by solver.main()"

    with open(output_file, "r", encoding="utf-8") as f:
        out_data = json.load(f)

    # 1. Status check: solver must reach FEASIBLE or OPTIMAL
    assert out_data.get("status") in ("FEASIBLE", "OPTIMAL"), f"Solver status was {out_data.get('status')}"

    # 2. Assert validationReport and grade_time_rule_diagnostics exist
    val_report = out_data.get("validationReport", {})
    assert "grade_time_rule_diagnostics" in val_report, "grade_time_rule_diagnostics must exist in validationReport"

    diagnostics = val_report["grade_time_rule_diagnostics"]
    selected_blocks = diagnostics.get("selectedCandidateBlocks", {})

    # 3. Assert selectedCandidateBlocks[rule_id] exists and matches one of the input candidate blocks
    assert rule_id in selected_blocks, f"rule_id '{rule_id}' must be present in selectedCandidateBlocks"
    selected_b = selected_blocks[rule_id]

    matches_b1 = (selected_b.get("day") == b1["day"] and list(selected_b.get("periods", [])) == list(b1["periods"]))
    matches_b2 = (selected_b.get("day") == b2["day"] and list(selected_b.get("periods", [])) == list(b2["periods"]))
    assert matches_b1 or matches_b2, f"selectedCandidateBlock {selected_b} must match either {b1} or {b2}"

    # 4. Assert unselected block is not reported as selected
    unselected_b = b2 if matches_b1 else b1
    unselected_match = (selected_b.get("day") == unselected_b["day"] and list(selected_b.get("periods", [])) == list(unselected_b["periods"]))
    assert not unselected_match, "Unselected block must not be reported as selected"

    # 5. Assert output can be json.dumps()-ed and contains no raw BoolVar
    dumps_str = json.dumps(out_data)
    assert "BoolVar" not in dumps_str, "Output JSON must not contain raw BoolVar objects"
    assert "CpModel" not in dumps_str, "Output JSON must not contain raw CpModel objects"


def test_legacy_co_planning_runtime_path_retired(tmp_path):
    """
    Task 7-B Contract Test:
    Assures legacy co-planning keys and diagnostics are fully retired from solver output
    even when legacy payload is passed into solver.main().
    """
    import sys
    import solver as solver_module

    input_file = tmp_path / "input.json"
    output_file = tmp_path / "output.json"

    payload = {
        "jobId": "test-job-legacy-retired",
        "schoolInfo": {
            "coPlanningSettings": {
                "enabled": True,
                "mode": "manual",
                "manualBlocks": {"5": {"day": 1, "startPeriod": 1, "length": 2}},
            },
            "gradeTimeRulesSettings": {
                "enabled": True,
                "version": 2,
                "rules": [],
            }
        },
        "aiSettings": {
            "coPlanningSettings": {
                "enabled": True,
                "mode": "manual",
            },
            "__schoolInfoCoPlanningSettings": {
                "enabled": True,
            }
        },
        "classes": [
            {
                "name": "1年1班",
                "grade": 1,
                "course_requirements": [
                    {"subject": "國語", "periods": 1, "teacher": "導師A"}
                ],
            }
        ],
        "teachers": [{"name": "導師A"}],
        "classrooms": [],
    }

    with open(input_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    with patch.object(sys, "argv", ["solver.py", str(input_file), str(output_file)]):
        try:
            solver_module.main()
        except SystemExit as exc:
            assert exc.code in (0, None)

    with open(output_file, "r", encoding="utf-8") as f:
        out_data = json.load(f)

    val_report = out_data.get("validationReport", {})
    assert "co_planning_diagnostics" not in val_report, "Legacy co_planning_diagnostics must NOT be in validationReport"

    dumps_str = json.dumps(out_data)
    assert "manual_co_planning_subject_teacher_lesson" not in dumps_str, "Legacy penalty key must not be in output JSON"
    assert "grade_co_planning_afternoon_block" not in dumps_str, "Legacy penalty key must not be in output JSON"
    assert "co_planning_subject_teacher_lesson" not in dumps_str, "Legacy penalty key must not be in output JSON"
