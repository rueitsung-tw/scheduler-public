"""
solver.py — 排課系統主入口

負責：
  1. CLI 參數讀取
  2. JSON 載入
  3. 呼叫 preprocessor 前處理
  4. 建構 OR-Tools model
  5. 呼叫各 constraints 模組
  6. 執行求解 / 序列化結果 / 寫入輸出

不改 CLI 介面、不改輸入 JSON schema、不改輸出 JSON schema、不改排課結果邏輯。

"""

import terminal_sanitizer
import copy
import os
import sys

# Diagnostics helper
def _dump_diagnostics(label, schedule_entries):
    print(f"\n[DIAG] === {label} ===", flush=True)
    found = []
    for entry in schedule_entries:
        if entry.get("day") == 2 and entry.get("period") == 1:
            if entry.get("className") in ["3年10班", "5年11班"]:
                found.append(entry)
    for f in found:
        print(f"[DIAG] {f}", flush=True)
    print("[DIAG] === END ===\n", flush=True)

import json
import time
import re
from collections import defaultdict

from ortools.sat.python import cp_model

from phase2_engine import SchedulePhase2Engine
from config import DAYS, PERIODS_PER_DAY, TOTAL_PERIODS, LUNCH_BOUNDARY, CLASSROOM_LIMITS_FALLBACK
from scheduler_policy import SolveMode, get_active_policy, parse_slot_rules, build_hard_slot_mask
from utils import (
    parse_grade,
    is_virtual_teacher,
    normalize_room_name,
    get_subject_capacity,
)
from preprocessor import (
    preprocess_classes,
    build_effective_grade_rules,
    allowed_grades_for_subject,
    normalize_classroom_metadata,
    build_priority_teacher_placeholders,
)
from constraints.base_rules import (
    create_schedule_vars_and_course_demands,
    create_alternating_vars,
    apply_preallocation_locks,
    apply_hard_slot_constraints,
    apply_class_slot_exclusivity,
)
from constraints.movable_locks import (
    get_movable_lock_policy,
    apply_movable_budgets,
)
from constraints.teacher_rules import (
    apply_anti_collision,
    apply_alternating_teacher_anti_collision,
    apply_teacher_quota,
    apply_teacher_unavailable_slots,
    apply_special_course_locks,
    classify_special_course_overlaps,
)
from constraints.class_rules import (
    apply_daily_subject_limit,
    apply_afternoon_prohibition,
    apply_no_consecutive_subject,
    apply_special_classroom_capacity,
    apply_science_habits,
    get_effective_class_period_capacity,
    get_art_room_capacity,
    resolve_class_grade,
    apply_week_specific_art_capacity_model,
    apply_week_specific_art_capacity_entries,
    apply_grade12_tuesday_life_course,
    build_daily_subject_teacher_minimum_penalty,
    apply_subject_day_spread,
    apply_music_fixed_vs_alternating_day_spread,
    apply_grade_time_hard_constraints,
)
from constraints.utils import grade_needs_special_room
from grade_time_rules import (
    parse_grade_time_rules,
    validate_grade_time_rules,
)
from grade_time_rule_diagnostics import (
    compute_grade_time_rule_diagnostics,
    extract_selector_values_from_metadata,
)
from constraints.special_rules import (
    apply_no_consecutive_pe,
    apply_art_consecutive_constraint,
    apply_alternating_perfect_pairing,
    apply_swimming_engine_v2,
    add_consecutive_constraint,
    get_valid_consecutive_pairs,
)
from constraints.teacher_class_progress import (
    build_teacher_class_progress_weekly_activities,
    evaluate_teacher_class_progress_round_robin,
)

# TCP penalty component rule IDs, in canonical order.
TCP_COMPONENT_RULE_IDS = (
    "teacher_class_progress_incomplete_round",
    "teacher_class_progress_waiting",
    "teacher_class_progress_visit_pattern",
)


def compare_teacher_class_progress_components(model_components, evaluator_components):
    """Compare solved model TCP components against the canonical evaluator's components.

    Pure function: no solver state, no I/O, no environment access.
    Returns {"matched": bool, "mismatches": [{"ruleId", "modelValue", "evaluatorValue"}, ...]}
    where each mismatch names the divergent rule and both values.
    """
    mismatches = [
        {
            "ruleId": rule_id,
            "modelValue": model_components.get(rule_id, 0),
            "evaluatorValue": evaluator_components.get(rule_id, 0),
        }
        for rule_id in TCP_COMPONENT_RULE_IDS
        if model_components.get(rule_id, 0) != evaluator_components.get(rule_id, 0)
    ]
    return {"matched": not mismatches, "mismatches": mismatches}


def _normalize_week_tag(week):
    value = str(week or "both").strip().lower()
    if value in ("odd", "single", "oddweek", "單", "單週"):
        return "odd"
    if value in ("even", "double", "evenweek", "雙", "雙週"):
        return "even"
    return "both"


def _expand_validation_weeks(week):
    normalized = _normalize_week_tag(week)
    if normalized == "both":
        return ("odd", "even")
    return (normalized,)


def _is_homeroom_location_name(name):
    value = str(name or "").strip()
    if not value:
        return True
    return value in ("原班教室", "班級教室", "homeroom", "classroom") or "原班" in value


def _get_explicit_room_info(entry):
    classroom_id = str(entry.get("classroomId", "") or entry.get("roomId", "") or "").strip()
    classroom_name = str(entry.get("classroomName", "") or entry.get("roomName", "") or "").strip()
    if classroom_id:
        return classroom_id, classroom_name or classroom_id
    if classroom_name and not _is_homeroom_location_name(classroom_name):
        return classroom_name, classroom_name
    return "", ""

def _normalize_special_room_subject(subj_raw):
    subj = str(subj_raw or "").strip()
    if subj in ("語文-本土語", "本土語言", "閩南語", "客語"):
        return "本土語"
    if subj == "英語":
        return "語文-英語"
    if subj == "自然":
        return "自然科學"
    if subj in ("科技-資訊", "資訊", "電腦"):
        return "資訊"
    if subj in ("健康與體育",):
        return "體育"
    return subj


def _compute_result_flags(used_soft_capacity_fallback, week_specific_conflict):
    """
    將 week-specific 衝堂旗標與實際降級流程分開回報。

    weekSpecificConflict 表示後驗仍有真實分週衝堂；
    degraded 則只表示本次求解流程真的啟用了降級/放寬路徑。
    """
    degraded = bool(used_soft_capacity_fallback)
    degrade_level = 1 if degraded else 0
    return {
        "weekSpecificConflict": bool(week_specific_conflict),
        "degraded": degraded,
        "degradeLevel": degrade_level,
    }


def _count_required_periods(reqs, skip_homeroom_block=False):
    total_periods = 0
    seen_alternating = set()
    for req in reqs:
        subject = req.get("subject", "")
        if skip_homeroom_block and "導師區塊" in subject:
            continue
        periods = int(float(req.get("periods", 0) or 0))
        if "交替" in subject:
            if subject in seen_alternating:
                continue
            seen_alternating.add(subject)
        total_periods += periods
    return total_periods


def _summarize_alternating_teacher_loads(classes_data):
    teacher_to_classes = defaultdict(set)

    for cls in classes_data:
        class_name = cls.get("name", "")
        for req in cls.get("course_requirements", []):
            if "音樂美勞_交替" not in req.get("subject", ""):
                continue
            for teacher_name in {
                req.get("teacher_name", ""),
                req.get("teacher_music", ""),
                req.get("teacher_art", ""),
            }:
                teacher_name = str(teacher_name or "").strip()
                if teacher_name:
                    teacher_to_classes[teacher_name].add(class_name)

    summaries = []
    for teacher_name, classes_set in sorted(teacher_to_classes.items()):
        class_names = sorted(classes_set)
        summaries.append({
            "level": "INFO",
            "teacher": teacher_name,
            "classCount": len(class_names),
            "classNames": class_names,
            "message": (
                f"{teacher_name}: 負責 {len(class_names)} 個交替班級 "
                f"({', '.join(class_names)})；此為總量提示，不代表同一時段衝突。"
            ),
        })
    return summaries


def _summarize_swimming_resource_pressure(classes_data):
    swim_classes = [
        cls for cls in classes_data
        if re.search(r'\d+年', cls.get("name", ""))
        and int(re.search(r'(\d+)年', cls.get("name", "")).group(1)) in [4, 5, 6]
    ]
    return {
        "level": "INFO" if len(swim_classes) > 3 else "OK",
        "classCount": len(swim_classes),
        "poolCount": 3,
        "message": (
            f"游泳班數({len(swim_classes)}) > 泳池數(3)，屬於總量壓力提示，"
            "不直接代表同一時段無解。"
            if len(swim_classes) > 3
            else "游泳總量壓力正常。"
        ),
    }


def _canonical_schedule_subject_for_room(subject):
    subj = str(subject or "").strip()
    if not subj:
        return ""
    if "自然" in subj:
        return "自然科學"
    if "英語" in subj or "英文" in subj:
        return "語文-英語"
    if "音樂" in subj:
        return "音樂"
    if "美勞" in subj:
        return "美勞"
    if "體育" in subj or "游泳" in subj:
        return "體育"
    if "資訊" in subj or "電腦" in subj or "科技-資訊" in subj:
        return "資訊"
    if "本土" in subj:
        return "本土語"
    return _normalize_special_room_subject(subj)


_VALIDATION_DAY_SPREAD_SUBJECTS = {
    "語文-英語",
    "資訊",
    "體育",
    "健康",
    "社會",
    "本土語",
}


def _validation_day_spread_subject(subject):
    normalized = _canonical_schedule_subject_for_room(subject)
    if normalized in _VALIDATION_DAY_SPREAD_SUBJECTS:
        return normalized
    return ""


def _collect_subject_day_spread_issues(schedule_entries):
    subject_day_slots = defaultdict(list)
    class_subject_weekly_counts = defaultdict(int)

    for entry in schedule_entries or []:
        subject = str(entry.get("subject", "")).strip()
        canonical_subject = _validation_day_spread_subject(subject)
        if not canonical_subject:
            continue

        class_name = str(entry.get("className", "")).strip()
        day = int(entry.get("day", 0) or 0)
        period = int(entry.get("period", 0) or 0)
        teacher_name = str(entry.get("teacherName", "")).strip()

        for week in _expand_validation_weeks(entry.get("week")):
            subject_day_slots[(class_name, canonical_subject, day, week)].append({
                "period": period,
                "subject": subject,
                "teacherName": teacher_name,
            })
            class_subject_weekly_counts[(class_name, canonical_subject, week)] += 1

    import math
    issues = []
    for (class_name, canonical_subject, day, week), entries in subject_day_slots.items():
        periods = sorted({item["period"] for item in entries})
        total_weekly = class_subject_weekly_counts.get((class_name, canonical_subject, week), 0)
        max_allowed = max(1, math.ceil(total_weekly / float(DAYS)))
        if len(periods) <= max_allowed:
            continue
        issues.append({
            "className": class_name,
            "canonicalSubject": canonical_subject,
            "day": day,
            "week": week,
            "count": len(periods),
            "periods": periods,
            "subjects": sorted({item["subject"] for item in entries if item["subject"]}),
            "teacherNames": sorted({item["teacherName"] for item in entries if item["teacherName"]}),
        })

    return issues


def _collect_science_same_day_shape_issues(schedule_entries):
    science_day_slots = defaultdict(list)

    for entry in schedule_entries or []:
        subject = str(entry.get("subject", "")).strip()
        if _canonical_schedule_subject_for_room(subject) != "自然科學":
            continue

        class_name = str(entry.get("className", "")).strip()
        day = int(entry.get("day", 0) or 0)
        period = int(entry.get("period", 0) or 0)
        teacher_name = str(entry.get("teacherName", "")).strip()

        for week in _expand_validation_weeks(entry.get("week")):
            science_day_slots[(class_name, day, week)].append({
                "period": period,
                "subject": subject,
                "teacherName": teacher_name,
            })

    issues = []
    for (class_name, day, week), entries in science_day_slots.items():
        periods = sorted({item["period"] for item in entries})
        if len(periods) != 3:
            continue
        issues.append({
            "className": class_name,
            "day": day,
            "week": week,
            "count": len(periods),
            "periods": periods,
            "subjects": sorted({item["subject"] for item in entries if item["subject"]}),
            "teacherNames": sorted({item["teacherName"] for item in entries if item["teacherName"]}),
        })

    return issues


def _entry_room_weight(entry):
    week = _normalize_week_tag(entry.get("week"))
    return 0.5 if week in ("odd", "even") else 1.0


def _entries_match_same_resolved_special_course_event(entries, teacher_name, day, period, resolved_special_courses):
    if not resolved_special_courses:
        return False

    # 1. 檢查單一 resolved special course
    for sc in resolved_special_courses:
        sc_teacher = sc.get("teacher") or sc.get("teacher_name")
        if sc_teacher != teacher_name:
            continue

        slots = sc.get("lockedSlots") or []
        if not any(slot.get("day") == day and slot.get("period") == period for slot in slots):
            continue

        target_classes = set(sc.get("targetClasses") or [])
        target_subject = sc.get("targetSubject") or sc.get("subject")
        effective_subjects = sc.get("_effective_subjects") or {}
        if not target_classes or not target_subject:
            continue

        all_entries_match = True
        for entry in entries:
            class_name = entry.get("className")
            if class_name not in target_classes:
                all_entries_match = False
                break

            allowed_subjects = {target_subject}
            effective_subject = effective_subjects.get(class_name)
            if effective_subject:
                allowed_subjects.add(effective_subject)
            if entry.get("subject") not in allowed_subjects:
                all_entries_match = False
                break

        if all_entries_match:
            return True

    # 2. 檢查具 sharedEventId 的共同授課事件分組
    shared_groups = defaultdict(list)
    for sc in resolved_special_courses:
        shared_id = sc.get("sharedEventId")
        if not shared_id:
            continue
        sc_teacher = sc.get("teacher") or sc.get("teacher_name")
        if sc_teacher != teacher_name:
            continue
        slots = sc.get("lockedSlots") or []
        if not any(slot.get("day") == day and slot.get("period") == period for slot in slots):
            continue
        shared_groups[str(shared_id).strip()].append(sc)

    for shared_id, group_scs in shared_groups.items():
        all_group_classes = set()
        class_to_allowed_subjects = defaultdict(set)
        for sc in group_scs:
            t_classes = set(sc.get("targetClasses") or [])
            all_group_classes |= t_classes
            t_subj = sc.get("targetSubject") or sc.get("subject")
            eff_subjs = sc.get("_effective_subjects") or {}
            for c in t_classes:
                if t_subj:
                    class_to_allowed_subjects[c].add(t_subj)
                if c in eff_subjs:
                    class_to_allowed_subjects[c].add(eff_subjs[c])

        all_entries_match = True
        for entry in entries:
            class_name = entry.get("className")
            if class_name not in all_group_classes:
                all_entries_match = False
                break
            allowed = class_to_allowed_subjects.get(class_name, set())
            if entry.get("subject") not in allowed:
                all_entries_match = False
                break

        if all_entries_match and all_group_classes:
            return True

    return False


def _configured_special_room_subjects(classrooms, classroom_limits, school_info, fallback_limits):
    subjects = set()

    for room in classrooms or []:
        subj = _normalize_special_room_subject(room.get("subject", ""))
        if subj:
            subjects.add(subj)

    for subj_raw in (classroom_limits or {}).keys():
        subj = _normalize_special_room_subject(subj_raw)
        if subj:
            subjects.add(subj)

    classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}
    for subj_raw in classroom_grades_cfg.keys():
        subj = _normalize_special_room_subject(subj_raw)
        if subj:
            subjects.add(subj)

    return subjects



def _validate_schedule_result(
    schedule_entries,
    classes_data,
    school_info,
    classrooms,
    ai_settings,
    standard_domain_settings=None,
    resolved_special_courses=None,
):
    class_map = {
        str(cls.get("name", "")).strip(): cls
        for cls in classes_data or []
        if cls.get("name")
    }
    teacher_slots = defaultdict(list)
    room_slots = defaultdict(list)
    room_usage = defaultdict(float)
    room_issues = []
    room_conflicts = []
    unassigned_room_issues = []
    teacher_issues = []
    grade_issues = []
    class_slot_issues = []
    class_slots = defaultdict(list)

    actual_room_count = defaultdict(int)
    for room in classrooms or []:
        subj = _normalize_special_room_subject(room.get("subject", ""))
        if subj:
            actual_room_count[subj] += 1

    normalized_limits = {}
    for subj_raw, limit in ((school_info or {}).get("classroomLimits", {}) or {}).items():
        try:
            normalized_limits[_normalize_special_room_subject(subj_raw)] = int(limit)
        except (TypeError, ValueError):
            continue

    fallback_limits = {
        "自然科學": 2,
        "語文-英語": 2,
        "音樂": 2,
        "美勞": 2,
        "體育": 3,
        "資訊": 2,
    }

    constrained_subjects = _configured_special_room_subjects(
        classrooms,
        normalized_limits,
        school_info,
        fallback_limits,
    )

    capacity_count_by_subject = {}
    for subj in constrained_subjects:
        count = actual_room_count.get(subj, 0)
        if count <= 0:
            count = normalized_limits.get(subj, fallback_limits.get(subj, 0))
        capacity_count_by_subject[subj] = count

    effective_grade_rules = build_effective_grade_rules(
        standard_domain_settings=standard_domain_settings,
        subject_grade_rules=(school_info or {}).get("subjectGradeRules", {}) or {},
    )

    for entry in schedule_entries:
        class_name = str(entry.get("className", "")).strip()
        teacher_name = str(entry.get("teacherName", "")).strip()
        subject = str(entry.get("subject", "")).strip()
        day = int(entry.get("day", 0) or 0)
        period = int(entry.get("period", 0) or 0)
        validation_weeks = _expand_validation_weeks(entry.get("week"))
        cls = class_map.get(class_name, {})
        grade = parse_grade(cls) or parse_grade({"name": class_name}) or 0

        for week in validation_weeks:
            if teacher_name:
                teacher_slots[(teacher_name, day, period, week)].append(entry)
            class_slots[(class_name, day, period, week)].append(entry)

        allowed_grades = allowed_grades_for_subject(subject, grade_rules=effective_grade_rules)

        if allowed_grades is not None and grade not in allowed_grades:
            grade_issues.append({
                "className": class_name,
                "day": day,
                "period": period,
                "subject": subject,
                "grade": grade,
                "allowedGrades": sorted(allowed_grades) if isinstance(allowed_grades, set) else allowed_grades,
            })

        canonical_subject = _canonical_schedule_subject_for_room(subject)
        if not canonical_subject:
            continue
        if canonical_subject not in constrained_subjects:
            continue
        if not grade_needs_special_room(
            canonical_subject,
            grade,
            (school_info or {}).get("subjectClassroomGrades", {}) or {},
        ):
            continue
        room_key, room_label = _get_explicit_room_info(entry)
        for week in validation_weeks:
            if room_key:
                room_slots[(room_key, day, period, week)].append(entry)
            else:
                # 體育是容量型活動空間，不需要逐筆實體教室指派
                if canonical_subject != "體育":
                    unassigned_room_issues.append({
                        "className": class_name,
                        "day": day,
                        "period": period,
                        "week": week,
                        "subject": subject,
                    })
                room_usage[(canonical_subject, day, period, week)] += _entry_room_weight(entry)

    for (teacher_name, day, period, week), entries in teacher_slots.items():
        if len(entries) <= 1:
            continue
        if _entries_match_same_resolved_special_course_event(
            entries,
            teacher_name,
            day,
            period,
            resolved_special_courses,
        ):
            continue
        if (ai_settings or {}).get("artsClassEnabled", False) and is_virtual_teacher(teacher_name):
            if all(class_map.get(e.get("className"), {}).get("isArtsClass", False) for e in entries):
                continue
        teacher_issues.append({
            "teacherName": teacher_name,
            "day": day,
            "period": period,
            "week": week,
            "classes": sorted({e.get("className", "") for e in entries}),
        })

    subject_day_spread_issues = _collect_subject_day_spread_issues(schedule_entries)
    science_same_day_shape_issues = _collect_science_same_day_shape_issues(schedule_entries)

    # ── Special Course Overlap Validation ──
    special_course_overlap_conflicts = []
    special_course_allowed_overlaps = []
    special_course_input_errors = []

    if resolved_special_courses:
        from constraints.teacher_rules import validate_shared_event_entity_consistency
        special_course_input_errors = validate_shared_event_entity_consistency(resolved_special_courses)
        overlap_analysis = classify_special_course_overlaps(resolved_special_courses)
        special_course_overlap_conflicts = overlap_analysis.get("conflicts", [])
        special_course_allowed_overlaps = overlap_analysis.get("allowed_overlaps", [])

    allowed_special_slots = {
        (item["className"], item["day"], item["period"])
        for item in special_course_allowed_overlaps
    }

    for (class_name, day, period, week), entries in class_slots.items():
        if len(entries) <= 1:
            continue
        if (class_name, day, period) in allowed_special_slots:
            continue
        class_slot_issues.append({
            "className": class_name,
            "day": day,
            "period": period,
            "week": week,
            "subjects": sorted({
                f"{e.get('subject', '')} / {e.get('teacherName', '')}"
                for e in entries
            }),
        })

    for (room_key, day, period, week), entries in room_slots.items():
        unique_classes = sorted({e.get("className", "") for e in entries if e.get("className")})
        if len(unique_classes) <= 1:
            continue
        sample = entries[0] if entries else {}
        room_conflicts.append({
            "classroomId": str(sample.get("classroomId", "") or "").strip(),
            "classroomName": str(sample.get("classroomName", "") or "").strip() or room_key,
            "day": day,
            "period": period,
            "week": week,
            "classes": unique_classes,
            "subjects": sorted({
                f"{e.get('className', '')} / {e.get('subject', '')} / {e.get('teacherName', '')}"
                for e in entries
            }),
        })

    for (subject, day, period, week), used in room_usage.items():
        capacity = capacity_count_by_subject.get(subject, 0)
        if used > capacity:
            room_issues.append({
                "subject": subject,
                "day": day,
                "period": period,
                "week": week,
                "used": used,
                "capacity": capacity,
            })

    # 🏀 診斷分組：按科目統計未指派教室的數量與班級分佈
    subject_counter = {}
    subject_classes = defaultdict(set)
    for item in unassigned_room_issues:
        subj = item.get("subject", "")
        cls_name = item.get("className", "")
        subject_counter[subj] = subject_counter.get(subj, 0) + 1
        if cls_name:
            subject_classes[subj].add(cls_name)

    unassigned_special_rooms_summary = [
        {
            "subject": subj,
            "count": cnt,
            "classes": sorted(subject_classes.get(subj, set())),
        }
        for subj, cnt in sorted(subject_counter.items(), key=lambda x: -x[1])
    ]

    return {
        "class_slot_conflicts": class_slot_issues,
        "teacher_conflicts": teacher_issues,
        "room_conflicts": room_conflicts,
        "room_overloads": room_issues,
        "unassigned_special_rooms": unassigned_room_issues,
        "unassigned_special_rooms_summary": unassigned_special_rooms_summary,
        "grade_subject_issues": grade_issues,
        "subject_day_spread_issues": subject_day_spread_issues,
        "science_same_day_shape_issues": science_same_day_shape_issues,
        "special_course_overlap_conflicts": special_course_overlap_conflicts,
        "special_course_allowed_overlaps": special_course_allowed_overlaps,
        "special_course_input_errors": special_course_input_errors,
    }


def _has_hard_validation_errors(validation_report, allow_room_overloads=False):
    """Return True when hard errors exist."""
    if not isinstance(validation_report, dict):
        return False

    if validation_report.get("teacher_conflicts"):
        return True
    if validation_report.get("class_slot_conflicts"):
        return True
    if validation_report.get("room_conflicts"):
        return True
    if validation_report.get("unassigned_special_rooms"):
        return True
    if validation_report.get("grade_subject_issues"):
        return True
    if any(item.get("canonicalSubject") == "本土語" for item in (validation_report.get("subject_day_spread_issues") or [])):
        return True
    if validation_report.get("science_same_day_shape_issues"):
        return True
    if not allow_room_overloads and validation_report.get("room_overloads"):
        return True
    if validation_report.get("special_course_overlap_conflicts"):
        return True
    if validation_report.get("special_course_input_errors"):
        return True

    return False


def _build_music_art_optimizer_configs(classes_data):
    configs = {}
    for cls in classes_data or []:
        class_name = str(cls.get("name", "")).strip()
        if not class_name:
            continue

        art_fixed_req = None
        alternating_req = None
        for req in cls.get("course_requirements", []) or []:
            subject = str(req.get("subject", "")).strip()
            if subject == "美勞_固定":
                art_fixed_req = req
            elif subject == "音樂美勞_交替":
                alternating_req = req

        if not art_fixed_req or not alternating_req:
            continue

        music_teacher = (
            alternating_req.get("teacher_music")
            or alternating_req.get("teacher_name")
            or alternating_req.get("teacher")
            or ""
        )
        art_teacher = (
            alternating_req.get("teacher_art")
            or art_fixed_req.get("teacher_name")
            or art_fixed_req.get("teacher")
            or ""
        )
        pair_group_id = alternating_req.get("pair_group_id") or ""
        if not music_teacher or not art_teacher or not pair_group_id:
            continue

        configs[class_name] = {
            "class_name": class_name,
            "grade": parse_grade(cls) or 0,
            "music_teacher": music_teacher,
            "art_teacher": art_teacher,
            "pair_group_id": pair_group_id,
        }

    return configs


def _refresh_music_art_pair_metadata(schedule_entries, optimizer_configs):
    if not schedule_entries or not optimizer_configs:
        return schedule_entries

    slot_members = defaultdict(list)
    class_entries = defaultdict(list)

    for entry in schedule_entries:
        class_name = str(entry.get("className", "")).strip()
        week = _normalize_week_tag(entry.get("week"))
        if class_name not in optimizer_configs or week not in ("odd", "even"):
            continue
        cfg = optimizer_configs[class_name]
        entry["pairGroupId"] = cfg["pair_group_id"]
        class_entries[class_name].append(entry)
        slot_key = (cfg["pair_group_id"], int(entry.get("day", 0) or 0), int(entry.get("period", 0) or 0))
        if class_name not in slot_members[slot_key]:
            slot_members[slot_key].append(class_name)

    for class_name, entries in class_entries.items():
        odd_entry = next((entry for entry in entries if _normalize_week_tag(entry.get("week")) == "odd"), None)
        direction = "music-first"
        if odd_entry and "美勞" in str(odd_entry.get("subject", "")):
            direction = "art-first"
        role = "A" if direction == "music-first" else "B"

        for entry in entries:
            slot_key = (
                optimizer_configs[class_name]["pair_group_id"],
                int(entry.get("day", 0) or 0),
                int(entry.get("period", 0) or 0),
            )
            partners = sorted(cx for cx in slot_members.get(slot_key, []) if cx != class_name)
            entry["pairDirection"] = direction
            entry["pairRole"] = role
            entry["pairPartnerClass"] = partners[0] if partners else None

    return schedule_entries


def _optimize_music_art_alternating_locally(schedule_entries, classes_data, classrooms, school_info):
    """Return (entries_list, skipped_bool)."""
    if not schedule_entries:
        return schedule_entries, True

    optimizer_configs = _build_music_art_optimizer_configs(classes_data)
    if not optimizer_configs:
        return schedule_entries, True

    working_entries = [dict(entry) for entry in schedule_entries]
    class_grade_map = {
        str(cls.get("name", "")).strip(): parse_grade(cls) or 0
        for cls in classes_data or []
        if cls.get("name")
    }

    class_contexts = {}
    excluded_entry_ids = set()

    for class_name, cfg in optimizer_configs.items():
        class_entries = [entry for entry in working_entries if str(entry.get("className", "")).strip() == class_name]
        art_entries = [entry for entry in class_entries if str(entry.get("subject", "")).strip() == "美勞_固定"]
        if len(art_entries) != 1:
            continue

        alt_entries = [
            entry
            for entry in class_entries
            if _normalize_week_tag(entry.get("week")) in ("odd", "even")
            and (
                str(entry.get("pairGroupId", "")).strip() == cfg["pair_group_id"]
                or str(entry.get("subject", "")).strip() in ("音樂", "美勞")
            )
        ]
        odd_entries = [entry for entry in alt_entries if _normalize_week_tag(entry.get("week")) == "odd"]
        even_entries = [entry for entry in alt_entries if _normalize_week_tag(entry.get("week")) == "even"]
        if len(odd_entries) != 1 or len(even_entries) != 1:
            continue

        art_entry = art_entries[0]
        odd_entry = odd_entries[0]
        even_entry = even_entries[0]
        alt_positions = {
            (int(entry.get("day", 0) or 0), int(entry.get("period", 0) or 0))
            for entry in (odd_entry, even_entry)
        }
        if len(alt_positions) != 1:
            continue

        art_day = int(art_entry.get("day", 0) or 0)
        art_period = int(art_entry.get("period", 0) or 0)
        alt_day, alt_period = next(iter(alt_positions))
        if art_day != alt_day:
            continue

        low_period = min(art_period, alt_period)
        high_period = max(art_period, alt_period)
        base = (art_day - 1) * PERIODS_PER_DAY
        valid_pairs = {(p1 - base + 1, p2 - base + 1) for p1, p2 in get_valid_consecutive_pairs(base)}
        if (low_period, high_period) not in valid_pairs:
            continue

        original_direction = "music-first"
        if "美勞" in str(odd_entry.get("subject", "")):
            original_direction = "art-first"

        class_contexts[class_name] = {
            **cfg,
            "day": art_day,
            "low_period": low_period,
            "high_period": high_period,
            "art_entry": art_entry,
            "odd_entry": odd_entry,
            "even_entry": even_entry,
            "original_alt_is_early": alt_period == low_period,
            "original_music_first": original_direction == "music-first",
        }
        excluded_entry_ids.update({id(art_entry), id(odd_entry), id(even_entry)})

    if not class_contexts:
        return working_entries, False

    normalized_limits = {}
    for subj_raw, limit in (school_info or {}).get("classroomLimits", {}).items():
        try:
            normalized_limits[_normalize_special_room_subject(subj_raw)] = int(limit)
        except (TypeError, ValueError):
            continue

    actual_room_count = defaultdict(int)
    for room in classrooms or []:
        subj = _normalize_special_room_subject(room.get("subject", ""))
        if subj in ("音樂", "美勞"):
            actual_room_count[subj] += 1

    room_capacity = {}
    for subj in ("音樂", "美勞"):
        room_capacity[subj] = (
            actual_room_count.get(subj)
            or normalized_limits.get(subj)
            or CLASSROOM_LIMITS_FALLBACK.get(subj, 0)
        )

    base_teacher_usage = defaultdict(int)
    base_room_usage = defaultdict(int)
    # [FIX] Track which (class, day, period) slots are already occupied by non-excluded subjects
    # to prevent the local optimizer from moving music/art into occupied slots.
    class_slot_occupied = set()
    classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}

    for entry in working_entries:
        if id(entry) in excluded_entry_ids:
            continue

        day = int(entry.get("day", 0) or 0)
        period = int(entry.get("period", 0) or 0)
        class_name = str(entry.get("className", "")).strip()
        teacher_name = str(entry.get("teacherName", "")).strip()
        week = _normalize_week_tag(entry.get("week"))

        if teacher_name:
            weeks = ("odd", "even") if week == "both" else (week,)
            for current_week in weeks:
                base_teacher_usage[(teacher_name, day, period, current_week)] += 1

        # Track class-slot occupancy for conflict prevention
        class_slot_occupied.add((class_name, day, period))

        canonical_subject = _canonical_schedule_subject_for_room(entry.get("subject", ""))
        if canonical_subject not in ("音樂", "美勞"):
            continue

        grade = class_grade_map.get(class_name, 0)
        if not grade_needs_special_room(canonical_subject, grade, classroom_grades_cfg):
            continue

        weeks = ("odd", "even") if week == "both" else (week,)
        for current_week in weeks:
            base_room_usage[(canonical_subject, day, period, current_week)] += 1

    model = cp_model.CpModel()
    teacher_buckets = defaultdict(list)
    room_buckets = defaultdict(list)
    pair_rewards = []
    change_penalties = []

    for class_name, ctx in class_contexts.items():
        state_early_music = model.NewBoolVar(f"artopt_{class_name}_early_music")
        state_early_art = model.NewBoolVar(f"artopt_{class_name}_early_art")
        state_late_music = model.NewBoolVar(f"artopt_{class_name}_late_music")
        state_late_art = model.NewBoolVar(f"artopt_{class_name}_late_art")
        model.Add(state_early_music + state_early_art + state_late_music + state_late_art == 1)

        alt_slot_is_early = model.NewBoolVar(f"artopt_{class_name}_alt_early")
        alt_direction_is_music_odd = model.NewBoolVar(f"artopt_{class_name}_music_odd")
        alt_at_low = model.NewBoolVar(f"artopt_{class_name}_alt_low")
        alt_at_high = model.NewBoolVar(f"artopt_{class_name}_alt_high")
        music_first = model.NewBoolVar(f"artopt_{class_name}_music_first")

        model.Add(alt_slot_is_early == state_early_music + state_early_art)
        model.Add(alt_direction_is_music_odd == state_early_music + state_late_music)
        model.Add(alt_at_low == state_early_music + state_early_art)
        model.Add(alt_at_high == state_late_music + state_late_art)
        model.Add(music_first == state_early_music + state_late_music)

        ctx.update({
            "state_early_music": state_early_music,
            "state_early_art": state_early_art,
            "state_late_music": state_late_music,
            "state_late_art": state_late_art,
            "alt_slot_is_early": alt_slot_is_early,
            "alt_direction_is_music_odd": alt_direction_is_music_odd,
            "alt_at_low": alt_at_low,
            "alt_at_high": alt_at_high,
            "music_first": music_first,
        })

        day = ctx["day"]
        low_period = ctx["low_period"]
        high_period = ctx["high_period"]
        music_teacher = ctx["music_teacher"]
        art_teacher = ctx["art_teacher"]

        # 交替課實際授課老師（單雙週）
        teacher_buckets[(music_teacher, day, low_period, "odd")].append(state_early_music)
        teacher_buckets[(art_teacher, day, low_period, "odd")].append(state_early_art)
        teacher_buckets[(art_teacher, day, low_period, "even")].append(state_early_music)
        teacher_buckets[(music_teacher, day, low_period, "even")].append(state_early_art)

        teacher_buckets[(music_teacher, day, high_period, "odd")].append(state_late_music)
        teacher_buckets[(art_teacher, day, high_period, "odd")].append(state_late_art)
        teacher_buckets[(art_teacher, day, high_period, "even")].append(state_late_music)
        teacher_buckets[(music_teacher, day, high_period, "even")].append(state_late_art)

        # 美勞固定課（雙週都占用）
        teacher_buckets[(art_teacher, day, high_period, "odd")].append(state_early_music)
        teacher_buckets[(art_teacher, day, high_period, "odd")].append(state_early_art)
        teacher_buckets[(art_teacher, day, high_period, "even")].append(state_early_music)
        teacher_buckets[(art_teacher, day, high_period, "even")].append(state_early_art)
        teacher_buckets[(art_teacher, day, low_period, "odd")].append(state_late_music)
        teacher_buckets[(art_teacher, day, low_period, "odd")].append(state_late_art)
        teacher_buckets[(art_teacher, day, low_period, "even")].append(state_late_music)
        teacher_buckets[(art_teacher, day, low_period, "even")].append(state_late_art)

        grade = ctx["grade"]
        if grade_needs_special_room("音樂", grade, classroom_grades_cfg):
            room_buckets[("音樂", day, low_period, "odd")].append(state_early_music)
            room_buckets[("音樂", day, low_period, "even")].append(state_early_art)
            room_buckets[("音樂", day, high_period, "odd")].append(state_late_music)
            room_buckets[("音樂", day, high_period, "even")].append(state_late_art)
        if grade_needs_special_room("美勞", grade, classroom_grades_cfg):
            room_buckets[("美勞", day, low_period, "odd")].append(state_early_art)
            room_buckets[("美勞", day, low_period, "even")].append(state_early_music)
            room_buckets[("美勞", day, high_period, "odd")].append(state_late_art)
            room_buckets[("美勞", day, high_period, "even")].append(state_late_music)
            room_buckets[("美勞", day, high_period, "odd")].append(state_early_music)
            room_buckets[("美勞", day, high_period, "odd")].append(state_early_art)
            room_buckets[("美勞", day, high_period, "even")].append(state_early_music)
            room_buckets[("美勞", day, high_period, "even")].append(state_early_art)
            room_buckets[("美勞", day, low_period, "odd")].append(state_late_music)
            room_buckets[("美勞", day, low_period, "odd")].append(state_late_art)
            room_buckets[("美勞", day, low_period, "even")].append(state_late_music)
            room_buckets[("美勞", day, low_period, "even")].append(state_late_art)

        slot_changed = model.NewBoolVar(f"artopt_{class_name}_slot_changed")
        if ctx["original_alt_is_early"]:
            model.Add(alt_slot_is_early == 1).OnlyEnforceIf(slot_changed.Not())
            model.Add(alt_slot_is_early == 0).OnlyEnforceIf(slot_changed)
        else:
            model.Add(alt_slot_is_early == 0).OnlyEnforceIf(slot_changed.Not())
            model.Add(alt_slot_is_early == 1).OnlyEnforceIf(slot_changed)

        direction_changed = model.NewBoolVar(f"artopt_{class_name}_direction_changed")
        if ctx["original_music_first"]:
            model.Add(music_first == 1).OnlyEnforceIf(direction_changed.Not())
            model.Add(music_first == 0).OnlyEnforceIf(direction_changed)
        else:
            model.Add(music_first == 0).OnlyEnforceIf(direction_changed.Not())
            model.Add(music_first == 1).OnlyEnforceIf(direction_changed)

        class_changed = model.NewBoolVar(f"artopt_{class_name}_class_changed")
        model.Add(class_changed >= slot_changed)
        model.Add(class_changed >= direction_changed)
        model.Add(class_changed <= slot_changed + direction_changed)

        ctx["class_changed"] = class_changed
        change_penalties.extend([slot_changed, direction_changed])

        # [FIX] Class-slot exclusivity: if the (class, day, period) slot is already occupied
        # by a non-excluded subject, forbid placing alternating courses there.
        day = ctx["day"]
        low_period = ctx["low_period"]
        high_period = ctx["high_period"]

        low_occupied = (class_name, day, low_period) in class_slot_occupied
        high_occupied = (class_name, day, high_period) in class_slot_occupied

        # alt_at_low means alternating course is at low_period
        # alt_at_high means alternating course is at high_period
        if low_occupied:
            model.Add(ctx["alt_at_low"] == 0)
            print(f"  [EXCLUDE] {class_name}: low_period={low_period} occupied, forbidding alt_at_low")
        if high_occupied:
            model.Add(ctx["alt_at_high"] == 0)
            print(f"  [EXCLUDE] {class_name}: high_period={high_period} occupied, forbidding alt_at_high")

    for key, vars_at_slot in teacher_buckets.items():
        teacher_name, day, period, week = key
        base_count = base_teacher_usage.get((teacher_name, day, period, week), 0)
        model.Add(sum(vars_at_slot) + base_count <= 1)

    for key, vars_at_slot in room_buckets.items():
        subject, day, period, week = key
        capacity = room_capacity.get(subject, 0)
        if capacity > 0:
            model.Add(sum(vars_at_slot) + base_room_usage.get((subject, day, period, week), 0) <= capacity)

    class_names = sorted(class_contexts.keys())
    for idx, class_name in enumerate(class_names):
        left_ctx = class_contexts[class_name]
        for other_class in class_names[idx + 1:]:
            right_ctx = class_contexts[other_class]
            if left_ctx["pair_group_id"] != right_ctx["pair_group_id"]:
                continue

            shared_slots = sorted({
                left_ctx["low_period"],
                left_ctx["high_period"],
            }.intersection({
                right_ctx["low_period"],
                right_ctx["high_period"],
            }))
            if left_ctx["day"] != right_ctx["day"] or not shared_slots:
                continue

            opposite = model.NewBoolVar(f"artopt_{class_name}_{other_class}_opposite")
            model.Add(left_ctx["music_first"] + right_ctx["music_first"] == 1).OnlyEnforceIf(opposite)
            model.Add(left_ctx["music_first"] == right_ctx["music_first"]).OnlyEnforceIf(opposite.Not())

            for slot_period in shared_slots:
                left_active = left_ctx["alt_at_low"] if slot_period == left_ctx["low_period"] else left_ctx["alt_at_high"]
                right_active = right_ctx["alt_at_low"] if slot_period == right_ctx["low_period"] else right_ctx["alt_at_high"]

                both_active = model.NewBoolVar(f"artopt_{class_name}_{other_class}_p{slot_period}_both")
                model.Add(both_active >= left_active + right_active - 1)
                model.Add(both_active <= left_active)
                model.Add(both_active <= right_active)

                reward = model.NewBoolVar(f"artopt_{class_name}_{other_class}_p{slot_period}_reward")
                model.Add(reward >= both_active + opposite - 1)
                model.Add(reward <= both_active)
                model.Add(reward <= opposite)
                pair_rewards.append(reward)

    objective_terms = []
    if pair_rewards:
        objective_terms.append(100 * sum(pair_rewards))
    class_change_penalties = [ctx["class_changed"] for ctx in class_contexts.values()]
    if class_change_penalties:
        objective_terms.append(-10 * sum(class_change_penalties))
    if change_penalties:
        objective_terms.append(-1 * sum(change_penalties))
    if objective_terms:
        model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(os.environ.get("LOCAL_ARTS_OPTIMIZER_MAX_TIME_SECONDS", "10.0"))
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print("  [WARN] [音美局部優化] 子模型無可行解，保留原 solver 輸出")
        return working_entries, False

    for class_name, ctx in class_contexts.items():
        alt_period = ctx["low_period"] if solver.Value(ctx["alt_slot_is_early"]) == 1 else ctx["high_period"]
        art_period = ctx["high_period"] if alt_period == ctx["low_period"] else ctx["low_period"]
        music_first = solver.Value(ctx["music_first"]) == 1

        ctx["art_entry"]["day"] = ctx["day"]
        ctx["art_entry"]["period"] = art_period

        ctx["odd_entry"]["day"] = ctx["day"]
        ctx["odd_entry"]["period"] = alt_period
        ctx["even_entry"]["day"] = ctx["day"]
        ctx["even_entry"]["period"] = alt_period

        ctx["odd_entry"]["pairGroupId"] = ctx["pair_group_id"]
        ctx["even_entry"]["pairGroupId"] = ctx["pair_group_id"]

        if music_first:
            ctx["odd_entry"]["subject"] = "音樂"
            ctx["odd_entry"]["teacherName"] = ctx["music_teacher"]
            ctx["even_entry"]["subject"] = "美勞"
            ctx["even_entry"]["teacherName"] = ctx["art_teacher"]
        else:
            ctx["odd_entry"]["subject"] = "美勞"
            ctx["odd_entry"]["teacherName"] = ctx["art_teacher"]
            ctx["even_entry"]["subject"] = "音樂"
            ctx["even_entry"]["teacherName"] = ctx["music_teacher"]

    print(f"  [OK] [音美局部優化] 已調整 {len(class_contexts)} 個音美交替班的局部連堂/方向")

    _dump_diagnostics("Before Backfill", working_entries)
    # [P0-06] 優化後重新 backfill classroomId/classroomName
    # 因為上述循環修改了 day/period/subject，原 classroomId 可能不再有效
    _backfill_music_art_classrooms_after_optimization(working_entries, classrooms, school_info)
    _dump_diagnostics("After Backfill (inside optimize)", working_entries)

    optimized_entries = _refresh_music_art_pair_metadata(working_entries, optimizer_configs)
    return optimized_entries, False


def _normalize_special_room_subject(subj_raw):
    """對應 class_rules._normalize_special_room_subject"""
    subj = str(subj_raw or "").strip()
    if subj in ("語文-本土語", "本土語言", "閩南語", "客語"):
        return "本土語"
    if subj == "英語":
        return "語文-英語"
    if subj == "自然":
        return "自然科學"
    if subj in ("科技-資訊", "資訊", "電腦"):
        return "資訊"
    if subj in ("健康與體育",):
        return "體育"
    return subj


def _backfill_music_art_classrooms_after_optimization(schedule_entries, classrooms, school_info):
    """
    [P0-06] 音美局部優化後重新指派實體教室。

    當 _optimize_music_art_alternating_locally 修改了 entry 的 day/period/subject/week，
    原 classroomId/classroomName 可能不再對應正確的科目或時段。
    此函數針對音樂/美勞 entry 重新查找可用教室並回填。
    """
    if not classrooms or not schedule_entries:
        return

    # 建立 subject -> rooms 映射
    rooms_by_subject = defaultdict(list)
    for room in classrooms:
        subj = _normalize_special_room_subject(room.get("subject", ""))
        if subj in ("音樂", "美勞"):
            rooms_by_subject[subj].append({
                "id": str(room.get("id") or room.get("name", "")),
                "name": str(room.get("name", "")),
                "subject": subj,
                "gradePreferences": room.get("gradePreferences", []) or [],
            })

    classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}

    # 收集所有需要 backfill 的音樂/美勞 entry
    # [FIX] 支援 '音樂_固定'/'美勞_固定'/'音樂美勞_交替' 等 suffix 變體
    arts_entries = []
    for entry in schedule_entries:
        subj = str(entry.get("subject", "")).strip()
        _check_subj = subj.replace("_固定", "").replace("_交替", "")
        if _check_subj not in ("音樂", "美勞"):
            continue
        className = str(entry.get("className", "")).strip()
        day = int(entry.get("day", 0) or 0)
        period = int(entry.get("period", 0) or 0)
        week = _normalize_week_tag(entry.get("week"))
        if not className or not day or not period:
            continue

        # 判斷該年級是否需要專科教室
        grade = _get_class_grade_from_name(className, school_info)
        canonical_subj = _normalize_special_room_subject(_check_subj)
        from constraints.utils import grade_needs_special_room
        if not grade_needs_special_room(canonical_subj, grade, classroom_grades_cfg):
            continue

        arts_entries.append({
            "entry": entry,
            "subject": canonical_subj,
            "className": className,
            "grade": grade,
            "day": day,
            "period": period,
            "week": week,
        })

    if not arts_entries:
        return

    # 按 (day, period) 分組，逐時段指派教室避免衝堂
    slot_groups = defaultdict(list)
    for item in arts_entries:
        slot_key = (item["day"], item["period"])
        slot_groups[slot_key].append(item)

    # 記錄已佔用: (room_id, day, period, week) -> set
    occupied = set()

    # 音美 entry 進到這個 helper 時，既有 classroomId/classroomName 一律視為待重配。
    # 若保留舊值，stale room id 會被誤當成當前 slot 的有效佔用，導致 self-blocking
    # 或更糟的「衝突雙方一起保留同一個舊 room id」。
    arts_entry_ids = set()
    for item in arts_entries:
        entry = item["entry"]
        arts_entry_ids.add(id(entry))
        entry["classroomId"] = ""
        entry["classroomName"] = ""

    for entry in schedule_entries:
        if id(entry) in arts_entry_ids:
            continue
        existing_room_id = str(entry.get("classroomId", "") or "").strip()
        if not existing_room_id:
            continue
        e_day = int(entry.get("day", 0) or 0)
        e_period = int(entry.get("period", 0) or 0)
        if not e_day or not e_period:
            continue
        e_week = _normalize_week_tag(entry.get("week"))
        for w in _expand_validation_weeks(e_week):
            occupied.add((existing_room_id, e_day, e_period, w))

    for slot_key, items in slot_groups.items():
        day, period = slot_key

        # 優先處理 week="both" (固定課)，避免被奇數/偶數單週交替課造成物理碎片化
        items.sort(key=lambda x: 0 if x["week"] == "both" else 1)

        for item in items:
            week = item["week"]
            subj = item["subject"]
            grade = item["grade"]
            entry = item["entry"]

            canonical_room_subj = _normalize_special_room_subject(subj)
            candidate_rooms = list(rooms_by_subject.get(canonical_room_subj, []))
            if not candidate_rooms:
                continue

            # 優先偏好年級，其次非偏好
            def room_sort_key(room):
                gp = room.get("gradePreferences", []) or []
                has_pref = grade in gp if isinstance(gp, list) else False
                return (0 if has_pref else 1, room.get("name", ""))

            candidate_rooms.sort(key=room_sort_key)

            weeks_to_occupy = ("odd", "even") if week == "both" else (week,)
            assigned = False
            for room in candidate_rooms:
                room_id = room["id"]

                is_free = True
                for w in weeks_to_occupy:
                    if (room_id, day, period, w) in occupied:
                        is_free = False
                        break

                if is_free:
                    entry["classroomId"] = room_id
                    entry["classroomName"] = room["name"]
                    for w in weeks_to_occupy:
                        occupied.add((room_id, day, period, w))
                    assigned = True
                    break

            if not assigned:
                # 所有教室都衝堂，清空以避免錯誤指派
                entry["classroomId"] = ""
                entry["classroomName"] = ""
                print(f"[Diag] Backfill failed! day={day}, period={period}, subject={subj}, week={week}, className={entry.get('className')}")
                for room in candidate_rooms:
                    room_id = room["id"]
                    conflicts = [w for w in weeks_to_occupy if (room_id, day, period, w) in occupied]
                    print(f"       Room {room.get('name')} occupied in weeks: {conflicts}")


def _backfill_other_special_room_classrooms(schedule_entries, classrooms, school_info):
    """
    [FIX] 為非音樂/美勞的專科教室科目（資訊、自然科學、語文-英語等）回填 classroomId/classroomName。

    這些科目在 solver 的 apply_special_classroom_capacity 中已有 room assignment 變數，
    但 output extraction 階段可能因為 assigned_rooms lookup 失敗而遺漏。
    此函數在 post-processing 階段補齊。
    """
    if not classrooms or not schedule_entries:
        return

    from constraints.utils import grade_needs_special_room

    # 建立 subject -> rooms 映射（涵蓋所有專科教室）
    rooms_by_subject = defaultdict(list)
    for room in classrooms:
        subj = _normalize_special_room_subject(room.get("subject", ""))
        if subj in ("音樂", "美勞"):
            continue  # 音樂/美勞由 _backfill_music_art_classrooms_after_optimization 處理
        if not subj:
            continue
        rooms_by_subject[subj].append({
            "id": str(room.get("id") or room.get("name", "")),
            "name": str(room.get("name", "")),
            "subject": subj,
            "gradePreferences": room.get("gradePreferences", []) or [],
        })

    if not rooms_by_subject:
        return

    classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}

    # 收集需要 backfill 的 entry（沒有 classroomId 的專科教室科目）
    entries_to_backfill = []
    for entry in schedule_entries:
        subj_raw = str(entry.get("subject", "")).strip()
        canonical = _normalize_special_room_subject(subj_raw)
        if not canonical or canonical not in rooms_by_subject:
            continue

        # 跳過已有 classroomId 的 entry
        existing_id = str(entry.get("classroomId", "") or "").strip()
        if existing_id:
            continue

        className = str(entry.get("className", "")).strip()
        day = int(entry.get("day", 0) or 0)
        period = int(entry.get("period", 0) or 0)
        week = _normalize_week_tag(entry.get("week"))
        if not className or not day or not period:
            continue

        grade = _get_class_grade_from_name(className, school_info)

        # [FIX] 必須尊重 grade_needs_special_room 語意：
        # 只有 grade_needs_special_room == True 的課才能 backfill classroomId。
        # 否則與 class_rules.py 的 needs_room guard 互相矛盾。
        if not grade_needs_special_room(canonical, grade, classroom_grades_cfg):
            continue

        entries_to_backfill.append({
            "entry": entry,
            "subject": canonical,
            "className": className,
            "grade": grade,
            "day": day,
            "period": period,
            "week": week,
        })

    if not entries_to_backfill:
        return

    # 按 (day, period, week) 分組
    slot_groups = defaultdict(list)
    for item in entries_to_backfill:
        slot_key = (item["day"], item["period"], item["week"])
        slot_groups[slot_key].append(item)

    # 記錄已佔用: (room_id, day, period, week) -> set
    occupied = set()

    # 載入所有已有 classroomId 的 entry 的佔用狀態
    for entry in schedule_entries:
        existing_room_id = str(entry.get("classroomId", "") or "").strip()
        if not existing_room_id:
            continue
        e_day = int(entry.get("day", 0) or 0)
        e_period = int(entry.get("period", 0) or 0)
        if not e_day or not e_period:
            continue
        e_week = _normalize_week_tag(entry.get("week"))
        for w in _expand_validation_weeks(e_week):
            occupied.add((existing_room_id, e_day, e_period, w))

    for slot_key, items in slot_groups.items():
        day, period, week = slot_key

        for item in items:
            canonical_subj = item["subject"]
            grade = item["grade"]
            entry = item["entry"]

            candidate_rooms = list(rooms_by_subject.get(canonical_subj, []))
            if not candidate_rooms:
                continue

            # 優先偏好年級
            def room_sort_key(room):
                gp = room.get("gradePreferences", []) or []
                has_pref = grade in gp if isinstance(gp, list) else False
                return (0 if has_pref else 1, room.get("name", ""))

            candidate_rooms.sort(key=room_sort_key)

            weeks_to_occupy = ("odd", "even") if week == "both" else (week,)
            assigned = False
            for room in candidate_rooms:
                room_id = room["id"]

                is_free = True
                for w in weeks_to_occupy:
                    if (room_id, day, period, w) in occupied:
                        is_free = False
                        break

                if is_free:
                    entry["classroomId"] = room_id
                    entry["classroomName"] = room["name"]
                    for w in weeks_to_occupy:
                        occupied.add((room_id, day, period, w))
                    assigned = True
                    break

            # 如果沒有分配到教室，保留空值（由 validation report 報告 overload）


def _get_class_grade_from_name(class_name, school_info):
    """從班級名稱提取年級"""
    import re as _re
    match = _re.search(r'(\d+)年', class_name)
    if match:
        return int(match.group(1))
    # Fallback: 從 classes_data 查找 (school_info 可能沒有)
    return 1


def run_grade_time_rules_preflight(data: dict) -> dict:
    """
    Authoritative Preflight for Grade Time Rules.
    Executes BEFORE any CpModel() construction.
    If there are blocking issues, returns result dict with status INVALID_GRADE_TIME_RULE_CONFIGURATION.
    Otherwise returns None.
    """
    if not isinstance(data, dict):
        return None

    school_info = data.get("schoolInfo", {})
    if not isinstance(school_info, dict):
        school_info = {}

    raw_settings = school_info.get("gradeTimeRulesSettings")
    if not raw_settings:
        ai_settings = data.get("aiSettings", {})
        if isinstance(ai_settings, dict):
            raw_settings = ai_settings.get("gradeTimeRulesSettings")

    rules = parse_grade_time_rules(raw_settings)
    if not rules:
        return None

    context = {
        "classes": data.get("classes", []),
        "teachers": data.get("teachers", []),
        "classrooms": data.get("classrooms", []),
    }

    res = validate_grade_time_rules(rules, context)
    if not res.is_valid and res.blocking_issues:
        issues_payload = [
            {
                "code": issue.code,
                "severity": issue.severity,
                "message": issue.message,
                "ruleIds": list(issue.rule_ids),
                "grade": issue.grade,
                "day": issue.day,
                "period": issue.period,
            }
            for issue in res.blocking_issues
        ]
        return {
            "status": "INVALID_GRADE_TIME_RULE_CONFIGURATION",
            "solverStatus": "INVALID_GRADE_TIME_RULE_CONFIGURATION",
            "error": f"Grade time rule configuration has {len(res.blocking_issues)} blocking issue(s)",
            "gradeTimeRuleIssues": issues_payload,
        }

    return None


def main():
    import faulthandler; faulthandler.enable()
    print("[PHASE] main 開始執行, 已掛載 faulthandler", flush=True)
    if len(sys.argv) != 3:
        print("[ERROR] 參數錯誤：需提供 input_path 與 output_path")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"[ERROR] 讀取 JSON 失敗: {e}")
        sys.exit(1)

    print("[PHASE] 載入 payload 完成", flush=True)

    # [P2] Phase-level observability initialized early
    phase_history = []
    phase_timings = {}
    solver_start_time = time.time()

    job_id = data.get("jobId", "UNKNOWN")
    schoolInfo = data.get("schoolInfo", {})
    teachers_data = data.get("teachers", [])
    classes_data = data.get("classes", [])
    special_courses = data.get("specialCourses", [])
    standard_domain_settings = data.get("standardDomainSettings", [])

    # ==========================================
    # 專科教室容量取得
    # ==========================================
    classroom_limits_config = schoolInfo.get("classroomLimits", {})

    # 讀取 aiSettings
    ai_settings = data.get("aiSettings", {})


    # ==========================================
    # 前處理（grade修正 / ghost art清理 / homeroom合併 / arts拆分）
    # ==========================================
    subject_grade_rules = schoolInfo.get("subjectGradeRules", {}) or {}

    _t_pre_start = time.time()
    classes_data, _metadata = preprocess_classes(
        classes_data,
        ai_settings,
        standard_domain_settings=standard_domain_settings,
        subject_grade_rules=subject_grade_rules,
    )
    _t_pre_end = time.time()
    phase_timings["preprocess_seconds"] = round(_t_pre_end - _t_pre_start, 3)

    data["preprocessMetadata"] = copy.deepcopy(_metadata)
    data["preprocessedClasses"] = copy.deepcopy(classes_data)
    print("[PHASE] preprocessing 完成", flush=True)

    # ==========================================
    # 🛡️ Authoritative Preflight for Grade Time Rules (runs BEFORE any CpModel() construction)
    # ==========================================
    gtr_preflight_result = run_grade_time_rules_preflight(data)
    if gtr_preflight_result is not None:
        print(f"\n[ERROR] [Preflight] Grade time rules validation failed: {gtr_preflight_result['error']}")
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(gtr_preflight_result, f, ensure_ascii=False, indent=2)
        sys.exit(0)

    # ==========================================
    # 🛡️ Preflight：求解前檢查輸入是否超載
    # 區分「輸入超載 INVALID_INPUT」與「求解後驗證失敗 INVALID_VALIDATION」
    # ==========================================
    class_load_trace = []
    invalid_classes = []
    for cls in classes_data:
        grade_num = resolve_class_grade(cls)
        is_arts_class = cls.get("isArtsClass") or cls.get("is_arts_class", False)

        # 🛡️ 容量一律來自 get_effective_class_period_capacity()，不讀 gradeMaxPeriods
        capacity = get_effective_class_period_capacity(
            grade_num,
            is_arts_class=is_arts_class,
            ai_settings=ai_settings,
        )

        total_periods = _count_required_periods(cls.get("course_requirements", []))

        reqs = cls.get("course_requirements", [])
        # [PREFLIGHT] 計算每科的 manual locks 數量
        lock_counts_by_subj = {}
        tt = cls.get("timetable")
        if isinstance(tt, dict):
            for day_key, day_data in tt.items():
                if isinstance(day_data, dict):
                    for period_key, cell in day_data.items():
                        if isinstance(cell, dict) and cell.get("isLocked") is True:
                            s = cell.get("subject")
                            if s:
                                lock_counts_by_subj[s] = lock_counts_by_subj.get(s, 0) + 1
        elif isinstance(tt, list):
            for day_idx, day_data in enumerate(tt):
                if isinstance(day_data, list):
                    for period_idx, cell in enumerate(day_data):
                        if isinstance(cell, dict) and cell.get("isLocked") is True:
                            s = cell.get("subject")
                            if s:
                                lock_counts_by_subj[s] = lock_counts_by_subj.get(s, 0) + 1

        reqs_dict = {r.get("subject", ""): int(r.get("periods", 0)) for r in reqs}
        trace_item = {
            "className": cls.get("name", ""),
            "grade": grade_num,
            "isArtsClass": is_arts_class,
            "totalPeriods": total_periods,
            "capacity": capacity,
            "requirementBreakdown": [
                {
                    "subject": r.get("subject", ""),
                    "periods": float(r.get("periods", 0)),
                    "defaultTeacher": r.get("defaultTeacher", ""),
                }
                for r in reqs
            ],
        }
        class_load_trace.append(trace_item)

        if total_periods > capacity:
            trace_item["validationError"] = "INVALID_INPUT_CLASS_LOAD"
            trace_item["periodExcess"] = round(total_periods - capacity, 2)
            invalid_classes.append(trace_item)
            print(f"  [ERROR] [Preflight] {cls.get('name', '')}: 總節數 {total_periods} > 容量 {capacity}！")
            continue

        # 🛡️ 檢查鎖定節數是否大於需求節數
        for subj, lock_count in lock_counts_by_subj.items():
            req_periods = reqs_dict.get(subj, 0)
            if lock_count > req_periods:
                trace_item["validationError"] = "INVALID_INPUT_LOCK_CONSERVATION"
                trace_item["conservationError"] = f"科目 '{subj}' 鎖定了 {lock_count} 節，但需求只有 {req_periods} 節"
                invalid_classes.append(trace_item)
                print(f"  [ERROR] [Preflight] {cls.get('name', '')}: {trace_item['conservationError']}")
                break

    # 將 classLoadTrace 寫入 metadata，供後端分析使用
    _metadata["classLoadTrace"] = class_load_trace

    if invalid_classes:
        # 輸入超載：不進 solver，直接回傳 INVALID_INPUT
        # 🔧 修復 B (RC-CONF-01 輔因)：附加 gradeCapacityMap 過渡方案
        # 讓前端能取得與 Python 同源的容量資訊
        # 【過渡方案】：solver preflight → gradeCapacityMap → store cache
        # 長期應改為由正式設定 API 直接提供
        grade_capacity_map = {}
        for grade_num in range(1, 7):
            for is_arts in [False, True]:
                key = f"grade{grade_num}{'_arts' if is_arts else ''}"
                grade_capacity_map[key] = get_effective_class_period_capacity(grade_num, is_arts)

        result = {
            "status": "INVALID_INPUT",
            "solverStatus": "INVALID_INPUT",
            "error": f"輸入資料驗證失敗：有 {len(invalid_classes)} 個班級發生總節數超載或鎖定節數大於需求節數",
            "classLoadTrace": class_load_trace,
            "invalidClasses": invalid_classes,
            "gradeCapacityMap": grade_capacity_map,
        }
        print(f"\n[ERROR] [Preflight] {len(invalid_classes)} 個班級輸入驗證失敗，不進 solver")
        for ic in invalid_classes:
            if ic.get("validationError") == "INVALID_INPUT_CLASS_LOAD":
                print(f"  - {ic['className']}: 總節數 {ic['totalPeriods']} > 容量 {ic['capacity']} (超限 {ic['periodExcess']})")
            elif ic.get("validationError") == "INVALID_INPUT_LOCK_CONSERVATION":
                print(f"  - {ic['className']}: {ic['conservationError']}")

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        sys.exit(0)

    # 收集班级名稱與老師名稱
    class_names = list(set([c.get("name") for c in classes_data if c.get("name")]))
    teacher_names = list(set([t.get("name") for t in teachers_data if t.get("name")]))

    # 專科教室數量計算
    classrooms = data.get("classrooms", [])
    classrooms_count_map = {}
    for room in classrooms:
        norm = normalize_room_name(room.get("name", ""))
        classrooms_count_map[norm] = classrooms_count_map.get(norm, 0) + 1

    # ============================================================
    # [NEW] [gradePreferences] 組建教室親和力映射表
    # room_grade_affinity: dict[subject_str, list[int]]
    #   key = 科目正規名稱（如 "自然科學"），value = 偏好年級列表（如 [6]），空列表表示共享
    # room_primary_teacher_map: dict[subject_str, str]
    #   key = 科目正規名稱，value = 主責教師名稱
    # ============================================================
    room_grade_affinity = {}        # {subject: [grade_int, ...]}
    room_primary_teacher_map = {}   # {subject: teacher_name}

    def normalize_subject_for_room(subj_raw):
        """對應前端 normalizeRoomSubject 邏輯"""
        if subj_raw == "英語":
            return "語文-英語"
        elif subj_raw == "自然":
            return "自然科學"
        elif subj_raw in ("科技-資訊", "電腦"):
            return "資訊"
        elif subj_raw in ("健康與體育",):
            return "體育"
        elif subj_raw in ("本土語言", "閩南語", "客語"):
            return "本土語"
        return subj_raw

    for room in classrooms:
        subj_raw = room.get("subject", "") or ""
        subj = normalize_subject_for_room(subj_raw)

        # gradePreferences 可能是 list 或 JSON 字串
        gp_raw = room.get("gradePreferences", [])
        if isinstance(gp_raw, str):
            try:
                gp_raw = json.loads(gp_raw)
            except Exception:
                gp_raw = []
        gp = [int(g) for g in gp_raw if str(g).isdigit()] if isinstance(gp_raw, list) else []

        # 同一科目可能有多間教室：合併年級偏好（取聯集）
        if subj not in room_grade_affinity:
            room_grade_affinity[subj] = []
        for g in gp:
            if g not in room_grade_affinity[subj]:
                room_grade_affinity[subj].append(g)

        # primaryTeacher：同一科目多間時，取第一個有設定的
        pt = room.get("primaryTeacher", "") or ""
        if pt and subj not in room_primary_teacher_map:
            room_primary_teacher_map[subj] = pt

    print(f"[INFO] [gradePreferences] 教室年級親和力映射: {room_grade_affinity}")
    print(f"[INFO] [primaryTeacher 主場映射] 教室主責教師映射: {room_primary_teacher_map}")

    # 計算各科目總需求
    subject_demand_count = defaultdict(int)
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            subj = req.get("subject", "")
            periods = int(req.get("periods", 0))
            default_t = req.get("defaultTeacher", "")
            if default_t == "subject":
                subject_demand_count[subj] += periods

    # 計算各科目可用教室數（只取 tuple 的第一元素：容量 int 值）
    subject_room_count = {}
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            subj = req.get("subject", "")
            default_t = req.get("defaultTeacher", "")
            if default_t == "subject" and subj not in subject_room_count:
                cap, source = get_subject_capacity(
                    subj, classrooms_count_map, classroom_limits_config
                )
                subject_room_count[subj] = cap

    # [Task 02] Two-pass solver: strict teaching-shape first, then feasibility recovery fallback
    from scheduler_policy import SolveMode, get_active_policy

    def _solve_attempt(relax_room_capacity=False, solve_mode=SolveMode.STRICT_TEACHING_SHAPE, build_level="quality", hint_values=None, time_limit=None):
        print(f"[PHASE] model build 開始 (build_level={build_level})", flush=True)
        policy = get_active_policy(solve_mode)
        model = cp_model.CpModel()
        schedule = {}
        phase2_penalty_vars = []

        # ============================================================
        # Phase 1: 基礎建模
        # ============================================================
        print("[INFO] [建模] 創建 schedule 變數與課程需求約束...")
        create_schedule_vars_and_course_demands(model, classes_data, schedule)

        print("[WARN] [建模] 創建 alternating BoolVar...")
        (
            alternating_class_is_music_odd,
            alternating_group_map,
            class_pair_group,
            class_teacher_pair,
        ) = create_alternating_vars(model, classes_data)

        print("[LOCK] [建模] 掃描手動預排鎖定...")
        movable_locks_policy = get_movable_lock_policy(data)
        locked_count, locked_vars, lock_audit_log = apply_preallocation_locks(model, classes_data, schedule, movable_locks_policy=movable_locks_policy)

        # ============================================================
        # Phase 2: 教師維度約束
        # ============================================================
        print("[CONSTRAINT] [核心約束] 加入教師衝堂防護...")
        model.special_courses = special_courses
        model.preprocess_metadata = data.get("preprocessMetadata")
        apply_anti_collision(
            model,
            schedule,
            class_names,
            teacher_names,
            classes_data,
            ai_settings,
            special_courses=special_courses,
            preprocess_metadata=data.get("preprocessMetadata"),
        )

        print("[CONSTRAINT] [核心約束] 加入交替課單雙週教師衝堂防護...")
        apply_alternating_teacher_anti_collision(
            model,
            schedule,
            class_teacher_pair,
            alternating_class_is_music_odd,
            classes_data=classes_data,
            ai_settings=ai_settings,
            special_courses=special_courses,
            preprocess_metadata=data.get("preprocessMetadata"),
        )

        print("[CONSTRAINT] [核心約束] 加入教師配額限制...")
        apply_teacher_quota(model, classes_data, teachers_data, schoolInfo)

        print("[CONSTRAINT] [核心約束] 加入不排課時段限制...")
        apply_teacher_unavailable_slots(model, schedule, teachers_data)

        print("[CONSTRAINT] [核心約束] 加入 operator 硬性時段規則 (hard_slot_mask)...")
        slot_rules = parse_slot_rules((ai_settings or {}).get("slotRules", []))
        hard_slot_mask = build_hard_slot_mask(slot_rules)
        if hard_slot_mask:
            applied_hard_slots = apply_hard_slot_constraints(model, schedule, hard_slot_mask)
            print(f"[CONSTRAINT] [核心約束] 套用 {applied_hard_slots} 個硬性時段限制 (hard_slot_mask)")

        print("[CONSTRAINT] [核心約束] 加入特殊課程鎖定...")
        apply_special_course_locks(model, schedule, special_courses, classes_data, teachers_data, ai_settings,
                                   preprocess_metadata=data.get("preprocessMetadata"),
                                   movable_locks_policy=movable_locks_policy)

        print("[CONSTRAINT] [核心約束] 加入班級時段排他性與跨實體條件解鎖...")
        apply_class_slot_exclusivity(model, schedule, classes_data, special_courses, getattr(model, "sc_decision_vars", None))

        # ============================================================
        # Phase 3: 班級維度約束
        # ============================================================
        print("[CONSTRAINT] [核心約束] 加入每日科任課上限...")
        apply_daily_subject_limit(model, classes_data, schedule, locked_vars)

        print("[CONSTRAINT] [核心約束] 加入年級時段硬約束 (Grade Time Hard Constraints)...")
        gtr_parsed = parse_grade_time_rules(schoolInfo.get("gradeTimeRulesSettings"))
        if gtr_parsed:
            apply_grade_time_hard_constraints(
                model,
                schedule,
                classes_data,
                gtr_parsed,
                teacher_type_lookup=None,
                subject_category_lookup=None,
            )

        print("[CONSTRAINT] [核心約束] 加入低年級下午禁排...")
        apply_afternoon_prohibition(model, classes_data, schedule, ai_settings=ai_settings, locked_vars=locked_vars)

        # [Task 07] Grade 1-2 Tuesday afternoon life-course placement (hard in strict, soft fallback)
        print("[CONSTRAINT] [核心約束] 加入 1-2 年級週二下午生活課...")
        grade12_tuesday_life_penalties = apply_grade12_tuesday_life_course(
            model, classes_data, schedule, solve_mode=solve_mode,
        )
        phase2_penalty_vars.extend(grade12_tuesday_life_penalties)

        print("[CONSTRAINT] [核心約束] 加入科任課不連堂...")
        apply_no_consecutive_subject(model, classes_data, schedule, locked_vars)

        print("[CONSTRAINT] [核心約束] 加入自然課排課習慣...")
        science_consec_map = apply_science_habits(model, classes_data, schedule, ai_settings, penalty_vars=phase2_penalty_vars, solve_mode=solve_mode)

        print("[CONSTRAINT] [核心約束] 加入專科教室容量限制...")

        # [Task 08] Normalize classroom metadata before room assignment
        # Note: normalize_classroom_metadata mutates in-place and returns the same list.
        # Do NOT reassign `classrooms` here to avoid UnboundLocalError (closure variable).
        normalize_classroom_metadata(classrooms)

        # [Task 08] Build priority teacher placeholders (not pre-bound to specific classes)
        # Signature: build_priority_teacher_placeholders(classrooms, classes_data=None)
        priority_placeholders = build_priority_teacher_placeholders(
            classrooms, classes_data
        )
        if priority_placeholders:
            print(f"[INFO] [Task 08] Built {len(priority_placeholders)} priority teacher placeholder(s)")

        # [Task 04/08] Classroom preference weights from policy adapter with YAML fallback defaults
        weight_grade_affinity = policy.get_weight("classroom_grade_affinity", default=3000)
        weight_teacher_affinity = policy.get_weight("classroom_primary_teacher_affinity", default=2500)
        apply_special_classroom_capacity(
            model,
            classes_data,
            schedule,
            classrooms,
            science_consec_map=science_consec_map,
            penalty_vars=phase2_penalty_vars,
            classroom_limits=classroom_limits_config,
            school_info=schoolInfo,
            relax_to_soft=relax_room_capacity,
            alternating_class_is_music_odd=alternating_class_is_music_odd,
            class_teacher_pair=class_teacher_pair,
            weight_grade_affinity=weight_grade_affinity,
            weight_teacher_affinity=weight_teacher_affinity,
        )

        # ============================================================
        # Phase 4: 特殊規則
        # ============================================================
        print("[CONSTRAINT] [核心約束] 加入體育不連堂...")
        apply_no_consecutive_pe(model, classes_data, schedule)

        # [Subject Day-Spread] 科任課日分散規則（英語/資訊/體育/健康/社會）
        print("[CONSTRAINT] [核心約束] 加入科任課日分散規則（英語/資訊/體育/健康/社會）...")
        apply_subject_day_spread(
            model, classes_data, schedule,
            locked_vars=locked_vars,
            penalty_vars=None if solve_mode == SolveMode.STRICT_TEACHING_SHAPE else phase2_penalty_vars,
        )

        # [Subject Day-Spread] 音樂固定課 vs 交替課不同日規則
        print("[CONSTRAINT] [核心約束] 加入音樂固定課 vs 交替課不同日規則...")
        apply_music_fixed_vs_alternating_day_spread(
            model, classes_data, schedule,
            alternating_class_is_music_odd=alternating_class_is_music_odd,
        )

        print("[CONSTRAINT] [核心約束] 加入音樂美勞至少一組連堂...")
        apply_art_consecutive_constraint(
            model, classes_data, schedule,
            penalty_vars=phase2_penalty_vars,
            solve_mode=solve_mode,
        )

        print("[CONSTRAINT] [核心約束] 加入完美互補配對約束...")
        apply_alternating_perfect_pairing(
            model,
            classes_data,
            schedule,
            teacher_names,
            alternating_class_is_music_odd,
            alternating_group_map,
            class_pair_group,
            class_teacher_pair,
            phase2_penalty_vars,
            ai_settings,
            solve_mode=solve_mode,
        )

        # [Task 2] Week-specific 音美教室容量建模（preferred penalty 10000）
        print("[CONSTRAINT] [核心約束] 加入 week-specific 音美容量模型...")
        class_grade_map_solver = {}
        for cls in classes_data:
            c_name = cls.get("name", "")
            raw_grade = cls.get("grade")
            if raw_grade is None:
                grade_match = re.search(r'(\d+)年', c_name)
                if grade_match:
                    raw_grade = int(grade_match.group(1))
            try:
                class_grade_map_solver[c_name] = (
                    int(raw_grade) if raw_grade is not None else 1
                )
            except Exception:
                class_grade_map_solver[c_name] = 1

        apply_week_specific_art_capacity_model(
            model,
            classes_data,
            schedule,
            classrooms,
            alternating_class_is_music_odd,
            class_grade_map_solver,
            phase2_penalty_vars,
            classroom_limits=classroom_limits_config,
        )

        print("[CONSTRAINT] [核心約束] 加入游泳引擎 v2...")
        apply_swimming_engine_v2(model, classes_data, schedule, ai_settings, phase2_penalty_vars)

        print("[CONSTRAINT] [連堂約束] 掃描通用連堂需求...")
        consecutive_subjects = ai_settings.get("consecutiveSubjects", [])
        consecutive_count = 0

        for cls in classes_data:
            c_name = cls.get("name", "")
            reqs = cls.get("course_requirements", [])

            for req in reqs:
                subj = req.get("subject", "")
                periods = int(req.get("periods", 0))
                allow_consec = req.get("allow_consecutive", False)

                if subj in consecutive_subjects:
                    allow_consec = True

                if not allow_consec:
                    continue

                if "自然" in subj or "美勞" in subj or "音樂" in subj or "導師區塊" in subj:
                    continue

                num_groups = periods // 2
                if num_groups < 1:
                    continue

                add_consecutive_constraint(
                    model, schedule, c_name, subj,
                    consecutive_groups=num_groups,
                    days=DAYS, periods_per_day=PERIODS_PER_DAY
                )
                consecutive_count += 1

        print(f"  [OK] [連堂約束] 共處理 {consecutive_count} 個科目的連堂需求\n")

        # [Task 07] Daily subject-teacher minimum soft objective (day-level count)
        print("[OBJECTIVE] [軟性目標] 加入每班每日至少一節科任課...")
        daily_min_penalties = build_daily_subject_teacher_minimum_penalty(
            model, schedule, classes_data,
        )
        phase2_penalty_vars.extend(daily_min_penalties)

        apply_movable_budgets(model, movable_locks_policy)
        phase2_penalty_vars.extend(getattr(model, "movable_objective_terms", []))

        phase2_external_count = len(phase2_penalty_vars)
        engine = SchedulePhase2Engine(
            model, schedule, class_names, teacher_names,
            TOTAL_PERIODS, DAYS, PERIODS_PER_DAY,
            teachers_data=teachers_data,
            external_penalty_vars=phase2_penalty_vars,
            room_grade_affinity=room_grade_affinity,
            room_primary_teacher_map=room_primary_teacher_map,
            classes_data=classes_data,
            school_info=schoolInfo,
            ai_settings=ai_settings,
            # [Task 08] Priority teacher placeholders for solver-driven assignment
            priority_placeholders=priority_placeholders,
            # [repair_03] Pass runtime policy adapter for weight resolution
            policy=policy,
            build_level=build_level,
        )
        engine.build_soft_constraints()

        # OPTION_B_DRYRUN
        import os
        dryrun_strategy = os.environ.get("OPTION_B_DRYRUN_STRATEGY")
        if dryrun_strategy and build_level == "core":
            from constraints.utils import grade_needs_special_room, _normalize_room_subject
            classroom_grades_cfg = (schoolInfo or {}).get("subjectClassroomGrades", {}) or {}
            class_grade_dict = {cls.get("name"): cls.get("grade") for cls in classes_data}

            english_pressure_vars = []
            for (c_name, p, t_name, subject), var in schedule.items():
                if _normalize_room_subject(subject) != "語文-英語":
                    continue
                grade = class_grade_dict.get(c_name)
                if grade is None:
                    continue
                if not grade_needs_special_room(subject, grade, classroom_grades_cfg):
                    continue
                english_pressure_vars.append(var)

            print(f"[OPTION_B_DRYRUN] Collected {len(english_pressure_vars)} english pressure vars")
            if english_pressure_vars:
                val_strategy = cp_model.SELECT_MAX_VALUE if dryrun_strategy == "MAX" else cp_model.SELECT_MIN_VALUE
                model.AddDecisionStrategy(
                    english_pressure_vars,
                    cp_model.CHOOSE_FIRST_UNBOUND,
                    val_strategy
                )

        if hint_values:
            print("[INFO] [建模] 注入前一階段的 Solution Hint...")
            for key, val in hint_values.items():
                if key in schedule:
                    try:
                        model.AddHint(schedule[key], int(val))
                    except Exception:
                        pass

        # [Task 3.8] Merge only penalties created inside the phase2 engine.
        # The engine starts by copying external_penalty_vars into self.penalty_vars,
        # so appending the whole list here would double-count those external entries.
        phase2_penalty_vars.extend(engine.penalty_vars[phase2_external_count:])

        solver = cp_model.CpSolver()
        dryrun_workers = os.environ.get("OPTION_B_DRYRUN_WORKERS")
        if dryrun_workers:
            solver.parameters.num_search_workers = int(dryrun_workers)
        else:
            solver.parameters.num_search_workers = 8

        legacy_max_time = os.environ.get("SOLVER_MAX_TIME_SECONDS")
        short_time_str = os.environ.get("SOLVER_SHORT_TIME_SECONDS")
        long_time_str = os.environ.get("SOLVER_LONG_TIME_SECONDS")

        if legacy_max_time and not short_time_str and not long_time_str:
            short_time = float(legacy_max_time)
            long_time = float(legacy_max_time)
        else:
            short_time = float(short_time_str or "20.0")
            long_time = float(long_time_str or "60.0")

        actual_time_limit = time_limit if time_limit is not None else short_time
        print(f"[PHASE] model build 完成, solve 開始 (workers={solver.parameters.num_search_workers}, timeout={actual_time_limit})", flush=True)
        solver.parameters.max_time_in_seconds = actual_time_limit
        status = solver.Solve(model)

        timeout_stage = "short"
        if status == cp_model.UNKNOWN and time_limit is None and long_time > short_time:
            print(f"[PHASE] Stage 1 未找到可行解，進入 Stage 2 延長求解 (timeout={long_time})", flush=True)
            solver.parameters.max_time_in_seconds = long_time
            status = solver.Solve(model)
            timeout_stage = "long"

        _status_map = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE", cp_model.INFEASIBLE: "INFEASIBLE", cp_model.MODEL_INVALID: "MODEL_INVALID", cp_model.UNKNOWN: "UNKNOWN"}
        print(f"[PHASE] solve 返回 status={status} ({_status_map.get(status, 'UNKNOWN/' + str(status))}) stage={timeout_stage}", flush=True)
        print(f"[DEBUG] [求解] solver.Solve() returned status={status} ({_status_map.get(status, 'UNKNOWN/' + str(status))}) stage={timeout_stage}")
        try:
            print(f"[OPTION_B_DRYRUN_STATS] status={_status_map.get(status, 'UNKNOWN')} branches={solver.NumBranches()} conflicts={solver.NumConflicts()} wall_time={round(solver.WallTime(), 3)}", flush=True)
        except Exception as e:
            print(f"[OPTION_B_DRYRUN_STATS_ERROR] {e}", flush=True)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            print(f"[WARN] [求解] Status is NOT OPTIMAL/FEASIBLE — schedule extraction will be blocked to prevent partial solution artifacts")
        return {
            "model": model,
            "schedule": schedule,
            "solver": solver,
            "status": status,
            "phase2_penalty_vars": phase2_penalty_vars,
            "engine": engine if 'engine' in locals() else None,
            "alternating_class_is_music_odd": alternating_class_is_music_odd,
            "alternating_group_map": alternating_group_map,
            "class_pair_group": class_pair_group,
            "class_teacher_pair": class_teacher_pair,
            "relax_room_capacity": relax_room_capacity,
            "timeout_stage": timeout_stage,
            # [P2] Phase-level wall time for observability
            "wall_time": round(solver.WallTime(), 3) if hasattr(solver, "WallTime") else 0,
            # [Task 7-A] Grade Time Rules candidate selector metadata.
            # apply_grade_time_soft_rules() is called by engine.build_soft_constraints();
            # the resulting selector_metadata is stored on engine.gtr_selector_metadata.
            # We must carry it in the attempt dict so the correct solver.Value can be used
            # after the winning attempt is selected (two-pass flow).
            "gtr_selector_metadata": getattr(engine, "gtr_selector_metadata", []),
        }

    # [Task 02] Two-pass solver flow:
    # 1. Strict pass with STRICT_TEACHING_SHAPE mode
    # 2. If strict infeasible/model-invalid, fallback to FEASIBILITY_RECOVERY mode
    # 3. Fallback output must be hard-valid (R2)

    try:
        solve_pass = "strict_teaching_shape"
        degraded = False
        degradation_reasons = []
        fallback_attempted = False  # [Task 02] Guard: fallback only once

        # Read global time limits for two-pass propagation
        legacy_max_time = os.environ.get("SOLVER_MAX_TIME_SECONDS")
        short_time_str = os.environ.get("SOLVER_SHORT_TIME_SECONDS")
        long_time_str = os.environ.get("SOLVER_LONG_TIME_SECONDS")
        if legacy_max_time and not short_time_str and not long_time_str:
            global_long_time = float(legacy_max_time)
        else:
            global_long_time = float(long_time_str or "60.0")

        strict_policy = get_active_policy(SolveMode.STRICT_TEACHING_SHAPE)

        print("[INFO] [求解] 啟動 Two-Pass Pass 1: Strict Teaching Shape (Core Level)")
        _t0 = time.time()
        attempt = _solve_attempt(relax_room_capacity=False, solve_mode=SolveMode.STRICT_TEACHING_SHAPE, build_level="core")
        _t1 = time.time()
        _total = _t1 - _t0
        _solve = attempt.get("wall_time", 0)
        _build = max(0, _total - _solve)
        phase_timings["solve_core_strict_total_seconds"] = round(_total, 3)
        phase_timings["solve_core_strict_build_seconds"] = round(_build, 3)
        phase_timings["solve_core_strict_solve_seconds"] = round(_solve, 3)
        phase_history.append({
            "phase": "strict_core",
            "buildLevel": "core",
            "solveMode": "STRICT_TEACHING_SHAPE",
            "status": attempt["solver"].StatusName(attempt["status"]) if attempt.get("solver") else "UNKNOWN",
            "timeoutStage": attempt.get("timeout_stage", "short"),
            "buildTimeSeconds": round(_build, 3),
            "solveTimeSeconds": round(_solve, 3),
            "totalTimeSeconds": round(_total, 3),
        })

        if attempt["status"] in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            print("[INFO] [求解] Strict pass 成功產出可行解，啟動 Two-Pass Pass 2: Quality 優化...")
            hint_values = {}
            for key, var in attempt["schedule"].items():
                try:
                    hint_values[key] = attempt["solver"].Value(var)
                except Exception:
                    pass

            _t0 = time.time()
            quality_attempt = _solve_attempt(
                relax_room_capacity=False,
                solve_mode=SolveMode.STRICT_TEACHING_SHAPE,
                build_level="quality",
                hint_values=hint_values,
                time_limit=global_long_time
            )
            _t1 = time.time()
            _total = _t1 - _t0
            _solve = quality_attempt.get("wall_time", 0)
            _build = max(0, _total - _solve)
            phase_timings["solve_quality_strict_total_seconds"] = round(_total, 3)
            phase_history.append({
                "phase": "strict_quality",
                "buildLevel": "quality",
                "solveMode": "STRICT_TEACHING_SHAPE",
                "status": quality_attempt["solver"].StatusName(quality_attempt["status"]) if quality_attempt.get("solver") else "UNKNOWN",
                "timeoutStage": quality_attempt.get("timeout_stage", "short"),
                "buildTimeSeconds": round(_build, 3),
                "solveTimeSeconds": round(_solve, 3),
                "totalTimeSeconds": round(_total, 3),
            })

            if quality_attempt["status"] in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                attempt = quality_attempt
                solve_pass = "strict_teaching_shape_quality"
                print("[INFO] [求解] Quality pass 優化成功！")
            else:
                print("[WARN] [求解] Quality pass 失敗，退回 Strict core pass 初解")

        if attempt["status"] in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID, cp_model.UNKNOWN):
            strict_status = attempt["status"]
            strict_status_name = attempt["solver"].StatusName(strict_status) if attempt.get("solver") else "UNKNOWN"

            # [Blocker 2] Only trigger fallback if fallback_enabled is True AND not already attempted
            if strict_policy.fallback_enabled and not fallback_attempted:
                print("[WARN] [求解] Strict pass 無解或模型無效，啟動 Feasibility Recovery Fallback (Core Level)...")
                fallback_attempted = True
                # Run fallback pass with FEASIBILITY_RECOVERY mode
                _t0 = time.time()
                attempt = _solve_attempt(relax_room_capacity=False, solve_mode=SolveMode.FEASIBILITY_RECOVERY, build_level="core")
                _t1 = time.time()
                _total = _t1 - _t0
                _solve = attempt.get("wall_time", 0)
                _build = max(0, _total - _solve)
                phase_timings["solve_core_fallback_total_seconds"] = round(_total, 3)
                phase_history.append({
                    "phase": "fallback_core",
                    "buildLevel": "core",
                    "solveMode": "FEASIBILITY_RECOVERY",
                    "status": attempt["solver"].StatusName(attempt["status"]) if attempt.get("solver") else "UNKNOWN",
                    "timeoutStage": attempt.get("timeout_stage", "short"),
                    "buildTimeSeconds": round(_build, 3),
                    "solveTimeSeconds": round(_solve, 3),
                    "totalTimeSeconds": round(_total, 3),
                })

                if attempt["status"] in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                    print("[INFO] [求解] Fallback pass 成功產出可行解，啟動 Quality 優化...")
                    fb_hint_values = {}
                    for key, var in attempt["schedule"].items():
                        try:
                            fb_hint_values[key] = attempt["solver"].Value(var)
                        except Exception:
                            pass

                    _t0 = time.time()
                    fb_quality_attempt = _solve_attempt(
                        relax_room_capacity=False,
                        solve_mode=SolveMode.FEASIBILITY_RECOVERY,
                        build_level="quality",
                        hint_values=fb_hint_values,
                        time_limit=global_long_time
                    )
                    _t1 = time.time()
                    _total = _t1 - _t0
                    _solve = fb_quality_attempt.get("wall_time", 0)
                    _build = max(0, _total - _solve)
                    phase_timings["solve_quality_fallback_total_seconds"] = round(_total, 3)
                    phase_history.append({
                        "phase": "fallback_quality",
                        "buildLevel": "quality",
                        "solveMode": "FEASIBILITY_RECOVERY",
                        "status": fb_quality_attempt["solver"].StatusName(fb_quality_attempt["status"]) if fb_quality_attempt.get("solver") else "UNKNOWN",
                        "timeoutStage": fb_quality_attempt.get("timeout_stage", "short"),
                        "buildTimeSeconds": round(_build, 3),
                        "solveTimeSeconds": round(_solve, 3),
                        "totalTimeSeconds": round(_total, 3),
                    })
                    if fb_quality_attempt["status"] in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                        attempt = fb_quality_attempt
                        solve_pass = "feasibility_recovery_quality"
                        print("[INFO] [求解] Fallback Quality pass 優化成功！")
                    else:
                        solve_pass = "feasibility_recovery"
                        print("[WARN] [求解] Fallback Quality pass 失敗，退回 Fallback core pass 初解")

                _fb_breakdown = {}

                if attempt["status"] in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                    # Fallback succeeded - mark as degraded
                    # solve_pass is already set above
                    degraded = True
                    # [Task 02] Compute penaltyBreakdown early to build specific degradationReasons
                    for pv_entry in attempt["phase2_penalty_vars"] or []:
                        if not isinstance(pv_entry, dict):
                            continue
                        rule_id = pv_entry.get("rule_id")
                        weight = pv_entry.get("weight", 0)
                        var = pv_entry.get("var")
                        if not rule_id or var is None:
                            continue
                        try:
                            val = attempt["solver"].Value(var)
                        except Exception:
                            continue
                        if val > 0:
                            _fb_breakdown[rule_id] = _fb_breakdown.get(rule_id, 0) + (weight * val)
                    # Build specific degradation reasons from penalty keys
                    if "natural_shape_fallback" in _fb_breakdown:
                        degradation_reasons.append("teaching-shape (natural science consecutive) relaxed in fallback mode")
                    if "art_music_shape_fallback" in _fb_breakdown:
                        degradation_reasons.append("teaching-shape (art/music consecutive) relaxed in fallback mode")
                    if "exact_two_alternating_pairing_fallback" in _fb_breakdown:
                        degradation_reasons.append("exact-two alternating pairing downgraded to near-hard soft")
                    if "grade12_tuesday_afternoon_life_course_fallback" in _fb_breakdown:
                        degradation_reasons.append("grade1-2 Tuesday afternoon life-course placement relaxed in fallback mode")
                    # Fallback safety net: if no specific reason identified, use generic
                    if not degradation_reasons:
                        degradation_reasons.append("teaching-shape constraints relaxed in fallback mode")
                    print("[INFO] [求解] Fallback pass 成功產出可行解（已降級）")
                if "classroom_capacity_overload" in _fb_breakdown and _fb_breakdown["classroom_capacity_overload"] > 0:
                    degradation_reasons.append("specialty room capacity relaxed to soft penalty in fallback mode")
                # else: Fallback also infeasible — try soft room capacity as last resort
                if attempt["status"] in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID, cp_model.UNKNOWN):
                    print("[WARN] [求解] FEASIBILITY_RECOVERY 仍無解，啟動 Soft Room Capacity 最終回退...")
                    _t0 = time.time()
                    soft_room_attempt = _solve_attempt(relax_room_capacity=True, solve_mode=SolveMode.FEASIBILITY_RECOVERY, build_level="core")
                    _t1 = time.time()
                    _total = _t1 - _t0
                    _solve = soft_room_attempt.get("wall_time", 0)
                    _build = max(0, _total - _solve)
                    phase_timings["solve_core_soft_room_total_seconds"] = round(_total, 3)
                    phase_history.append({
                        "phase": "soft_room_capacity",
                        "buildLevel": "core",
                        "solveMode": "FEASIBILITY_RECOVERY",
                        "status": soft_room_attempt["solver"].StatusName(soft_room_attempt["status"]) if soft_room_attempt.get("solver") else "UNKNOWN",
                        "timeoutStage": soft_room_attempt.get("timeout_stage", "short"),
                        "buildTimeSeconds": round(_build, 3),
                        "solveTimeSeconds": round(_solve, 3),
                        "totalTimeSeconds": round(_total, 3),
                    })
                    if soft_room_attempt["status"] in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                        attempt = soft_room_attempt
                        solve_pass = "soft_room_capacity_recovery"
                        degraded = True
                        if not degradation_reasons:
                            degradation_reasons.append("specialty room capacity relaxed to soft penalty")
                        print("[INFO] [求解] Soft Room Capacity 回退成功產出可行解（已降級）")
            else:
                if not strict_policy.fallback_enabled:
                    print("[INFO] [求解] Strict pass 無解但 fallback_enabled=false，不執行 fallback")
                elif fallback_attempted:
                    print("[INFO] [求解] Fallback 已嘗試過，不再重複執行")
            # Per YAML §105, §208: physical room safety is a hard constraint that never degrades
            # Exception: when manual_locks create unsolvable pressure, soft capacity prevents INFEASIBLE

        model = attempt["model"]
        schedule = attempt["schedule"]
        solver = attempt["solver"]
        status = attempt["status"]
        phase2_penalty_vars = attempt["phase2_penalty_vars"]
        engine = attempt.get("engine")
        alternating_class_is_music_odd = attempt["alternating_class_is_music_odd"]
        alternating_group_map = attempt["alternating_group_map"]
        class_pair_group = attempt["class_pair_group"]
        class_teacher_pair = attempt["class_teacher_pair"]
        used_soft_capacity_fallback = attempt["relax_room_capacity"]

        # [Task 02] Compute penaltyBreakdown from phase2_penalty_vars
        # [Blocker 1] Defensive: skip raw CP-SAT expressions, only parse dict metadata
        # [Task 3.8] Initialize all Stage 3 rule IDs to 0 so they appear even when fully satisfied
        # [Task 04] Include classroom preference penalty keys per YAML weight_registry
        penalty_breakdown = {
            "classroom_grade_affinity": 0,
            "classroom_primary_teacher_affinity": 0,
            "grade_morning_first_period_homeroom_day": 0,
            "morning_two_homeroom_periods_per_day": 0,
            # [Task 07] New penalty keys for grade1-2 Tuesday life-course and daily subject-teacher minimum
            "grade12_tuesday_afternoon_life_course_fallback": 0,
            "daily_subject_teacher_minimum": 0,
            # [Task 08] Priority scheduling penalty keys per YAML weight_registry
            "specialty_room_non_preferred_grade": 0,
            "priority_teacher_placeholder": 0,
            # [repair_07] Teacher quota overtime — always soft, aggregated from dict metadata
            "teacher_quota_overtime": 0,
            "teacher_class_progress_incomplete_round": 0,
            "teacher_class_progress_waiting": 0,
            "teacher_class_progress_visit_pattern": 0,
        }
        # CRITICAL: solver.Value() crashes with C-level access violation on INFEASIBLE/UNKNOWN
        # Must guard ALL solver.Value() calls with status check
        solved_penalty_entries = (engine.penalty_vars if 'engine' in locals() and hasattr(engine, 'penalty_vars') else phase2_penalty_vars) or []
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for pv_entry in solved_penalty_entries:
                if not isinstance(pv_entry, dict):
                    continue

                rule_id = pv_entry.get("rule_id")
                weight = pv_entry.get("weight", 0)
                var = pv_entry.get("var")

                if not rule_id or var is None:
                    continue

                try:
                    val = solver.Value(var) if hasattr(var, "Index") else int(var)
                except Exception:
                    continue

                if val > 0:
                    penalty_breakdown[rule_id] = penalty_breakdown.get(rule_id, 0) + (weight * val)

        status_str = "UNKNOWN"
        if status == cp_model.OPTIMAL: status_str = "OPTIMAL"
        elif status == cp_model.FEASIBLE: status_str = "FEASIBLE"
        elif status == cp_model.INFEASIBLE: status_str = "INFEASIBLE"
        elif status == cp_model.MODEL_INVALID: status_str = "MODEL_INVALID"

        result = {
            "jobId": job_id,
            "status": status_str,
            "solverStatus": status_str,
            "time_seconds": round(solver.WallTime(), 3) if hasattr(solver, "WallTime") else 0,
            "total_penalty": sum(penalty_breakdown.values()),
            "schedule": [],
            "message": "求解失敗" if status_str not in ("OPTIMAL", "FEASIBLE") else "",
            # [Task 02] Two-pass metadata
            "solvePass": solve_pass,
            "degraded": degraded,
            "degradationReasons": degradation_reasons,
            "penaltyBreakdown": penalty_breakdown,
            "teacherClassProgress": getattr(engine, "tcp_artifact", {}).get("evaluator_result", {"components": {}, "violations": [], "rounds": []}) if 'engine' in locals() else {"components": {}, "violations": [], "rounds": []},
            "timeoutStage": attempt.get("timeout_stage", "short"),
            "hadFeasibleCandidate": status in (cp_model.OPTIMAL, cp_model.FEASIBLE),
        }

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            result["message"] = "成功產出課表"
            if used_soft_capacity_fallback:
                result["message"] = "成功產出課表（已啟用專科教室容量軟性降級）"

            # Post-solve solved parity calculation for teacherClassProgress
            tcp_entries_in_engine = [p for p in getattr(engine, 'penalty_vars', []) if isinstance(p, dict) and str(p.get('rule_id', '')).startswith('teacher_class_progress')]
            print(f"[DIAG] engine.penalty_vars TCP count: {len(tcp_entries_in_engine)}", flush=True)
            for p in tcp_entries_in_engine:
                try:
                    val = solver.Value(p["var"]) if hasattr(p["var"], "Index") else int(p["var"])
                    print(f"[DIAG] TCP entry rule={p.get('rule_id')} w={p.get('weight')} var={p['var']} val={val}", flush=True)
                except Exception as ex:
                    print(f"[DIAG] TCP entry rule={p.get('rule_id')} w={p.get('weight')} err={ex}", flush=True)
            model_tcp_components = {
                "teacher_class_progress_incomplete_round": 0,
                "teacher_class_progress_waiting": 0,
                "teacher_class_progress_visit_pattern": 0,
            }
            tcp_sources = (engine.penalty_vars if engine and hasattr(engine, 'penalty_vars') else phase2_penalty_vars) or []
            for pv_entry in tcp_sources:
                if isinstance(pv_entry, dict):
                    rule_id = pv_entry.get("rule_id")
                    if rule_id in model_tcp_components:
                        w = pv_entry.get("weight", 0)
                        v = pv_entry.get("var")
                        if v is not None:
                            try:
                                val = solver.Value(v) if hasattr(v, "Index") else int(v)
                                model_tcp_components[rule_id] += w * val
                            except Exception as e:
                                pass

            rep_schedule = {}
            for (c, p, t, s), var in schedule.items():
                try:
                    if solver.Value(var) == 1:
                        rep_schedule[(c, p, t, s)] = 1
                except Exception:
                    pass

            tcp_cfg = (ai_settings or {}).get("qualityRules", {})
            eval_acts = build_teacher_class_progress_weekly_activities(
                rep_schedule, tcp_cfg, days=DAYS, periods_per_day=PERIODS_PER_DAY
            )
            eval_res = evaluate_teacher_class_progress_round_robin(
                eval_acts, tcp_cfg, value_of=None
            )
            evaluator_tcp_components = eval_res.get("components", {
                "teacher_class_progress_incomplete_round": 0,
                "teacher_class_progress_waiting": 0,
                "teacher_class_progress_visit_pattern": 0,
            })

            tcp_parity = compare_teacher_class_progress_components(
                model_tcp_components, evaluator_tcp_components
            )

            result["teacherClassProgress"] = {
                "source": "solved",
                "modelComponents": model_tcp_components,
                "evaluatorComponents": evaluator_tcp_components,
                "totalPenalty": sum(model_tcp_components.values()),
                "parity": tcp_parity,
                "rounds": eval_res.get("rounds", []),
                "violations": eval_res.get("violations", []),
            }

            if not tcp_parity["matched"]:
                result["status"] = "MODEL_EVALUATOR_MISMATCH"
                result["solverStatus"] = "MODEL_EVALUATOR_MISMATCH"
                result["error"] = "teacher_class_progress_model_evaluator_mismatch"
                result["message"] = "求解失敗：TCP 模型與評估器結果不一致"

            # ========== [NEW] 輸出 AI 排定與湊班後的特殊專案/抽離課程 ==========
            result["specialCourses"] = []

            # CRITICAL: All solver.Value() calls below must be inside this status guard.
            # Calling solver.Value() on INFEASIBLE/UNKNOWN causes C-level access violation.

            if hasattr(model, "sc_decision_vars"):
                for sc_entry in model.sc_decision_vars:
                    sc = sc_entry["sc"]
                    vars_list = sc_entry["vars"]
                    classes_pool = sc_entry["classes_pool"]
                    select_vars = sc_entry["select_vars"]
                    mode = sc_entry["mode"]

                    # 尋找排定時段
                    chosen_p = -1
                    for p in range(TOTAL_PERIODS):
                        if solver.Value(vars_list[p]) == 1:
                            chosen_p = p
                            break

                    if chosen_p != -1:
                        day = (chosen_p // PERIODS_PER_DAY) + 1
                        period = (chosen_p % PERIODS_PER_DAY) + 1
                        locked_slots = [{"day": day, "period": period}]
                    else:
                        locked_slots = sc.get("lockedSlots", [])

                    # 尋找參與班級
                    if mode == "auto":
                        selected_classes = [c for c in classes_pool if solver.Value(select_vars[c]) == 1]
                    else:
                        selected_classes = sc.get("targetClasses", [])

                    # 建立更新後的特殊課程紀錄，將 isAutoTime/isAutoClass 設為 False 固定下來
                    updated_sc = {
                        "id": sc.get("id"),
                        "type": sc.get("type"),
                        "name": sc.get("name"),
                        "targetSubject": sc.get("targetSubject"),
                        "teacher": sc.get("teacher"),
                        "targetClasses": selected_classes,
                        "lockedSlots": locked_slots,
                        "isAutoTime": False,   # 固定時段
                        "isAutoClass": False,  # 固定班級
                        "autoClassConfig": sc.get("autoClassConfig"),
                        "sharedEventId": sc.get("sharedEventId"),
                        "sourceGroup": sc.get("sourceGroup"),
                        "sourceKind": sc.get("sourceKind"),
                        "projectName": sc.get("projectName"),
                    }
                    result["specialCourses"].append(updated_sc)

            # -- 預先建立 pair 對照表：(group_id, period) -> [class_name]
            active_alt_at = {}
            for (c, p, t, s), var in schedule.items():
                if "音樂美勞_交替" in s and solver.Value(var) == 1:
                    gid = class_pair_group.get(c)
                    if gid:
                        key = (gid, p)
                        active_alt_at.setdefault(key, [])
                        if c not in active_alt_at[key]:
                            active_alt_at[key].append(c)

            # [NEW] 建立 (className, period_index, week) -> (roomId, roomName) 對照表
            assigned_rooms = {}

            print(f"\n[DIAG] === CP-SAT raw classroom_assignments ===", flush=True)
            if hasattr(model, "classroom_assignments"):
                for item in model.classroom_assignments:
                    try:
                        if solver.Value(item["var"]) == 1:
                            assigned_rooms[(item["className"], item["period"], item.get("week", "both"))] = {
                                "classroomId": item.get("roomId", ""),
                                "classroomName": item.get("roomName", ""),
                            }
                            # Diagnostic check
                            c_name = item["className"]
                            p_idx = item["period"]
                            day = (p_idx // PERIODS_PER_DAY) + 1
                            period = (p_idx % PERIODS_PER_DAY) + 1
                            if c_name in ["3年10班", "5年11班"] and day == 2 and period == 1:
                                print(f"[DIAG] Class: {c_name}, Room: {item.get('roomName', '')}, Week: {item.get('week', 'both')}", flush=True)
                    except Exception:
                        pass
            print(f"[DIAG] === END ===\n", flush=True)

            # -- 主輸出迴圈
            print("[PHASE] schedule extraction 開始", flush=True)
            for (c, p, t, s), var in schedule.items():
                if solver.Value(var) != 1:
                    continue

                day    = (p // PERIODS_PER_DAY) + 1
                period = (p % PERIODS_PER_DAY) + 1

                final_subject = s
                pair_fields   = {}

                # 泛型交替科目判斷
                is_alt = "交替" in s or "/" in s
                pair_fields = {}
                week_entries = []  # 交替課時儲存 (week, subject, teacher_name) 列表

                if is_alt:
                    subj_parts = s.split('/')
                    if len(subj_parts) == 2:
                        subj_a, subj_b = subj_parts[0], subj_parts[1]
                    else:
                        subj_a, subj_b = "音樂", "美勞"

                    bool_val = None
                    if (c, t) in alternating_class_is_music_odd:
                        bool_val = solver.Value(alternating_class_is_music_odd[(c, t)])
                    else:
                        art_t = class_teacher_pair.get(c, ("", ""))[1]
                        if (c, art_t) in alternating_class_is_music_odd:
                            bool_val = solver.Value(alternating_class_is_music_odd[(c, art_t)])

                    gid      = class_pair_group.get(c)
                    partners = [cx for cx in active_alt_at.get((gid, p), []) if cx != c]
                    pair_partner = partners[0] if partners else None

                    if pair_partner is None:
                        print(f"  [WARN] [Pair 診斷] {c} 第{day}天第{period}節 找不到配對班！group={gid}")

                    pair_fields = {
                        "pairGroupId":      gid,
                        "pairPartnerClass": pair_partner,
                    }

                    if bool_val == 1:
                        week_entries.append(("odd", subj_a, t))
                        art_teacher = class_teacher_pair.get(c, ("", ""))[1] or t
                        week_entries.append(("even", subj_b, art_teacher))
                        pair_fields["pairRole"] = "A"
                        pair_fields["pairDirection"] = "music-first"
                    else:
                        art_teacher = class_teacher_pair.get(c, ("", ""))[1] or t
                        week_entries.append(("odd", subj_b, art_teacher))
                        week_entries.append(("even", subj_a, t))
                        pair_fields["pairRole"] = "B"
                        pair_fields["pairDirection"] = "art-first"

                if week_entries:
                    for week, wk_subject, wk_teacher in week_entries:
                        room_info = assigned_rooms.get((c, p, week), {})
                        entry = {
                            "day":         day,
                            "period":      period,
                            "className":   c,
                            "teacherName": wk_teacher,
                            "subject":     wk_subject,
                            "classroomId": room_info.get("classroomId", ""),
                            "classroomName": room_info.get("classroomName", ""),
                            "week":        week,
                        }
                        entry.update(pair_fields)
                        result["schedule"].append(entry)
                else:
                    room_info = assigned_rooms.get((c, p, "odd")) or assigned_rooms.get((c, p, "even")) or {}
                    entry = {
                        "day":         day,
                        "period":      period,
                        "className":   c,
                        "teacherName": t,
                        "subject":     final_subject if not is_alt else s,
                        "classroomId": room_info.get("classroomId", ""),
                        "classroomName": room_info.get("classroomName", ""),
                    }
                    entry.update(pair_fields)
                    result["schedule"].append(entry)

            _dump_diagnostics("After Schedule Extraction", result["schedule"])
            print("[PHASE] post-processing 開始", flush=True)
            optimized_schedule, music_art_optimization_skipped = _optimize_music_art_alternating_locally(
                result["schedule"],
                classes_data,
                classrooms,
                schoolInfo,
            )
            result["schedule"] = optimized_schedule

            # [FIX] backfill other special-room subjects (資訊, 自然科學, 語文-英語, etc.)
            # This ensures explicit classroom assignment regardless of whether music/art optimization occurred.
            _backfill_other_special_room_classrooms(result["schedule"], classrooms, schoolInfo)

            # [Task 2/5] Week-specific 音美教室容量後驗檢查
            ws_check = apply_week_specific_art_capacity_entries(
                result["schedule"],
                classes_data,
                classrooms,
                school_info=schoolInfo,
            )
            week_specific_conflict = ws_check["ws_overload"] > 0
            if week_specific_conflict:
                print(f"[WARN] [Week-Specific Capacity] 音美教室超載: {ws_check['ws_overload']} 節")
                for detail in ws_check["overload_details"]:
                    print(f"  - {detail['week']} 第{detail['day']}天第{detail['periodInDay']}節 "
                          f"{detail['subject']}: 使用{detail['used']}/{detail['capacity']}")

            # [DEBUG] 求解後診斷：驗證美勞固定課與交替課連堂
            _validate_art_alternating_consecutive(result["schedule"], classes_data)

            # [Task 5] 輸出旗標
            result_flags = _compute_result_flags(
                used_soft_capacity_fallback,
                week_specific_conflict,
            )
            result["weekSpecificConflict"] = result_flags["weekSpecificConflict"]
            result["musicArtOptimizationSkipped"] = music_art_optimization_skipped

            # Movable Locks prototype output
            moved_lessons = []
            movable_decisions = getattr(model, "movable_lock_decisions", [])
            for dec in movable_decisions:
                is_moved_var = dec.get("is_moved")
                if is_moved_var is not None and solver.Value(is_moved_var):
                    orig_p = dec["from_period"]
                    new_p = orig_p
                    for p, cv, _, _ in dec.get("lock_choice_vars", []):
                        if solver.Value(cv) == 1:
                            new_p = p
                            break
                    moved_lessons.append({
                        "className": dec["className"],
                        "subject": dec["subject"],
                        "type": dec["lockType"],
                        "specialCourseType": dec.get("specialCourseType", ""),
                        "originalPeriod": {"day": (orig_p // PERIODS_PER_DAY) + 1, "period": (orig_p % PERIODS_PER_DAY) + 1},
                        "newPeriod": {"day": (new_p // PERIODS_PER_DAY) + 1, "period": (new_p % PERIODS_PER_DAY) + 1}
                    })

            if moved_lessons:
                result["movedLockedLessons"] = moved_lessons
                result["movableLockSummary"] = {
                    "totalMoved": len(moved_lessons)
                }
                result["requiresUserReview"] = True

            # [Task 02] Do NOT overwrite result["degraded"] — it was set by two-pass flow
            # Only merge additional flags that don't conflict:
            if "degradeLevel" not in result:
                result["degradeLevel"] = result_flags.get("degradeLevel", "")

            print("[PHASE] validation 開始", flush=True)

            # ── 建構 resolved_special_courses 供 overlap 驗證使用 ──
            _resolved_for_validation = []
            if hasattr(model, "sc_decision_vars"):
                for sc_entry in model.sc_decision_vars:
                    sc = sc_entry["sc"]
                    vars_list = sc_entry["vars"]
                    classes_pool = sc_entry["classes_pool"]
                    select_vars = sc_entry["select_vars"]
                    mode = sc_entry["mode"]
                    eff_subjs = sc_entry.get("effective_subjects", {})

                    # 尋找排定時段
                    chosen_p = -1
                    for p in range(TOTAL_PERIODS):
                        try:
                            if solver.Value(vars_list[p]) == 1:
                                chosen_p = p
                                break
                        except Exception:
                            pass

                    if chosen_p != -1:
                        day = (chosen_p // PERIODS_PER_DAY) + 1
                        period = (chosen_p % PERIODS_PER_DAY) + 1
                        locked_slots = [{"day": day, "period": period}]
                    else:
                        locked_slots = sc.get("lockedSlots", [])

                    # 尋找參與班級
                    if mode == "auto":
                        selected_classes = [c for c in classes_pool if solver.Value(select_vars[c]) == 1]
                    else:
                        selected_classes = sc.get("targetClasses", [])

                    _resolved_for_validation.append({
                        "name": sc.get("name"),
                        "teacher": sc.get("teacher"),
                        "targetSubject": sc.get("targetSubject"),
                        "targetClasses": selected_classes,
                        "lockedSlots": locked_slots,
                        "sharedEventId": sc.get("sharedEventId"),
                        "_effective_subjects": eff_subjs,
                    })

            _dump_diagnostics("Before _validate_schedule_result", result["schedule"])

            _t_val_start = time.time()
            validation_report = _validate_schedule_result(
                result["schedule"],
                classes_data,
                schoolInfo,
                classrooms,
                ai_settings,
                standard_domain_settings=standard_domain_settings,
                resolved_special_courses=_resolved_for_validation,
            )
            has_validation_errors = _has_hard_validation_errors(
                validation_report,
                allow_room_overloads=used_soft_capacity_fallback,
            )
            _t_val_end = time.time()
            phase_timings["validation_seconds"] = round(_t_val_end - _t_val_start, 3)

            # [Task 7-A] Grade Time Rules diagnostics contract.
            # apply_grade_time_soft_rules() is called by engine.build_soft_constraints() and
            # stores selector metadata on engine.gtr_selector_metadata. That metadata is
            # carried in attempt["gtr_selector_metadata"] so we can use attempt["solver"].Value
            # on the correct (winning) attempt's BoolVars.
            _gtr_selector_meta = attempt.get("gtr_selector_metadata", [])
            if _gtr_selector_meta and status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                _gtr_selector_values = extract_selector_values_from_metadata(
                    _gtr_selector_meta, attempt["solver"].Value
                )
            else:
                _gtr_selector_values = {}
            _raw_gtr_settings = (
                schoolInfo.get("gradeTimeRulesSettings")
                if isinstance(schoolInfo, dict)
                else None
            )
            if not _raw_gtr_settings:
                _ai_s = ai_settings if isinstance(ai_settings, dict) else {}
                _raw_gtr_settings = _ai_s.get("gradeTimeRulesSettings")
            validation_report["grade_time_rule_diagnostics"] = compute_grade_time_rule_diagnostics(
                raw_settings=_raw_gtr_settings,
                selector_values=_gtr_selector_values,
                solution_entries=result["schedule"],
            )

            with open("debug_schedule_validation_report.json", "w", encoding="utf-8") as vf:
                json.dump(validation_report, vf, ensure_ascii=False, indent=2)

            result["validationReport"] = validation_report

            if has_validation_errors:
                result["status"] = "INVALID_VALIDATION"
                result["solverStatus"] = "INVALID_VALIDATION"
                result["message"] = "求解結果未通過硬限制驗證，請檢查 debug_schedule_validation_report.json"
                result["schedule"] = []
                result["validationReport"] = validation_report
                result["hadFeasibleCandidate"] = True
            elif used_soft_capacity_fallback and validation_report.get("room_overloads"):
                overload_count = len(validation_report.get("room_overloads") or [])
                result["message"] = f"成功產出課表（已啟用專科教室容量軟性降級；剩餘 {overload_count} 筆容量警告）"
        # When status is NOT OPTIMAL/FEASIBLE, skip extraction/post-processing/validation
        # and handle INFEASIBLE/UNKNOWN directly
        if status == cp_model.INFEASIBLE:
            result["status"] = "INFEASIBLE"
            result["solverStatus"] = "INFEASIBLE"
            result["message"] = "無法產出符合條件的課表 (條件矛盾)"
            _write_infeasible_report(data, classes_data, teachers_data, schedule, subject_room_count, subject_demand_count)
        elif status == cp_model.UNKNOWN:
            result["status"] = "TIMEOUT_NO_SOLUTION"
            result["solverStatus"] = "TIMEOUT_NO_SOLUTION"
            result["message"] = "求解逾時，未找到任何可行解"
        elif status == cp_model.MODEL_INVALID:
            result["status"] = "MODEL_INVALID"
            result["solverStatus"] = "MODEL_INVALID"
            result["message"] = "模型構建錯誤"

        # [P2] Attach phase-level observability metadata
        total_solver_time = time.time() - solver_start_time
        result["phaseTimings"] = phase_timings
        result["phaseTimings"]["total_solver_seconds"] = round(total_solver_time, 3)
        result["phaseHistory"] = phase_history
        result["terminalReason"] = result.get("status", "UNKNOWN")

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    except Exception as e:
        import traceback
        error_msg = f"演算法崩潰: {str(e)}\n{traceback.format_exc()}"
        print(f"[ERROR] 嚴重錯誤: \n{error_msg}")

        error_result = {
            "jobId": job_id,
            "status": "ERROR",
            "solverStatus": "ERROR",
            "time_seconds": 0,
            "total_penalty": 0,
            "schedule": [],
            "message": f"系統錯誤，請聯絡管理員。\n{str(e)}"
        }
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(error_result, f, ensure_ascii=False, indent=2)

        sys.exit(1)


def _validate_art_alternating_consecutive(schedule_entries, classes_data):
    """
    驗證有交替課的班級，其 美勞_固定 一定與 音樂美勞_交替 相鄰連堂。

    Args:
        schedule_entries: list of dict from solver output (day, period, className, subject)
        classes_data: list of class dicts
    """
    alt_classes = []
    for cls in classes_data:
        c_name = cls.get("name", "")
        reqs = cls.get("course_requirements", [])
        has_art_fixed = any("美勞_固定" in r.get("subject", "") for r in reqs)
        has_alternating = any("音樂美勞_交替" in r.get("subject", "") for r in reqs)
        if has_art_fixed and has_alternating:
            alt_classes.append(c_name)

    if not alt_classes:
        print("\n[DEBUG] [診斷] 無交替班級，跳過美勞連堂驗證")
        return True

    print(f"\n[DEBUG] [診斷] 檢查 {len(alt_classes)} 個交替班級的美勞連堂狀況...")
    all_ok = True

    for c_name in alt_classes:
        art_fixed_pos = None
        alternating_positions = set()
        for entry in schedule_entries:
            if entry["className"] != c_name:
                continue
            subj = entry["subject"]
            if "美勞_固定" in subj:
                art_fixed_pos = (entry["day"], entry["period"])
                continue

            week = _normalize_week_tag(entry.get("week"))
            if week not in ("odd", "even"):
                if "交替" in subj or "(單)" in subj or "(雙)" in subj:
                    alternating_positions.add((entry["day"], entry["period"]))
                continue

            has_pair_metadata = any(
                entry.get(key)
                for key in ("pairGroupId", "pairPartnerClass", "pairDirection", "pairRole")
            )
            if has_pair_metadata or subj in ("音樂", "美勞"):
                alternating_positions.add((entry["day"], entry["period"]))

        if art_fixed_pos is None or not alternating_positions:
            print(
                f"  [WARN]  {c_name}: 找不到完整的美勞_固定或交替課位置 "
                f"(art={art_fixed_pos}, alt={sorted(alternating_positions)})"
            )
            all_ok = False
            continue

        if len(alternating_positions) != 1:
            print(
                f"  [WARN]  {c_name}: 偵測到多個交替課位置 {sorted(alternating_positions)}，"
                "無法唯一驗證美勞連堂"
            )
            all_ok = False
            continue

        alt_pos = next(iter(alternating_positions))

        # 檢查是否同一天且相鄰
        if art_fixed_pos[0] != alt_pos[0]:
            print(f"  [ERROR] {c_name}: 美勞_固定(第{art_fixed_pos[0]}天)與交替(第{alt_pos[0]}天)不同天!")
            all_ok = False
            continue

        day, p1 = art_fixed_pos
        _, p2 = alt_pos
        diff = abs(p1 - p2)

        if diff != 1:
            print(f"  [ERROR] {c_name}: 美勞_固定(第{p1}節)與交替(第{p2}節)不相鄰! (差距={diff})")
            all_ok = False
            continue

        # 檢查是否跨午休 (LUNCH_BOUNDARY=4, 即第4節與第5節之間)
        min_p = min(p1, p2)
        if min_p == LUNCH_BOUNDARY:
            print(f"  [ERROR] {c_name}: 美勞連堂跨午休!(第{min_p}節與第{min_p+1}節)")
            all_ok = False
            continue

        print(f"  [OK] {c_name}: 美勞_固定(第{day}天第{p1}節) + 交替(第{day}天第{p2}節) → 連堂OK")

    if all_ok:
        print("  [OK] 所有交替班級的美勞連堂驗證通過!")
    else:
        print("  [WARN]  部分交替班級的美勞連堂驗證失敗!")

    return all_ok


def _write_infeasible_report(data, classes_data, teachers_data, schedule, subject_room_count, subject_demand_count):
    """
    寫入 INFEASIBLE 診斷報告。
    """
    ai_settings = data.get("aiSettings", {}) or {}
    teacher_loads = {}
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            subj = req.get("subject", "")
            t = req.get("teacher", "")
            if t:
                periods = int(req.get("periods", 0))
                # 交替課以 0.5 權重計入教師負載，避免 1.5 節被算成 2 節
                if "交替" in subj:
                    periods = periods / 2
                teacher_loads[t] = teacher_loads.get(t, 0) + periods

    with open('debug_infeasible_report.txt', 'w', encoding='utf-8') as f:
        write = lambda text: f.write(terminal_sanitizer.sanitize_text(text))

        write("=== [ALERT] 智慧排課 INFEASIBLE 增強診斷報告 ===\n\n")

        write("[DEBUG] 1. 【班級總節數與空堂極限掃描】\n")
        for cls in classes_data:
            reqs = cls.get("course_requirements", [])
            total_p = _count_required_periods(reqs)
            grade = resolve_class_grade(cls)
            is_arts_class = cls.get("isArtsClass") or cls.get("is_arts_class", False)
            max_slots = get_effective_class_period_capacity(
                grade,
                is_arts_class=is_arts_class,
                ai_settings=ai_settings,
            )
            class_type_label = "藝才班" if is_arts_class else "一般班"
            write(
                f" - {cls.get('name')}: 共需排 {total_p} 節課 "
                f"(正式可用上限: {max_slots} 節, {class_type_label})"
            )
            if total_p > max_slots:
                write(" [ERROR] 嚴重錯誤：排課需求大於可用空堂！\n")
            else:
                write(" [OK] 正常\n")

        write("\n[DEBUG] 2. 【教師負載與專長掃描】\n")
        for t, load in teacher_loads.items():
            write(f" - {t}: 被分配了 {load} 節課\n")
            if load > 24:
                write("   [WARN] 警告：該教師超鐘點過多，可能導致空堂不足！\n")

        write("\n[DEBUG] 3. 【交替課配對可行性】\n")
        alt_load_summaries = _summarize_alternating_teacher_loads(classes_data)
        if not alt_load_summaries:
            write(" - [INFO] 本次輸入未偵測到音樂美勞交替班級。\n")
        for summary in alt_load_summaries:
            write(f" - [{summary['level']}] {summary['message']}\n")

        write("\n[DEBUG] 4. 【有效時段充足性】\n")
        for cls in classes_data:
            c_name = cls.get("name", "")
            grade = resolve_class_grade(cls)
            is_arts_class = cls.get("isArtsClass") or cls.get("is_arts_class", False)
            reqs = cls.get("course_requirements", [])
            total_sci = _count_required_periods(reqs, skip_homeroom_block=True)
            effective_periods = get_effective_class_period_capacity(
                grade,
                is_arts_class=is_arts_class,
                ai_settings=ai_settings,
            )
            write(f" - {c_name}: 科任需求 {total_sci} 節 / 有效時段 {effective_periods} 節")
            if total_sci > effective_periods:
                write(" [ERROR] 需求超過有效時段！\n")
            else:
                write(" [OK]\n")

        write("\n[DEBUG] 5. 【游泳資源分析】\n")
        swim_summary = _summarize_swimming_resource_pressure(classes_data)
        write(f" - 4-6年級班級數: {swim_summary['classCount']}\n")
        write(f" - 泳池容量: 3 個\n")
        if swim_summary["level"] == "INFO":
            write(f"   [INFO] {swim_summary['message']}\n")

        write("\n[DEBUG] 6. 【教室容量 vs 總需求】\n")
        for room_key, count in subject_room_count.items():
            demand = subject_demand_count.get(room_key, 0)
            max_capacity = count * TOTAL_PERIODS
            write(f" - {room_key}: 容量 {count} 間 (週容量={max_capacity}節) / 總需求 {demand} 節")
            if demand > max_capacity:
                write(" [ERROR] 需求超過容量！\n")
            else:
                write(" [OK]\n")

        write("\n[DEBUG] 7. 【教師同一時段能力掃描】\n")
        for t_data in teachers_data:
            t_name = t_data.get("name", "")
            safe_max = t_data.get("_safe_max_quota", 20)
            actual = teacher_loads.get(t_name, 0)
            if actual > 0:
                write(f" - {t_name}: 需求 {actual} 節 / 配額 {safe_max} 節")
                if actual > safe_max:
                    write(" [WARN] 超出配額！\n")
                else:
                    write(" [OK]\n")

        write("\n[DEBUG] 8. 【前端 Payload 原始資料檢查】\n")
        payload_homeroom_trace = (
            (data.get("payloadDiagnostics", {}) or {}).get("homeroomRequirementTrace", [])
        )
        preprocess_homeroom_trace = (
            (data.get("preprocessMetadata", {}) or {}).get("homeroomBlockizationTrace", [])
        )
        if payload_homeroom_trace or preprocess_homeroom_trace:
            payload_trace_map = {
                item.get("className", ""): item
                for item in payload_homeroom_trace
                if item.get("className")
            }
            preprocess_trace_map = {
                item.get("className", ""): item
                for item in preprocess_homeroom_trace
                if item.get("className")
            }
            for class_name in sorted(set(payload_trace_map) | set(preprocess_trace_map)):
                payload_trace = payload_trace_map.get(class_name, {})
                preprocess_trace = preprocess_trace_map.get(class_name, {})
                payload_periods = float(payload_trace.get("blockCandidatePeriods", 0) or 0)
                preprocess_merged = float(preprocess_trace.get("mergedPeriods", 0) or 0)
                existing_block = float(preprocess_trace.get("existingHomeroomBlockPeriods", 0) or 0)
                final_block = float(preprocess_trace.get("finalHomeroomBlockPeriods", 0) or 0)
                write(
                    f" - {class_name}: 前端 block 候選 {payload_periods} 節 / "
                    f"preprocess 合併 {preprocess_merged} 節 / 現成導師區塊 {existing_block} 節 / "
                    f"最終導師區塊 {final_block} 節"
                )
                if payload_periods and abs(payload_periods - preprocess_merged) > 0.01:
                    write(" [WARN] 前端 homeroom 候選與 preprocess 合併節數不一致，請回查 payload 建構鏈。\n")
                elif existing_block and preprocess_merged:
                    write(" [INFO] payload 內已含既有導師區塊，這會把最終導師區塊推高，請檢查是否重複送入。\n")
                else:
                    write(" [OK]\n")
        else:
            write(" - [INFO] 本次 payload 未附 homeroom trace；若要追查 15→16，請使用新版前端重新送單。\n")
        write("請同步查看專案根目錄的 debug_payload.json，確認前端送來的老師名字是否有空值或錯字。\n")

    with open('debug_payload.json', 'w', encoding='utf-8') as payload_file:
        json.dump(data, payload_file, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
