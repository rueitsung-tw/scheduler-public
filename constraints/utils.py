"""
constraints/utils.py — 共用科目正規化與規則判斷模組

This module provides the single source of truth for:
- Subject name normalization (canonical_subject)
- Grade-subject legality checks (is_subject_allowed_for_grade)
- Specialty classroom need determination (grade_needs_special_room)

All other constraint modules should import from here instead of duplicating logic.
"""


def canonical_subject(subject: str) -> str:
    """
    Subject name normalization — single source of truth.
    
    Handles Traditional/Simplified Chinese variants and aliases.
    Strips suffixes like '_固定', '_交替' before normalization.
    
    Args:
        subject: Raw subject name (may contain suffixes, mixed scripts)
        
    Returns:
        Normalized canonical subject name
        
    Examples:
        >>> canonical_subject("音樂_固定")
        '音乐'
        >>> canonical_subject("美勞_交替")
        '美劳'
        >>> canonical_subject("自然科學")
        '自然科学'
        >>> canonical_subject("科技-資訊")
        '科技-资讯'
        >>> canonical_subject("資訊")
        '科技-资讯'
    """
    if not subject:
        return ''
    
    s = subject.strip()
    
    # Strip alternating/fixed suffixes first
    for suffix in ('_固定', '_交替'):
        if s.endswith(suffix):
            s = s[:-len(suffix)]
            break
    
    # Normalize based on prefix/content matching
    if s.startswith("音樂") or s.startswith("音乐"):
        return "音乐"
    if s.startswith("美劳") or s.startswith("美勞"):
        return "美劳"
    if s.startswith("自然") or s.startswith("科学") or s.startswith("科學"):
        return "自然科学"
    if any(x in s for x in ("科技-資訊", "科技-资讯", "資訊", "资讯", "電腦", "电脑")):
        return "科技-资讯"
    
    return s


def is_subject_allowed_for_grade(subject: str, grade: int, subject_grade_rules: dict) -> bool:
    """
    Check if a subject can be scheduled in the given grade.
    
    Uses the subjectGradeRules setting as the authoritative source.
    If no rule is defined for the subject, it is allowed in all grades.
    
    Args:
        subject: Subject name (will be normalized)
        grade: Grade number (1-6)
        subject_grade_rules: Dict mapping canonical subject names to list of allowed grades
        
    Returns:
        True if the subject is allowed in this grade, False otherwise
    """
    canonical = canonical_subject(subject)
    allowed = subject_grade_rules.get(canonical)
    if allowed is None:
        return True  # No restriction defined — allow everywhere
    return grade in allowed


def _normalize_room_subject(subj_raw):
    """Normalize subject name to solver's room-assignment canonical form.
    
    This MUST align with solver.py::_normalize_special_room_subject so that
    classroom config keys (subjectClassroomGrades) match the subjects used
    in apply_special_classroom_capacity and _validate_schedule_result.
    
    Returns Traditional Chinese canonical names:
        - "科技-資訊", "資訊", "電腦" -> "資訊"
        - "英語" -> "語文-英語"
        - "自然" -> "自然科學"
        - "健康與體育" -> "體育"
        - etc.
    """
    subj = str(subj_raw or "").strip()
    if not subj:
        return ""
    # Strip alternating/fixed suffixes
    for suffix in ("_固定", "_交替"):
        if subj.endswith(suffix):
            subj = subj[:-len(suffix)]
            break
    if subj == "英語":
        return "語文-英語"
    if subj == "自然":
        return "自然科學"
    if subj in ("科技-資訊", "資訊", "電腦"):
        return "資訊"
    if subj in ("健康與體育",):
        return "體育"
    if subj in ("本土語言", "閩南語", "客語"):
        return "本土語"
    # Keep music/art/science as-is (they already use Traditional Chinese)
    if subj in ("音樂", "音乐"):
        return "音樂"
    if subj in ("美勞", "美劳"):
        return "美勞"
    if subj in ("自然科學", "自然科学"):
        return "自然科學"
    if subj == "體育":
        return "體育"
    return subj


def grade_needs_special_room(subject: str, grade: int, subject_classroom_grades: dict) -> bool:
    """
    Determine if a subject in this grade needs a specialty classroom.
    
    Uses _normalize_room_subject (Traditional Chinese canonical) to align with
    solver.py::_normalize_special_room_subject and class_rules.py room assignment.
    
    This controls room capacity counting, NOT whether the subject is allowed.
    Low grades (1-2) typically can use regular classrooms.
    
    Args:
        subject: Subject name (will be normalized to room-canonical form)
        grade: Grade number (1-6)
        subject_classroom_grades: Dict mapping canonical subject names to list of grades needing special room
        
    Returns:
        True if this grade needs a specialty classroom for this subject
    """
    canonical = _normalize_room_subject(subject)

    # Normalize config keys using the same room-subject normalizer
    normalized_cfg = {}
    for subj_raw, grades in (subject_classroom_grades or {}).items():
        norm_key = _normalize_room_subject(subj_raw)
        if norm_key:
            normalized_cfg[norm_key] = grades or []

    if canonical in normalized_cfg:
        return grade in normalized_cfg[canonical]

    # Subject not in config -> does NOT need specialty classroom.
    # Only subjects explicitly configured in subjectClassroomGrades require special rooms.
    # This prevents "導師區塊", "語文-本土語", "生活", "健康" etc. from being
    # incorrectly flagged as needing specialty classrooms.
    return False
