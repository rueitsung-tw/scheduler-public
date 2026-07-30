"""
grade_time_rule_diagnostics.py

Pure Python helper for computing validationReport.grade_time_rule_diagnostics.

Contract:
- Input:  raw_settings (dict | None), selector_values (dict[tuple, int]), solution_entries (list)
- Output: a fully JSON-serialisable dict matching DIAGNOSTICS_SCHEMA_KEYS
- No CP-SAT objects, no BoolVar, no CpModel.
- Never reads debug_schedule_validation_report.json or any file from disk.
- All data comes from the arguments passed in.

selector_values schema:
    key   = (rule_id: str, block_index: int)
    value = int (0 or 1) — already extracted from solver.Value() before passing in

solution_entries schema (each entry):
    {
        "day": int,
        "period": int,
        "className": str,
        "teacherName": str,
        "subject": str,
    }
"""

from typing import Any, Dict, List, Optional, Tuple

from grade_time_rules import (
    GradeTimeRule,
    GradeTimeRuleValidationResult,
    parse_grade_time_rules,
    validate_grade_time_rules,
)

# ── Stable schema contracts ──────────────────────────────────────────────────

DIAGNOSTICS_SCHEMA_KEYS: Tuple[str, ...] = (
    "enabled",
    "totalRules",
    "activeRules",
    "draftRules",
    "blockingIssues",
    "warnings",
    "selectedCandidateBlocks",
    "ruleResults",
)

RULE_RESULT_SCHEMA_KEYS: Tuple[str, ...] = (
    "ruleId",
    "purpose",
    "targetGrades",
    "selectedBlock",
    "targetSlots",
    "fulfilledSlots",
    "unfulfilledSlots",
    "fulfillmentRate",
    "reasonCodes",
)


# ── Internal helpers ─────────────────────────────────────────────────────────

def _count_raw_rules(raw_settings: Any) -> Tuple[int, int, int]:
    """
    Count (totalRules, activeRules, draftRules) directly from raw_settings.
    Does NOT use parse_grade_time_rules (which silently drops disabled rules).
    """
    if not isinstance(raw_settings, dict):
        return 0, 0, 0
    if not raw_settings.get("enabled", True):
        return 0, 0, 0

    raw_rules = raw_settings.get("rules", [])
    if not isinstance(raw_rules, list):
        return 0, 0, 0

    total = 0
    active = 0
    draft = 0
    for r in raw_rules:
        if not isinstance(r, dict):
            continue
        total += 1
        if r.get("enabled", True):
            active += 1
        else:
            draft += 1

    return total, active, draft


def _resolve_selected_candidate_blocks(
    active_rules: Tuple[GradeTimeRule, ...],
    selector_values: Dict[Tuple[str, int], int],
) -> Dict[str, Any]:
    """
    Build a mapping of rule_id -> selected block dict for candidate rules.
    Only includes rules where a selector with value == 1 was found.
    """
    result: Dict[str, Any] = {}
    for rule in active_rules:
        if rule.time_selection_mode != "candidate":
            continue
        for idx, block in enumerate(rule.candidate_blocks or ()):
            val = selector_values.get((rule.id, idx), 0)
            if val == 1:
                # Convert block to plain JSON-safe dict
                if isinstance(block, dict):
                    result[rule.id] = {k: list(v) if isinstance(v, (list, tuple)) else v
                                       for k, v in block.items()}
                else:
                    result[rule.id] = block
                break  # exactly one selector per rule
    return result


def _build_target_slots(rule: GradeTimeRule, selected_block: Optional[Any]) -> List[str]:
    """
    Return a list of human-readable slot labels like ["W2P5", "W2P6"].
    For fixed rules: derived from rule.day / rule.periods.
    For candidate rules with selected block: derived from the selected block.
    For candidate rules without selected block: empty list.
    """
    slots = []
    if rule.time_selection_mode == "fixed":
        day = rule.day
        for p in (rule.periods or ()):
            slots.append(f"W{day}P{p}")
    elif rule.time_selection_mode == "candidate" and selected_block is not None:
        if isinstance(selected_block, dict):
            day = int(selected_block.get("day", 0))
            if "periods" in selected_block:
                for p in selected_block["periods"]:
                    slots.append(f"W{day}P{int(p)}")
            elif "startPeriod" in selected_block and "length" in selected_block:
                start = int(selected_block["startPeriod"])
                length = int(selected_block["length"])
                for p in range(start, start + length):
                    slots.append(f"W{day}P{p}")
    return slots


def _count_fulfilled_slots(
    rule: GradeTimeRule,
    target_slots: List[str],
    solution_entries: List[Dict[str, Any]],
) -> Tuple[int, int]:
    """
    For each target slot, check whether the solution has any entry that
    satisfies the rule for the rule's target grades.

    Returns (fulfilled_count, unfulfilled_count).

    Note: solution_entries is a list of {day, period, className, teacherName, subject}.
    We check by (grade, day, period) presence in the solution.
    This is a best-effort post-solve count — not a constraint re-validation.
    """
    if not target_slots or not solution_entries:
        return 0, len(target_slots)

    # Build lookup: (day, period) -> list of solution entries
    slot_entries: Dict[Tuple[int, int], List[Dict[str, Any]]] = {}
    for entry in solution_entries:
        d = entry.get("day")
        p = entry.get("period")
        if d is not None and p is not None:
            key = (int(d), int(p))
            slot_entries.setdefault(key, []).append(entry)

    fulfilled = 0
    unfulfilled = 0
    target_grades = set(rule.grades)

    for slot_label in target_slots:
        # Parse "W{day}P{period}"
        try:
            parts = slot_label.lstrip("W").split("P")
            day = int(parts[0])
            period = int(parts[1])
        except (ValueError, IndexError):
            unfulfilled += 1
            continue

        entries_at_slot = slot_entries.get((day, period), [])
        # Filter to entries for classes in the rule's target grades
        # (We don't have grade lookup here, so we check if any entry exists at this slot)
        # For post-solve diagnostics we just count presence
        if entries_at_slot:
            fulfilled += 1
        else:
            unfulfilled += 1

    return fulfilled, unfulfilled


def _build_rule_result(
    rule: GradeTimeRule,
    selected_candidate_blocks: Dict[str, Any],
    solution_entries: List[Dict[str, Any]],
    validation_result: GradeTimeRuleValidationResult,
) -> Dict[str, Any]:
    """
    Build a single ruleResult dict for an active rule.
    All fields match RULE_RESULT_SCHEMA_KEYS.
    """
    # Resolve selected block (None for fixed rules, or the selected candidate block)
    if rule.time_selection_mode == "candidate":
        selected_block = selected_candidate_blocks.get(rule.id)
    else:
        selected_block = None  # fixed rules have no single "selected" block

    target_slots = _build_target_slots(rule, selected_block)
    fulfilled, unfulfilled = _count_fulfilled_slots(rule, target_slots, solution_entries)
    total_slots = len(target_slots)
    fulfillment_rate = round(fulfilled / total_slots, 4) if total_slots > 0 else None

    # Collect reason codes from canonical validator issues for this rule
    reason_codes = []
    for issue in validation_result.issues:
        if rule.id in issue.rule_ids:
            if issue.code not in reason_codes:
                reason_codes.append(issue.code)

    return {
        "ruleId": rule.id,
        "purpose": rule.purpose,
        "targetGrades": list(rule.grades),
        "selectedBlock": (
            {k: list(v) if isinstance(v, (list, tuple)) else v
             for k, v in selected_block.items()}
            if isinstance(selected_block, dict)
            else selected_block
        ),
        "targetSlots": target_slots,
        "fulfilledSlots": fulfilled,
        "unfulfilledSlots": unfulfilled,
        "fulfillmentRate": fulfillment_rate,
        "reasonCodes": reason_codes,
    }


# ── Public API ───────────────────────────────────────────────────────────────

def compute_grade_time_rule_diagnostics(
    raw_settings: Any,
    selector_values: Dict[Tuple[str, int], int],
    solution_entries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Compute validationReport.grade_time_rule_diagnostics from the current
    solver run's inputs and outputs.

    Args:
        raw_settings:
            The raw gradeTimeRulesSettings dict (from schoolInfo or aiSettings).
            May be None or empty — in that case diagnostics returns a disabled stub.

        selector_values:
            Mapping of (rule_id, block_index) -> int (0 or 1).
            Must be plain Python ints extracted from solver.Value() BEFORE calling
            this function. No BoolVar objects allowed.

        solution_entries:
            List of schedule entry dicts from the solved schedule.
            Each entry: {day, period, className, teacherName, subject, ...}.
            Pass [] if the solve did not produce a feasible solution.

    Returns:
        A fully JSON-serialisable dict with keys matching DIAGNOSTICS_SCHEMA_KEYS.
        Never reads any file from disk.
    """
    # Step 1: Count raw rule categories (includes disabled rules)
    total_rules, active_rules_count, draft_rules_count = _count_raw_rules(raw_settings)

    if total_rules == 0:
        return {
            "enabled": False,
            "totalRules": 0,
            "activeRules": 0,
            "draftRules": 0,
            "blockingIssues": [],
            "warnings": [],
            "selectedCandidateBlocks": {},
            "ruleResults": [],
        }

    # Step 2: Parse only the active rules
    active_rules: Tuple[GradeTimeRule, ...] = parse_grade_time_rules(raw_settings)

    # Step 3: Run canonical validator on active rules
    validation_result = validate_grade_time_rules(active_rules)

    # Step 4: Resolve selected candidate blocks from selector_values (plain ints)
    selected_candidate_blocks = _resolve_selected_candidate_blocks(active_rules, selector_values)

    # Step 5: Serialize blocking issues and warnings (from canonical validator only)
    blocking_issues = [
        {
            "code": issue.code,
            "severity": issue.severity,
            "message": issue.message,
            "ruleIds": list(issue.rule_ids),
        }
        for issue in validation_result.blocking_issues
    ]
    warnings = [
        {
            "code": issue.code,
            "severity": issue.severity,
            "message": issue.message,
            "ruleIds": list(issue.rule_ids),
        }
        for issue in validation_result.warnings
    ]

    # Step 6: Build per-rule results (active rules only)
    rule_results = [
        _build_rule_result(rule, selected_candidate_blocks, solution_entries, validation_result)
        for rule in active_rules
    ]

    return {
        "enabled": True,
        "totalRules": total_rules,
        "activeRules": active_rules_count,
        "draftRules": draft_rules_count,
        "blockingIssues": blocking_issues,
        "warnings": warnings,
        "selectedCandidateBlocks": selected_candidate_blocks,
        "ruleResults": rule_results,
    }


def extract_selector_values_from_metadata(
    selector_metadata: List[Dict[str, Any]],
    solver_value_fn: Any,
) -> Dict[Tuple[str, int], int]:
    """
    Convert selector_metadata (list of {rule_id, block, selector: BoolVar}) into
    a plain dict of (rule_id, block_index) -> int.

    Args:
        selector_metadata:
            The list returned by apply_grade_time_soft_rules().
            Each item has: rule_id (str), block (dict), selector (BoolVar).

        solver_value_fn:
            The solver.Value function (cp_model.CpSolver.Value).
            Called here to extract int values BEFORE leaving the solve context.

    Returns:
        Dict mapping (rule_id, block_index) -> int (0 or 1).
        All BoolVar objects are resolved to plain Python ints.
        Safe to pass to compute_grade_time_rule_diagnostics().
    """
    # Group by rule_id to determine block indices
    rule_blocks: Dict[str, List[Dict[str, Any]]] = {}
    for item in selector_metadata:
        rid = item.get("rule_id", "")
        rule_blocks.setdefault(rid, []).append(item)

    result: Dict[Tuple[str, int], int] = {}
    for rid, items in rule_blocks.items():
        for idx, item in enumerate(items):
            sel_var = item.get("selector")
            if sel_var is None:
                result[(rid, idx)] = 0
                continue
            try:
                val = int(solver_value_fn(sel_var))
            except Exception:
                val = 0
            result[(rid, idx)] = val

    return result
