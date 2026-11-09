"""
constraints/teacher_class_progress.py

Pure helper functions, CP-SAT soft penalty modeling, and round evaluator for teacher class progress round-robin scheduling.
"""

from typing import Any, Callable, Dict, List, Optional, Tuple
from ortools.sat.python import cp_model
from constraints.special_rules import get_valid_consecutive_pairs


def normalize_teacher_class_progress_week(value: Any) -> str:
    """
    Normalize week value to internal string representation: 'both', 'odd', or 'even'.
    Mapping:
    - 0, 'both', None, '' -> 'both'
    - 1, 'odd', 'single' -> 'odd'
    - 2, 'even', 'double' -> 'even'
    """
    if value is None or value == "" or value == 0 or value == "both":
        return "both"
    if value == 1 or value == "odd" or value == "single":
        return "odd"
    if value == 2 or value == "even" or value == "double":
        return "even"
    return "both"


def expand_teacher_class_progress_entries(configured_entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Expand configured teacher weekly lesson entries into effective entries.
    An entry with week 'both' (0) expands into two effective entries (one for 'odd', one for 'even').
    An entry with week 'odd' (1) produces one effective entry for 'odd'.
    An entry with week 'even' (2) produces one effective entry for 'even'.
    """
    expanded = []
    for entry in configured_entries:
        week_norm = normalize_teacher_class_progress_week(entry.get("week"))
        if week_norm == "both":
            e_odd = dict(entry)
            e_odd["effective_week"] = "odd"
            expanded.append(e_odd)

            e_even = dict(entry)
            e_even["effective_week"] = "even"
            expanded.append(e_even)
        else:
            e = dict(entry)
            e["effective_week"] = week_norm
            expanded.append(e)
    return expanded


def _neutral_tcp_components() -> Dict[str, int]:
    """Zeroed TCP component map used before a solved evaluation exists."""
    return {
        "teacher_class_progress_incomplete_round": 0,
        "teacher_class_progress_waiting": 0,
        "teacher_class_progress_visit_pattern": 0,
    }


def _neutral_evaluator_result() -> Dict[str, Any]:
    """
    Placeholder evaluator result for build-time artifacts. The symbolic
    builder must never run the concrete evaluator on unsolved presence
    values; the real evaluation happens after the solve.
    """
    return {
        "total_penalty": 0,
        "components": _neutral_tcp_components(),
        "violations": [],
        "rounds": [],
    }


def validate_teacher_class_progress_settings(tcp_settings: Dict[str, Any]) -> None:
    """
    Validate normalized TCP settings before modeling or evaluation.

    Raises ValueError with a deterministic message naming the offending
    teacher / class / subject / week when:
      - a weeklyLessons entry has missing, non-numeric, fractional, zero,
        or negative lessons (bool is not a valid lesson count);
      - a teacher has duplicate (classId, subject, effective_week) entries.
    """
    settings = tcp_settings.get("teacherClassProgress", tcp_settings) if isinstance(tcp_settings, dict) else {}
    teachers_cfg = settings.get("teachers", []) if isinstance(settings, dict) else []
    for teacher in teachers_cfg:
        t_id = teacher.get("teacherId")
        weekly_lessons = teacher.get("weeklyLessons", []) or []
        seen = set()
        for entry in weekly_lessons:
            cls = entry.get("classId")
            subj = entry.get("subject")
            week_norm = normalize_teacher_class_progress_week(entry.get("week"))
            key = (cls, subj, week_norm)
            if key in seen:
                raise ValueError(
                    "teacher_class_progress_invalid_settings: duplicate weeklyLessons entry "
                    f"teacher={t_id!r} class={cls!r} subject={subj!r} week={week_norm!r}"
                )
            seen.add(key)
            lessons = entry.get("lessons")
            if isinstance(lessons, bool) or not isinstance(lessons, int):
                raise ValueError(
                    "teacher_class_progress_invalid_settings: non-integer lessons "
                    f"teacher={t_id!r} class={cls!r} subject={subj!r} week={week_norm!r} lessons={lessons!r}"
                )
            if lessons <= 0:
                raise ValueError(
                    "teacher_class_progress_invalid_settings: non-positive lessons "
                    f"teacher={t_id!r} class={cls!r} subject={subj!r} week={week_norm!r} lessons={lessons!r}"
                )


def build_teacher_class_progress_visit_layout(lesson_count: int, legal_pairs: List[Tuple[int, int]]) -> Dict[str, Any]:
    """
    Build visit layout for a given lesson count and valid consecutive pairs.
    Layout rules:
    - 1 lesson: [1] (one single visit)
    - 2 lessons: [2] (one double visit)
    - 3 lessons: [2, 1] (one double visit + one single visit)
    - 4 lessons: [2, 2] (two double visits)
    """
    required_pairs = lesson_count // 2
    selected_pairs = []
    consumed_periods = set()
    for pair in legal_pairs or []:
        if len(selected_pairs) == required_pairs:
            break
        if not isinstance(pair, (tuple, list)) or len(pair) != 2:
            continue
        first, second = pair
        if (
            not isinstance(first, int)
            or not isinstance(second, int)
            or second != first + 1
            or first in consumed_periods
            or second in consumed_periods
        ):
            continue
        selected_pairs.append((first, second))
        consumed_periods.update((first, second))
        if len(selected_pairs) == required_pairs:
            break

    if len(selected_pairs) != required_pairs:
        raise ValueError(
            "teacher_class_progress_missing_legal_pair: "
            f"lesson_count={lesson_count} required_pairs={required_pairs} "
            f"available_pairs={len(legal_pairs or [])} selected_pairs={len(selected_pairs)}"
        )

    visit_sizes = [2] * required_pairs + ([1] if lesson_count % 2 else [])

    return {
        "lesson_count": lesson_count,
        "visit_sizes": visit_sizes,
        "total_visits": len(visit_sizes),
        "legal_pairs": list(legal_pairs),
        "selected_legal_pairs": selected_pairs,
    }


def build_teacher_class_progress_weekly_activities(
    schedule: Dict[Tuple[str, int, str, str], Any],
    tcp_settings: Dict[str, Any],
    *,
    days: int = 5,
    periods_per_day: int = 7,
    period_base: str = "zero",
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Map schedule slots into symbolic effective week activities based on configured TCP settings.
    Includes the configured candidate slots for each teacher-class-subject-week entry; the exact
    `lessons` cardinality is enforced by the CP-SAT model builder, not here.
    Schedule keys: (class_name, period, teacher_name, subject_name)

    period_base:
      - "zero": schedule period is a 0-based global index (0..days*periods_per_day-1).
      - "one":  schedule period is a 1-based global index (1..days*periods_per_day).
    The activity's "period" field is always a 1-based global index.
    """
    if period_base not in ("zero", "one"):
        raise ValueError(f"invalid period_base: {period_base!r} (expected 'zero' or 'one')")
    validate_teacher_class_progress_settings(tcp_settings)
    settings = tcp_settings.get("teacherClassProgress", tcp_settings) if isinstance(tcp_settings, dict) else {}
    teachers_cfg = settings.get("teachers", []) if isinstance(settings, dict) else []
    entry_map = {}
    for teacher in teachers_cfg:
        t_id = teacher.get("teacherId")
        lessons = teacher.get("weeklyLessons", [])
        expanded = expand_teacher_class_progress_entries(lessons)
        for e in expanded:
            key = (t_id, e.get("classId"), e.get("subject"), e.get("effective_week"))
            entry_map[key] = e

    raw_activities = {"odd": [], "even": []}

    for (cls, period, teacher, subject), slot_val in schedule.items():
        raw_tag = "both"
        presence = slot_val
        if isinstance(slot_val, dict):
            raw_tag = slot_val.get("week", "both")
            presence = slot_val.get("presence", 1)
        slot_week = normalize_teacher_class_progress_week(raw_tag)

        target_weeks = ["odd", "even"] if slot_week == "both" else [slot_week]

        for eff_week in target_weeks:
            entry_key = (teacher, cls, subject, eff_week)
            cfg_entry = entry_map.get(entry_key)
            if cfg_entry is None or cfg_entry.get("lessons", 0) <= 0:
                continue

            if not isinstance(period, int):
                continue
            if period_base == "zero":
                period_1based = period + 1
            else:
                period_1based = period
            act = {
                "teacher_id": teacher,
                "class_id": cls,
                "subject": subject,
                "period": period_1based,
                "effective_week": eff_week,
                "presence": presence,
                "configured_entry": cfg_entry,
            }
            raw_activities[eff_week].append(act)

    # Sort activities per configured entry
    activities = {"odd": [], "even": []}
    for eff_week in ["odd", "even"]:
        grouped = {}
        for act in raw_activities[eff_week]:
            key = (act["teacher_id"], act["class_id"], act["subject"])
            grouped.setdefault(key, []).append(act)
        for key, act_list in grouped.items():
            act_list.sort(key=lambda x: x["period"])
            activities[eff_week].extend(act_list)

    for eff_week in ["odd", "even"]:
        activities[eff_week].sort(key=lambda x: (x["period"], x["class_id"], x["subject"]))

    return activities


def group_activities_into_visits(
    activities: List[Dict[str, Any]],
    periods_per_day: int = 7,
    value_of: Optional[Callable[[Any], Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Group active lessons into visits based on class_id, subject, week, and legal consecutive pairs.
    """
    active_items = []
    for item in activities:
        presence = item.get("presence")
        if value_of is not None:
            active_val = value_of(presence)
        elif isinstance(presence, bool):
            active_val = int(presence)
        elif isinstance(presence, (int, float)):
            active_val = int(presence)
        else:
            raise ValueError(
                "group_activities_into_visits: non-concrete presence value "
                f"({type(presence).__name__}); pass value_of or concrete 0/1 presence"
            )

        if active_val == 1:
            active_items.append(item)

    active_items.sort(key=lambda x: x["period"])

    visits = []
    i = 0
    while i < len(active_items):
        curr = active_items[i]
        cls = curr["class_id"]
        period = curr["period"]

        if i + 1 < len(active_items):
            next_item = active_items[i + 1]
            if next_item["class_id"] == cls and next_item["subject"] == curr["subject"]:
                p1 = curr["period"]
                p2 = next_item["period"]

                day = (p1 - 1) // periods_per_day
                base = day * periods_per_day
                legal_pairs = get_valid_consecutive_pairs(base)

                # legal pairs are 0-based; p1/p2 are 1-based global periods.
                if (p1 - 1, p2 - 1) in legal_pairs:
                    visits.append({
                        "teacher_id": curr["teacher_id"],
                        "class_id": cls,
                        "subject": curr["subject"],
                        "period": p1,
                        "end_period": p2,
                        "visit_size": 2,
                        "effective_week": curr["effective_week"],
                        "items": [curr, next_item],
                    })
                    i += 2
                    continue

        visits.append({
            "teacher_id": curr["teacher_id"],
            "class_id": cls,
            "subject": curr["subject"],
            "period": period,
            "end_period": period,
            "visit_size": 1,
            "effective_week": curr["effective_week"],
            "items": [curr],
        })
        i += 1

    return visits


def evaluate_teacher_class_progress_round_robin(
    weekly_activities: Dict[str, List[Dict[str, Any]]],
    tcp_settings: Dict[str, Any],
    *,
    value_of: Optional[Callable[[Any], Any]] = None,
) -> Dict[str, Any]:
    """
    Evaluates teacher class progress round-robin schedule metrics and penalties.
    Returns RoundRobinEvaluation dict.
    """
    settings = tcp_settings.get("teacherClassProgress", tcp_settings)
    if not settings.get("enabled", False):
        return {
            "total_penalty": 0,
            "components": {
                "teacher_class_progress_incomplete_round": 0,
                "teacher_class_progress_waiting": 0,
                "teacher_class_progress_visit_pattern": 0,
            },
            "violations": [],
            "rounds": [],
        }

    w_incomplete = settings.get("incompleteRoundWeight", 10)
    w_waiting = settings.get("waitingWeight", 5)
    w_visit_pattern = settings.get("visitPatternWeight", 5)

    teachers_cfg = settings.get("teachers", [])
    violations = []
    rounds_detail = []

    comp_incomplete = 0
    comp_waiting = 0
    comp_visit_pattern = 0

    for teacher_cfg in teachers_cfg:
        t_id = teacher_cfg.get("teacherId")
        class_order = teacher_cfg.get("classOrder", [])
        if not t_id or not class_order:
            continue

        for eff_week in ["odd", "even"]:
            raw_activities = [
                a for a in weekly_activities.get(eff_week, [])
                if a.get("teacher_id") == t_id or a.get("teacher_name") == t_id
            ]

            visits = group_activities_into_visits(raw_activities, value_of=value_of)
            if not visits:
                continue

            current_round = 1
            cursor_idx = 0
            last_cursor_period = None

            for visit in visits:
                cls = visit["class_id"]
                period = visit["period"]
                expected_cls = class_order[cursor_idx]

                if cls != expected_cls:
                    penalty = 1 * w_visit_pattern
                    comp_visit_pattern += penalty
                    violations.append({
                        "component": "teacher_class_progress_visit_pattern",
                        "teacherId": t_id,
                        "effectiveWeek": eff_week,
                        "roundIndex": current_round,
                        "expectedClassId": expected_cls,
                        "actualClassId": cls,
                        "period": period,
                        "rawUnits": 1,
                        "weight": w_visit_pattern,
                        "penalty": penalty,
                    })
                else:
                    if last_cursor_period is not None:
                        gap = period - last_cursor_period
                        if gap > 10:
                            raw_units = gap - 10
                            penalty = raw_units * w_waiting
                            comp_waiting += penalty
                            violations.append({
                                "component": "teacher_class_progress_waiting",
                                "teacherId": t_id,
                                "effectiveWeek": eff_week,
                                "roundIndex": current_round,
                                "expectedClassId": expected_cls,
                                "actualClassId": cls,
                                "period": period,
                                "rawUnits": raw_units,
                                "weight": w_waiting,
                                "penalty": penalty,
                            })
                    last_cursor_period = period

                    cursor_idx += 1
                    if cursor_idx == len(class_order):
                        rounds_detail.append({
                            "teacherId": t_id,
                            "effectiveWeek": eff_week,
                            "roundIndex": current_round,
                            "status": "complete",
                            "expectedClassId": None,
                        })
                        cursor_idx = 0
                        current_round += 1

            if cursor_idx > 0:
                missing_count = len(class_order) - cursor_idx
                penalty = missing_count * w_incomplete
                comp_incomplete += penalty
                expected_cls = class_order[cursor_idx]
                violations.append({
                    "component": "teacher_class_progress_incomplete_round",
                    "teacherId": t_id,
                    "effectiveWeek": eff_week,
                    "roundIndex": current_round,
                    "expectedClassId": expected_cls,
                    "actualClassId": None,
                    "period": None,
                    "rawUnits": missing_count,
                    "weight": w_incomplete,
                    "penalty": penalty,
                })
                rounds_detail.append({
                    "teacherId": t_id,
                    "effectiveWeek": eff_week,
                    "roundIndex": current_round,
                    "status": "incomplete",
                    "expectedClassId": expected_cls,
                })

    total_penalty = comp_incomplete + comp_waiting + comp_visit_pattern

    return {
        "total_penalty": total_penalty,
        "components": {
            "teacher_class_progress_incomplete_round": comp_incomplete,
            "teacher_class_progress_waiting": comp_waiting,
            "teacher_class_progress_visit_pattern": comp_visit_pattern,
        },
        "violations": violations,
        "rounds": rounds_detail,
    }


def _is_legal_pair_periods(p1, p2, periods_per_day):
    """Whether two 1-based global periods form a legal consecutive double (same day, no lunch crossing)."""
    # get_valid_consecutive_pairs works on 0-based global periods; convert first.
    z1 = p1 - 1
    z2 = p2 - 1
    day = z1 // periods_per_day
    base = day * periods_per_day
    legal_pairs = get_valid_consecutive_pairs(base)
    return (z1, z2) in legal_pairs


def add_teacher_class_progress_round_robin_penalties(
    model: Any,
    weekly_activities: Dict[str, List[Dict[str, Any]]],
    tcp_settings: Dict[str, Any],
    *,
    days: int = 5,
    periods_per_day: int = 7,
    period_base: str = "zero",
) -> Dict[str, Any]:
    """
    Adds CP-SAT soft penalty terms for teacher class progress round-robin.

    The visit structure is modeled DYNAMICALLY so that, on any solved assignment, the model's
    visits exactly match the evaluator's concrete `group_activities_into_visits` output:
      - a selected activity that is not part of a selected legal pair is a single visit;
      - a selected legal pair is one double visit;
      - an unselected activity produces no visit.
    The exact configured `lessons` count is enforced as a hard cardinality constraint per
    (teacher, class, subject, effective week).

    Returns metadata artifact dict with penalty_entries.
    """
    settings = tcp_settings.get("teacherClassProgress", tcp_settings) if isinstance(tcp_settings, dict) else {}
    validate_teacher_class_progress_settings(tcp_settings)
    if not settings.get("enabled", False) or model is None:
        return {
            "penalty_entries": [],
            "component_rule_ids": {
                "incomplete": "teacher_class_progress_incomplete_round",
                "waiting": "teacher_class_progress_waiting",
                "visit_pattern": "teacher_class_progress_visit_pattern",
            },
            "penalty_val": 0,
            "components": _neutral_tcp_components(),
            "evaluator_result": _neutral_evaluator_result(),
        }

    penalty_entries = []

    teachers_cfg = settings.get("teachers", [])
    w_incomplete = settings.get("incompleteRoundWeight", 10)
    w_waiting = settings.get("waitingWeight", 5)
    w_visit_pattern = settings.get("visitPatternWeight", 5)

    for teacher_cfg in teachers_cfg:
        t_id = teacher_cfg.get("teacherId")
        class_order = teacher_cfg.get("classOrder", [])
        if not t_id or not class_order:
            continue

        L = len(class_order)

        for eff_week in ["odd", "even"]:
            raw_acts = [
                a for a in weekly_activities.get(eff_week, [])
                if a.get("teacher_id") == t_id or a.get("teacher_name") == t_id
            ]
            raw_acts = sorted(raw_acts, key=lambda a: a["period"])
            for a in raw_acts:
                if not isinstance(a["presence"], cp_model.IntVar):
                    raise ValueError(
                        "add_teacher_class_progress_round_robin_penalties: expected symbolic "
                        f"CP-SAT presence variables, got {type(a['presence']).__name__} "
                        f"(teacher={t_id!r} class={a['class_id']!r} subject={a['subject']!r} week={eff_week!r})"
                    )

            # Hard cardinality: exact configured lessons per (class, subject, effective week).
            # Every configured bucket is checked against its candidate slots, including
            # buckets with zero candidates, so a candidate-domain shortage fails
            # deterministically before the solve.
            by_cls_subj = {}
            for a in raw_acts:
                by_cls_subj.setdefault((a["class_id"], a["subject"]), []).append(a)
            seen_buckets = set()
            for wl in teacher_cfg.get("weeklyLessons", []):
                wl_week = normalize_teacher_class_progress_week(wl.get("week"))
                if wl_week not in ("both", eff_week):
                    continue
                cls = wl.get("classId")
                subj = wl.get("subject")
                if (cls, subj) in seen_buckets:
                    continue
                seen_buckets.add((cls, subj))
                lessons = wl.get("lessons", 0)
                if not lessons or lessons <= 0:
                    continue
                acts = by_cls_subj.get((cls, subj), [])
                if len(acts) < lessons:
                    raise ValueError(
                        "teacher_class_progress_invalid_configuration: candidate domain shortage "
                        f"teacher={t_id!r} class={cls!r} subject={subj!r} week={eff_week!r} "
                        f"candidates={len(acts)} lessons={lessons}"
                    )
                model.Add(sum(a["presence"] for a in acts) == lessons)

            if not raw_acts:
                continue
            K = len(raw_acts)
            safe_t = str(t_id).replace(" ", "_")

            # Dynamic visit recurrence (matches the evaluator's concrete greedy folding).
            sel = [a["presence"] for a in raw_acts]
            pair_legal = [False] * K
            for i in range(K - 1):
                a, b = raw_acts[i], raw_acts[i + 1]
                pair_legal[i] = (
                    a["class_id"] == b["class_id"]
                    and a["subject"] == b["subject"]
                    and b["period"] == a["period"] + 1
                    and _is_legal_pair_periods(a["period"], b["period"], periods_per_day)
                )

            start_vars = [None] * K
            prev_double = 0  # double[-1]
            for i in range(K):
                s = model.NewBoolVar(f"tcp_start_{safe_t}_{eff_week}_{i}")
                if isinstance(prev_double, int):
                    # prev_double == 0 (constant)
                    model.Add(s == sel[i])
                else:
                    # s = sel[i] AND NOT prev_double  (2-way reification)
                    model.Add(s <= sel[i])
                    model.Add(s <= 1 - prev_double)
                    model.Add(s >= sel[i] - prev_double)
                start_vars[i] = s

                if i + 1 < K and pair_legal[i]:
                    d = model.NewBoolVar(f"tcp_double_{safe_t}_{eff_week}_{i}")
                    # d = s AND sel[i+1]
                    model.Add(d <= s)
                    model.Add(d <= sel[i + 1])
                    model.Add(d >= s + sel[i + 1] - 1)
                    prev_double = d
                else:
                    prev_double = 0

            # Sequential state machine over the K candidate positions (in period order).
            advances_vars = []
            for i in range(K):
                v_var = start_vars[i]
                v_cls = raw_acts[i]["class_id"]
                adv_var = model.NewBoolVar(f"tcp_adv_{safe_t}_{eff_week}_{i}")
                pat_var = model.NewBoolVar(f"tcp_pat_{safe_t}_{eff_week}_{i}")

                prefix_adv_expr = sum(advances_vars)
                cursor_k_vars = []
                for k in range(L):
                    ck_var = model.NewBoolVar(f"tcp_ck_{k}_{safe_t}_{eff_week}_{i}")
                    max_rounds = (i // L) + 1
                    k_matches = []
                    for r_num in range(max_rounds + 1):
                        target_val = r_num * L + k
                        if target_val <= i:
                            m_var = model.NewBoolVar(f"tcp_ck_m_{target_val}_{safe_t}_{eff_week}_{i}")
                            model.Add(prefix_adv_expr == target_val).OnlyEnforceIf(m_var)
                            model.Add(prefix_adv_expr != target_val).OnlyEnforceIf(m_var.Not())
                            k_matches.append(m_var)
                    if k_matches:
                        model.Add(ck_var == sum(k_matches))
                    else:
                        model.Add(ck_var == 0)
                    cursor_k_vars.append(ck_var)

                matching_ck = [cursor_k_vars[k] for k in range(L) if class_order[k] == v_cls]
                if matching_ck:
                    match_ck_var = model.NewBoolVar(f"tcp_match_ck_{safe_t}_{eff_week}_{i}")
                    model.Add(match_ck_var == sum(matching_ck))
                    model.Add(adv_var <= v_var)
                    model.Add(adv_var <= match_ck_var)
                    model.Add(adv_var >= v_var + match_ck_var - 1)
                else:
                    model.Add(adv_var == 0)

                model.Add(pat_var == v_var - adv_var)
                advances_vars.append(adv_var)

                if w_visit_pattern > 0:
                    penalty_entries.append({
                        "rule_id": "teacher_class_progress_visit_pattern",
                        "weight": w_visit_pattern,
                        "var": pat_var,
                    })

            # Incomplete round penalty
            M = K
            if w_incomplete > 0:
                total_adv = model.NewIntVar(0, M, f"tcp_total_adv_{safe_t}_{eff_week}")
                model.Add(total_adv == sum(advances_vars))
                for rem in range(1, L):
                    missing_count = L - rem
                    rem_bool = model.NewBoolVar(f"tcp_rem_{rem}_{safe_t}_{eff_week}")
                    max_rounds = (M // L) + 1
                    round_matches = []
                    for r_num in range(max_rounds + 1):
                        target_val = r_num * L + rem
                        if target_val <= M:
                            match_var = model.NewBoolVar(f"tcp_match_{target_val}_{safe_t}_{eff_week}")
                            model.Add(total_adv == target_val).OnlyEnforceIf(match_var)
                            model.Add(total_adv != target_val).OnlyEnforceIf(match_var.Not())
                            round_matches.append(match_var)
                    if round_matches:
                        model.Add(rem_bool == sum(round_matches))
                        penalty_entries.append({
                            "rule_id": "teacher_class_progress_incomplete_round",
                            "weight": missing_count * w_incomplete,
                            "var": rem_bool,
                        })

            # Waiting penalty (between consecutive advancing positions)
            if w_waiting > 0:
                for i in range(M):
                    for j in range(i + 1, M):
                        p_i = raw_acts[i]["period"]
                        p_j = raw_acts[j]["period"]
                        if p_j - p_i > 10:
                            gap_units = p_j - p_i - 10
                            between_adv = advances_vars[i + 1:j]
                            consec_var = model.NewBoolVar(f"tcp_wait_{i}_{j}_{safe_t}_{eff_week}")
                            conds = [advances_vars[i], advances_vars[j]]
                            if between_adv:
                                no_between = model.NewBoolVar(f"tcp_nobetween_{i}_{j}_{safe_t}_{eff_week}")
                                model.Add(sum(between_adv) == 0).OnlyEnforceIf(no_between)
                                model.Add(sum(between_adv) >= 1).OnlyEnforceIf(no_between.Not())
                                conds.append(no_between)
                            model.AddBoolAnd(conds).OnlyEnforceIf(consec_var)
                            model.AddBoolOr([c.Not() for c in conds]).OnlyEnforceIf(consec_var.Not())
                            penalty_entries.append({
                                "rule_id": "teacher_class_progress_waiting",
                                "weight": gap_units * w_waiting,
                                "var": consec_var,
                            })

    return {
        "penalty_entries": penalty_entries,
        "component_rule_ids": {
            "incomplete": "teacher_class_progress_incomplete_round",
            "waiting": "teacher_class_progress_waiting",
            "visit_pattern": "teacher_class_progress_visit_pattern",
        },
        "penalty_val": 0,
        "components": _neutral_tcp_components(),
        "evaluator_result": _neutral_evaluator_result(),
    }
