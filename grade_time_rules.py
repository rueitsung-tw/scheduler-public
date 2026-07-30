"""
grade_time_rules.py
Authoritative parser, dataclasses, and deterministic Preflight validator for Grade Time Rules.
"""

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union


def required_count_for_threshold(target_class_count: int, threshold: str) -> int:
    if threshold == "all":
        return target_class_count
    elif threshold == "at_least_90":
        return math.ceil(target_class_count * 0.9)
    return 0


def _load_issue_codes() -> Dict[str, str]:
    contract_path = Path(__file__).parent / "contracts" / "grade_time_rule_issue_codes.json"
    if contract_path.exists():
        with open(contract_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "GTR_INVALID_DAY_OR_PERIOD": "blocking",
        "GTR_DUPLICATE_RULE": "blocking",
        "GTR_REQUIRE_SUBJECT_CONFLICT": "blocking",
        "GTR_TEACHER_TYPE_CONFLICT": "blocking",
        "GTR_FIXED_LOCK_CONFLICT": "blocking",
        "GTR_SUBJECT_NOT_AVAILABLE_FOR_GRADE": "blocking",
        "GTR_EMPTY_CANDIDATE_BLOCKS": "blocking",
        "GTR_TEACHER_CAPACITY_RISK": "warning",
        "GTR_ROOM_CAPACITY_RISK": "warning",
        "GTR_THRESHOLD_CAPACITY_RISK": "warning",
        "GTR_PE_PERIOD_45_QUALITY_RISK": "warning",
        "GTR_PERIOD7_FLEXIBLE_QUALITY_RISK": "warning",
        "GRADE_TIME_RULE_MIGRATION_FAILED": "blocking",
    }


ISSUE_CODES = _load_issue_codes()


@dataclass(frozen=True)
class GradeTimeRule:
    id: str
    enabled: bool = True
    name: str = ""
    purpose: str = "general"               # 'general' | 'co_planning'
    grades: Tuple[int, ...] = ()           # e.g. (1,) or (5, 6)
    apply_to: str = "all_classes_in_grade" # 'all_classes_in_grade'

    time_selection_mode: str = "fixed"     # 'fixed' | 'candidate'
    day: int = 1                           # 1..5
    periods: Tuple[int, ...] = ()          # tuple of ints, e.g. (1,) or (5, 6)
    candidate_blocks: Tuple[Any, ...] = () # candidate blocks for co_planning

    rule_type: str = "require_subject"     # 'require_subject', 'require_subject_category', 'forbid_teacher_type', 'require_teacher_type'
    subject_name: str = ""
    subject_category: str = ""
    teacher_type: str = ""                # 'homeroom', 'subject', 'admin'

    enforcement_mode: str = "hard"         # 'hard', 'near_hard', 'soft'
    weight: int = 9000
    fulfillment_threshold: str = ""        # 'prefer', 'at_least_90', 'all'

    require_same_subject_across_grade: bool = True
    continuous: bool = False
    note: str = ""


@dataclass(frozen=True)
class GradeTimeRuleIssue:
    code: str
    severity: str
    message: str
    rule_ids: Tuple[str, ...] = ()
    grade: Optional[int] = None
    day: Optional[int] = None
    period: Optional[int] = None


@dataclass(frozen=True)
class GradeTimeRuleValidationResult:
    is_valid: bool
    issues: Tuple[GradeTimeRuleIssue, ...] = ()

    @property
    def blocking_issues(self) -> Tuple[GradeTimeRuleIssue, ...]:
        return tuple(i for i in self.issues if i.severity == "blocking")

    @property
    def warnings(self) -> Tuple[GradeTimeRuleIssue, ...]:
        return tuple(i for i in self.issues if i.severity == "warning")


def parse_grade_time_rules(settings: Union[Dict[str, Any], str, None]) -> Tuple[GradeTimeRule, ...]:
    if not settings:
        return ()

    if isinstance(settings, str):
        try:
            settings = json.loads(settings)
        except Exception:
            return ()

    if not isinstance(settings, dict):
        return ()

    if not settings.get("enabled", True):
        return ()

    raw_rules = settings.get("rules", [])
    if not isinstance(raw_rules, list):
        return ()

    parsed_rules: List[GradeTimeRule] = []

    for raw in raw_rules:
        if not isinstance(raw, dict):
            continue
        if not raw.get("enabled", True):
            continue

        rule_id = str(raw.get("id", ""))
        name = str(raw.get("name", ""))
        purpose = str(raw.get("purpose", "general"))
        time_selection_mode = str(raw.get("timeSelectionMode", "fixed"))

        raw_grades = raw.get("grades", [])
        grades = tuple(int(g) for g in raw_grades if isinstance(g, (int, str)) and str(g).isdigit())

        raw_periods = raw.get("periods", [])
        periods = tuple(int(p) for p in raw_periods if isinstance(p, (int, str)) and str(p).isdigit())

        candidate_blocks = raw.get("candidateBlocks", [])
        if isinstance(candidate_blocks, list):
            candidate_blocks = tuple(candidate_blocks)
        else:
            candidate_blocks = ()

        rule_type = str(raw.get("ruleType", "require_subject"))
        subject_name = str(raw.get("subjectName", ""))
        subject_category = str(raw.get("subjectCategory", ""))
        teacher_type = str(raw.get("teacherType", ""))

        fulfillment_threshold = str(raw.get("fulfillmentThreshold", ""))
        enforcement_mode = str(raw.get("enforcementMode", "hard"))
        weight = int(raw.get("weight", 9000))

        if purpose == "co_planning":
            rule_type = "require_teacher_type"
            teacher_type = "subject"
            if fulfillment_threshold == "all":
                enforcement_mode = "hard"
                weight = 9000
            elif fulfillment_threshold == "at_least_90":
                enforcement_mode = "near_hard"
                weight = 6000
            elif fulfillment_threshold == "prefer":
                enforcement_mode = "soft"
                weight = 3000

        rule = GradeTimeRule(
            id=rule_id,
            enabled=True,
            name=name,
            purpose=purpose,
            grades=grades,
            apply_to=str(raw.get("applyTo", "all_classes_in_grade")),
            time_selection_mode=time_selection_mode,
            day=int(raw.get("day", 1)),
            periods=periods,
            candidate_blocks=candidate_blocks,
            rule_type=rule_type,
            subject_name=subject_name,
            subject_category=subject_category,
            teacher_type=teacher_type,
            enforcement_mode=enforcement_mode,
            weight=weight,
            fulfillment_threshold=fulfillment_threshold,
            require_same_subject_across_grade=bool(raw.get("requireSameSubjectAcrossGrade", True)),
            continuous=bool(raw.get("continuous", False)),
            note=str(raw.get("note", "")),
        )
        parsed_rules.append(rule)

    return tuple(parsed_rules)


def validate_grade_time_rules(
    rules: Sequence[GradeTimeRule],
    scheduling_context: Optional[Dict[str, Any]] = None,
) -> GradeTimeRuleValidationResult:
    issues: List[GradeTimeRuleIssue] = []

    active_rules = [r for r in rules if r.enabled]

    # 1. Parameter Validation
    for r in active_rules:
        # Invalid day or period for fixed rules
        if r.time_selection_mode == "fixed":
            if r.day < 1 or r.day > 5:
                issues.append(
                    GradeTimeRuleIssue(
                        code="GTR_INVALID_DAY_OR_PERIOD",
                        severity=ISSUE_CODES.get("GTR_INVALID_DAY_OR_PERIOD", "blocking"),
                        message=f"Rule {r.id} has invalid day {r.day}",
                        rule_ids=(r.id,),
                        day=r.day,
                    )
                )
            for p in r.periods:
                if p < 1 or p > 7:
                    issues.append(
                        GradeTimeRuleIssue(
                            code="GTR_INVALID_DAY_OR_PERIOD",
                            severity=ISSUE_CODES.get("GTR_INVALID_DAY_OR_PERIOD", "blocking"),
                            message=f"Rule {r.id} has invalid period {p}",
                            rule_ids=(r.id,),
                            day=r.day if 1 <= r.day <= 5 else None,
                            period=p,
                        )
                    )

        # Missing candidate blocks or invalid purpose for candidate mode
        if r.time_selection_mode == "candidate":
            if r.purpose != "co_planning":
                issues.append(
                    GradeTimeRuleIssue(
                        code="GTR_EMPTY_CANDIDATE_BLOCKS",
                        severity=ISSUE_CODES.get("GTR_EMPTY_CANDIDATE_BLOCKS", "blocking"),
                        message=f"Rule {r.id} has purpose '{r.purpose}' but candidate mode is only allowed for co_planning",
                        rule_ids=(r.id,),
                    )
                )
            elif not r.candidate_blocks or len(r.candidate_blocks) == 0:
                issues.append(
                    GradeTimeRuleIssue(
                        code="GTR_EMPTY_CANDIDATE_BLOCKS",
                        severity=ISSUE_CODES.get("GTR_EMPTY_CANDIDATE_BLOCKS", "blocking"),
                        message=f"Rule {r.id} in candidate mode has empty candidate blocks",
                        rule_ids=(r.id,),
                    )
                )

    # 2. Duplicate Rules Check
    seen = {}
    for r in active_rules:
        key = (
            r.purpose,
            r.time_selection_mode,
            r.grades,
            r.day if r.time_selection_mode == "fixed" else None,
            r.periods if r.time_selection_mode == "fixed" else None,
            r.rule_type,
            r.subject_name,
            r.subject_category,
            r.teacher_type,
            r.fulfillment_threshold,
        )
        if key in seen:
            prev_id = seen[key]
            issues.append(
                GradeTimeRuleIssue(
                    code="GTR_DUPLICATE_RULE",
                    severity=ISSUE_CODES.get("GTR_DUPLICATE_RULE", "blocking"),
                    message=f"Duplicate grade time rule between {prev_id} and {r.id}",
                    rule_ids=(prev_id, r.id),
                )
            )
        else:
            seen[key] = r.id

    # 3. Time Slot Overlap & Conflict Check (Fixed Rules)
    # Expand rules into (grade, day, period) slots
    slot_subject_map: Dict[Tuple[int, int, int], List[Tuple[str, str]]] = {}
    slot_teacher_type_map: Dict[Tuple[int, int, int], List[Tuple[str, str, str]]] = {}

    for r in active_rules:
        if r.time_selection_mode != "fixed":
            continue
        if r.day < 1 or r.day > 5:
            continue

        for g in r.grades:
            for p in r.periods:
                if p < 1 or p > 7:
                    continue
                slot_key = (g, r.day, p)

                # Subject requirement conflict
                if r.rule_type == "require_subject" and r.subject_name:
                    if slot_key not in slot_subject_map:
                        slot_subject_map[slot_key] = []
                    slot_subject_map[slot_key].append((r.subject_name, r.id))

                # Teacher type require/forbid conflict
                if r.rule_type in ("require_teacher_type", "forbid_teacher_type") and r.teacher_type:
                    if slot_key not in slot_teacher_type_map:
                        slot_teacher_type_map[slot_key] = []
                    slot_teacher_type_map[slot_key].append((r.rule_type, r.teacher_type, r.id))

    # Evaluate subject conflicts
    for (g, d, p), reqs in slot_subject_map.items():
        distinct_subjects = set(subj for subj, _ in reqs)
        if len(distinct_subjects) > 1:
            affected_ids = tuple(sorted(set(rid for _, rid in reqs)))
            issues.append(
                GradeTimeRuleIssue(
                    code="GTR_REQUIRE_SUBJECT_CONFLICT",
                    severity=ISSUE_CODES.get("GTR_REQUIRE_SUBJECT_CONFLICT", "blocking"),
                    message=f"Conflicting subjects {distinct_subjects} required for grade {g} at day {d} period {p}",
                    rule_ids=affected_ids,
                    grade=g,
                    day=d,
                    period=p,
                )
            )

    # Evaluate teacher type conflicts
    for (g, d, p), reqs in slot_teacher_type_map.items():
        req_types = set(tt for rtype, tt, _ in reqs if rtype == "require_teacher_type")
        forbid_types = set(tt for rtype, tt, _ in reqs if rtype == "forbid_teacher_type")
        conflicts = req_types.intersection(forbid_types)
        if conflicts:
            affected_ids = tuple(sorted(set(rid for _, _, rid in reqs)))
            issues.append(
                GradeTimeRuleIssue(
                    code="GTR_TEACHER_TYPE_CONFLICT",
                    severity=ISSUE_CODES.get("GTR_TEACHER_TYPE_CONFLICT", "blocking"),
                    message=f"Conflicting teacher type {conflicts} required and forbidden for grade {g} at day {d} period {p}",
                    rule_ids=affected_ids,
                    grade=g,
                    day=d,
                    period=p,
                )
            )

    # 4. Quality Soft Rules (Warnings)
    pe_names = {"體育", "體育課", "PE", "pe"}
    non_flexible_core_subjects = {"國語", "數學", "英語", "自然", "社會"}

    for r in active_rules:
        if r.time_selection_mode != "fixed":
            continue
        if r.enforcement_mode not in ("hard", "all"):
            continue

        for g in r.grades:
            for p in r.periods:
                # PE at period 4 or 5 -> warning
                if r.rule_type == "require_subject" and r.subject_name in pe_names and p in (4, 5):
                    issues.append(
                        GradeTimeRuleIssue(
                            code="GTR_PE_PERIOD_45_QUALITY_RISK",
                            severity=ISSUE_CODES.get("GTR_PE_PERIOD_45_QUALITY_RISK", "warning"),
                            message=f"PE required at period {p} for grade {g} creates heat/quality risk",
                            rule_ids=(r.id,),
                            grade=g,
                            day=r.day,
                            period=p,
                        )
                    )

                # Non-flexible subject at period 7 -> warning
                if r.rule_type == "require_subject" and r.subject_name in non_flexible_core_subjects and p == 7:
                    issues.append(
                        GradeTimeRuleIssue(
                            code="GTR_PERIOD7_FLEXIBLE_QUALITY_RISK",
                            severity=ISSUE_CODES.get("GTR_PERIOD7_FLEXIBLE_QUALITY_RISK", "warning"),
                            message=f"Core subject {r.subject_name} required at period 7 for grade {g} violates period 7 flexible preference",
                            rule_ids=(r.id,),
                            grade=g,
                            day=r.day,
                            period=7,
                        )
                    )

    is_valid = len([i for i in issues if i.severity == "blocking"]) == 0
    return GradeTimeRuleValidationResult(is_valid=is_valid, issues=tuple(issues))
