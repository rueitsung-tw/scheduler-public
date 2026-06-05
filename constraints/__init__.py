"""
constraints/ — 約束模組集合

- base_rules: 基礎建模（schedule變數、手動鎖定、alternating BoolVar）
- teacher_rules: 教師維度約束（衝堂防護、配額、不排課時段）
- class_rules: 班級維度約束（每日上限、下午禁排、不連堂、專科容量、自然習慣）
- special_rules: 特殊規則（英語、體育、音樂美勞、交替配對、游泳、通用連堂）
"""

from .base_rules import (
    create_schedule_vars_and_course_demands,
    create_alternating_vars,
    apply_preallocation_locks,
)

from .teacher_rules import (
    apply_anti_collision,
    apply_teacher_quota,
    apply_teacher_unavailable_slots,
    apply_special_course_locks,
)

from .class_rules import (
    apply_daily_subject_limit,
    apply_afternoon_prohibition,
    apply_no_consecutive_subject,
    apply_special_classroom_capacity,
    apply_science_habits,
)

from .special_rules import (
    apply_english_capacity,
    apply_no_consecutive_pe,
    apply_art_consecutive_constraint,
    apply_alternating_perfect_pairing,
    apply_swimming_engine_v2,
    add_consecutive_constraint,
)

__all__ = [
    # base_rules
    "create_schedule_vars_and_course_demands",
    "create_alternating_vars",
    "apply_preallocation_locks",
    # teacher_rules
    "apply_anti_collision",
    "apply_teacher_quota",
    "apply_teacher_unavailable_slots",
    "apply_special_course_locks",
    # class_rules
    "apply_daily_subject_limit",
    "apply_afternoon_prohibition",
    "apply_no_consecutive_subject",
    "apply_special_classroom_capacity",
    "apply_science_habits",
    # special_rules
    "apply_english_capacity",
    "apply_no_consecutive_pe",
    "apply_art_consecutive_constraint",
    "apply_alternating_perfect_pairing",
    "apply_swimming_engine_v2",
    "add_consecutive_constraint",
]
