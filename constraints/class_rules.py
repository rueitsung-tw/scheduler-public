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


def apply_afternoon_prohibition(model, classes_data, schedule):
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
        raw_grade = cls.get("grade")
        if raw_grade is None:
            match = re.search(r'(\d+)年', c_name)
            if match:
                raw_grade = int(match.group(1))
        try:
            grade = int(raw_grade) if raw_grade is not None else 1
        except Exception:
            grade = 1

        forbidden_days = []
        if grade in [1, 2]:
            forbidden_days = [0, 2, 3, 4]
        elif grade in [3, 4]:
            forbidden_days = [2, 4]
        elif grade in [5, 6]:
            forbidden_days = [2]

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



def apply_special_classroom_capacity(model, classes_data, schedule, classrooms,
                                     science_consec_map=None, penalty_vars=None,
                                     classroom_limits=None, school_info=None):
    """
    [硬約束 9] 專科教室容量限制 (年級/科目綁定與分配模型)

    每個班級在排定某個專科科目時，必須指派到一間相應且年級相容的專科教室。
    音樂、美勞的交替課以半權重計入教室容量，自然課只統計連堂時段。

    Args:
        model: CpModel
        classes_data: list of class dicts
        schedule: dict (c, p, t, s) -> BoolVar
        classrooms: list of classroom dicts (from frontend payload)
        science_consec_map: dict (c_name, p) -> BoolVar (可選)
        penalty_vars: list of penalty vars to minimize (可選)
        classroom_limits: dict (subject -> int) 專科教室預設容量限制 (可選)
    """
    if penalty_vars is None:
        penalty_vars = []

    if not hasattr(model, "classroom_assignments"):
        model.classroom_assignments = []

    from collections import defaultdict
    from config import TOTAL_PERIODS

    # 1. 預先建立班級年級對照表
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

    # 2. 將 classrooms 分組並進行名稱正規化
    rooms_by_subject = defaultdict(list)

    def normalize_subject_for_room(subj_raw):
        """對應前端與系統標準領域設定之 canonical key"""
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

    # [安全防護網] 核心科目安全預設容量
    core_subjects_fallback = {
        "自然科學": 2,
        "語文-英語": 2,
        "音樂": 2,
        "美勞": 2,
        "體育": 3,
        "資訊": 2
    }

    # 如果有傳入客製化限額設定，則進行更新/擴充
    if classroom_limits:
        for subj_raw, limit in classroom_limits.items():
            subj_norm = normalize_subject_for_room(subj_raw)
            try:
                core_subjects_fallback[subj_norm] = int(limit)
            except (ValueError, TypeError):
                pass

    existing_subjects = set(normalize_subject_for_room(r.get("subject", "")) for r in classrooms if r.get("subject"))

    # 複製一份 active_classrooms
    active_classrooms = list(classrooms)
    for core_subj, fallback_count in core_subjects_fallback.items():
        if core_subj not in existing_subjects:
            print(f"  [NOTE] [安全預設] 未偵測到【{core_subj}】教室建檔，系統自動套用預設防護網: {fallback_count} 間共享教室")
            for i in range(fallback_count):
                active_classrooms.append({
                    "id": f"virtual_{core_subj}_{i}",
                    "name": f"虛擬{core_subj}教室{i+1}",
                    "subject": core_subj,
                    "allowSharing": True,
                    "gradePreferences": []
                })

    for room in active_classrooms:
        subj_raw = room.get("subject", "") or ""
        subj = normalize_subject_for_room(subj_raw)
        rooms_by_subject[subj].append(room)

    # 預先建立 per -> list of (c, t, s, var) 索引，防止 O(N) 遍歷
    schedule_by_period = defaultdict(list)
    for (sch_c, sch_per, sch_t, sch_s), var in schedule.items():
        schedule_by_period[sch_per].append((sch_c, sch_t, sch_s, var))

    # 3. 逐一科目、逐一節次建立分配與容量限制
    for subj, rooms in rooms_by_subject.items():
        if not rooms:
            continue

        for p in range(TOTAL_PERIODS):
            # class_active_vars 收集此時段、此科目下所有活躍班級資訊:
            # 格式: (class_name, teacher_name, subject_name, active_var, weight)
            class_active_vars = []

            for c, t, s, var in schedule_by_period.get(p, []):
                # [NEW] 讀取動態年級使用設定
                grade = class_grade_map.get(c, 1)
                classroom_grades_cfg = {}
                if school_info and "subjectClassroomGrades" in school_info:
                    classroom_grades_cfg = school_info["subjectClassroomGrades"]

                need_classroom = True
                if subj in classroom_grades_cfg:
                    # 動態讀取設定白名單
                    need_classroom = (grade in classroom_grades_cfg[subj])
                else:
                    # 原本的硬編碼 Fallback 邏輯
                    if subj in ("音樂", "美勞", "自然科學") and grade <= 2:
                        need_classroom = False
                    elif subj == "語文-英語" and grade == 1:
                        need_classroom = False

                if not need_classroom:
                    continue

                # 自然科學 (只統計被判定為連堂的時段)
                if subj == "自然科學" and "自然" in s:
                    if science_consec_map is not None:
                        cv = science_consec_map.get((c, p))
                        if cv is not None:
                            class_active_vars.append((c, t, s, cv, 1))

                # 音樂教室
                elif subj == "音樂" and "音樂" in s:
                    if "音樂美勞_交替" in s:
                        class_active_vars.append((c, t, s, var, 1))  # 交替課權重 1 (占半間)
                    else:
                        class_active_vars.append((c, t, s, var, 2))  # 固定課權重 2 (占整間)

                # 美勞教室
                elif subj == "美勞" and "美勞" in s:
                    if "音樂美勞_交替" in s:
                        class_active_vars.append((c, t, s, var, 1))
                    else:
                        class_active_vars.append((c, t, s, var, 2))

                # 英語教室 (排除 1 年級英語課，已在最上面用 need_classroom 過濾，此處移除硬性條件)
                elif subj == "語文-英語" and ("英語" in s or "英文" in s):
                    class_active_vars.append((c, t, s, var, 1))

                # 其他科任教室 (體育、資訊、本土語等)
                elif s == subj or (subj == "體育" and "體育" in s):
                    class_active_vars.append((c, t, s, var, 1))

            if not class_active_vars:
                continue

            # 4. 指派決策：建立 assign 變數與限制
            room_occupants = defaultdict(list)  # room_id -> [(assign_var, weight)]

            for c, t_name, s_name, active_var, weight in class_active_vars:
                grade = class_grade_map.get(c, 1)

                # 篩選出與該班級年級相容的教室
                compatible_rooms = []
                for room in rooms:
                    gp_raw = room.get("gradePreferences", [])
                    if isinstance(gp_raw, str):
                        try:
                            import json
                            gp_raw = json.loads(gp_raw)
                        except Exception:
                            gp_raw = []
                    gp = [int(g) for g in gp_raw if str(g).isdigit()] if isinstance(gp_raw, list) else []
                    allow_sharing = room.get("allowSharing", True)

                    if not gp:
                        # 全校共享教室，完全相容
                        compatible_rooms.append((room, False))
                    else:
                        if grade in gp:
                            # 年級完美匹配
                            compatible_rooms.append((room, False))
                        elif allow_sharing:
                            # 允許共享，但年級非優先，標記為 mismatch 懲罰
                            compatible_rooms.append((room, True))

                if not compatible_rooms:
                    # 若無任何相容教室，此班級在此時段無法上此科目
                    model.Add(active_var == 0)
                    continue

                assign_vars = []
                for room, is_mismatch in compatible_rooms:
                    r_id = room.get("id")
                    safe_c = c.replace("年", "").replace("班", "")

                    # 建立指派變數: assign_c_r_p
                    av = model.NewBoolVar(f"assign_{safe_c}_{r_id}_p{p}".replace("-", "_").replace(" ", "_"))
                    assign_vars.append(av)
                    room_occupants[r_id].append((av, weight))

                    # 記錄指派關係以供 solver.py 提取結果
                    model.classroom_assignments.append({
                        "className": c,
                        "period": p,
                        "roomName": room.get("name", ""),
                        "classroomId": r_id,
                        "subject": subj,
                        "var": av
                    })

                    # -- 軟約束 A：非優先年級使用此教室的懲罰 (GRADE_AFFINITY_MISS_PENALTY) --
                    if is_mismatch:
                        penalty_vars.append(400 * av)

                    # -- 軟約束 B：主責教師未命中主場教室的懲罰 (PRIMARY_TEACHER_MISS_PENALTY) --
                    primary_teacher = room.get("primaryTeacher", "")
                    if primary_teacher and t_name and primary_teacher != t_name:
                        penalty_vars.append(800 * av)

                # 限制：若班級上課，必須且只能分配到一間相容教室；否則不分配
                model.Add(sum(assign_vars) == active_var)

            # 5. 容量上限限制 (Capacity Constraint) -> 改為帶有高額懲罰的軟超載限制
            for room in rooms:
                r_id = room.get("id")
                occupants = room_occupants.get(r_id, [])
                if occupants:
                    capacity = 2 if subj in ("音樂", "美勞") else 1
                    
                    # 建立超載變數 (以 5 為上限，防止極端佔用)
                    # 超載量 = sum(av * w) - capacity，但限制最小為 0
                    overload_var = model.NewIntVar(0, 5, f"overload_{r_id}_p{p}")
                    model.Add(sum(av * w for av, w in occupants) - capacity <= overload_var)
                    
                    if penalty_vars is not None:
                        # 權重設為 10000，確保只在無解時才被妥協超載
                        penalty_vars.append(10000 * overload_var)
                    else:
                        # Baseline fallback: 若未傳入 penalty_vars 則套用原本的硬限制
                        model.Add(overload_var == 0)


def apply_science_habits(model, classes_data, schedule, ai_settings=None):
    """
    [硬約束 10] 自然課排課習慣（重構版）

    核心設計：
    1. 以「合法連堂配對」為基礎，不再用硬猜的 forbidden_p 邏輯
    2. 3-4 年級：1 組連堂 + 1 節填縫（軟偏好）
    3. 5-6 年級：2 組連堂（硬約束）
    4. 午休邊界統一使用 LUNCH_BOUNDARY，不再硬編碼
    5. 教師不跨半天規則保留（總節數 <= 2 時）

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts

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

        # ---- 3-4 年級：軟偏好 1 組連堂 + 填縫 ----
        if grade in [3, 4]:
            all_consec = list(consec_vars.values())
            if all_consec:
                # 每天最多加起來 <= 1 組連堂
                for d in range(DAYS):
                    d_consec = [consec_vars[(d, pi)] for pi in range(len(valid_pairs))
                               if (d, pi) in consec_vars]
                    if d_consec:
                        model.Add(sum(d_consec) <= 1)
                # 全週軟偏好至少 1 組連堂（不強制，用 Maximize 偏好）
                # 這裡不做硬約束，只加每日上限
                # ↓ 新增這一行，強制全週至少有 1 組連堂
                model.Add(sum(all_consec) >= 1)

        # ---- 5-6 年級：全週至少 2 組連堂 ----
        elif grade in [5, 6]:
            all_consec = list(consec_vars.values())
            if all_consec:
                model.Add(sum(all_consec) >= 2)
                # 每天上限 2 組（因為一天只有 7 節，最多 2 組連堂）
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


__all__ = [
    "apply_daily_subject_limit",
    "apply_afternoon_prohibition",
    "apply_no_consecutive_subject",
    "apply_special_classroom_capacity",
    "apply_science_habits",
]
