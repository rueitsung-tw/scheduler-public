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
import logging
from collections import defaultdict
from config import DAYS, PERIODS_PER_DAY, TOTAL_PERIODS
from utils import is_virtual_teacher
from constraints.movable_locks import is_special_course_lock_movable, get_candidate_periods, apply_movable_lock


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


def _get_special_course_keys(model=None, special_courses=None, classes_data=None, preprocess_metadata=None):
    sc_list = special_courses or getattr(model, "special_courses", None) or []
    metadata = preprocess_metadata
    if metadata is None:
        metadata = getattr(model, "preprocess_metadata", None)
    sc_keys = set()
    for sc in sc_list:
        t = sc.get("teacher") or sc.get("teacher_name")
        s = sc.get("targetSubject") or sc.get("subject")
        if t and s:
            for c in sc.get("targetClasses") or []:
                sc_keys.add((c, t, s))
                effective_s = resolve_effective_special_course_subject(sc, c, metadata)
                if effective_s:
                    sc_keys.add((c, t, effective_s))

    return sc_keys


def apply_anti_collision(
    model,
    schedule,
    class_names,
    teacher_names,
    classes_data,
    ai_settings,
    special_courses=None,
    preprocess_metadata=None,
):
    """
    [硬約束 2] 衝堂防護

    1. 班級同時段不衝突（音樂/美勞視為一組）
    2. 教師同時段不衝突（特殊課程由 apply_special_course_locks 獨立維護）

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        class_names: list of class names
        teacher_names: list of teacher names
        classes_data: list of class dicts
        ai_settings: dict with artsClassEnabled flag
        special_courses: list of special course dicts (optional)
    """
    from collections import defaultdict
    schedule_by_class_period = defaultdict(list)
    schedule_by_teacher_period = defaultdict(list)
    
    sc_keys = _get_special_course_keys(
        model,
        special_courses,
        classes_data,
        preprocess_metadata=preprocess_metadata,
    )

    for (c, per, t, s), var in schedule.items():
        if (c, t, s) not in sc_keys:
            schedule_by_class_period[(c, per)].append(var)
        if t and (c, t, s) not in sc_keys:
            schedule_by_teacher_period[(t, per)].append(var)

    # 班級維度：普通課程同時段只能有一門課
    for p in range(TOTAL_PERIODS):
        for c_name in class_names:
            slot_vars = list(set(schedule_by_class_period.get((c_name, p), [])))
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
            t_vars = schedule_by_teacher_period.get((t_name, p), [])
            if t_vars:
                model.Add(sum(t_vars) <= 1)


def apply_alternating_teacher_anti_collision(
    model,
    schedule,
    class_teacher_pair,
    alternating_class_is_music_odd,
    classes_data=None,
    ai_settings=None,
    special_courses=None,
    preprocess_metadata=None,
):
    """
    交替課實際授課教師的單雙週互斥。

    schedule 變數只以主教師建模；輸出時會依 is_music_odd 切成主教師/副教師。
    因此副教師必須另外用 week-specific occupancy 防衝堂。
    同時也要把固定課（week=both）展開進 odd/even bucket，
    才能攔下「固定課 both + 交替課 odd/even」的真實衝堂。
    """
    teacher_week_slots = defaultdict(list)
    sc_keys = _get_special_course_keys(
        model,
        special_courses,
        classes_data,
        preprocess_metadata=preprocess_metadata,
    )

    for (c_name, period, schedule_teacher, subject), active_var in schedule.items():
        is_alt = "交替" in subject or "/" in subject
        if not is_alt:
            if schedule_teacher and (c_name, schedule_teacher, subject) not in sc_keys and not _teacher_is_collision_exempt(
                schedule_teacher,
                classes_data,
                ai_settings,
                schedule,
            ):
                teacher_week_slots[(schedule_teacher, period, "odd")].append(active_var)
                teacher_week_slots[(schedule_teacher, period, "even")].append(active_var)
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

        if music_teacher and not _teacher_is_collision_exempt(
            music_teacher,
            classes_data,
            ai_settings,
            schedule,
        ):
            teacher_week_slots[(music_teacher, period, "odd")].append(odd_music)
            teacher_week_slots[(music_teacher, period, "even")].append(even_music)
        if art_teacher and not _teacher_is_collision_exempt(
            art_teacher,
            classes_data,
            ai_settings,
            schedule,
        ):
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


def normalize_special_course_entity(sc_or_name) -> str:
    """
    回傳正規化後的抽離實體名稱。
    在目前沒有獨立 entityId 的架構下，一律以 exact name.strip() 作為實體識別。
    不消費 sourceKind，不做別名或子字串映射。空白或無名稱回傳空字串。
    """
    if isinstance(sc_or_name, dict):
        name = sc_or_name.get("name") or sc_or_name.get("scName") or ""
    elif isinstance(sc_or_name, str):
        name = sc_or_name
    else:
        name = ""
    return str(name).strip()


def can_parallel_special_course_pair(left: dict, right: dict, class_name: str) -> bool:
    """
    判斷同班同節的兩筆特殊課程 entry 是否允許並行。
    1. 任一實體名稱為空白 -> False
    2. 同一實體 -> 僅在 effective schedule subject 相同時放行 (同學習中心導師區塊)
    3. 不同實體 -> 僅在教師不同時放行 (跨實體不同教師)；若教師相同則為衝堂拒絕
    """
    entity_l = normalize_special_course_entity(left)
    entity_r = normalize_special_course_entity(right)

    if not entity_l or not entity_r:
        return False

    eff_l = left.get("effectiveScheduleSubject") or left.get("targetSubject") or ""
    eff_r = right.get("effectiveScheduleSubject") or right.get("targetSubject") or ""

    if entity_l == entity_r:
        # 同一抽離實體
        return eff_l == eff_r

    # 不同抽離實體 (跨實體)
    t_l = str(left.get("teacher") or "").strip()
    t_r = str(right.get("teacher") or "").strip()

    # 若教師皆非空且相同 -> 教師衝堂保護，不放行
    if t_l and t_r and t_l == t_r:
        return False

    # 不同教師跨實體 -> 放行
    return True


def classify_special_course_pair(left: dict, right: dict, class_name: str) -> str:
    """
    為診斷與驗證回傳明示的處置 disposition 標籤。
    """
    if can_parallel_special_course_pair(left, right, class_name):
        entity_l = normalize_special_course_entity(left)
        entity_r = normalize_special_course_entity(right)
        if entity_l != entity_r:
            return "allowed_cross_entity_parallel"
        return "allowed_same_effective_subject"

    entity_l = normalize_special_course_entity(left)
    entity_r = normalize_special_course_entity(right)
    if entity_l == entity_r:
        return "conflict_different_effective_subject"

    t_l = str(left.get("teacher") or "").strip()
    t_r = str(right.get("teacher") or "").strip()
    if t_l and t_r and t_l == t_r:
        return "conflict_cross_entity_teacher_collision"

    return "conflict_different_effective_subject"


def validate_shared_event_entity_consistency(special_courses: list[dict]) -> list[dict]:
    """
    檢測是否有同一 sharedEventId 跨越不同抽離實體的資料語意錯誤。
    """
    special_courses = special_courses or []
    from collections import defaultdict

    groups = defaultdict(list)
    for sc in special_courses:
        shared_id = (sc.get("sharedEventId") or "").strip()
        if shared_id:
            groups[shared_id].append(sc)

    violations = []
    for shared_id, sc_list in groups.items():
        entities = set(normalize_special_course_entity(sc) for sc in sc_list if normalize_special_course_entity(sc))
        if len(entities) > 1:
            violations.append({
                "code": "INVALID_SHARED_EVENT_MIXED_ENTITIES",
                "sharedEventId": shared_id,
                "entities": sorted(list(entities)),
                "message": f"sharedEventId '{shared_id}' contains mixed entities: {sorted(list(entities))}",
            })
    return violations


def resolve_effective_special_course_subject(sc, class_name, preprocess_metadata):
    """
    學習中心若 targetSubject 已被 homeroom blockization merge，
    回傳 '導師區塊'；否則回傳原始 targetSubject。
    其他 specialCourse 一律回傳原始 targetSubject。
    """
    subj = sc.get("targetSubject", "")
    if not subj:
        return subj
    if sc.get("name") != "學習中心":
        return subj

    def _canonical(s):
        s = str(s).strip()
        if s in ("國", "國語", "國語文", "語文-國語", "國1", "國2"):
            return "語文-國語"
        if s in ("數", "數學", "數1", "數2"):
            return "數學"
        return s

    canon_subj = _canonical(subj)

    trace_list = (preprocess_metadata or {}).get("homeroomBlockizationTrace", [])
    for trace in trace_list:
        if trace.get("className") != class_name:
            continue
        merged = [_canonical(m.get("subject", "")) for m in trace.get("mergedSubjects", [])]
        if canon_subj in merged:
            return "導師區塊"
    return subj


def classify_special_course_overlaps(resolved_special_courses):
    """
    分析已解好的 special courses 結果，找出同班同時段重疊，
    依 effective subject 分類為 allowed_overlap 或 conflict。

    參數:
        resolved_special_courses: list[dict]
            每個 dict 為結果組裝後的 specialCourse，已包含：
            - "name": str
            - "teacher": str
            - "targetSubject": str (原始)
            - "targetClasses": list[str]
            - "lockedSlots": list[{"day": int, "period": int}]
            - "_effective_subjects": dict[str, str]  (className -> effectiveSubject)

    回傳:
        {
            "allowed_overlaps": [],
            "conflicts": [],
        }
    """
    resolved_special_courses = resolved_special_courses or []
    from collections import defaultdict

    # 建立 (className, day, period) -> [entries] 的索引
    slot_map = defaultdict(list)
    for sc in resolved_special_courses:
        eff_map = sc.get("_effective_subjects", {})
        for cls_name in sc.get("targetClasses", []):
            for slot in sc.get("lockedSlots", []):
                day = slot.get("day", 1)
                period = slot.get("period", 1)
                eff_subj = eff_map.get(cls_name, sc.get("targetSubject", ""))
                slot_map[(cls_name, day, period)].append({
                    "scName": sc.get("name", ""),
                    "teacher": sc.get("teacher", ""),
                    "originalTargetSubject": sc.get("targetSubject", ""),
                    "effectiveScheduleSubject": eff_subj,
                })

    allowed_overlaps = []
    conflicts = []

    for (cls_name, day, period), entries in slot_map.items():
        if len(entries) <= 1:
            continue

        all_pairs_allowed = True
        has_cross_entity = False
        has_teacher_collision = False

        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                e1 = entries[i]
                e2 = entries[j]
                left_dict = {"name": e1["scName"], "teacher": e1["teacher"], "effectiveScheduleSubject": e1["effectiveScheduleSubject"]}
                right_dict = {"name": e2["scName"], "teacher": e2["teacher"], "effectiveScheduleSubject": e2["effectiveScheduleSubject"]}

                if not can_parallel_special_course_pair(left_dict, right_dict, cls_name):
                    all_pairs_allowed = False
                    if e1["teacher"] and e1["teacher"] == e2["teacher"]:
                        has_teacher_collision = True
                else:
                    if normalize_special_course_entity(left_dict) != normalize_special_course_entity(right_dict):
                        has_cross_entity = True

        if all_pairs_allowed:
            disposition = "allowed_cross_entity_parallel" if has_cross_entity else "allowed_same_effective_subject"
            allowed_overlaps.append({
                "className": cls_name,
                "day": day,
                "period": period,
                "entries": entries,
                "disposition": disposition,
            })
        else:
            disposition = "conflict_cross_entity_teacher_collision" if has_teacher_collision else "conflict_different_effective_subject"
            conflicts.append({
                "className": cls_name,
                "day": day,
                "period": period,
                "entries": entries,
                "disposition": disposition,
            })

    return {
        "allowed_overlaps": allowed_overlaps,
        "conflicts": conflicts,
    }


def apply_special_course_locks(model, schedule, special_courses, classes_data, teachers_data, ai_settings,
                                preprocess_metadata=None, movable_locks_policy=None):
    """
    [硬約束 5] 特殊專案與抽離課程建模（學習中心/抽離群組結構）

    支援：
      1. 鎖定時段 (isAutoTime=False)
      2. AI自動時段 (isAutoTime=True)
      3. 固定參與班級 (isAutoClass=False)
      4. AI自動湊班 (isAutoClass=True)
      5. 班級目標科目 (targetSubject) 同步排課
      6. 特教教師衝堂防護與佔用

    [SEMANTIC FIX 2026-06-30]
    學習中心抽離事件語意修正：
    多筆 pullout 記錄（不同 targetSubject）可能代表同一個抽離事件。
    例如：4165(國語)+4166(國語)+4167(數學)+4168(數學) 都是「3年1/3/10班 → 學習中心」的同一事件。

    修復策略：
    - 引入 event_key = (name, teacher, mode, classes_key) 作為事件層級分組（不含 subject）
    - 同一事件內的 pullout 共用同一組時段決策變數 (event_vars)
    - 教師佔用只計算事件層級（一次），而非每筆 pullout 各算一次
    - 每筆 pullout 的 sc_decision_vars 仍獨立記錄（供輸出使用），但 vars 指向 event_vars
    - lockedSlots 取同一事件內所有 pullout 的交集時段
    """
    from collections import defaultdict
    import re
    from config import LUNCH_BOUNDARY

    # [PERFORMANCE INDEXING]
    model.special_courses = special_courses
    schedule_by_c_p_s = defaultdict(list)
    schedule_by_t_p = defaultdict(list)
    for (sch_c, sch_p, sch_t, sch_s), var in schedule.items():
        schedule_by_c_p_s[(sch_c, sch_p, sch_s)].append(var)
        if sch_t:
            schedule_by_t_p[(sch_t, sch_p)].append((sch_s, var))

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

    # ============================================================
    # [SEMANTIC FIX v2] 事件層級分組 + lockedSlot 次分組
    #
    # 第一層：event_key = (name, teacher, mode, classes_key)
    #   同一事件內的 pullout 共享教師與班級池，教師佔用只算一次
    #
    # 第二層：按 lockedSlot 簽名次分組
    #   同一事件內的 pullout 可能代表不同科目的不同抽離時段。
    #   例如：4165/4166/4167 (day2p2/day4p3) vs 4168 (day3p1)
    #   這些是同一學習中心事件的不同時段，不能取交集（會為空）
    #
    # 次分組策略：
    #   - 將具有相同 lockedSlot 簽名的 pullout 聚在一起
    #   - 每個次分組建立一組 event_vars
    #   - 同一事件的不同次分組之間，教師佔用互相排斥（不能同時進行）
    # ============================================================
    events = defaultdict(list)
    for sc in special_courses:
        name = sc.get("name", "")
        teacher = sc.get("teacher", "")
        is_auto_class = sc.get("isAutoClass", False)
        shared_event_id = sc.get("sharedEventId")

        if is_auto_class:
            cfg = sc.get("autoClassConfig") or {}
            grades = frozenset(cfg.get("grades") or [])
            count = cfg.get("count", 1)
            event_key = (name, teacher, "auto", grades, count)
        elif shared_event_id:
            event_key = (name, teacher, "shared", str(shared_event_id).strip())
        else:
            classes_key = frozenset(sc.get("targetClasses") or [])
            event_key = (name, teacher, "manual", classes_key)

        events[event_key].append(sc)

    teacher_p_sc_vars = defaultdict(list)
    sc_decision_vars = []

    # 3. 對每個事件進行建模
    for event_key, event_sc_list in events.items():
        name, teacher, mode, *rest = event_key

        # 3a. 決定 classes_in_pool 與 select_c_vars（事件層級）
        if mode == "auto":
            grades_pool = rest[0]
            count = rest[1] if len(rest) > 1 else 1
            classes_in_pool = [c for c, g in class_grade_map.items() if g in grades_pool]
            select_c_vars = {}
            for c in classes_in_pool:
                select_c_vars[c] = model.NewBoolVar(
                    f"select_c_{name}_{teacher}_{c}".replace(" ", "_").replace("-", "_")
                )
            if select_c_vars:
                model.Add(sum(select_c_vars.values()) == count)
        elif mode == "shared":
            # 🛡️ 求解前語意硬驗證：同一 sharedEventId 內，同一班級不可對應多個不同的有效科目
            class_eff_map = {}
            classes_set = set()
            for sc in event_sc_list:
                for c in sc.get("targetClasses") or []:
                    classes_set.add(c)
                    eff = resolve_effective_special_course_subject(sc, c, preprocess_metadata)
                    if c in class_eff_map and class_eff_map[c] != eff:
                        shared_id_str = str(rest[0]) if rest else ""
                        raise ValueError(
                            f"INVALID_SHARED_EVENT_SAME_CLASS_MULTI_SUBJECT: "
                            f"班級「{c}」在共同事件「{shared_id_str}」中同時被指派多個不同的有效科目「{class_eff_map[c]}」與「{eff}」"
                        )
                    class_eff_map[c] = eff
            classes_in_pool = sorted(list(classes_set))
            select_c_vars = {c: 1 for c in classes_in_pool}
        else:
            classes_in_pool = list(rest[0])
            select_c_vars = {c: 1 for c in classes_in_pool}

        # 3b. [SEMANTIC FIX v2] 按 lockedSlot 簽名次分組
        # 將具有相同 lockedSlot 配置的 pullout 聚在一起
        slot_signature_groups = defaultdict(list)
        for sc in event_sc_list:
            is_auto_time = sc.get("isAutoTime", False)
            locked_slots = sc.get("lockedSlots", [])
            if is_auto_time or not locked_slots:
                sig = ("auto",)
            else:
                sig = frozenset((s.get("day", 1), s.get("period", 1)) for s in locked_slots)
            slot_signature_groups[sig].append(sc)

        # 3c. 為每個次分組建立 event_vars
        event_id_parts = []
        for sc in event_sc_list:
            event_id_parts.append(str(sc.get("id", "")))
        event_id_tag = "_".join(sorted(event_id_parts))

        sub_event_vars_list = []
        sub_idx = 0
        for sig, sub_sc_list in slot_signature_groups.items():
            sub_tag = f"{event_id_tag}_s{sub_idx}"
            sub_event_vars = [
                model.NewBoolVar(f"sc_event_{sub_tag}_p{p}")
                for p in range(TOTAL_PERIODS)
            ]
            model.Add(sum(sub_event_vars) == 1)
            sub_event_vars_list.append((sig, sub_sc_list, sub_event_vars))

            # 3d. 計算此次分組的 allowed periods
            sub_allowed = set(range(TOTAL_PERIODS))
            for sc in sub_sc_list:
                is_auto_time = sc.get("isAutoTime", False)
                locked_slots = sc.get("lockedSlots", [])
                if not is_auto_time and locked_slots:
                    allowed = set()
                    for slot in locked_slots:
                        d = int(slot.get("day", 1))
                        pr = int(slot.get("period", 1))
                        p_lock = (d - 1) * PERIODS_PER_DAY + (pr - 1)
                        if 0 <= p_lock < TOTAL_PERIODS:
                            allowed.add(p_lock)
                    sub_allowed &= allowed

            # 3e. 下午禁排過濾
            for p in range(TOTAL_PERIODS):
                for c in classes_in_pool:
                    grade = class_grade_map.get(c, 1)
                    if not is_period_allowed_for_grade(grade, p):
                        if mode == "auto":
                            model.Add(sub_event_vars[p] + select_c_vars[c] <= 1)
                        else:
                            model.Add(sub_event_vars[p] == 0)

            # 3f. 應用 lockedSlots 約束
            if len(sub_allowed) == 1:
                p_lock = next(iter(sub_allowed))
                sc_sample = sub_sc_list[0] if sub_sc_list else {}
                is_movable = is_special_course_lock_movable(sc_sample, movable_locks_policy)
                if is_movable:
                    global_allowed = set()
                    for p in range(TOTAL_PERIODS):
                        is_allowed = True
                        for c in classes_in_pool:
                            grade = class_grade_map.get(c, 1)
                            if not is_period_allowed_for_grade(grade, p):
                                is_allowed = False
                                break
                        if is_allowed:
                            global_allowed.add(p)
                            
                    candidates = get_candidate_periods(p_lock, movable_locks_policy, allowed_periods=global_allowed)
                    def var_getter(p):
                        return sub_event_vars[p]
                        
                    decision_meta = {
                        "lockType": "special_course_lock",
                        "className": ",".join(classes_in_pool),
                        "subject": sc_sample.get("targetSubject", "未知"),
                        "specialCourseType": sc_sample.get("name", ""),
                        "from_period": p_lock,
                    }
                    apply_movable_lock(model, p_lock, candidates, var_getter, decision_meta)
                    print(f"  [LOCK] [可遷移抽離鎖定] {sc_sample.get('name')} (班級={','.join(classes_in_pool)}) 第{p_lock//PERIODS_PER_DAY+1}天第{p_lock%PERIODS_PER_DAY+1}節")
                else:
                    model.Add(sub_event_vars[p_lock] == 1)
            elif len(sub_allowed) > 1:
                for p in range(TOTAL_PERIODS):
                    if p not in sub_allowed:
                        model.Add(sub_event_vars[p] == 0)

            sub_idx += 1

        # 3g. [SEMANTIC FIX] 教師佔用：同一事件的所有次分組共用教師佔用
        # 但每個次分組在不同時段，所以不會互相衝突
        if teacher:
            for sig, sub_sc_list, sub_event_vars in sub_event_vars_list:
                for p in range(TOTAL_PERIODS):
                    teacher_p_sc_vars[(teacher, p)].append(sub_event_vars[p])

        # 3h. 為每個 pullout 記錄 sc_decision_vars
        for sig, sub_sc_list, sub_event_vars in sub_event_vars_list:
            for sc in sub_sc_list:
                sc_id = sc.get("id")
                subj = sc.get("targetSubject", "")
                sc_target_classes = sc.get("targetClasses") or []
                sc_classes = sc_target_classes if mode == "shared" and sc_target_classes else classes_in_pool

                # ── 記錄 effective_subjects 資訊 ──
                effective_subjects_map = {}
                if subj:
                    effective_subjects_map = {
                        c: resolve_effective_special_course_subject(sc, c, preprocess_metadata)
                        for c in sc_classes
                    }

                sc_decision_vars.append({
                    "sc": sc,
                    "vars": sub_event_vars,  # [SEMANTIC FIX] 指向次分組 vars
                    "classes_pool": sc_classes,
                    "select_vars": select_c_vars,
                    "mode": mode,
                    "effective_subjects": effective_subjects_map,
                })

                # 3i. 同步排課約束（使用 effective subject 做映射）
                if subj:
                    # ── 映射失敗 warning 去重：每個 (class, effective_subj) 只記一次 ──
                    _warned_missing = set()

                    for p in range(TOTAL_PERIODS):
                        for c in sc_classes:
                            effective_subj = resolve_effective_special_course_subject(
                                sc, c, preprocess_metadata
                            )
                            class_p_subj_vars = schedule_by_c_p_s.get((c, p, effective_subj), [])
                            if not class_p_subj_vars:
                                # ── 診斷：找不到對應變數，per (class, subject) 只警告一次 ──
                                warn_key = (c, effective_subj)
                                if effective_subj != subj and warn_key not in _warned_missing:
                                    _warned_missing.add(warn_key)
                                    logging.warning(
                                        "[特殊課程] %s 班=%s 原始科目=%s 映射科目=%s "
                                        "但 solver 仍找不到對應 schedule 變數",
                                        sc.get("name"), c, subj, effective_subj
                                    )
                                continue

                            if mode == "auto":
                                model.Add(
                                    sum(class_p_subj_vars) >= sub_event_vars[p] + select_c_vars[c] - 1
                                )
                            else:
                                model.Add(sum(class_p_subj_vars) >= sub_event_vars[p])

    # 4. 特教教師衝堂防護與常規配課衝突限制
    sc_subjects_by_teacher = defaultdict(set)
    for sc in special_courses or []:
        sc_t = sc.get("teacher", "")
        sc_s = sc.get("targetSubject", "")
        if sc_t and sc_s:
            sc_subjects_by_teacher[sc_t].add(sc_s)

    for (teacher, p), sc_vars_at_p in teacher_p_sc_vars.items():
        t_sc_subjs = sc_subjects_by_teacher.get(teacher, set())
        reg_t_vars = schedule_by_t_p.get((teacher, p), [])
        regular_rep_vars = []
        seen_subjs = set()
        for subj, var in reg_t_vars:
            if subj in t_sc_subjs:
                continue
            if subj not in seen_subjs:
                seen_subjs.add(subj)
                regular_rep_vars.append(var)
        model.Add(sum(regular_rep_vars) + sum(sc_vars_at_p) <= 1)

    # 把 sc_decision_vars 暫存到 model 中，方便主程式存取
    model.sc_decision_vars = sc_decision_vars
