"""
base_rules.py — 排課系統基礎建模規則

負責：
  1. 創建 schedule 變數 (class, period, teacher, subject) -> BoolVar
  2. 滿足各班課程需求的硬約束
  3. alternating_class_is_music_odd BoolVar 創建（需訪問 model）
  4. 手動預排鎖定掃描與 audit log
  5. 返回 locked_vars 集合供後續約束使用

依賴：config, utils (純函式)
不依賴：OR-Tools 以外的外部模組
"""

import terminal_sanitizer
import re
from config import DAYS, PERIODS_PER_DAY, TOTAL_PERIODS
from constraints.movable_locks import is_manual_lock_movable, is_cell_per_cell_movable, get_candidate_periods, apply_movable_lock


def create_schedule_vars_and_course_demands(model, classes_data, schedule):
    """
    [硬約束 1] 為每個班級的每個課程需求創建 BoolVar，
    並強制 sum(schedule vars for this req) == periods_needed。

    同時處理音樂美勞_交替的雙老師綁定。

    Args:
        model: ortools.sat.python.cp_model.CpModel
        classes_data: list of class dicts with course_requirements
        schedule: dict to populate with (c, p, t, s) -> BoolVar mapping

    Returns:
        None (mutates schedule in-place)
    """
    for cls in classes_data:
        c_name = cls.get("name")
        reqs = cls.get("course_requirements", [])
        total_needed_for_class = 0
        # [FIX] 去重機制：防止同一班級的多筆「交替」課程需求被重複計算
        # key: (班級, 交替科目) -> 避免因音樂老師和美勞老師各一筆而导致需求節數翻倍
        seen_alternating = set()

        for req in reqs:
            subject = req.get("subject", "未知科目")
            periods_needed = int(req.get("periods", 0))
            t_name = req.get("teacher_name") or req.get("teacher")

            if not t_name:
                print(f"[WARN] [警告] 班級 {c_name} 的 {subject} 沒有指派老師！這會導致該科無法排課。")
                continue
            if periods_needed <= 0:
                continue

            # [FIX] 交替課去重：同一班級同一名交替科目只處理第一筆（通常是音樂老師那筆）
            # 第二筆（美勞老師）直接跳過，因為變數和約束已在第一筆建立
            if "交替" in subject:
                alt_key = (c_name, subject)
                if alt_key in seen_alternating:
                    print(f"  [SKIP] [交替去重] 跳過 {c_name} 的重複交替需求: {subject} ({t_name})")
                    continue
                seen_alternating.add(alt_key)

            total_needed_for_class += periods_needed

            vars_for_this_req = []
            for p in range(TOTAL_PERIODS):
                var = model.NewBoolVar(f"c_{c_name}_p_{p}_t_{t_name}_s_{subject}")
                schedule[(c_name, p, t_name, subject)] = var
                vars_for_this_req.append(var)

            model.Add(sum(vars_for_this_req) == periods_needed)

            # [OK] 重構後：「音樂美勞_交替」只建立一組變數（以主老師 teacher_name 為 key）
            # 實際授課老師由 is_music_odd 方向變數決定，不再為美勞老師建立獨立 BoolVar
            # 這避免了同一班級同一 subject 出現兩組交替變數的問題

        raw_grade = cls.get("grade")
        print(f"[INFO] [檢查] 班級 {c_name} (前端傳入年級: {raw_grade}) | 本週總需求: {total_needed_for_class} 節")

    # ==========================================
    # 🛡️ 排他性約束：同一班級同一時段最多一個科目
    # 這是防止 class_slot_conflicts 的核心硬約束
    # sum over all subjects for (class, period) <= 1
    # ==========================================
    classes_list = list(set(cls.get("name") for cls in classes_data if cls.get("name")))
    exclusive_count = 0
    for c in classes_list:
        for p in range(TOTAL_PERIODS):
            vars_for_slot = [
                var for (k_c, k_p, k_t, k_s), var in schedule.items()
                if k_c == c and k_p == p
            ]
            if len(vars_for_slot) > 1:
                model.add(sum(vars_for_slot) <= 1)
                exclusive_count += 1

    print(f"[INFO] [建模] 創建了 {len(schedule)} 個 schedule 變數")
    print(f"[INFO] [排他約束] 加入了 {exclusive_count} 個 at-most-one 約束 (班級/時段排他)")


def create_alternating_vars(model, classes_data):
    """
    為有「交替」課程（如音樂美勞_交替，健/s, s/社）的班級創建 is_alt_odd BoolVar。
    is_alt_odd=1 → 單週上科目A / 雙週上科目B
    is_alt_odd=0 → 單週上科目B / 雙週上科目A

    Returns:
        tuple:
          - alternating_class_is_music_odd : dict (class_name, teacher_name) -> BoolVar
          - alternating_group_map          : dict pair_group_id -> [class_name, ...]
          - class_pair_group               : dict class_name -> pair_group_id
          - class_teacher_pair             : dict class_name -> (music_t, art_t)
    """
    alternating_class_is_music_odd = {}
    alternating_group_map = {}    # pair_group_id -> [class_name]
    class_pair_group      = {}    # class_name    -> pair_group_id
    class_teacher_pair    = {}    # class_name    -> (music_t, art_t)
    seen_alt_classes      = set()

    for cls in classes_data:
        c_name = cls.get("name", "")
        # 注意：不要因為班級已處理過一個交替類型，就跳過其他交替類型（如音美與健s應並存）
        # 所以 seen key 應加上科目類型

        for req in cls.get("course_requirements", []):
            subj   = req.get("subject", "")
            t_name = req.get("teacher_name", "")

            # 泛型交替判斷
            is_alt = req.get("is_alternating", False) or "交替" in subj or "/" in subj
            if not is_alt or not t_name:
                continue
            if int(req.get("periods", 0)) <= 0:
                continue

            alt_type_key = (c_name, subj)
            if alt_type_key in seen_alt_classes:
                continue

            music_t  = req.get("teacher_music", t_name)
            # 若為健/s等單一老師授課，art_t 默認與 music_t 相同
            art_t    = req.get("teacher_art", "") or req.get("teacher_partner", "") or t_name
            raw_grade = cls.get("grade")

            # [20260612] pair_group_id 格式修正：
            # - 音美交替（含"音樂"/"美勞"/"藝術"）：包含年級，同年級配對
            # - 泛型交替（如健/s、s/社）：保留年級作用域
            is_music_art = any(kw in subj for kw in ("音樂", "美勞", "美術", "藝術")) or \
                           (req.get("teacher_music") and req.get("teacher_art"))

            if req.get("pair_group_id"):
                group_id = req.get("pair_group_id")
            elif is_music_art:
                # 音美交替 fallback：與 preprocessor 使用相同的 md5+grade 規則
                import hashlib as _hashlib
                raw_key = f"{music_t}|{art_t}|{raw_grade}"
                group_id = "g_" + _hashlib.md5(raw_key.encode("utf-8")).hexdigest()[:8]
            else:
                # 泛型交替：保留 grade 作用域
                group_id = f"g_{music_t}_{art_t}_{raw_grade}"

            safe_name = c_name.replace("年", "").replace("班", "")
            # 使變量名稱具備科目唯一性，避免多個不同交替類型（如音美、健s）使用相同變量而衝突
            var_suffix = subj.split('/')[0][:3] if '/' in subj else "art"
            var = model.NewBoolVar(f"is_alt_odd_{safe_name}_{music_t}_{var_suffix}")

            # 音樂/主老師 key（與 schedule dict key 一致）
            alternating_class_is_music_odd[(c_name, music_t)] = var
            print(f"[WARN] 創建單雙週變量: {c_name} + {music_t} ({subj}) → {var}")

            # 美勞/副老師也指向同一變數（方向共用）
            if art_t and art_t != music_t:
                alternating_class_is_music_odd[(c_name, art_t)] = var
                print(f"[WARN] 副老師綁定同一變量: {c_name} + {art_t} → {var}")

            # 群組資料
            alternating_group_map.setdefault(group_id, [])
            if c_name not in alternating_group_map[group_id]:
                alternating_group_map[group_id].append(c_name)
            class_pair_group[c_name]   = group_id
            class_teacher_pair[c_name] = (music_t, art_t)

            seen_alt_classes.add(alt_type_key)

    print(f"\n[INFO] [交替群組] 共 {len(alternating_group_map)} 組師資配對：")
    for gid, members in alternating_group_map.items():
        print(f"   {gid}: {members}")

    return (
        alternating_class_is_music_odd,
        alternating_group_map,
        class_pair_group,
        class_teacher_pair,
    )


def apply_preallocation_locks(model, classes_data, schedule, movable_locks_policy=None):
    """
    掃描前端傳入的 timetable 中 isLocked=true 的格子，
    將對應的 schedule BoolVar 鎖定為 1，並將同一時段的其他科目鎖定為 0。
    （若符合可遷移鎖定條件，則套用 movable_locks）

    Args:
        model: ortools.sat.python.cp_model.CpModel
        classes_data: list of class dicts (may contain timetable field)
        schedule: dict with (c, p, t, s) -> BoolVar
        movable_locks_policy: dict with prototype configuration


    Returns:
        tuple: (locked_count: int, locked_vars: set, lock_audit_log: list[dict])
    """
    print("\n[LOCK] [鎖定掃描] 開始掃描手動預排鎖定...")
    locked_count = 0
    lock_audit_log = []
    locked_vars = set()

    for cls_data in classes_data:
        current_c_name = cls_data.get("name")
        raw_timetable = cls_data.get("timetable")

        if not raw_timetable:
            continue

        if isinstance(raw_timetable, list):
            _process_array_timetable(model, current_c_name, raw_timetable, schedule, lock_audit_log, locked_vars, movable_locks_policy)
            locked_count += _count_valid_locks(lock_audit_log)
        elif isinstance(raw_timetable, dict):
            _process_dict_timetable(model, current_c_name, raw_timetable, schedule, lock_audit_log, locked_vars, movable_locks_policy)
            locked_count += _count_valid_locks(lock_audit_log)

    # 輸出 Lock Audit 報告
    ghost_candidates = [e for e in lock_audit_log if e["verdict"] == "GHOST_LOCK_CANDIDATE"]
    with open('debug_lock_audit.txt', 'w', encoding='utf-8') as f:
        write = lambda text: f.write(terminal_sanitizer.sanitize_text(text))

        write("=== [DEBUG] Lock Audit Report ===\n\n")
        write(f"總計 isLocked 格子：{len(lock_audit_log)} 個\n")
        write(f"成功匹配（有效鎖）：{len(lock_audit_log) - len(ghost_candidates)} 個\n")
        write(f"幽靈鎖候選（無法匹配）：{len(ghost_candidates)} 個\n\n")

        if ghost_candidates:
            write("[WARN] 以下為幽靈鎖候選（isLocked=true 但 solver 找不到對應的課程需求）：\n")
            for e in ghost_candidates:
                write(f"  - {e['class']} 第{e['day']}天第{e['period']}節：subject={e['subject']}, teacher={e['teacher']}\n")
            write("\n這些格子目前不會鎖定任何變數，但若日後加入課程需求後可能造成衝突。\n")

        write("\n=== 完整稽核明細 ===\n")
        for e in lock_audit_log:
            write(f"[{e['verdict']}] {e['class']} 第{e['day']}天第{e['period']}節 | {e['subject']} / {e['teacher']} | 匹配變數: {e['match_count']} 個\n")

    if len(locked_vars) > 0:
        print(f"\n[OK] 成功載入並鎖定 {len(locked_vars)} 堂手動預排課程！")
        print(f"[LOG] [Lock Audit] 稽核報告已輸出至 debug_lock_audit.txt（幽靈鎖候選: {len(ghost_candidates)} 個）")
    else:
        print(f"\n [鎖定掃描] 未偵測到任何手動鎖定時段")
        print(f"[LOG] [Lock Audit] 稽核報告已輸出至 debug_lock_audit.txt（幽靈鎖候選: {len(ghost_candidates)} 個）")

    return len(locked_vars), locked_vars, lock_audit_log


def _process_cell(model, current_c_name, abs_p, lock_subj, lock_teach, schedule, lock_audit_log, locked_vars, movable_locks_policy=None, cell=None):
    """
    處理單個 locked cell。內部輔助函式。
    """
    match_vars = []
    other_vars = []
    for (sch_c, sch_p, sch_t, sch_s), var in schedule.items():
        if sch_c == current_c_name and sch_p == abs_p:
            if lock_subj and lock_teach and lock_subj in sch_s and lock_teach in sch_t:
                match_vars.append(var)
            else:
                other_vars.append(var)

    day = abs_p // PERIODS_PER_DAY
    period = abs_p % PERIODS_PER_DAY

    audit_entry = {
        "class": current_c_name,
        "day": day + 1,
        "period": period + 1,
        "subject": lock_subj,
        "teacher": lock_teach,
        "matched": len(match_vars) > 0,
        "match_count": len(match_vars),
        "verdict": "VALID_LOCK" if match_vars else "GHOST_LOCK_CANDIDATE"
    }
    lock_audit_log.append(audit_entry)

    if match_vars:
        if is_manual_lock_movable(lock_subj, movable_locks_policy, cell=cell):
            must_cross_noon = is_cell_per_cell_movable(cell)
            candidates = get_candidate_periods(abs_p, movable_locks_policy, must_cross_noon=must_cross_noon)
            def var_getter(p):
                return schedule.get((current_c_name, p, lock_teach, lock_subj))
            
            decision_meta = {
                "lockType": "manual_subject_lock",
                "className": current_c_name,
                "subject": lock_subj,
                "specialCourseType": None,
                "from_period": abs_p,
            }
            apply_movable_lock(model, abs_p, candidates, var_getter, decision_meta)
            print(f"  [LOCK] [可遷移鎖定] {current_c_name} 第{day+1}天第{period+1}節 -> {lock_subj} ({lock_teach})")
        else:
            model.Add(match_vars[0] == 1)
            locked_vars.add(match_vars[0])
            for ov in other_vars:
                model.Add(ov == 0)
            print(f"  [LOCK] [手動鎖定] {current_c_name} 第{day+1}天第{period+1}節 -> {lock_subj} ({lock_teach})")
    else:
        print(f"   [幽靈鎖跳過] {current_c_name} 第{day+1}天第{period+1}節 -> {lock_subj} ({lock_teach})：無對應課程需求，已略過")


def _process_array_timetable(model, current_c_name, raw_timetable, schedule, lock_audit_log, locked_vars, movable_locks_policy=None):
    """處理 Array 格式的 timetable: timetable[day_idx][period_idx]"""
    for day_idx, day_data in enumerate(raw_timetable):
        if not isinstance(day_data, list):
            continue
        for period_idx, cell in enumerate(day_data):
            if not isinstance(cell, dict):
                continue
            if cell.get("isLocked") is True:
                lock_subj = cell.get("subject", "")
                lock_teach = cell.get("teacher") or cell.get("teacher_name", "")
                abs_p = day_idx * PERIODS_PER_DAY + period_idx
                if abs_p >= TOTAL_PERIODS:
                    continue
                _process_cell(model, current_c_name, abs_p, lock_subj, lock_teach, schedule, lock_audit_log, locked_vars, movable_locks_policy, cell=cell)

def _process_dict_timetable(model, current_c_name, raw_timetable, schedule, lock_audit_log, locked_vars, movable_locks_policy=None):
    """處理 Object 格式的 timetable: timetable[dayKey][periodKey]"""
    for day_key, day_data in raw_timetable.items():
        if not isinstance(day_data, dict):
            continue
        try:
            day_idx = int(day_key) - 1
        except (ValueError, TypeError):
            continue
        if day_idx < 0 or day_idx >= DAYS:
            continue
        for period_key, cell in day_data.items():
            if not isinstance(cell, dict):
                continue
            if cell.get("isLocked") is True:
                lock_subj = cell.get("subject", "")
                lock_teach = cell.get("teacher") or cell.get("teacher_name", "")
                try:
                    period_idx = int(period_key) - 1
                except (ValueError, TypeError):
                    continue
                if period_idx < 0 or period_idx >= PERIODS_PER_DAY:
                    continue
                abs_p = day_idx * PERIODS_PER_DAY + period_idx
                if abs_p >= TOTAL_PERIODS:
                    continue
                _process_cell(model, current_c_name, abs_p, lock_subj, lock_teach, schedule, lock_audit_log, locked_vars, movable_locks_policy, cell=cell)


def _count_valid_locks(lock_audit_log):
    """計算有效鎖的數量"""
    return sum(1 for e in lock_audit_log if e["verdict"] == "VALID_LOCK")


def apply_hard_slot_constraints(model, lesson_vars, hard_slot_mask, lesson_teacher_lookup=None):
    """Force lesson variables to 0 when their teacher is blocked by a hard slot rule."""
    applied = 0
    if not hard_slot_mask:
        return 0

    for key, var in lesson_vars.items():
        if isinstance(key, tuple) and len(key) == 4:
            # Format: (class_name, abs_period, teacher_name, subject)
            _, abs_p, teacher_id, _ = key
            day = (abs_p // PERIODS_PER_DAY) + 1
            period = (abs_p % PERIODS_PER_DAY) + 1
        elif isinstance(key, tuple) and len(key) >= 3:
            # Format: (lesson, day, period) or similar
            day = key[1]
            period = key[2]
            teacher_id = (lesson_teacher_lookup or {}).get(key)
        else:
            continue

        if not teacher_id:
            continue

        if (day, period) in hard_slot_mask.get(teacher_id, set()):
            model.Add(var == 0)
            applied += 1

    return applied

