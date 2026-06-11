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


def grade_needs_special_room(subject: str, grade: int, subject_classroom_grades: dict) -> bool:
    """
    Determine if a subject in this grade needs a specialty classroom.
    
    This controls room capacity counting, NOT whether the subject is allowed.
    Low grades (1-2) typically can use regular classrooms.
    
    Args:
        subject: Subject name (will be normalized)
        grade: Grade number (1-6)
        subject_classroom_grades: Dict mapping canonical subject names to list of grades needing special room
        
    Returns:
        True if this grade needs a specialty classroom for this subject
    """
    canonical = canonical_subject(subject)

    normalized_cfg = {}
    for subj_raw, grades in (subject_classroom_grades or {}).items():
        normalized_cfg[canonical_subject(subj_raw)] = grades or []

    if canonical in normalized_cfg:
        return grade in normalized_cfg[canonical]

    # Keep validation/build-time behavior aligned with solver fallback:
    # low grades are exempt for music/art/science; other specialty subjects
    # still require capacity accounting even when config is missing.
    if canonical in ("音乐", "美劳", "自然科学") and grade <= 2:
        return False

    return True
