"""
class_rules.py — 班級維度約束

負責：
  - [硬約束 6] 每日科任課上限
  - [硬約束 7] 低年級下午禁排
  - [硬約束 8] 科任課不連堂（通用版）
  - [硬約束 9] 專科教室容量
  - [硬約束 10] 自然課排課習慣（連堂配對、不跨午休）

依賴：config, utils
"""

import terminal_sanitizer
from collections import defaultdict
import re
from config import DAYS, PERIODS_PER_DAY, TOTAL_PERIODS, LUNCH_BOUNDARY
from utils import is_virtual_teacher
from .utils import grade_needs_special_room, _normalize_room_subject

# [Task 02] Import WEIGHT_REGISTRY to eliminate hard-coded weights
from scheduler_policy import SolveMode, WEIGHT_REGISTRY


def _science_valid_consec_pairs() -> list:
    """
    回傳一天內合法的連堂配對 (0-based 內部索引)。

    原則：
    - 相鄰節次才能連堂
    - 不可跨午休 (LUNCH_BOUNDARY 是切點)

    以 PERIODS_PER_DAY=7, LUNCH_BOUNDARY=4 為例:
    上午: 0,1,2,3 | 下午: 4,5,6
    合法配對: (0,1), (2,3), (4,5), (5,6)
    """
    pairs = []
    # 上午區間: 0 ~ LUNCH_BOUNDARY-1
    for pr in range(0, LUNCH_BOUNDARY - 1, 2):
        pairs.append((pr, pr + 1))
    # 下午區間: LUNCH_BOUNDARY ~ PERIODS_PER_DAY-1
    for pr in range(LUNCH_BOUNDARY, PERIODS_PER_DAY - 1, 2):
        pairs.append((pr, pr + 1))
    return pairs


def _is_arts_class_exempt(is_arts_class, ai_settings=None):
    """
    藝才班不享有班級作息/空堂豁免。

    產品規則：藝才班與普通班的每週上課總節數、下午禁排時段完全一致；
    藝才班僅在課程種類（如舞蹈）與虛擬/外聘教師警示判定上有特規。

    因此班級容量與下午禁排一律按年級規則計算，不因 isArtsClass 改變。
    保留此函式作為相容層，固定回傳 False，避免其他呼叫點分叉出第二套規則。
    """
    return False


def resolve_class_grade(cls):
    c_name = cls.get("name", "")
    raw_grade = cls.get("grade")
    if raw_grade is None:
        match = re.search(r'(\d+)年', c_name)
        if match:
            raw_grade = int(match.group(1))
    try:
        return int(raw_grade) if raw_grade is not None else 1
    except Exception:
        return 1


def get_forbidden_afternoon_days(grade, is_arts_class=False, ai_settings=None):
    if _is_arts_class_exempt(is_arts_class, ai_settings=ai_settings):
        return []

    if grade in [1, 2]:
        return [0, 2, 3, 4]
    if grade in [3, 4]:
        return [2, 4]
    if grade in [5, 6]:
        return [2]
    return []


def get_effective_class_period_capacity(grade, is_arts_class=False, ai_settings=None):
    forbidden_days = get_forbidden_afternoon_days(
        grade,
        is_arts_class=is_arts_class,
        ai_settings=ai_settings,
    )
    afternoon_periods = PERIODS_PER_DAY - LUNCH_BOUNDARY
    return TOTAL_PERIODS - len(forbidden_days) * afternoon_periods


def apply_daily_subject_limit(model, classes_data, schedule, locked_vars=None):
    """
    [硬約束 6] 每日科任課上限

    [INFO] 豁免一：人類預排鎖定之變數跳過硬約束
     豁免二：藝才班 + 虛擬/外聘/待排教師的課程跳過硬約束

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
        locked_vars: set of locked BoolVars (from apply_preallocation_locks)
    """
    if locked_vars is None:
        locked_vars = set()

    # 預先建立 (c, per) -> list of (t, s, var) 索引，防止 O(N) 遍歷
    schedule_by_class_period = defaultdict(list)
    for (sch_c, sch_per, sch_t, sch_s), var in schedule.items():
        schedule_by_class_period[(sch_c, sch_per)].append((sch_t, sch_s, var))

    for cls in classes_data:
        c_name = cls.get("name", "")
        is_arts_class = cls.get("isArtsClass") or cls.get("is_arts_class", False)

        raw_grade = cls.get("grade")
        if raw_grade is None:
            match = re.search(r'(\d+)年', c_name)
            if match:
                raw_grade = int(match.group(1))
        try:
            grade = int(raw_grade) if raw_grade is not None else 1
        except Exception:
            grade = 1

        if grade in [1, 2]:
            daily_limit = 4
        elif grade in [3, 4]:
            daily_limit = 5
        else:
            daily_limit = 5

        for d in range(DAYS):
            base = d * PERIODS_PER_DAY
            for p in range(base, min(base + PERIODS_PER_DAY, TOTAL_PERIODS)):
                subject_vars = [var for t, s, var in schedule_by_class_period.get((c_name, p), [])
                               if "導師區塊" not in s]
                if not subject_vars:
                    continue

                # [INFO] 豁免一：人類預排神聖不可侵犯
                if any(v in locked_vars for v in subject_vars):
                    continue

                #  豁免二：藝才班 + 虛擬教師專長課程
                if is_arts_class:
                    teachers_in_vars = [t for t, s, var in schedule_by_class_period.get((c_name, p), []) if var in subject_vars]
                    if all(is_virtual_teacher(t) for t in teachers_in_vars if t):
                        continue
                        
                model.Add(sum(subject_vars) <= daily_limit)


def apply_afternoon_prohibition(model, classes_data, schedule, ai_settings=None, locked_vars=None):
    """
    [硬約束 07] 低年級下午禁排
    1-2年級：週一、週三、週四、週五
    3-4年級：週三、週五
    5-6年級：週三

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
        locked_vars: set of locked BoolVars
    """
    if locked_vars is None:
        locked_vars = set()

    # 預建表 (c, per) -> list of (t, s, var) 索引
    from collections import defaultdict
    schedule_by_class_period = defaultdict(list)
    for (sch_c, sch_per, sch_t, sch_s), var in schedule.items():
        schedule_by_class_period[(sch_c, sch_per)].append((sch_t, sch_s, var))

    for cls in classes_data:
        c_name = cls.get("name", "")
        grade = resolve_class_grade(cls)
        is_arts_class = cls.get("isArtsClass") or cls.get("is_arts_class", False)
        forbidden_days = get_forbidden_afternoon_days(
            grade,
            is_arts_class=is_arts_class,
            ai_settings=ai_settings,
        )

        for d in forbidden_days:
            base = d * PERIODS_PER_DAY
            for p in range(base + LUNCH_BOUNDARY, min(base + PERIODS_PER_DAY, TOTAL_PERIODS)):
                for t, s, var in schedule_by_class_period.get((c_name, p), []):
                    model.Add(var == 0)


def apply_no_consecutive_subject(model, classes_data, schedule, locked_vars=None):
    """
    [硬約束 8] 科任課不連堂（通用版）

    [INFO] 豁免一：人類預排鎖定之變數跳過硬約束
     豁免二：藝才班 + 虛擬/外聘/待排教師的課程跳過硬約束

    排除自然、美勞、音樂、導師區塊（各有專門約束處理）

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
        locked_vars: set of locked BoolVars (from apply_preallocation_locks)
    """
    if locked_vars is None:
        locked_vars = set()

    # 預先建立 (c, per) -> list of (t, s, var) 索引，防止 O(N) 遍歷
    from collections import defaultdict
    schedule_by_class_period = defaultdict(list)
    for (sch_c, sch_per, sch_t, sch_s), var in schedule.items():
        schedule_by_class_period[(sch_c, sch_per)].append((sch_t, sch_s, var))

    for cls in classes_data:
        c_name = cls.get("name", "")
        is_arts_class = cls.get("isArtsClass") or cls.get("is_arts_class", False)
        reqs = cls.get("course_requirements", [])
        for req in reqs:
            subj = req.get("subject", "")
            if "自然" in subj or "美勞" in subj or "音樂" in subj or "導師區塊" in subj:
                continue

            #  豁免二：藝才班 + 虛擬教師專長課程
            teacher_name = req.get("teacher_name") or req.get("teacher", "")
            if is_arts_class and is_virtual_teacher(teacher_name):
                continue

            for d in range(DAYS):
                base = d * PERIODS_PER_DAY
                for pr in range(PERIODS_PER_DAY - 1):
                    p1 = base + pr
                    p2 = base + pr + 1
                    if p2 >= TOTAL_PERIODS:
                        continue
                    v1 = [var for t, s, var in schedule_by_class_period.get((c_name, p1), []) if subj in s]
                    v2 = [var for t, s, var in schedule_by_class_period.get((c_name, p2), []) if subj in s]
                    if v1 and v2:
                        # [INFO] 豁免一：人類預排神聖不可侵犯
                        if v1[0] in locked_vars or v2[0] in locked_vars:
                            continue
                        model.Add(v1[0] + v2[0] <= 1)



# ============================================================
# Subject Day-Spread Hard Constraint
# ============================================================
# 目標科目：語文-英語、資訊、體育、健康、社會
# 規則：同班同科同日最多 1 堂；相鄰兩天至多出現一天
# ============================================================

_TARGET_SPREAD_SUBJECTS = {
    "語文-英語": {"語文-英語", "英語"},
    "資訊": {"資訊", "科技-資訊", "電腦"},
    "體育": {"體育", "健康與體育"},
    "健康": {"健康"},
    "社會": {"社會"},
    "本土語": {"本土語", "本土語言", "語文-本土語", "閩南語", "客語"},
}


def _resolve_spread_canonical(subj_raw):
    """
    將原始 subject 字串映射到 day-spread canonical key。
    回傳 canonical key (str) 或 None（不屬於目標科目）。
    """
    subj = str(subj_raw or "").strip()
    # 先用既有 canonical 邏輯正規化
    normalized = _normalize_special_room_subject(subj)
    for canonical_key, alias_set in _TARGET_SPREAD_SUBJECTS.items():
        if subj in alias_set or normalized in alias_set or normalized == canonical_key:
            return canonical_key
    return None


def apply_subject_day_spread(model, classes_data, schedule, locked_vars=None, penalty_vars=None, adjacent_weight=None):
    """
    科任課日分散規則

    目標科目：語文-英語、資訊、體育、健康、社會
    規則：
      1. [HARD] 同班同科同日最多 1 堂（sum <= 1）
      2. [SOFT] 相鄰兩天至多出現一天 → soft penalty (weight=800)

    產品決策 (2026-07-15):
      - Rule A 保留為 hard constraint（合法性規則）
      - Rule B 改為 soft penalty（課表品質偏好，不應讓整份課表 INFEASIBLE）

    豁免：
      - 藝才班 + 虛擬教師的課程跳過
      - locked_vars 中的變數跳過（但不跳過整個科目）

    Args:
        model: CpModel
        classes_data: list of class dicts
        schedule: dict (c, p, t, s) -> BoolVar
        locked_vars: set of locked BoolVars (from apply_preallocation_locks)
        penalty_vars: list for soft penalty vars (optional, for Rule B)
        adjacent_weight: weight for Rule B soft penalty (default: from WEIGHT_REGISTRY)
    """
    if locked_vars is None:
        locked_vars = set()

    # 預先建立 (c, per) -> list of (t, s, var) 索引
    schedule_by_class_period = defaultdict(list)
    for (sch_c, sch_per, sch_t, sch_s), var in schedule.items():
        schedule_by_class_period[(sch_c, sch_per)].append((sch_t, sch_s, var))

    for cls in classes_data:
        c_name = cls.get("name", "")
        is_arts_class = cls.get("isArtsClass") or cls.get("is_arts_class", False)
        reqs = cls.get("course_requirements", [])

        # 收集該班的所有目標科目 canonical key
        target_canonical_set = set()
        for req in reqs:
            subj_raw = req.get("subject", "")
            canonical_key = _resolve_spread_canonical(subj_raw)
            if canonical_key is None:
                continue

            # 豁免二：藝才班 + 虛擬教師
            teacher_name = req.get("teacher_name") or req.get("teacher", "")
            if is_arts_class and is_virtual_teacher(teacher_name):
                continue

            target_canonical_set.add(canonical_key)

        if not target_canonical_set:
            continue

        # 對每個 canonical key 建立 day-level presence 並加入約束
        for canonical_key in target_canonical_set:
            alias_set = _TARGET_SPREAD_SUBJECTS[canonical_key]

            # [Task B] 收集每一天該科目的變數（包含 locked）
            # locked 的課也要算進 day-level presence / daily count，
            # 否則 solver 可能在同一天再塞一節，或在相鄰日再塞一節。
            all_day_vars = {d: [] for d in range(DAYS)}
            locked_day_count = {d: 0 for d in range(DAYS)}
            for d in range(DAYS):
                base = d * PERIODS_PER_DAY
                for p in range(base, min(base + PERIODS_PER_DAY, TOTAL_PERIODS)):
                    for t, s, var in schedule_by_class_period.get((c_name, p), []):
                        subj_check = str(s or "").strip()
                        norm_s = _normalize_special_room_subject(subj_check)
                        if subj_check in alias_set or norm_s in alias_set or norm_s == canonical_key:
                            all_day_vars[d].append(var)
                            if var in locked_vars:
                                locked_day_count[d] += 1

            # 過濾掉完全沒有變數的天
            active_days = {d: vars_list for d, vars_list in all_day_vars.items() if vars_list}
            if not active_days:
                continue

            # 1. 同天最多 1 堂（sum constraint）
            # [Task B] 若使用者已鎖超過 1 節在同一天，upper bound 需尊重既有 locked 現況
            for d, vars_list in active_days.items():
                upper_bound = max(1, locked_day_count[d])
                model.Add(sum(vars_list) <= upper_bound)

            # 2. 相鄰兩天至多出現一天（day-level presence）
            # Rule B: 相鄰兩天至多出現一天 → soft penalty (2026-07-15 產品決策)
            # 原因: Rule A (同日最多1堂) 是合法性規則，保留 hard;
            # Rule B 是課表品質偏好，不應讓整份課表 INFEASIBLE
            if penalty_vars is not None:
                if adjacent_weight is None:
                    from scheduler_policy import WEIGHT_REGISTRY
                    adjacent_weight = WEIGHT_REGISTRY.get("subject_day_spread_adjacent", 800)

                # [Task B] day_present 必須由包含 locked 的 all_day_vars 建出來
                has_on_day = {}
                for d, vars_list in active_days.items():
                    h = model.NewBoolVar(
                        f"spread_has_{c_name}_{canonical_key}_d{d}".replace(" ", "_").replace("-", "_")
                    )
                    model.AddMaxEquality(h, vars_list)
                    has_on_day[d] = h

                for d in range(DAYS - 1):
                    d_next = d + 1
                    if d in has_on_day and d_next in has_on_day:
                        # Soft penalty: violation when both adjacent days have the subject
                        viol = model.NewBoolVar(
                            f"subject_day_spread_adjacent_violation_{c_name}_{canonical_key}_d{d}".replace(" ", "_").replace("-", "_")
                        )
                        model.Add(viol >= has_on_day[d] + has_on_day[d_next] - 1)
                        penalty_vars.append({
                            "rule_id": "subject_day_spread_adjacent",
                            "weight": adjacent_weight,
                            "var": viol,
                        })


def apply_music_fixed_vs_alternating_day_spread(
    model, classes_data, schedule, alternating_class_is_music_odd=None
):
    """
    [硬約束] 音樂固定課 vs 交替課不同日規則

    若同一班同時存在「音樂固定課」entry 與「音樂/美勞交替課」entry，
    則兩者不可出現在同一天。

    識別方式（與 base_rules.py 第 130 行 create_alternating_vars 一致）：
      - 交替課：is_alternating=True, 或 subject 含 "交替", 或 subject 含 "/"
      - 固定音樂課：subject 含 "音樂" 且不符合交替條件

    Args:
        model: CpModel
        classes_data: list of class dicts
        schedule: dict (c, p, t, s) -> BoolVar
        alternating_class_is_music_odd: dict[(class_name, teacher_name), BoolVar]
            由 create_alternating_vars() 產生。若為 None 或空 dict，直接 return。
    """
    if not alternating_class_is_music_odd:
        return

    # 預先建立 (c, per) -> list of (t, s, var) 索引
    schedule_by_class_period = defaultdict(list)
    for (sch_c, sch_per, sch_t, sch_s), var in schedule.items():
        schedule_by_class_period[(sch_c, sch_per)].append((sch_t, sch_s, var))

    for cls in classes_data:
        c_name = cls.get("name", "")
        reqs = cls.get("course_requirements", [])

        # [Task C] 第一段：從 course_requirements 建立 fixed / alternating 的 key 集合
        # alternating 判定必須從 requirement metadata 來，不靠第二段字串重猜。
        # key 格式: (teacher, normalized_subject)
        fixed_music_keys = set()
        alt_music_keys = set()

        for req in reqs:
            subj = str(req.get("subject", "") or "").strip()
            teacher = str(req.get("teacher", "") or req.get("teacher_name", "") or "").strip()
            is_alternating = req.get("is_alternating", False)

            # 沿用現有規格判定 alternating
            is_alt_entry = (
                is_alternating
                or "交替" in subj
                or "/" in subj
            )
            is_music = "音樂" in subj

            if not is_music or not teacher:
                continue

            # 用 _normalize_special_room_subject 正規化 subject
            norm_subj = _normalize_special_room_subject(subj)
            key = (teacher, norm_subj)

            if is_alt_entry:
                alt_music_keys.add(key)
            else:
                fixed_music_keys.add(key)

        if not fixed_music_keys or not alt_music_keys:
            continue

        # 收集固定音樂與交替音樂的變數
        day_fixed = {d: [] for d in range(DAYS)}
        day_alt = {d: [] for d in range(DAYS)}

        for d in range(DAYS):
            base = d * PERIODS_PER_DAY
            for p in range(base, min(base + PERIODS_PER_DAY, TOTAL_PERIODS)):
                for t, s, var in schedule_by_class_period.get((c_name, p), []):
                    subj = str(s or "").strip()

                    if "音樂" not in subj:
                        continue

                    norm_s = _normalize_special_room_subject(subj)
                    key = (t, norm_s)

                    # [Task C] 依照第一段記錄的 key 來分流
                    is_alt_class = (c_name, t) in alternating_class_is_music_odd

                    if key in alt_music_keys and is_alt_class:
                        day_alt[d].append(var)
                    elif key in fixed_music_keys:
                        day_fixed[d].append(var)

        # 過濾空天
        active_fixed = {d: v for d, v in day_fixed.items() if v}
        active_alt = {d: v for d, v in day_alt.items() if v}

        if not active_fixed or not active_alt:
            continue

        # 建立 day-level presence
        has_fixed_day = {}
        for d, vars_list in active_fixed.items():
            h = model.NewBoolVar(
                f"music_fixed_has_{c_name}_d{d}".replace(" ", "_")
            )
            model.AddMaxEquality(h, vars_list)
            has_fixed_day[d] = h

        has_alt_day = {}
        for d, vars_list in active_alt.items():
            h = model.NewBoolVar(
                f"music_alt_has_{c_name}_d{d}".replace(" ", "_")
            )
            model.AddMaxEquality(h, vars_list)
            has_alt_day[d] = h

        # 同一天不可同時有固定音樂和交替音樂
        for d in range(DAYS):
            if d in has_fixed_day and d in has_alt_day:
                model.Add(has_fixed_day[d] + has_alt_day[d] <= 1)


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


def _canonical_schedule_subject_for_room(subject):
    """
    Normalize schedule subject to room-assignment canonical (Traditional Chinese).
    
    [SAFETY] Must handle both Traditional and Simplified Chinese input.
    Output must match repair_agent.canonical_subject() for consistency.
    Falls through to _normalize_room_subject from utils.py for any
    subjects not explicitly handled here, ensuring Simplified Chinese
    variants are properly converted.
    """
    from .utils import _normalize_room_subject
    
    subj = str(subject or "").strip()
    if not subj:
        return ""
    # Handle both Traditional and Simplified Chinese
    if "自然" in subj or "科学" in subj:
        return "自然科學"
    if "英語" in subj or "英语" in subj or "英文" in subj:
        return "語文-英語"
    if "音樂" in subj or "音乐" in subj:
        return "音樂"
    if "美勞" in subj or "美劳" in subj:
        return "美勞"
    if "體育" in subj or "体育" in subj or "游泳" in subj:
        return "體育"
    if any(x in subj for x in ("資訊", "资讯", "電腦", "电脑", "科技-資訊", "科技-资讯")):
        return "資訊"
    if "本土" in subj:
        return "本土語"
    # Fallback: use utils._normalize_room_subject for any remaining variants
    return _normalize_room_subject(subj)


def _subject_capacity_weight(subject, canonical_subject):
    if canonical_subject in ("音樂", "美勞"):
        return 1 if ("交替" in str(subject or "") or "/" in str(subject or "")) else 2
    return 1


def _grade_needs_special_room(canonical_subj, grade, school_info):
    """
    Wrapper for shared grade_needs_special_room utility.
    Maintains backward compatibility with existing call sites.
    """
    classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}
    return grade_needs_special_room(canonical_subj, grade, classroom_grades_cfg)


def _configured_special_room_subjects(classrooms, classroom_limits, school_info, fallback_limits):
    """
    回傳應套用專科教室 hard capacity 的科目。

    一般教室科目若沒有實體教室、容量設定或 fallback，不應被 0 容量硬卡。
    """
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

    # fallback_limits provides capacity defaults only and must not activate
    # special-room validation for subjects the fixture did not explicitly configure.
    # If a subject appears only in fallback_limits (no classrooms, no classroomLimits,
    # no subjectClassroomGrades), the solver skips room assignment for that subject;
    # downstream validators should not then require a room that was never modelled.

    return subjects


def _build_actual_rooms_by_subject(classrooms):
    rooms_by_subject = defaultdict(list)
    for room in classrooms or []:
        room_id = room.get("id")
        room_name = str(room.get("name", "") or "").strip()
        normalized_subject = _normalize_special_room_subject(room.get("subject", ""))
        if not normalized_subject:
            continue
        if not room_id and not room_name:
            continue
        rooms_by_subject[normalized_subject].append({
            "id": str(room_id or room_name),
            "name": room_name or str(room_id),
            "subject": normalized_subject,
            "gradePreferences": room.get("gradePreferences", []) or [],
            "primaryTeacher": str(room.get("primaryTeacher", "") or "").strip(),
            "allowSharing": room.get("allowSharing", True),  # [Task 08] default true per YAML §340
        })
    return rooms_by_subject


def _select_candidate_rooms_for_occurrence(
    canonical_subject,
    class_name,
    grade,
    teacher_name,
    rooms_by_subject,
):
    rooms = list(rooms_by_subject.get(canonical_subject, []) or [])
    if not rooms:
        return []

    def _room_sort_key(room):
        grade_prefs = room.get("gradePreferences", []) or []
        has_grade_pref = grade in grade_prefs if isinstance(grade_prefs, list) else False
        has_teacher_pref = teacher_name and teacher_name == room.get("primaryTeacher", "")
        return (
            0 if has_grade_pref else 1,
            0 if has_teacher_pref else 1,
            room.get("name", ""),
        )

    rooms.sort(key=_room_sort_key)
    return rooms


def _new_and_with_bool(model, left_var, right_var, name):
    var = model.NewBoolVar(name)
    model.Add(var <= left_var)
    model.Add(var <= right_var)
    model.Add(var >= left_var + right_var - 1)
    return var


def _new_and_with_negated_bool(model, left_var, right_var, name):
    var = model.NewBoolVar(name)
    model.Add(var <= left_var)
    model.Add(var <= right_var.Not())
    model.Add(var >= left_var - right_var)
    return var


def apply_special_classroom_capacity(model, classes_data, schedule, classrooms,
                                     science_consec_map=None, penalty_vars=None,
                                     classroom_limits=None, school_info=None,
                                     relax_to_soft=False,
                                     english_slack_enabled=False,
                                     alternating_class_is_music_odd=None,
                                     class_teacher_pair=None,
                                     # [Task 04] Classroom preference soft objective weights
                                     weight_grade_affinity=None,
                                     weight_teacher_affinity=None,
                                     # [Task 08] Specialty room non-preferred grade penalty weight
                                     weight_specialty_non_preferred_grade=None):
    """
    [硬約束 9] 專科教室容量限制

    採用「同科目、同節次總需求 <= 可用專科教室總量」的容量限制，
    避免逐房指派造成的大量搜尋空間。

    預設為硬限制；當 relax_to_soft=True 時，改以 slack 變數承接超載量，
    並將超載懲罰累加至 penalty_vars，供第二階段軟性降級求解使用。

    音樂/美勞固定課以 2 單位計，交替課以 1 單位計；
    教室總量也換算為對應單位數，因此仍能表達交替課共享容量。
    """
    if penalty_vars is None:
        penalty_vars = []

    if not hasattr(model, "classroom_assignments"):
        model.classroom_assignments = []

    class_grade_map = {}
    for cls in classes_data:
        c_name = cls.get("name", "")
        raw_grade = cls.get("grade")
        if raw_grade is None:
            match = re.search(r'(\d+)年', c_name)
            if match:
                raw_grade = int(match.group(1))
        try:
            grade = int(raw_grade) if raw_grade is not None else 1
        except Exception:
            grade = 1
        class_grade_map[c_name] = grade

    core_subjects_fallback = {
        "自然科學": 2,
        "語文-英語": 2,
        "音樂": 2,
        "美勞": 2,
        "體育": 3,
        "資訊": 2,
    }

    normalized_limits = {}
    for subj_raw, limit in (classroom_limits or {}).items():
        try:
            normalized_limits[_normalize_special_room_subject(subj_raw)] = int(limit)
        except (TypeError, ValueError):
            continue

    actual_room_count = defaultdict(int)
    for room in classrooms or []:
        subj = _normalize_special_room_subject(room.get("subject", ""))
        if subj:
            actual_room_count[subj] += 1

    capacity_count_by_subject = {}
    constrained_subjects = _configured_special_room_subjects(
        classrooms,
        normalized_limits,
        school_info,
        core_subjects_fallback,
    )

    for subj in constrained_subjects:
        count = actual_room_count.get(subj, 0)
        if count <= 0:
            count = normalized_limits.get(subj, core_subjects_fallback.get(subj, 0))
            if subj not in actual_room_count:
                print(f"  [NOTE] [容量模型] 【{subj}】未建實體教室，採用容量上限 {count}")
        capacity_count_by_subject[subj] = count

    rooms_by_subject = _build_actual_rooms_by_subject(classrooms)
    classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}

    # [Task 04] Resolve preference weights from policy adapter with fallback defaults
    if weight_grade_affinity is None:
        weight_grade_affinity = WEIGHT_REGISTRY.get("classroom_grade_affinity", 3000)
    if weight_teacher_affinity is None:
        weight_teacher_affinity = WEIGHT_REGISTRY.get("classroom_primary_teacher_affinity", 2500)
    # [Task 08] Specialty room non-preferred grade penalty (YAML §432-433, weight=3000)
    if weight_specialty_non_preferred_grade is None:
        weight_specialty_non_preferred_grade = WEIGHT_REGISTRY.get("specialty_room_non_preferred_grade", 3000)

    room_slot_groups = defaultdict(list)

    schedule_by_period = defaultdict(list)
    for (sch_c, sch_per, sch_t, sch_s), var in schedule.items():
        schedule_by_period[sch_per].append((sch_c, sch_t, sch_s, var))

    subjects_seen = sorted({
        _canonical_schedule_subject_for_room(subject)
        for (_c, _p, _t, subject) in schedule.keys()
        if _canonical_schedule_subject_for_room(subject)
    })

    for subj in subjects_seen:
        if subj not in constrained_subjects:
            continue

        room_count = capacity_count_by_subject.get(subj, 0)
        if room_count <= 0:
            continue

        if subj in ("音樂", "美勞"):
            capacity_units = room_count * 2
        else:
            capacity_units = room_count

        for p in range(TOTAL_PERIODS):
            usage_terms = []
            for c_name, _t_name, raw_subject, active_var in schedule_by_period.get(p, []):
                mapped_subject = _canonical_schedule_subject_for_room(raw_subject)
                if mapped_subject != subj:
                    continue

                grade = class_grade_map.get(c_name, 1)
                # subj is already room-canonical (Traditional Chinese) from _canonical_schedule_subject_for_room
                # Do NOT wrap with canonical_subject() which returns Simplified Chinese and breaks config lookup
                classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}
                if not grade_needs_special_room(subj, grade, classroom_grades_cfg):
                    continue

                usage_terms.append(active_var * _subject_capacity_weight(raw_subject, subj))

            if usage_terms:
                usage_sum = sum(usage_terms)
                
                # === C1 PROTOTYPE START ===
                is_english_slack_target = (
                    english_slack_enabled
                    and subj == "語文-英語"
                )

                if not relax_to_soft and not is_english_slack_target:
                    model.Add(usage_sum <= capacity_units)
                else:
                    overload_upper_bound = max(0, len(usage_terms) * 2)
                    
                    if is_english_slack_target:
                        overload_var = model.NewIntVar(0, overload_upper_bound, f"english_room_slack_{subj}_{p}")
                        model.Add(usage_sum <= capacity_units + overload_var)
                        english_slack_weight = WEIGHT_REGISTRY.get("english_room_slack_fallback", 8000)
                        penalty_vars.append({
                            "rule_id": "english_room_slack_fallback",
                            "weight": english_slack_weight,
                            "var": overload_var,
                            "subject": subj,
                            "period": p,
                            "capacity": capacity_units,
                            "actual_usage_terms": len(usage_terms),
                            "requiresUserReview": True,
                        })
                    else:
                        overload_var = model.NewIntVar(0, overload_upper_bound, f"room_overload_{subj}_{p}")
                        model.Add(usage_sum <= capacity_units + overload_var)
                        # [Task 02] Use WEIGHT_REGISTRY key for classroom capacity overload
                        room_cap_weight = WEIGHT_REGISTRY.get("classroom_capacity_overload", 5000)
                        penalty_vars.append({
                            "rule_id": "classroom_capacity_overload",
                            "weight": room_cap_weight,
                            "var": overload_var,
                        })
                # === C1 PROTOTYPE END ===

    for (class_name, period_idx, teacher_name, raw_subject), active_var in schedule.items():
        canonical_room_subject = _canonical_schedule_subject_for_room(raw_subject)
        if not canonical_room_subject or canonical_room_subject not in constrained_subjects:
            continue

        actual_rooms = rooms_by_subject.get(canonical_room_subject, [])
        if not actual_rooms:
            continue

        grade = class_grade_map.get(class_name, 1)
        # [SAFETY] grade_needs_special_room 控制兩件事：
        # 1. 容量計數（上方 loop 已用此過濾 usage_terms）
        # 2. 是否建立 room assignment 變數
        # 兩者必須一致，否則會把原本不計入硬容量的課強制塞進有限教室，
        # 造成 solver INFEASIBLE。
        needs_room = grade_needs_special_room(
            canonical_room_subject, grade, classroom_grades_cfg
        )

        # [P0-1 FIX] If this grade does not need a specialty room for this subject,
        # skip the entire hard room assignment / room occupancy path.
        # This prevents solver INFEASIBLE when the subject is not configured
        # in subjectClassroomGrades for this grade.
        if not needs_room:
            continue

        is_alt = "交替" in str(raw_subject or "") or "/" in str(raw_subject or "")
        if not is_alt:
            candidate_rooms = _select_candidate_rooms_for_occurrence(
                canonical_room_subject,
                class_name,
                grade,
                teacher_name,
                rooms_by_subject,
            )
            if not candidate_rooms:
                model.Add(active_var == 0)
                continue

            room_vars = []
            for room in candidate_rooms:
                room_var = model.NewBoolVar(
                    f"room_assign_{class_name}_{period_idx}_{canonical_room_subject}_{room['id']}".replace(" ", "_")
                )
                model.Add(room_var <= active_var)

                # [Task 04] Grade affinity miss soft penalty
                grade_prefs = room.get("gradePreferences", []) or []
                cls_grade = class_grade_map.get(class_name, 1)
                if grade_prefs and cls_grade not in grade_prefs:
                    miss_var = model.NewBoolVar(
                        f"grade_aff_miss_{class_name}_{period_idx}_{room['id']}".replace(" ", "_")
                    )
                    model.Add(miss_var >= room_var)
                    penalty_vars.append({
                        "rule_id": "classroom_grade_affinity",
                        "weight": weight_grade_affinity,
                        "var": miss_var,
                    })

                # [Task 04] Primary-teacher affinity miss soft penalty
                pt = room.get("primaryTeacher", "") or ""
                if pt and teacher_name != pt:
                    t_miss_var = model.NewBoolVar(
                        f"teacher_aff_miss_{class_name}_{period_idx}_{room['id']}".replace(" ", "_")
                    )
                    model.Add(t_miss_var >= room_var)
                    penalty_vars.append({
                        "rule_id": "classroom_primary_teacher_affinity",
                        "weight": weight_teacher_affinity,
                        "var": t_miss_var,
                    })

                # [Task 08] Specialty room non-preferred grade penalty with allowSharing semantics (non-alternating)
                allow_sharing = room.get("allowSharing", True)  # default true per YAML §340
                if grade_prefs and cls_grade not in grade_prefs:
                    ns_miss_var_na = model.NewBoolVar(
                        f"specialty_ns_miss_{class_name}_{period_idx}_{room['id']}".replace(" ", "_")
                    )
                    model.Add(ns_miss_var_na >= room_var)
                    # allowSharing=false → higher penalty (still soft, not hard constraint)
                    # TODO: confirm allowSharing=false semantics with Codex before converting to hard constraint
                    ns_weight_na = weight_specialty_non_preferred_grade * 2 if not allow_sharing else weight_specialty_non_preferred_grade
                    penalty_vars.append({
                        "rule_id": "specialty_room_non_preferred_grade",
                        "weight": ns_weight_na,
                        "var": ns_miss_var_na,
                    })

                room_vars.append(room_var)
                room_slot_groups[(room["id"], period_idx, "odd")].append(room_var)
                room_slot_groups[(room["id"], period_idx, "even")].append(room_var)
                model.classroom_assignments.append({
                    "className": class_name,
                    "period": period_idx,
                    "week": "odd",
                    "roomId": room["id"],
                    "roomName": room["name"],
                    "subject": canonical_room_subject,
                    "var": room_var,
                })
                model.classroom_assignments.append({
                    "className": class_name,
                    "period": period_idx,
                    "week": "even",
                    "roomId": room["id"],
                    "roomName": room["name"],
                    "subject": canonical_room_subject,
                    "var": room_var,
                })
            model.Add(sum(room_vars) == active_var)
            continue

        if not alternating_class_is_music_odd or not class_teacher_pair:
            continue

        music_teacher, art_teacher = class_teacher_pair.get(class_name, (teacher_name, teacher_name))
        direction_var = alternating_class_is_music_odd.get((class_name, teacher_name))
        if direction_var is None:
            direction_var = alternating_class_is_music_odd.get((class_name, music_teacher))
        if direction_var is None:
            direction_var = alternating_class_is_music_odd.get((class_name, art_teacher))
        if direction_var is None:
            continue

        parts = [part.strip() for part in str(raw_subject or "").split("/") if str(part or "").strip()]
        if len(parts) == 2:
            subject_a = _canonical_schedule_subject_for_room(parts[0]) or "音樂"
            subject_b = _canonical_schedule_subject_for_room(parts[1]) or "美勞"
        else:
            subject_a, subject_b = "音樂", "美勞"

        odd_a_occ = _new_and_with_bool(
            model,
            active_var,
            direction_var,
            f"room_occ_{class_name}_{period_idx}_odd_{subject_a}".replace(" ", "_"),
        )
        even_b_occ = _new_and_with_bool(
            model,
            active_var,
            direction_var,
            f"room_occ_{class_name}_{period_idx}_even_{subject_b}".replace(" ", "_"),
        )
        odd_b_occ = _new_and_with_negated_bool(
            model,
            active_var,
            direction_var,
            f"room_occ_{class_name}_{period_idx}_odd_{subject_b}".replace(" ", "_"),
        )
        even_a_occ = _new_and_with_negated_bool(
            model,
            active_var,
            direction_var,
            f"room_occ_{class_name}_{period_idx}_even_{subject_a}".replace(" ", "_"),
        )

        occurrence_specs = [
            ("odd", subject_a, music_teacher, odd_a_occ),
            ("even", subject_b, art_teacher, even_b_occ),
            ("odd", subject_b, art_teacher, odd_b_occ),
            ("even", subject_a, music_teacher, even_a_occ),
        ]

        for week_tag, actual_subject, actual_teacher, occ_var in occurrence_specs:
            if not actual_subject:
                model.Add(occ_var == 0)
                continue
            if not grade_needs_special_room(actual_subject, grade, classroom_grades_cfg):
                model.Add(occ_var == 0)
                continue

            candidate_rooms = _select_candidate_rooms_for_occurrence(
                actual_subject,
                class_name,
                grade,
                actual_teacher,
                rooms_by_subject,
            )
            if not candidate_rooms:
                model.Add(occ_var == 0)
                continue

            room_vars = []
            for room in candidate_rooms:
                room_var = model.NewBoolVar(
                    f"room_assign_{class_name}_{period_idx}_{week_tag}_{actual_subject}_{room['id']}".replace(" ", "_")
                )
                model.Add(room_var <= occ_var)

                # [Task 04] Grade affinity miss soft penalty (alternating)
                grade_prefs = room.get("gradePreferences", []) or []
                cls_grade = class_grade_map.get(class_name, 1)
                if grade_prefs and cls_grade not in grade_prefs:
                    miss_var = model.NewBoolVar(
                        f"grade_aff_miss_{class_name}_{period_idx}_{week_tag}_{room['id']}".replace(" ", "_")
                    )
                    model.Add(miss_var >= room_var)
                    penalty_vars.append({
                        "rule_id": "classroom_grade_affinity",
                        "weight": weight_grade_affinity,
                        "var": miss_var,
                    })

                # [Task 08] Specialty room non-preferred grade penalty with allowSharing semantics
                allow_sharing = room.get("allowSharing", True)  # default true per YAML §340
                if grade_prefs and cls_grade not in grade_prefs:
                    ns_miss_var = model.NewBoolVar(
                        f"specialty_ns_miss_{class_name}_{period_idx}_{week_tag}_{room['id']}".replace(" ", "_")
                    )
                    model.Add(ns_miss_var >= room_var)
                    # allowSharing=false → higher penalty (still soft, not hard constraint)
                    # TODO: confirm allowSharing=false semantics with Codex before converting to hard constraint
                    ns_weight = weight_specialty_non_preferred_grade * 2 if not allow_sharing else weight_specialty_non_preferred_grade
                    penalty_vars.append({
                        "rule_id": "specialty_room_non_preferred_grade",
                        "weight": ns_weight,
                        "var": ns_miss_var,
                    })

                # [Task 04] Primary-teacher affinity miss soft penalty (alternating)
                pt = room.get("primaryTeacher", "") or ""
                if pt and actual_teacher != pt:
                    t_miss_var = model.NewBoolVar(
                        f"teacher_aff_miss_{class_name}_{period_idx}_{week_tag}_{room['id']}".replace(" ", "_")
                    )
                    model.Add(t_miss_var >= room_var)
                    penalty_vars.append({
                        "rule_id": "classroom_primary_teacher_affinity",
                        "weight": weight_teacher_affinity,
                        "var": t_miss_var,
                    })

                room_vars.append(room_var)
                room_slot_groups[(room["id"], period_idx, week_tag)].append(room_var)
                model.classroom_assignments.append({
                    "className": class_name,
                    "period": period_idx,
                    "week": week_tag,
                    "roomId": room["id"],
                    "roomName": room["name"],
                    "subject": actual_subject,
                    "var": room_var,
                })
            model.Add(sum(room_vars) == occ_var)

    for vars_in_slot in room_slot_groups.values():
        if vars_in_slot:
            model.Add(sum(vars_in_slot) <= 1)


def apply_science_habits(model, classes_data, schedule, ai_settings=None, penalty_vars=None, solve_mode=None):
    """
    [軟約束 10] 自然課排課習慣（重構版）

    核心設計：
    1. 以「合法連堂配對」為基礎，不再用硬猜的 forbidden_p 邏輯
    2. STRICT mode: natural shape = hard constraint (violation must be 0)
    3. FALLBACK mode: natural shape = near-hard soft penalty (natural_shape_fallback: 16000)
    4. 午休邊界統一使用 LUNCH_BOUNDARY，不再硬編碼
    5. 教師不跨半天規則保留（總節數 <= 2 時）
    6. 「每日結構上限」與「不可跨午休」仍為硬限制
    7. 同一天的自然課若形成 2+1（總數剛好 3 節）視為硬違規

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
        ai_settings: dict with naturalConsecutive flag
        penalty_vars: list for soft penalty accumulation
        solve_mode: SolveMode enum — STRICT_TEACHING_SHAPE makes shape hard;
                    FEASIBILITY_RECOVERY uses policy weight 16000

    Returns:
        science_consec_at_period: dict {p: [BoolVar, ...]} 用於教室容量計算
    """
    # 安全閘：若無自然課則直接返回
    if ai_settings is None:
        ai_settings = {}

    if not ai_settings.get("naturalConsecutive", True):
        return {}

    total_sci_period = 0
    for cls in classes_data:
        total_sci_period += sum(
            int(r.get("periods", 0))
            for r in cls.get("course_requirements", [])
            if "自然" in r.get("subject", "")
        )
    if total_sci_period == 0:
        return {}

    # 收集所有自然相關班級的變數
    science_classes = []
    for cls in classes_data:
        c_name = cls.get("name", "")
        sci_reqs = [r for r in cls.get("course_requirements", []) if "自然" in r.get("subject", "")]
        if not sci_reqs:
            continue

        raw_grade = cls.get("grade")
        if raw_grade is None:
            match = re.search(r'(\d+)年', c_name)
            if match:
                raw_grade = int(match.group(1))
        try:
            grade = int(raw_grade) if raw_grade is not None else 1
        except Exception:
            grade = 1

        total_sci = sum(int(r.get("periods", 0)) for r in sci_reqs)
        from collections import defaultdict
        sci_vars = defaultdict(list)
        for (c, per, t, s), var in schedule.items():
            if c == c_name and "自然" in s:
                sci_vars[per].append(var)
        science_classes.append({
            "name": c_name,
            "grade": grade,
            "total_sci": total_sci,
            "sci_vars": sci_vars,
        })

    # 合法連堂配對
    valid_pairs = _science_valid_consec_pairs()

    # 用於追蹤特定班級在特定時段的連堂狀態：(c_name, p) -> BoolVar
    science_consec_map = {}

    for sci_cls in science_classes:
        c_name = sci_cls["name"]
        grade = sci_cls["grade"]
        total_sci = sci_cls["total_sci"]
        sci_vars = sci_cls["sci_vars"]

        if not sci_vars:
            continue

        # 2+1 代表同一天有連堂自然再外掛一節單堂，屬於明確違規。
        for d in range(DAYS):
            base = d * PERIODS_PER_DAY
            day_vars = []
            for p in range(base, min(base + PERIODS_PER_DAY, TOTAL_PERIODS)):
                day_vars.extend(sci_vars.get(p, []))
            if day_vars:
                model.Add(sum(day_vars) != 3)

        # ---- 建立連堂 BoolVar ----
        consec_vars = {}  # (d, pair_idx) -> BoolVar

        for d in range(DAYS):
            base = d * PERIODS_PER_DAY
            for pair_idx, (p_offset1, p_offset2) in enumerate(valid_pairs):
                p1 = base + p_offset1
                p2 = base + p_offset2
                if not sci_vars[p1] or not sci_vars[p2]:   # list 空即跳過
                    continue

                has_p1 = model.NewBoolVar(f'sci_has_{c_name}_p{p1}')
                has_p2 = model.NewBoolVar(f'sci_has_{c_name}_p{p2}')
                model.AddMaxEquality(has_p1, sci_vars[p1])  # 任一 var 為 1 則 has_p1=1
                model.AddMaxEquality(has_p2, sci_vars[p2])

                cv = model.NewBoolVar(f'sci_consec_{c_name}_d{d}_pair{pair_idx}')
                model.Add(cv <= has_p1)
                model.Add(cv <= has_p2)
                model.Add(cv >= has_p1 + has_p2 - 1)       # 兩端都有才算連堂

                consec_vars[(d, pair_idx)] = cv
                science_consec_map[(c_name, p1)] = cv
                science_consec_map[(c_name, p2)] = cv

        # ---- [Task 02] solve_mode aware natural shape constraint ----
        # STRICT mode: natural shape = hard constraint
        # FALLBACK mode: natural shape = near-hard soft penalty (from policy adapter)
        from scheduler_policy import SolveMode, get_active_policy
        
        if grade in [3, 4]:
            all_consec = list(consec_vars.values())
            if all_consec:
                # 每天最多加起來 <= 1 組連堂（硬限制：結構上限）
                for d in range(DAYS):
                    d_consec = [consec_vars[(d, pi)] for pi in range(len(valid_pairs))
                               if (d, pi) in consec_vars]
                    if d_consec:
                        model.Add(sum(d_consec) <= 1)
                
                if solve_mode == SolveMode.STRICT_TEACHING_SHAPE:
                    # STRICT: hard constraint — must have at least 1 consecutive pair
                    model.Add(sum(all_consec) >= 1)
                else:
                    # FALLBACK or legacy: soft penalty from policy adapter
                    policy = get_active_policy(solve_mode)
                    weight = policy.get_weight("natural_shape_fallback", default=800)
                    has_sci_consec = model.NewBoolVar(f'sci_consec_ok_{c_name}')
                    model.Add(sum(all_consec) >= 1).OnlyEnforceIf(has_sci_consec)
                    if penalty_vars is not None:
                        no_sci = model.NewIntVar(0, 1, f"no_natural_shape_{c_name.replace(' ','_')}")
                        model.Add(no_sci == 1 - has_sci_consec)
                        penalty_vars.append({
                            "rule_id": "natural_shape_fallback",
                            "weight": weight,
                            "var": no_sci,
                        })

        elif grade in [5, 6]:
            all_consec = list(consec_vars.values())
            if all_consec:
                # 每天上限 2 組（硬限制：結構上限）
                for d in range(DAYS):
                    d_consec = [consec_vars[(d, pi)] for pi in range(len(valid_pairs))
                               if (d, pi) in consec_vars]
                    if d_consec:
                        model.Add(sum(d_consec) <= 2)
                
                if solve_mode == SolveMode.STRICT_TEACHING_SHAPE:
                    # STRICT: hard constraint — must have at least 2 consecutive pairs
                    model.Add(sum(all_consec) >= 2)
                else:
                    # FALLBACK or legacy: soft penalty from policy adapter
                    policy = get_active_policy(solve_mode)
                    weight = policy.get_weight("natural_shape_fallback", default=1200)
                    has_sci_consec = model.NewBoolVar(f'sci_consec_ok_{c_name}')
                    model.Add(sum(all_consec) >= 2).OnlyEnforceIf(has_sci_consec)
                    if penalty_vars is not None:
                        no_sci = model.NewIntVar(0, 1, f"no_natural_shape_{c_name.replace(' ','_')}")
                        model.Add(no_sci == 1 - has_sci_consec)
                        penalty_vars.append({
                            "rule_id": "natural_shape_fallback",
                            "weight": weight,
                            "var": no_sci,
                        })

        # ---- 教師不跨半天規則（保留原邏輯，改用 LUNCH_BOUNDARY） ----
        sci_teachers = set()
        for (c, per, t, s), var in schedule.items():
            if c == c_name and "自然" in s:
                sci_teachers.add(t)

        for t_name in sci_teachers:
            for d in range(DAYS):
                base = d * PERIODS_PER_DAY
                t_sci_today = [var for (c, per, t, s), var in schedule.items()
                              if t == t_name and "自然" in s and c == c_name
                              and base <= per < base + PERIODS_PER_DAY]
                if not t_sci_today:
                    continue

                t_sci_am = [var for (c, per, t, s), var in schedule.items()
                           if t == t_name and "自然" in s and c == c_name
                           and base <= per < base + LUNCH_BOUNDARY]
                t_sci_pm = [var for (c, per, t, s), var in schedule.items()
                           if t == t_name and "自然" in s and c == c_name
                           and base + LUNCH_BOUNDARY <= per < base + PERIODS_PER_DAY]

                if t_sci_am and t_sci_pm:
                    has_am = model.NewBoolVar(f'sci_has_am_{t_name}_d{d}')
                    has_pm = model.NewBoolVar(f'sci_has_pm_{t_name}_d{d}')
                    model.AddMaxEquality(has_am, t_sci_am)
                    model.AddMaxEquality(has_pm, t_sci_pm)

                    cross_half_day = model.NewBoolVar(f'sci_cross_{t_name}_d{d}')
                    model.AddBoolAnd([has_am, has_pm]).OnlyEnforceIf(cross_half_day)
                    model.AddBoolOr([has_am.Not(), has_pm.Not()]).OnlyEnforceIf(cross_half_day.Not())

                    if total_sci <= 2:
                        model.Add(cross_half_day == 0)
                    else:
                        model.Add(sum(t_sci_today) >= 3).OnlyEnforceIf(cross_half_day)

    return science_consec_map


def get_art_room_capacity(subject, classrooms, classroom_limits=None, school_info=None):
    """
    [Task 2 / L0-2] 取得音樂或美勞專科教室的間數。

    這是 odd/even 教室容量的唯一來源（single source of truth）。
    solver 建模、後驗報告、前端報表三處必須都呼叫此函式，不得各自硬編碼。

    Args:
        subject: "音樂" 或 "美勞"
        classrooms: list of room dicts with subject field
        classroom_limits: dict {subject: limit} (optional)
        school_info: dict with subjectClassroomGrades (optional)

    Returns:
        int: 教室間數（不含 *2 容量換算）
    """
    normalized = _normalize_special_room_subject(subject)
    if normalized not in ("音樂", "美勞"):
        return 0

    # 1. 實際實體教室數量
    count = sum(1 for room in (classrooms or [])
                if _normalize_special_room_subject(room.get("subject", "")) == normalized)

    # 2. 若無實體教室，嘗試 classroom_limits
    if count <= 0 and classroom_limits:
        for subj_raw, limit in classroom_limits.items():
            if _normalize_special_room_subject(subj_raw) == normalized:
                try:
                    count = int(limit)
                except (TypeError, ValueError):
                    pass

    # 3. Fallback — 規格書 v1.1 定義預設值為 1（非 2）
    if count <= 0:
        count = 1

    return count


def apply_week_specific_art_capacity_model(
    model,
    classes_data,
    schedule,
    classrooms,
    alternating_class_is_music_odd,
    class_grade_map,
    penalty_vars,
    classroom_limits=None,
):
    """
    [Task 2 / L0-2] 將 week-specific 音美教室容量約束建入 OR-Tools CpModel。

    以 preferred（高懲罰 10000）軟約束方式，確保 odd/even 週別的音樂/美勞
    教室需求不超過物理容量。這是 main solver 內的建模層，不是後驗檢查。

    Args:
        model: ortools CpModel
        classes_data: list of class dicts
        schedule: dict[(c,p,t,s), BoolVar]
        classrooms: list of room dicts
        alternating_class_is_music_odd: dict[(c_name, t_name), BoolVar]
        class_grade_map: dict[c_name, int]
        penalty_vars: list，懲罰項追加至此
        classroom_limits: optional dict

    Returns:
        dict[(label, p), IntVar]: ws_overload_vars，供後驗查詢
    """
    if not alternating_class_is_music_odd:
        return {}

    from config import TOTAL_PERIODS, PERIODS_PER_DAY

    music_cap = get_art_room_capacity("音樂", classrooms, classroom_limits)
    art_cap = get_art_room_capacity("美勞", classrooms, classroom_limits)

    # 建立班級 → is_music_odd BoolVar 對照（取主老師 key）
    class_music_odd_var = {}
    for (c_name, t_name), bvar in alternating_class_is_music_odd.items():
        if c_name not in class_music_odd_var:
            class_music_odd_var[c_name] = bvar

    classroom_grades_cfg = {}
    for cls in classes_data:
        ci = cls.get("schoolInfo", {})
        if ci:
            classroom_grades_cfg = ci.get("subjectClassroomGrades", {}) or {}
            break

    ws_overload_vars = {}

    for p in range(TOTAL_PERIODS):
        music_odd_vars, music_even_vars = [], []
        art_odd_total_vars, art_even_total_vars = [], []

        # 交替課：拆分為 odd/even 音樂與美勞占用
        for (c, per, t, s), var in schedule.items():
            if per != p or "音樂美勞_交替" not in s:
                continue
            is_odd = class_music_odd_var.get(c)
            if is_odd is None:
                continue

            # odd week 音樂占用 = var AND is_odd
            m_odd = model.NewBoolVar(f"ws_m_odd_{c.replace(' ','_')}_p{p}")
            model.Add(m_odd >= var + is_odd - 1)
            model.Add(m_odd <= var)
            model.Add(m_odd <= is_odd)
            music_odd_vars.append(m_odd)

            # even week 音樂占用 = var AND NOT is_odd
            is_odd_not = model.NewBoolVar(f"ws_is_odd_not_{c.replace(' ','_')}_p{p}")
            model.Add(is_odd_not == 1 - is_odd)
            m_even = model.NewBoolVar(f"ws_m_even_{c.replace(' ','_')}_p{p}")
            model.Add(m_even >= var + is_odd_not - 1)
            model.Add(m_even <= var)
            model.Add(m_even <= is_odd_not)
            music_even_vars.append(m_even)

            # 美勞占用與音樂互補（交替課）
            art_odd_total_vars.append(m_even)   # odd week 美勞 = even week 音樂
            art_even_total_vars.append(m_odd)   # even week 美勞 = odd week 音樂

        # 固定課：每週都占美勞教室
        for (c, per, t, s), var in schedule.items():
            if per != p or "美勞_固定" not in s:
                continue
            grade = class_grade_map.get(c, 1)
            # "美勞" is already room-canonical (Traditional Chinese), pass directly to grade_needs_special_room
            if grade_needs_special_room("美勞", grade, classroom_grades_cfg):
                art_odd_total_vars.append(var)
                art_even_total_vars.append(var)

        # [Task 02] 容量約束（改為 Hard Constraint，消除物理碎片化斷層）
        for label, demand_vars, capacity in [
            ("music_odd", music_odd_vars, music_cap),
            ("music_even", music_even_vars, music_cap),
            ("art_odd", art_odd_total_vars, art_cap),
            ("art_even", art_even_total_vars, art_cap),
        ]:
            if not demand_vars:
                continue
            model.Add(sum(demand_vars) <= capacity)

    return {}


def apply_week_specific_art_capacity(
    schedule_solution,
    classes_data,
    alternating_class_is_music_odd,
    classrooms,
    classroom_limits=None,
    school_info=None,
):
    """
    [Task 2 / L0-2] Week-specific 音美教室容量後驗檢查。

    在主 solver 產出可行解後，逐週檢查音樂/美勞教室是否超載。
    - Odd week: is_music_odd=1 → 該節上音樂；is_music_odd=0 → 該節上美勞
    - Even week: 方向翻轉

    此函式不修改 solver 模型，只回傳診斷報告。

    Args:
        schedule_solution: dict (c, p, t, s) -> bool (solver.Value 結果)
        classes_data: list of class dicts
        alternating_class_is_music_odd: dict (class_name, teacher_name) -> BoolVar
        classrooms: list of room dicts
        classroom_limits: optional dict
        school_info: optional dict

    Returns:
        dict: {
            "ws_overload": int,           # 總超載節次數
            "overload_details": [...],    # 每筆超載明細
            "music_capacity": int,
            "art_capacity": int,
        }
    """
    music_cap = get_art_room_capacity("音樂", classrooms, classroom_limits, school_info)
    art_cap = get_art_room_capacity("美勞", classrooms, classroom_limits, school_info)

    # 建立班級→年級 map
    class_grade_map = {}
    for cls in classes_data:
        c_name = cls.get("name", "")
        raw_grade = cls.get("grade")
        if raw_grade is None:
            match = re.search(r'(\d+)年', c_name)
            if match:
                raw_grade = int(match.group(1))
        try:
            grade = int(raw_grade) if raw_grade is not None else 1
        except Exception:
            grade = 1
        class_grade_map[c_name] = grade

    classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}

    # 逐週檢查
    overload_details = []
    ws_overload = 0

    for week_type in ("odd", "even"):
        # 統計每一節的音樂/美勞使用量
        period_music_usage = defaultdict(int)
        period_art_usage = defaultdict(int)

        for (c, p, t, s), solved in schedule_solution.items():
            if not solved:
                continue

            canonical = _canonical_schedule_subject_for_room(s)
            if canonical not in ("音樂", "美勞"):
                continue

            grade = class_grade_map.get(c, 1)
            # canonical is already room-canonical (Traditional Chinese), pass directly to grade_needs_special_room
            if not grade_needs_special_room(canonical, grade, classroom_grades_cfg):
                continue

            # 判斷交替課在該週實際是什麼科目
            actual_subject = canonical
            if "交替" in s or "/" in s:
                var = alternating_class_is_music_odd.get((c, t))
                if var is not None:
                    direction = 1 if hasattr(var, 'Value') else 0
                    try:
                        direction = var.Value() if hasattr(var, 'Value') and callable(var.Value) else int(bool(var))
                    except Exception:
                        direction = 0

                    if week_type == "odd":
                        actual_subject = "音樂" if direction == 1 else "美勞"
                    else:
                        actual_subject = "美勞" if direction == 1 else "音樂"

            if actual_subject == "音樂":
                period_music_usage[p] += 1
            elif actual_subject == "美勞":
                period_art_usage[p] += 1

        # 檢查超載
        for p in range(TOTAL_PERIODS):
            music_used = period_music_usage.get(p, 0)
            art_used = period_art_usage.get(p, 0)

            if music_used > music_cap:
                overload = music_used - music_cap
                ws_overload += overload
                overload_details.append({
                    "week": week_type,
                    "period": p,
                    "day": p // PERIODS_PER_DAY + 1,
                    "periodInDay": p % PERIODS_PER_DAY + 1,
                    "subject": "音樂",
                    "used": music_used,
                    "capacity": music_cap,
                    "overload": overload,
                })

            if art_used > art_cap:
                overload = art_used - art_cap
                ws_overload += overload
                overload_details.append({
                    "week": week_type,
                    "period": p,
                    "day": p // PERIODS_PER_DAY + 1,
                    "periodInDay": p % PERIODS_PER_DAY + 1,
                    "subject": "美勞",
                    "used": art_used,
                    "capacity": art_cap,
                    "overload": overload,
                })

    return {
        "ws_overload": ws_overload,
        "overload_details": overload_details,
        "music_capacity": music_cap,
        "art_capacity": art_cap,
    }


def apply_week_specific_art_capacity_entries(
    schedule_entries,
    classes_data,
    classrooms,
    classroom_limits=None,
    school_info=None,
):
    """
    以最終輸出的 schedule entries 進行 week-specific 音美教室後驗檢查。

    這個版本不依賴 OR-Tools BoolVar 方向值，而是直接使用已展開的
    odd/even 週別課表條目，避免 local optimizer 調整後與後驗檢查口徑不一致。
    """
    music_cap = get_art_room_capacity("音樂", classrooms, classroom_limits, school_info)
    art_cap = get_art_room_capacity("美勞", classrooms, classroom_limits, school_info)

    class_grade_map = {}
    for cls in classes_data:
        c_name = cls.get("name", "")
        raw_grade = cls.get("grade")
        if raw_grade is None:
            match = re.search(r'(\d+)年', c_name)
            if match:
                raw_grade = int(match.group(1))
        try:
            grade = int(raw_grade) if raw_grade is not None else 1
        except Exception:
            grade = 1
        class_grade_map[c_name] = grade

    classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}
    overload_details = []
    ws_overload = 0

    def _normalize_week_tag(week):
        value = str(week or "both").strip().lower()
        if value in ("odd", "single", "oddweek", "單", "單週"):
            return "odd"
        if value in ("even", "double", "evenweek", "雙", "雙週"):
            return "even"
        return "both"

    for week_type in ("odd", "even"):
        period_music_usage = defaultdict(int)
        period_art_usage = defaultdict(int)

        for entry in schedule_entries or []:
            canonical = _canonical_schedule_subject_for_room(entry.get("subject", ""))
            if canonical not in ("音樂", "美勞"):
                continue

            class_name = str(entry.get("className", "")).strip()
            grade = class_grade_map.get(class_name, 1)
            # canonical is already room-canonical (Traditional Chinese), pass directly to grade_needs_special_room
            if not grade_needs_special_room(canonical, grade, classroom_grades_cfg):
                continue

            entry_week = _normalize_week_tag(entry.get("week"))
            if entry_week not in ("both", week_type):
                continue

            day = int(entry.get("day", 0) or 0)
            period_in_day = int(entry.get("period", 0) or 0)
            if day <= 0 or period_in_day <= 0:
                continue
            period = (day - 1) * PERIODS_PER_DAY + (period_in_day - 1)

            if canonical == "音樂":
                period_music_usage[period] += 1
            else:
                period_art_usage[period] += 1

        for period in range(TOTAL_PERIODS):
            music_used = period_music_usage.get(period, 0)
            art_used = period_art_usage.get(period, 0)

            if music_used > music_cap:
                overload = music_used - music_cap
                ws_overload += overload
                overload_details.append({
                    "week": week_type,
                    "period": period,
                    "day": period // PERIODS_PER_DAY + 1,
                    "periodInDay": period % PERIODS_PER_DAY + 1,
                    "subject": "音樂",
                    "used": music_used,
                    "capacity": music_cap,
                    "overload": overload,
                })

            if art_used > art_cap:
                overload = art_used - art_cap
                ws_overload += overload
                overload_details.append({
                    "week": week_type,
                    "period": period,
                    "day": period // PERIODS_PER_DAY + 1,
                    "periodInDay": period % PERIODS_PER_DAY + 1,
                    "subject": "美勞",
                    "used": art_used,
                    "capacity": art_cap,
                    "overload": overload,
                })

    return {
        "ws_overload": ws_overload,
        "overload_details": overload_details,
        "music_capacity": music_cap,
        "art_capacity": art_cap,
    }


__all__ = [
    "apply_daily_subject_limit",
    "apply_afternoon_prohibition",
    "apply_no_consecutive_subject",
    "apply_special_classroom_capacity",
    "apply_science_habits",
    "get_effective_class_period_capacity",
    "get_art_room_capacity",
    "get_forbidden_afternoon_days",
    "resolve_class_grade",
    "apply_week_specific_art_capacity_model",
    "apply_week_specific_art_capacity",
    "apply_week_specific_art_capacity_entries",
    # Task 3.2~3.9: soft rule helpers
    "is_homeroom_lesson",
    "is_subject_teacher_lesson",
    "build_grade_morning_first_period_homeroom_penalty",
    "build_morning_two_homeroom_periods_penalty",
    "build_co_planning_afternoon_block_penalty",
    "build_co_planning_subject_lesson_penalty",
    "build_homeroom_daily_max_periods_penalty",
    "build_manual_co_planning_penalty",
    # Task 07: grade1-2 Tuesday life-course & daily subject-teacher minimum
    "apply_grade12_tuesday_life_course",
    "build_daily_subject_teacher_minimum_penalty",
    # Subject Day-Spread Hard Constraint
    "apply_subject_day_spread",
    "apply_music_fixed_vs_alternating_day_spread",
]


# ============================================================
# Task 3.2: Homeroom / Subject-Teacher Lesson Type Helpers
# ============================================================

def is_homeroom_lesson(lesson: dict) -> bool:
    """
    判斷一筆課程需求是否為導師型課程。

    識別方式（任一滿足即為 True）：
    - subject == "導師區塊"
    - defaultTeacher == "homeroom"

    保守預設：未知類型回傳 False。
    """
    if not lesson or not isinstance(lesson, dict):
        return False
    subj = (lesson.get("subject") or "").strip()
    default_t = (lesson.get("defaultTeacher") or "").strip()
    return subj == "導師區塊" or default_t == "homeroom"


def is_subject_teacher_lesson(lesson: dict) -> bool:
    """
    判斷一筆課程需求是否為科任教師課程。

    識別方式：
    - defaultTeacher == "subject"
    - 且 NOT is_homeroom_lesson(lesson)

    保守預設：未知類型回傳 False。
    """
    if not lesson or not isinstance(lesson, dict):
        return False
    if is_homeroom_lesson(lesson):
        return False
    default_t = (lesson.get("defaultTeacher") or "").strip()
    return default_t == "subject"


# ============================================================
# Task 3.3: 3-6 年級每週一天第一節導師課偏好 (soft)
# ============================================================

def build_grade_morning_first_period_homeroom_penalty(
    model,
    schedule,
    classes_data,
    configurable_grades=None,
):
    """
    為每個配置年級建立 soft objective：
    偏好某一年級的所有班級在某一天的 period 1（index 0）排入導師課。

    Returns: list of {"rule_id": str, "weight": int, "var": IntVar}
    """
    if configurable_grades is None:
        configurable_grades = [3, 4, 5, 6]

    weight = WEIGHT_REGISTRY.get("grade_morning_first_period_homeroom_day", 3500)
    penalty_vars = []

    # Build grade -> classes mapping
    grade_classes = defaultdict(list)
    for cls in classes_data:
        g = resolve_class_grade(cls)
        if g in configurable_grades:
            grade_classes[g].append(cls.get("name", ""))

    # Collect homeroom subjects from payload
    homeroom_subjects = set()
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            if is_homeroom_lesson(req):
                homeroom_subjects.add(req.get("subject", ""))

    if not homeroom_subjects:
        # Fallback: use common name
        homeroom_subjects = {"導師區塊"}

    for grade, class_names in grade_classes.items():
        if not class_names:
            continue

        grade_has_any_hr = False
        day_satisfied_vars = []
        for day in range(DAYS):
            class_has_hr_list = []
            for c_name in class_names:
                # Period 1 of this day = index day * PERIODS_PER_DAY + 0
                p_index = day * PERIODS_PER_DAY
                # Find if any homeroom lesson is scheduled here
                is_hr_vars = []
                for (c, p, t, s), var in schedule.items():
                    if c == c_name and p == p_index and s in homeroom_subjects:
                        is_hr_vars.append(var)

                has_hr = model.NewBoolVar(f"grade{grade}_day{day+1}_{c_name}_has_hr_p1")
                if is_hr_vars:
                    grade_has_any_hr = True
                    slot_sum = model.NewIntVar(0, len(is_hr_vars), f"grade{grade}_day{day+1}_{c_name}_hr_sum")
                    model.Add(slot_sum == sum(is_hr_vars))
                    model.Add(slot_sum >= 1).OnlyEnforceIf(has_hr)
                    model.Add(slot_sum == 0).OnlyEnforceIf(has_hr.Not())
                else:
                    model.Add(has_hr == 0)
                class_has_hr_list.append(has_hr)

            day_satisfied = model.NewBoolVar(f"grade{grade}_day{day+1}_all_homeroom_p1")
            for has_hr in class_has_hr_list:
                model.AddImplication(day_satisfied, has_hr)
            model.AddBoolOr([has_hr.Not() for has_hr in class_has_hr_list] + [day_satisfied])
            day_satisfied_vars.append(day_satisfied)

        if grade_has_any_hr and day_satisfied_vars:
            any_day_satisfied = model.NewBoolVar(f"grade{grade}_any_day_homeroom_p1")
            model.AddMaxEquality(any_day_satisfied, day_satisfied_vars)
            violation = model.NewIntVar(0, 1, f"grade{grade}_no_homeroom_p1_day_violation")
            model.Add(violation == 1 - any_day_satisfied)
            penalty_vars.append({
                "rule_id": "grade_morning_first_period_homeroom_day",
                "weight": max(weight // max(len(configurable_grades), 1), 1),
                "var": violation,
            })

    return penalty_vars


# ============================================================
# Task 3.8: 導師每日最大節次軟懲罰 (soft)
# ============================================================

def build_homeroom_daily_max_periods_penalty(
    model,
    schedule,
    classes_data,
    max_periods=4,
):
    """
    導師每日超過 max_periods 節時產生 soft penalty。

    語意：對每位 type==homeroom 的老師，按「該老師每天實際授課的占用節次」計數。
    violation = max(0, occupied_count - max_periods)

    這不等於「某班有幾節導師型科目」；而是「導師本人在該日實際被排了幾節課」。
    若導師兼多班，各班的授課節次會累加。

    Args:
        model: ortools CpModel
        schedule: dict[(c,p,t,s), BoolVar]
        classes_data: list of class dicts
        max_periods: 每日導師課程上限（預設 4）

    Returns: list of {"rule_id": str, "weight": int, "var": IntVar}
    """
    weight = WEIGHT_REGISTRY.get("homeroom_daily_max_periods", 3200)
    penalty_vars = []

    # Step 1: Collect all homeroom teacher names
    # A teacher is homeroom if they appear as homeroom_teacher in any class
    homeroom_teachers = set()
    for cls in classes_data:
        ht = cls.get("homeroom_teacher") or cls.get("homeroom_teacher_id") or ""
        if ht:
            homeroom_teachers.add(str(ht).strip())

    if not homeroom_teachers:
        return []

    # Step 2: For each homeroom teacher, for each day, count occupied slots
    for teacher in homeroom_teachers:
        for day in range(DAYS):
            day_start = day * PERIODS_PER_DAY
            day_end = day_start + PERIODS_PER_DAY

            # Collect all schedule vars where this teacher teaches on this day
            teacher_vars = [
                var for (c, p, t, s), var in schedule.items()
                if str(t).strip() == teacher and day_start <= p < day_end
            ]

            if not teacher_vars:
                continue

            count_var = model.NewIntVar(
                0, len(teacher_vars),
                f"hr_teacher_daily_count_{teacher}_day{day+1}"
            )
            model.Add(count_var == sum(teacher_vars))

            overload = model.NewIntVar(
                0, len(teacher_vars),
                f"hr_teacher_daily_overload_{teacher}_day{day+1}"
            )
            model.Add(overload >= count_var - max_periods)
            model.Add(overload >= 0)

            penalty_vars.append({
                "rule_id": "homeroom_daily_max_periods",
                "weight": weight // (len(homeroom_teachers) * DAYS),
                "var": overload,
            })

    return penalty_vars


# ============================================================
# Task 3.9: Manual Co-Planning Block Penalty (near-hard soft)
# ============================================================

def build_manual_co_planning_penalty(
    model,
    schedule,
    classes_data,
    school_info=None,
):
    """
    當 coPlanningSettings.mode == "manual" 時，對 manualBlocks 指定的區塊
    施加 near-hard soft penalty：該年級所有班級在該時段內偏好排入科任課。

    Args:
        model: ortools CpModel
        schedule: dict[(c,p,t,s), BoolVar]
        classes_data: list of class dicts
        school_info: dict with coPlanningSettings

    Returns: list of {"rule_id": str, "weight": int, "var": IntVar}
    """
    co_settings = _parse_co_planning_settings(school_info)

    if not co_settings["enabled"]:
        return []

    if co_settings["mode"] != "manual":
        return []

    manual_blocks = co_settings.get("manualBlocks", {})
    if not manual_blocks:
        return []

    weight = WEIGHT_REGISTRY.get("manual_co_planning_subject_teacher_lesson", 9000)
    penalty_vars = []

    grade_classes = defaultdict(list)
    for cls in classes_data:
        g = resolve_class_grade(cls)
        grade_classes[g].append(cls.get("name", ""))

    subject_teacher_subjects = set()
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            if is_subject_teacher_lesson(req):
                subject_teacher_subjects.add(req.get("subject", ""))

    for grade, block in manual_blocks.items():
        if block is None:
            continue

        class_names = grade_classes.get(grade, [])
        if not class_names:
            continue

        day_1based = block["day"]
        start_p_1based = block["startPeriod"]

        day_idx = day_1based - 1 if 1 <= day_1based <= DAYS else None
        if day_idx is None:
            continue

        p_start_idx = day_idx * PERIODS_PER_DAY + (start_p_1based - 1)
        block_periods = [p_start_idx, p_start_idx + 1]

        for c_name in class_names:
            for p_index in block_periods:
                if p_index >= TOTAL_PERIODS:
                    continue

                subject_vars = [
                    var for (c, p, t, s), var in schedule.items()
                    if c == c_name and p == p_index and s in subject_teacher_subjects
                ]

                has_subject = model.NewBoolVar(f"manual_co_plan_subject_{grade}_{c_name}_p{p_index}")
                if subject_vars:
                    subject_sum = model.NewIntVar(0, len(subject_vars), f"manual_co_plan_subjectSum_{grade}_{c_name}_p{p_index}")
                    model.Add(subject_sum == sum(subject_vars))
                    model.Add(subject_sum >= 1).OnlyEnforceIf(has_subject)
                    model.Add(subject_sum == 0).OnlyEnforceIf(has_subject.Not())
                else:
                    model.Add(has_subject == 0)

                penalty_var = model.NewBoolVar(
                    f"manual_co_plan_penalty_{grade}_{c_name}_p{p_index}"
                )
                model.Add(penalty_var == 1 - has_subject)

                penalty_vars.append({
                    "rule_id": "manual_co_planning_subject_teacher_lesson",
                    "weight": weight // max(len(classes_data), 1),
                    "var": penalty_var,
                })

    return penalty_vars


# ============================================================
# Task 3.4: 每班每日早上兩節導師型課程偏好 (soft)
# ============================================================

def build_morning_two_homeroom_periods_penalty(
    model,
    schedule,
    classes_data,
    configurable_grades=None,
):
    """
    每個 regular class 在每天的 morning periods（index 0-3）中，
    偏好恰好有 2 節為 homeroom-type 課程。

    penalty += abs(count - 2) * weight

    Returns: list of {"rule_id": str, "weight": int, "var": IntVar}
    """
    if configurable_grades is None:
        configurable_grades = [1, 2, 3, 4, 5, 6]

    weight = WEIGHT_REGISTRY.get("morning_two_homeroom_periods_per_day", 3000)
    penalty_vars = []

    # Collect homeroom subjects
    homeroom_subjects = set()
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            if is_homeroom_lesson(req):
                homeroom_subjects.add(req.get("subject", ""))

    if not homeroom_subjects:
        homeroom_subjects = {"導師區塊"}

    # Morning period indices within a day (0-based within day)
    morning_period_indices = list(range(min(4, PERIODS_PER_DAY)))

    for cls in classes_data:
        c_name = cls.get("name", "")
        g = resolve_class_grade(cls)
        if g not in configurable_grades:
            continue

        for day in range(DAYS):
            # Count homeroom lessons in morning periods
            count_var = model.NewIntVar(0, len(morning_period_indices), f"morning_hr_count_{c_name}_day{day+1}")
            count_terms = []
            for mp in morning_period_indices:
                p_index = day * PERIODS_PER_DAY + mp
                hr_vars_at_slot = []
                for (c, p, t, s), var in schedule.items():
                    if c == c_name and p == p_index and s in homeroom_subjects:
                        hr_vars_at_slot.append(var)
                if hr_vars_at_slot:
                    # Max of homeroom vars at this slot (at most 1 can be 1)
                    count_terms.extend(hr_vars_at_slot)

            model.Add(count_var == sum(count_terms))

            # Absolute deviation from target 2
            slack_pos = model.NewIntVar(0, len(morning_period_indices), f"morning_hr_slack_pos_{c_name}_day{day+1}")
            slack_neg = model.NewIntVar(0, len(morning_period_indices), f"morning_hr_slack_neg_{c_name}_day{day+1}")
            model.Add(slack_pos - slack_neg == count_var - 2)
            abs_dev = model.NewIntVar(0, len(morning_period_indices), f"morning_hr_absdev_{c_name}_day{day+1}")
            model.Add(abs_dev == slack_pos + slack_neg)

            penalty_vars.append({
                "rule_id": "morning_two_homeroom_periods_per_day",
                "weight": weight // (len(configurable_grades) * DAYS),
                "var": abs_dev,
            })

    return penalty_vars


# ============================================================
# Task 07: Grade 1-2 Tuesday Afternoon Life-Course Rule
# Strict pass: hard constraint — life course MUST be placed in Tuesday afternoon
# Fallback pass: near-hard soft penalty (weight=14000)
# ============================================================

def apply_grade12_tuesday_life_course(
    model,
    classes_data,
    schedule,
    solve_mode=None,
):
    """
    Grade 1-2 Tuesday afternoon life-course placement rule.

    Strict mode: Hard constraint — at least one `生活` period for Grade 1-2
        must be scheduled on Tuesday afternoon (periods >= LUNCH_BOUNDARY).

    Fallback mode: Near-hard soft penalty with weight=14000.

    P2 semantic correction: This rule requires Tuesday afternoon slots to be
    occupied by `生活`, but does NOT forbid `生活` from appearing in other periods.
    If `生活` demand exceeds Tuesday afternoon capacity, excess goes elsewhere.

    Args:
        solve_mode: SolveMode.STRICT_TEACHING_SHAPE or SolveMode.FEASIBILITY_RECOVERY

    Returns: list of penalty entries (empty for strict mode, soft entries for fallback)
    """
    # Fix #1: support both SolveMode enum and string fallback
    if solve_mode is None:
        solve_mode = SolveMode.STRICT_TEACHING_SHAPE

    is_strict = (
        solve_mode == SolveMode.STRICT_TEACHING_SHAPE
        or solve_mode == "strict_teaching_shape"
    )

    target_grades = {1, 2}
    target_subject = "生活"
    tuesday_day_idx = 1  # 0-based: Mon=0, Tue=1 (consistent with get_forbidden_afternoon_days)

    penalty_output = []

    for cls in classes_data:
        g = resolve_class_grade(cls)
        if g not in target_grades:
            continue

        c_name = cls.get("name", "")
        if not c_name:
            continue

        # Check if this class has `生活` course requirement
        has_life_course = False
        for req in cls.get("course_requirements", []):
            if req.get("subject", "") == target_subject:
                has_life_course = True
                break

        if not has_life_course:
            continue

        # Find all schedule vars for (class, subject=生活) on Tuesday afternoon
        tuesday_afternoon_vars = []
        for (c, p, t, s), var in schedule.items():
            if c != c_name:
                continue
            if s != target_subject:
                continue
            # Check if period is on Tuesday (day=1, 0-based) and afternoon
            day_idx = p // PERIODS_PER_DAY
            period_in_day = p % PERIODS_PER_DAY
            if day_idx == 1 and period_in_day >= LUNCH_BOUNDARY:
                tuesday_afternoon_vars.append(var)

        if not tuesday_afternoon_vars:
            continue

        if is_strict:
            # Hard constraint: at least one life course on Tuesday afternoon
            model.Add(sum(tuesday_afternoon_vars) >= 1)
        else:
            # Fix #2: Fallback near-hard soft penalty using proper BoolVar
            weight = WEIGHT_REGISTRY.get("grade12_tuesday_afternoon_life_course_fallback", 14000)

            has_life_pm = model.NewBoolVar(
                f"has_life_pm_{c_name}_tuesday"
            )
            model.Add(sum(tuesday_afternoon_vars) >= 1).OnlyEnforceIf(has_life_pm)
            model.Add(sum(tuesday_afternoon_vars) == 0).OnlyEnforceIf(has_life_pm.Not())

            violation = model.NewIntVar(0, 1, f"life_course_violation_{c_name}_tuesday_pm")
            model.Add(violation == 1 - has_life_pm)

            penalty_output.append({
                "rule_id": "grade12_tuesday_afternoon_life_course_fallback",
                "weight": weight,
                "var": violation,
            })

    return penalty_output


# ============================================================
# Task 07: Daily Subject-Teacher Minimum (soft objective)
# Each class each day should have at least 1 subject_teacher_lesson
# Excludes homeroom and 導師區塊
# ============================================================

def build_daily_subject_teacher_minimum_penalty(
    model,
    schedule,
    classes_data,
):
    """
    Day-level count soft objective: each class each day should have
    at least one subject-teacher lesson (excluding homeroom / 導師區塊).

    Penalty when count < 1. Weight = 3000 from WEIGHT_REGISTRY.

    Returns: list of {"rule_id": str, "weight": int, "var": IntVar}
    """
    # Fix #4: build class+subject -> requirement metadata map from course_requirements
    req_map = {}  # (class_name, subject) -> requirement dict
    for cls in classes_data:
        c_name = cls.get("name", "")
        if not c_name:
            continue
        for req in cls.get("course_requirements", []):
            subj = req.get("subject", "")
            if subj:
                req_map[(c_name, subj)] = req

    weight = WEIGHT_REGISTRY.get("daily_subject_teacher_minimum", 3000)
    penalty_vars = []

    for cls in classes_data:
        c_name = cls.get("name", "")
        if not c_name:
            continue

        # Skip arts classes (they have different scheduling rules)
        is_arts = cls.get("isArtsClass") or cls.get("is_arts_class", False)
        if is_arts:
            continue

        for day in range(DAYS):
            day_start = day * PERIODS_PER_DAY
            day_end = day_start + PERIODS_PER_DAY

            # Fix #4: Count only true subject-teacher lessons using req_map
            subject_vars = []
            for (c, p, t, s), var in schedule.items():
                if c != c_name:
                    continue
                if p < day_start or p >= day_end:
                    continue
                # Only count if req_map has metadata AND is_subject_teacher_lesson returns True.
                # Do NOT guess from subject name when req is None — this avoids counting
                # "班會" or other non-subject-teacher lessons as subject_teacher_lesson.
                req = req_map.get((c_name, s))
                if req is not None and is_subject_teacher_lesson(req):
                    subject_vars.append(var)

            # If no identifiable subject_teacher_lesson candidates for this class-day,
            # the minimum can never be satisfied — create a permanent violation (weight applied).
            if not subject_vars:
                always_violate = model.NewBoolVar(
                    f"subj_tchr_always_violation_{c_name}_day{day+1}"
                )
                model.Add(always_violate == 1)
                penalty_vars.append({
                    "rule_id": "daily_subject_teacher_minimum",
                    "weight": weight // (len(classes_data) * DAYS),
                    "var": always_violate,
                })
                continue

            count_var = model.NewIntVar(0, len(subject_vars), f"subj_tchr_count_{c_name}_day{day+1}")
            model.Add(count_var == sum(subject_vars))

            # Fix #3: proper soft deficit using BoolVar — avoids INFEASIBLE when count >= 2
            has_subject = model.NewBoolVar(
                f"has_subj_tchr_{c_name}_day{day+1}"
            )
            model.Add(count_var >= 1).OnlyEnforceIf(has_subject)
            model.Add(count_var == 0).OnlyEnforceIf(has_subject.Not())

            violation = model.NewIntVar(0, 1, f"subj_tchr_violation_{c_name}_day{day+1}")
            model.Add(violation == 1 - has_subject)

            penalty_vars.append({
                "rule_id": "daily_subject_teacher_minimum",
                "weight": weight // (len(classes_data) * DAYS),
                "var": violation,
            })

    return penalty_vars


# ============================================================
# Task 3.6: 共備候選區塊軟目標 (soft)
# ============================================================

def _parse_co_planning_settings(school_info):
    """
    Parse coPlanningSettings from schoolInfo with backward compatibility.

    Supports two modes:
    - "auto": solver picks one block from candidateBlocks per grade (soft preference)
    - "manual": user specifies exact block per grade via manualBlocks; treated as near-hard

    Returns dict with keys:
      enabled, grades, mode, candidateBlocks, manualBlocks
    Missing/None/disabled -> returns safe defaults that skip all rules.
    """
    if not school_info or not isinstance(school_info, dict):
        return {"enabled": False, "grades": [], "mode": "auto", "candidateBlocks": [], "manualBlocks": {}}

    co_planning = school_info.get("coPlanningSettings", {})
    if not co_planning or not isinstance(co_planning, dict):
        return {"enabled": False, "grades": [], "mode": "auto", "candidateBlocks": [], "manualBlocks": {}}

    if not co_planning.get("enabled"):
        return {"enabled": False, "grades": [], "mode": "auto", "candidateBlocks": [], "manualBlocks": {}}

    grades = co_planning.get("grades", []) or []
    mode = co_planning.get("mode", "auto")
    if mode not in ("auto", "manual"):
        mode = "auto"
    candidate_blocks = co_planning.get("candidateBlocks", []) or []
    manual_blocks_raw = co_planning.get("manualBlocks", {}) or {}

    # Filter: keep only valid afternoon blocks with length == 2
    valid_blocks = []
    for block in candidate_blocks:
        if not isinstance(block, dict):
            continue
        day = block.get("day")
        start_period = block.get("startPeriod")
        length = block.get("length", 0)

        # Must have length == 2
        if length != 2:
            continue

        # Must be afternoon (1-based period > LUNCH_BOUNDARY)
        if start_period is None or start_period <= LUNCH_BOUNDARY:
            continue

        valid_blocks.append({
            "day": day,
            "startPeriod": start_period,
            "length": length,
        })

    # Parse manualBlocks: { "5": {day, startPeriod, length}, "6": null }
    # null means no manual block for that grade (fall back to auto or skip)
    manual_blocks = {}
    if isinstance(manual_blocks_raw, dict):
        for grade_key, block_val in manual_blocks_raw.items():
            try:
                g = int(grade_key)
            except (ValueError, TypeError):
                continue
            if block_val is None:
                manual_blocks[g] = None
            elif isinstance(block_val, dict):
                d = block_val.get("day")
                sp = block_val.get("startPeriod")
                ln = block_val.get("length", 2)
                if d is not None and sp is not None and ln == 2:
                    # Validate afternoon
                    if sp > LUNCH_BOUNDARY:
                        manual_blocks[g] = {
                            "day": d,
                            "startPeriod": sp,
                            "length": ln,
                        }

    return {
        "enabled": True,
        "grades": grades if isinstance(grades, list) else [],
        "mode": mode,
        "candidateBlocks": valid_blocks,
        "manualBlocks": manual_blocks,
    }


def build_co_planning_afternoon_block_penalty(
    model,
    schedule,
    classes_data,
    school_info=None,
):
    """
    對每個配置的 grade，在 candidateBlocks 中偏好選擇一個合法的 afternoon 2-period 區塊。

    Returns: (penalty_vars, indicator_map)
      penalty_vars: list of {"rule_id": str, "weight": int, "var": IntVar}
      indicator_map: dict[(grade, day, startPeriod)] -> BoolVar (indicator for block selected)
    """
    co_settings = _parse_co_planning_settings(school_info)

    # Guard clause: skip if not enabled, no blocks/grades, or mode is manual
    # (manual mode uses build_manual_co_planning_penalty instead)
    if not co_settings["enabled"] or not co_settings["grades"] or not co_settings["candidateBlocks"]:
        return [], {}
    if co_settings["mode"] == "manual":
        return [], {}

    weight = WEIGHT_REGISTRY.get("grade_co_planning_afternoon_block", 2500)
    penalty_vars = []
    indicator_map = {}

    grades = set(co_settings["grades"])
    candidate_blocks = co_settings["candidateBlocks"]

    # Build grade -> classes mapping
    grade_classes = defaultdict(list)
    for cls in classes_data:
        g = resolve_class_grade(cls)
        if g in grades:
            grade_classes[g].append(cls.get("name", ""))

    subject_teacher_subjects = set()
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            if is_subject_teacher_lesson(req):
                subject_teacher_subjects.add(req.get("subject", ""))

    for grade, class_names in grade_classes.items():
        if not class_names:
            continue

        # Create indicator variables for each candidate block
        block_indicators = []
        block_satisfied_vars = []
        for block in candidate_blocks:
            day_1based = block["day"]  # 1-based day
            start_p_1based = block["startPeriod"]  # 1-based period

            # Convert to 0-based indices
            day_idx = day_1based - 1 if 1 <= day_1based <= DAYS else None
            if day_idx is None:
                continue
            p_start_idx = day_idx * PERIODS_PER_DAY + (start_p_1based - 1)

            indicator = model.NewBoolVar(
                f"co_plan_grade{grade}_day{day_1based}_p{start_p_1based}"
            )
            block_indicators.append(indicator)
            indicator_map[(grade, day_1based, start_p_1based)] = indicator

            slot_subject_flags = []
            for c_name in class_names:
                for offset in range(2):
                    p_index = p_start_idx + offset
                    if p_index >= TOTAL_PERIODS:
                        continue
                    subject_vars = [
                        var
                        for (c, p, t, s), var in schedule.items()
                        if c == c_name and p == p_index and s in subject_teacher_subjects
                    ]
                    has_subject = model.NewBoolVar(
                        f"co_plan_blockSubject_{grade}_{day_1based}_{start_p_1based}_{c_name}_{offset}"
                    )
                    if subject_vars:
                        subject_sum = model.NewIntVar(
                            0,
                            len(subject_vars),
                            f"co_plan_blockSubjectSum_{grade}_{day_1based}_{start_p_1based}_{c_name}_{offset}",
                        )
                        model.Add(subject_sum == sum(subject_vars))
                        model.Add(subject_sum >= 1).OnlyEnforceIf(has_subject)
                        model.Add(subject_sum == 0).OnlyEnforceIf(has_subject.Not())
                    else:
                        model.Add(has_subject == 0)
                    slot_subject_flags.append(has_subject)

            block_satisfied = model.NewBoolVar(
                f"co_plan_grade{grade}_day{day_1based}_p{start_p_1based}_fully_subject"
            )
            if slot_subject_flags:
                for has_subject in slot_subject_flags:
                    model.AddImplication(block_satisfied, has_subject)
                model.AddBoolOr([has_subject.Not() for has_subject in slot_subject_flags] + [block_satisfied])
            else:
                model.Add(block_satisfied == 0)
            block_satisfied_vars.append(block_satisfied)

        # Soft preference: exactly one block selected per grade
        if block_indicators:
            sum_indicators = model.NewIntVar(0, len(block_indicators), f"co_plan_sumInd_{grade}")
            model.Add(sum_indicators == sum(block_indicators))

            # Penalty for deviation from 1
            slack_pos = model.NewIntVar(0, 1, f"co_plan_slackPos_{grade}")
            slack_neg = model.NewIntVar(0, len(block_indicators), f"co_plan_slackNeg_{grade}")
            model.Add(slack_pos - slack_neg == sum_indicators - 1)
            abs_dev = model.NewIntVar(0, max(len(block_indicators), 1), f"co_plan_absdev_{grade}")
            model.Add(abs_dev == slack_pos + slack_neg)

            penalty_vars.append({
                "rule_id": "grade_co_planning_afternoon_block",
                "weight": weight // max(len(grades), 1),
                "var": abs_dev,
            })

        if block_satisfied_vars:
            any_block_satisfied = model.NewBoolVar(f"co_plan_grade{grade}_any_fully_subject_block")
            model.AddMaxEquality(any_block_satisfied, block_satisfied_vars)
            no_satisfied_block = model.NewIntVar(0, 1, f"co_plan_grade{grade}_no_fully_subject_block")
            model.Add(no_satisfied_block == 1 - any_block_satisfied)
            penalty_vars.append({
                "rule_id": "grade_co_planning_afternoon_block",
                "weight": max(weight // max(len(grades), 1), 1),
                "var": no_satisfied_block,
            })

    return penalty_vars, indicator_map


# ============================================================
# Task 3.7: 共備期間科任課偏好 (soft)
# ============================================================

def build_co_planning_subject_lesson_penalty(
    model,
    schedule,
    classes_data,
    indicator_map,
):
    """
    當某年級的共備區塊被選中後，該年級所有班級在該時段內
    偏好排入 subject-teacher lesson（而非 homeroom lesson）。

    Args:
        indicator_map: dict[(grade, day, startPeriod)] -> BoolVar from Task 3.6

    Returns: list of {"rule_id": str, "weight": int, "var": IntVar}
    """
    if not indicator_map:
        return []

    weight = WEIGHT_REGISTRY.get("co_planning_subject_teacher_lesson", 2000)
    penalty_vars = []

    # Build grade -> classes mapping
    grade_classes = defaultdict(list)
    for cls in classes_data:
        g = resolve_class_grade(cls)
        grade_classes[g].append(cls.get("name", ""))

    # Collect subject-teacher subjects
    subject_teacher_subjects = set()
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            if is_subject_teacher_lesson(req):
                subject_teacher_subjects.add(req.get("subject", ""))

    # For each selected (grade, block), penalize slots that are not subject-teacher lessons.
    for (grade, day_1based, start_p_1based), indicator in indicator_map.items():
        class_names = grade_classes.get(grade, [])
        if not class_names:
            continue

        day_idx = day_1based - 1
        p_start_idx = day_idx * PERIODS_PER_DAY + (start_p_1based - 1)
        # Block covers 2 periods
        block_periods = [p_start_idx, p_start_idx + 1]

        for c_name in class_names:
            for p_index in block_periods:
                if p_index >= TOTAL_PERIODS:
                    continue

                # Find subject-teacher vars at this (class, period)
                subject_vars = []
                for (c, p, t, s), var in schedule.items():
                    if c == c_name and p == p_index and s in subject_teacher_subjects:
                        subject_vars.append(var)

                has_subject = model.NewBoolVar(f"co_plan_subject_{grade}_{c_name}_p{p_index}")
                if subject_vars:
                    subject_sum = model.NewIntVar(0, len(subject_vars), f"co_plan_subjectSum_{grade}_{c_name}_p{p_index}")
                    model.Add(subject_sum == sum(subject_vars))
                    model.Add(subject_sum >= 1).OnlyEnforceIf(has_subject)
                    model.Add(subject_sum == 0).OnlyEnforceIf(has_subject.Not())
                else:
                    model.Add(has_subject == 0)

                penalty_var = model.NewBoolVar(
                    f"co_plan_penalty_{grade}_{c_name}_p{p_index}"
                )
                # penalty_var == indicator AND NOT has_subject
                model.Add(penalty_var >= indicator - has_subject)
                model.Add(penalty_var <= indicator)
                model.Add(penalty_var <= 1 - has_subject)

                num_grades = max(len(set(k[0] for k in indicator_map.keys())), 1)
                penalty_vars.append({
                    "rule_id": "co_planning_subject_teacher_lesson",
                    "weight": max(weight // num_grades, 1),
                    "var": penalty_var,
                })

    return penalty_vars
