"""
teacher_rules.py — 教師維度約束

負責：
  - [硬約束 2] 教師衝堂防護（含交替課魔法方程式）
  - [硬約束 3] 教師不排課時段
  - [硬約束 4] 教師節數配額上限（含 expertise_quotas）
  - [硬約束 5] 特殊專案抽離鎖定

依賴：config, utils
"""

import terminal_sanitizer
import json
from collections import defaultdict
from config import DAYS, PERIODS_PER_DAY, TOTAL_PERIODS
from utils import is_virtual_teacher


def _build_class_map(classes_data):
    return {
        str(cls.get("name", "")).strip(): cls
        for cls in classes_data or []
        if cls.get("name")
    }


def _teacher_is_collision_exempt(teacher_name, classes_data, ai_settings, schedule):
    """
    只有在藝才班模式啟用，且該虛擬教師當前所有排課變數都屬於藝才班時，
    才允許跳過教師互斥約束。
    """
    if not (ai_settings or {}).get("artsClassEnabled", False):
        return False
    if not is_virtual_teacher(teacher_name):
        return False

    class_map = _build_class_map(classes_data)
    assigned_classes = {
        class_name
        for (class_name, _period, current_teacher, _subject) in schedule.keys()
        if current_teacher == teacher_name
    }
    if not assigned_classes:
        return False

    return all(class_map.get(class_name, {}).get("isArtsClass", False) for class_name in assigned_classes)


def apply_anti_collision(model, schedule, class_names, teacher_names, classes_data, ai_settings):
    """
    [硬約束 2] 衝堂防護

    1. 班級同時段不衝突（音樂/美勞視為一組）
    2. 教師同時段不衝突（2*fixed + alt <= 2 魔法方程式）

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        class_names: list of class names
        teacher_names: list of teacher names
        classes_data: list of class dicts
        ai_settings: dict with artsClassEnabled flag
    """
    # 班級維度：同時段只能有一門課
    for p in range(TOTAL_PERIODS):
        for c_name in class_names:
            slot_vars = list(set([
                var
                for (c, per, _t, _s), var in schedule.items()
                if c == c_name and per == p
            ]))
            if slot_vars:
                model.AddAtMostOne(slot_vars)

    # 教師維度：衝堂防護（以實際 schedule 內出現的老師為準，避免漏掉導師或未建檔老師）
    teacher_names_in_schedule = sorted({
        t_name
        for (_class_name, _period, t_name, _subject) in schedule.keys()
        if t_name
    })
    all_teacher_names = sorted(set(teacher_names or []).union(teacher_names_in_schedule))

    for p in range(TOTAL_PERIODS):
        for t_name in all_teacher_names:
            if _teacher_is_collision_exempt(t_name, classes_data, ai_settings, schedule):
                # 僅限純藝才班虛擬教師可豁免
                continue
            t_vars = [var for (c, per, t, s), var in schedule.items() if t == t_name and per == p]
            if t_vars:
                model.Add(sum(t_vars) <= 1)


def apply_alternating_teacher_anti_collision(
    model,
    schedule,
    class_teacher_pair,
    alternating_class_is_music_odd,
):
    """
    交替課實際授課教師的單雙週互斥。

    schedule 變數只以主教師建模；輸出時會依 is_music_odd 切成主教師/副教師。
    因此副教師必須另外用 week-specific occupancy 防衝堂。
    """
    teacher_week_slots = defaultdict(list)

    for (c_name, period, schedule_teacher, subject), active_var in schedule.items():
        is_alt = "交替" in subject or "/" in subject
        if not is_alt:
            continue

        music_teacher, art_teacher = class_teacher_pair.get(
            c_name,
            (schedule_teacher, schedule_teacher),
        )
        direction_var = alternating_class_is_music_odd.get((c_name, schedule_teacher))
        if direction_var is None:
            direction_var = alternating_class_is_music_odd.get((c_name, music_teacher))
        if direction_var is None:
            direction_var = alternating_class_is_music_odd.get((c_name, art_teacher))
        if direction_var is None:
            continue

        odd_music = model.NewBoolVar(
            f"alt_occ_odd_music_{c_name}_{period}_{music_teacher}".replace(" ", "_")
        )
        model.Add(odd_music <= active_var)
        model.Add(odd_music <= direction_var)
        model.Add(odd_music >= active_var + direction_var - 1)

        even_art = model.NewBoolVar(
            f"alt_occ_even_art_{c_name}_{period}_{art_teacher}".replace(" ", "_")
        )
        model.Add(even_art <= active_var)
        model.Add(even_art <= direction_var)
        model.Add(even_art >= active_var + direction_var - 1)

        odd_art = model.NewBoolVar(
            f"alt_occ_odd_art_{c_name}_{period}_{art_teacher}".replace(" ", "_")
        )
        model.Add(odd_art <= active_var)
        model.Add(odd_art <= direction_var.Not())
        model.Add(odd_art >= active_var - direction_var)

        even_music = model.NewBoolVar(
            f"alt_occ_even_music_{c_name}_{period}_{music_teacher}".replace(" ", "_")
        )
        model.Add(even_music <= active_var)
        model.Add(even_music <= direction_var.Not())
        model.Add(even_music >= active_var - direction_var)

        if music_teacher:
            teacher_week_slots[(music_teacher, period, "odd")].append(odd_music)
            teacher_week_slots[(music_teacher, period, "even")].append(even_music)
        if art_teacher:
            teacher_week_slots[(art_teacher, period, "odd")].append(odd_art)
            teacher_week_slots[(art_teacher, period, "even")].append(even_art)

    protected_slots = 0
    for vars_at_slot in teacher_week_slots.values():
        if vars_at_slot:
            model.Add(sum(vars_at_slot) <= 1)
            protected_slots += 1

    if protected_slots:
        print(f"  [CONSTRAINT] [交替教師防衝堂] 已建立 {protected_slots} 組單雙週教師互斥")


def apply_teacher_unavailable_slots(model, schedule, teachers_data):
    """
    [硬約束 3] 教師不排課時段

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        teachers_data: list of teacher dicts with unavailable_slots
    """
    for t_data in teachers_data:
        t_name = t_data.get("name")
        unavail = t_data.get("unavailable_slots", [])
        if isinstance(unavail, str):
            try:
                unavail = json.loads(unavail)
            except Exception:
                unavail = []
        for slot in unavail:
            d, pr = -1, -1
            if isinstance(slot, list) and len(slot) == 2:
                d, pr = int(slot[0]), int(slot[1])
            elif isinstance(slot, dict) and "day" in slot and "period" in slot:
                d, pr = int(slot["day"]), int(slot["period"])
            if d >= 1 and pr >= 1:
                global_period_idx = (d - 1) * PERIODS_PER_DAY + (pr - 1)
                if global_period_idx < TOTAL_PERIODS:
                    for (c, per, t, s), var in schedule.items():
                        if t == t_name and per == global_period_idx:
                            model.Add(var == 0)


def apply_teacher_quota(model, classes_data, teachers_data, schoolInfo):
    """
    [硬約束 4] 教師節數配額上限
    （硬約束已移至 phase2_engine.py 作為 soft quota，此處僅計算 metadata）

    Args:
        model: CpModel
        classes_data: list of class dicts
        teachers_data: list of teacher dicts
        schoolInfo: dict with periodDefaults

    Returns:
        None (mutates teachers_data in-place to add _safe_max_quota and _expertise_quotas)
    """
    teacher_demand = {}
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            subject = req.get("subject", "")
            if "_固定" in subject or "_交替" in subject:
                continue
            t = req.get("teacher_name") or req.get("teacher", "")
            if t:
                periods = int(req.get("periods", 0))
                if "交替" in subject:
                    periods = periods / 2
                teacher_demand[t] = teacher_demand.get(t, 0) + periods

    period_defaults = schoolInfo.get("periodDefaults", {})
    for t_data in teachers_data:
        t_name = t_data.get("name")
        t_type = t_data.get("type", "subject")
        fallback_base = int(period_defaults.get(t_type, 20))

        teacher_teaches_arts_class = False
        if is_virtual_teacher(t_name):
            for cls in classes_data:
                for req in cls.get("course_requirements", []):
                    req_t = req.get("teacher_name") or req.get("teacher", "")
                    if req_t == t_name and cls.get("isArtsClass", False):
                        teacher_teaches_arts_class = True
                        break
                if teacher_teaches_arts_class:
                    break

        if teacher_teaches_arts_class:
            effective_max_periods = 9999
            print(f"   [藝才班特規] {t_name} 豁免配額上限 (max_periods → 9999)")
        else:
            effective_max_periods = int(t_data.get("base_periods") or t_data.get("max_periods") or fallback_base)

        base = effective_max_periods
        reduction = int(t_data.get("reduction", 0))
        overtime = int(t_data.get("overtime", 0))
        max_quota = base - reduction + overtime

        actual_demand = teacher_demand.get(t_name, 0)
        safe_max_quota = max(max_quota, actual_demand)

        exp_alloc_raw = t_data.get("expertise_allocations", [])
        if isinstance(exp_alloc_raw, str):
            try:
                exp_alloc_raw = json.loads(exp_alloc_raw)
            except Exception:
                exp_alloc_raw = []

        expertise_quotas = {}
        if isinstance(exp_alloc_raw, list) and len(exp_alloc_raw) > 0:
            for alloc in exp_alloc_raw:
                subj = alloc.get("subject", "")
                qval = int(alloc.get("quota", 0))
                if subj and qval > 0:
                    expertise_quotas[subj] = qval

        # Soft quota 邏輯已移至 phase2_engine.py
        t_data["_safe_max_quota"] = safe_max_quota
        t_data["_expertise_quotas"] = expertise_quotas

        if expertise_quotas:
            print(f"  [INFO] [專長配額] {t_name}: {expertise_quotas}")
        print(f"  [CONSTRAINT] [Soft Quota] {t_name} 總上限: {safe_max_quota} (硬約束已移除，改用懲罰權重)")


def apply_special_course_locks(model, schedule, special_courses, classes_data, teachers_data, ai_settings):
    """
    [硬約束 5] 特殊專案與抽離課程建模（學習中心/抽離群組結構）

    支援：
      1. 鎖定時段 (isAutoTime=False)
      2. AI自動時段 (isAutoTime=True)
      3. 固定參與班級 (isAutoClass=False)
      4. AI自動湊班 (isAutoClass=True)
      5. 班級目標科目 (targetSubject) 同步排課
      6. 特教教師衝堂防護與佔用
    """
    from collections import defaultdict
    import re
    from config import LUNCH_BOUNDARY

    # 1. 預先建立班級與其年級的對照表
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

    # 2. 獲取下午禁排時段檢查函式
    def is_period_allowed_for_grade(grade, p):
        d = p // PERIODS_PER_DAY
        pr = p % PERIODS_PER_DAY
        if pr < LUNCH_BOUNDARY:
            return True
        # 下午時段禁排規則：
        # 1-2年級：週一、三、四、五下午禁排
        # 3-4年級：週三、五下午禁排
        # 5-6年級：週三下午禁排
        if grade in [1, 2]:
            return d not in [0, 2, 3, 4]
        elif grade in [3, 4]:
            return d not in [2, 4]
        elif grade in [5, 6]:
            return d != 2
        return True

    # 3. 按照群組特徵進行分組，確保同一組的班級集合在不同節次保持一致 (isAutoClass = True 時)
    groups = defaultdict(list)
    for sc in special_courses:
        name = sc.get("name", "")
        subj = sc.get("targetSubject", "")
        teacher = sc.get("teacher", "")
        is_auto_class = sc.get("isAutoClass", False)

        if is_auto_class:
            cfg = sc.get("autoClassConfig") or {}
            grades = cfg.get("grades") or []
            grades_key = frozenset(grades)
            count = cfg.get("count", 1)
            group_key = (name, subj, teacher, "auto", grades_key, count)
        else:
            classes_list = sc.get("targetClasses") or []
            classes_key = frozenset(classes_list)
            group_key = (name, subj, teacher, "manual", classes_key, 0)

        groups[group_key].append(sc)

    teacher_p_sc_vars = defaultdict(list)
    sc_decision_vars = []

    # 4. 對每個群組進行建模
    for group_key, sc_list in groups.items():
        name, subj, teacher, mode, extra_key, count = group_key

        select_c_vars = {}  # class_name -> BoolVar

        if mode == "auto":
            grades_pool = extra_key
            classes_in_pool = [c for c, g in class_grade_map.items() if g in grades_pool]
            # 建立選擇變數
            for c in classes_in_pool:
                select_c_vars[c] = model.NewBoolVar(f"select_c_{name}_{subj}_{teacher}_{c}".replace(" ", "_").replace("-", "_"))
            # 強制選擇 count 個班級
            if select_c_vars:
                model.Add(sum(select_c_vars.values()) == count)
        else:
            classes_in_pool = list(extra_key)
            for c in classes_in_pool:
                select_c_vars[c] = 1  # 固定為 1

        # 4b. 針對該群組的每個個別特殊課程進行時段排定與約束建模
        for idx, sc in enumerate(sc_list):
            sc_id = sc.get("id")
            is_auto_time = sc.get("isAutoTime", False)
            locked_slots = sc.get("lockedSlots", [])

            # 建立時段決策變數：sc_vars[p] = 1 代表此特殊課程排在時段 p
            sc_vars = [model.NewBoolVar(f"sc_at_{sc_id}_p{p}") for p in range(TOTAL_PERIODS)]
            model.Add(sum(sc_vars) == 1)

            # 儲存此變數結構以便後續主程式讀取與輸出
            sc_decision_vars.append({
                "sc": sc,
                "vars": sc_vars,
                "classes_pool": classes_in_pool,
                "select_vars": select_c_vars,
                "mode": mode
            })

            # 關聯特教教師與此課程時段變數，用於限制特教教師不排課與防衝堂
            if teacher:
                for p in range(TOTAL_PERIODS):
                    teacher_p_sc_vars[(teacher, p)].append(sc_vars[p])

            # 4c. 時段限制 (Teachable Periods & Locked Slots)
            for p in range(TOTAL_PERIODS):
                for c in classes_in_pool:
                    grade = class_grade_map.get(c, 1)
                    if not is_period_allowed_for_grade(grade, p):
                        if mode == "auto":
                            model.Add(sc_vars[p] + select_c_vars[c] <= 1)
                        else:
                            model.Add(sc_vars[p] == 0)

            # 手動指定時段 (isAutoTime = False)
            if not is_auto_time and locked_slots:
                slot = locked_slots[0]
                d = int(slot.get("day", 1))
                pr = int(slot.get("period", 1))
                p_lock = (d - 1) * PERIODS_PER_DAY + (pr - 1)
                if 0 <= p_lock < TOTAL_PERIODS:
                    model.Add(sc_vars[p_lock] == 1)

            # 4d. 同步排課約束：若特殊課程在時段 p 進行 (sc_vars[p] = 1) 且班級 c 被選中 (select_c = 1)，
            # 則班級 c 必須在時段 p 排定該目標科目 (targetSubject)
            if subj:
                for p in range(TOTAL_PERIODS):
                    for c in classes_in_pool:
                        class_p_subj_vars = [var for (sch_c, sch_p, sch_t, sch_s), var in schedule.items()
                                             if sch_c == c and sch_p == p and sch_s == subj]
                        if not class_p_subj_vars:
                            continue

                        if mode == "auto":
                            model.Add(sum(class_p_subj_vars) >= sc_vars[p] + select_c_vars[c] - 1)
                        else:
                            model.Add(sum(class_p_subj_vars) >= sc_vars[p])

    # 5. 特教教師衝堂防護與常規配課衝突限制
    for (teacher, p), sc_vars_at_p in teacher_p_sc_vars.items():
        regular_vars = [var for (c, per, t, s), var in schedule.items() if t == teacher and per == p]
        model.Add(sum(regular_vars) + sum(sc_vars_at_p) <= 1)

    # 把 sc_decision_vars 暫存到 model 中，方便主程式存取
    model.sc_decision_vars = sc_decision_vars

