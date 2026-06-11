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
from .utils import grade_needs_special_room, canonical_subject


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
    settings = ai_settings or {}
    return bool(is_arts_class and settings.get("artsClassEnabled"))


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


def apply_afternoon_prohibition(model, classes_data, schedule, ai_settings=None):
    """
    [硬約束 7] 低年級下午禁排

    1-2年級：週一至週五的下午全禁
    3-4年級：週三、週五的下午禁
    5-6年級：週三的下午禁

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
    """
    # 預先建立 (c, per) -> list of (t, s, var) 索引
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

    for subj_raw in (fallback_limits or {}).keys():
        subj = _normalize_special_room_subject(subj_raw)
        if subj:
            subjects.add(subj)

    return subjects


def apply_special_classroom_capacity(model, classes_data, schedule, classrooms,
                                     science_consec_map=None, penalty_vars=None,
                                     classroom_limits=None, school_info=None,
                                     relax_to_soft=False):
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
                canonical = canonical_subject(subj)
                classroom_grades_cfg = (school_info or {}).get("subjectClassroomGrades", {}) or {}
                if not grade_needs_special_room(canonical, grade, classroom_grades_cfg):
                    continue

                usage_terms.append(active_var * _subject_capacity_weight(raw_subject, subj))

            if usage_terms:
                usage_sum = sum(usage_terms)
                if not relax_to_soft:
                    model.Add(usage_sum <= capacity_units)
                else:
                    overload_upper_bound = max(0, len(usage_terms) * 2)
                    overload_var = model.NewIntVar(0, overload_upper_bound, f"room_overload_{subj}_{p}")
                    model.Add(usage_sum <= capacity_units + overload_var)
                    penalty_vars.append(overload_var * 5000)


def apply_science_habits(model, classes_data, schedule, ai_settings=None, penalty_vars=None):
    """
    [軟約束 10] 自然課排課習慣（重構版）

    核心設計：
    1. 以「合法連堂配對」為基礎，不再用硬猜的 forbidden_p 邏輯
    2. 3-4 年級：偏好 1 組連堂（軟限制，權重 800）
    3. 5-6 年級：偏好 2 組連堂（軟限制，權重 1200）
    4. 午休邊界統一使用 LUNCH_BOUNDARY，不再硬編碼
    5. 教師不跨半天規則保留（總節數 <= 2 時）
    6. 「每日結構上限」與「不可跨午休」仍為硬限制

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
        ai_settings: dict with naturalConsecutive flag
        penalty_vars: list for soft penalty accumulation

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

        # ---- 3-4 年級：軟偏好至少 1 組連堂（權重 800）----
        if grade in [3, 4]:
            all_consec = list(consec_vars.values())
            if all_consec:
                # 每天最多加起來 <= 1 組連堂（硬限制：結構上限）
                for d in range(DAYS):
                    d_consec = [consec_vars[(d, pi)] for pi in range(len(valid_pairs))
                               if (d, pi) in consec_vars]
                    if d_consec:
                        model.Add(sum(d_consec) <= 1)
                # 全週軟偏好至少 1 組連堂
                has_sci_consec = model.NewBoolVar(f'sci_consec_ok_{c_name}')
                model.Add(sum(all_consec) >= 1).OnlyEnforceIf(has_sci_consec)
                if penalty_vars is not None:
                    penalty_vars.append(800 * (1 - has_sci_consec))

        # ---- 5-6 年級：軟偏好至少 2 組連堂（權重 1200）----
        elif grade in [5, 6]:
            all_consec = list(consec_vars.values())
            if all_consec:
                has_sci_consec = model.NewBoolVar(f'sci_consec_ok_{c_name}')
                model.Add(sum(all_consec) >= 2).OnlyEnforceIf(has_sci_consec)
                if penalty_vars is not None:
                    penalty_vars.append(1200 * (1 - has_sci_consec))
                # 每天上限 2 組（硬限制：結構上限）
                for d in range(DAYS):
                    d_consec = [consec_vars[(d, pi)] for pi in range(len(valid_pairs))
                               if (d, pi) in consec_vars]
                    if d_consec:
                        model.Add(sum(d_consec) <= 2)

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
            canon_subj = canonical_subject("美勞")
            if grade_needs_special_room(canon_subj, grade, classroom_grades_cfg):
                art_odd_total_vars.append(var)
                art_even_total_vars.append(var)

        # 容量約束（preferred，10000 懲罰）
        for label, demand_vars, capacity in [
            ("music_odd", music_odd_vars, music_cap),
            ("music_even", music_even_vars, music_cap),
            ("art_odd", art_odd_total_vars, art_cap),
            ("art_even", art_even_total_vars, art_cap),
        ]:
            if not demand_vars:
                continue
            ov = model.NewIntVar(0, len(demand_vars), f"ws_overload_{label}_p{p}")
            model.Add(ov >= sum(demand_vars) - capacity)
            penalty_vars.append(10000 * ov)
            ws_overload_vars[(label, p)] = ov

    return ws_overload_vars


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
            canon_subj = canonical_subject(canonical)
            if not grade_needs_special_room(canon_subj, grade, classroom_grades_cfg):
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
            canon_subj = canonical_subject(canonical)
            if not grade_needs_special_room(canon_subj, grade, classroom_grades_cfg):
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
]
