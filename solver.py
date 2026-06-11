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

import sys
import json
import time
import re
from collections import defaultdict

from ortools.sat.python import cp_model

from phase2_engine import SchedulePhase2Engine
from config import DAYS, PERIODS_PER_DAY, TOTAL_PERIODS, LUNCH_BOUNDARY
from utils import (
    parse_grade,
    is_virtual_teacher,
    normalize_room_name,
    get_subject_capacity,
)
from preprocessor import preprocess_classes
from constraints.base_rules import (
    create_schedule_vars_and_course_demands,
    create_alternating_vars,
    apply_preallocation_locks,
)
from constraints.teacher_rules import (
    apply_anti_collision,
    apply_teacher_quota,
    apply_teacher_unavailable_slots,
    apply_special_course_locks,
)
from constraints.class_rules import (
    apply_daily_subject_limit,
    apply_afternoon_prohibition,
    apply_no_consecutive_subject,
    apply_special_classroom_capacity,
    apply_science_habits,
)
from constraints.special_rules import (
    apply_english_capacity,
    apply_no_consecutive_pe,
    apply_art_consecutive_constraint,
    apply_alternating_perfect_pairing,
    apply_swimming_engine_v2,
    add_consecutive_constraint,
    get_valid_consecutive_pairs,
)


def main():
    if len(sys.argv) != 3:
        print("❌ 參數錯誤：需提供 input_path 與 output_path")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ 讀取 JSON 失敗: {e}")
        sys.exit(1)

    job_id = data.get("jobId", "UNKNOWN")
    schoolInfo = data.get("schoolInfo", {})
    teachers_data = data.get("teachers", [])
    classes_data = data.get("classes", [])
    special_courses = data.get("specialCourses", [])

    # ==========================================
    # 專科教室容量取得
    # ==========================================
    classroom_limits_config = schoolInfo.get("classroomLimits", {})

    # 讀取 aiSettings
    ai_settings = data.get("aiSettings", {})

    # ==========================================
    # 前處理（grade修正 / ghost art清理 / homeroom合併 / arts拆分）
    # ==========================================
    classes_data, _metadata = preprocess_classes(classes_data, ai_settings)

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
    # 🆕 [gradePreferences] 組建教室親和力映射表
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

    print(f"📌 [gradePreferences] 教室年級親和力映射: {room_grade_affinity}")
    print(f"📌 [primaryTeacher 主場映射] 教室主責教師映射: {room_primary_teacher_map}")

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

    model = cp_model.CpModel()
    schedule = {}
    phase2_penalty_vars = []

    try:
        # ============================================================
        # Phase 1: 基礎建模
        # ============================================================
        print("📦 [建模] 創建 schedule 變數與課程需求約束. ..")
        create_schedule_vars_and_course_demands(model, classes_data, schedule)

        print("🔄 [建模] 創建 alternating BoolVar. ..")
        (
            alternating_class_is_music_odd,
            alternating_group_map,
            class_pair_group,
            class_teacher_pair,
        ) = create_alternating_vars(model, classes_data)

        print("🔒 [建模] 掃描手動預排鎖定. ..")
        locked_count, locked_vars, lock_audit_log = apply_preallocation_locks(model, classes_data, schedule)

        # ============================================================
        # Phase 2: 教師維度約束
        # ============================================================
        print("⚡ [核心約束] 加入教師衝堂防護. ..")
        apply_anti_collision(model, schedule, class_names, teacher_names, classes_data, ai_settings)

        print("⚡ [核心約束] 加入教師配額限制. ..")
        apply_teacher_quota(model, classes_data, teachers_data, schoolInfo)

        print("⚡ [核心約束] 加入不排課時段限制. ..")
        apply_teacher_unavailable_slots(model, schedule, teachers_data)

        print("⚡ [核心約束] 加入特殊課程鎖定. ..")
        apply_special_course_locks(model, schedule, special_courses, classes_data, teachers_data, ai_settings)

        # ============================================================
        # Phase 3: 班級維度約束
        # ============================================================
        print("⚡ [核心約束] 加入每日科任課上限. ..")
        apply_daily_subject_limit(model, classes_data, schedule, locked_vars)

        print("⚡ [核心約束] 加入低年級下午禁排. ..")
        apply_afternoon_prohibition(model, classes_data, schedule)

        print("⚡ [核心約束] 加入科任課不連堂. ..")
        apply_no_consecutive_subject(model, classes_data, schedule, locked_vars)

        print("⚡ [核心約束] 加入自然課排課習慣...")
        science_consec_map = apply_science_habits(model, classes_data, schedule, ai_settings)

        print("⚡ [核心約束] 加入專科教室容量限制...")
        classrooms = data.get("classrooms", [])
        apply_special_classroom_capacity(model, classes_data, schedule, classrooms,
                                         science_consec_map=science_consec_map,
                                         penalty_vars=phase2_penalty_vars,
                                         classroom_limits=classroom_limits_config,
                                         school_info=schoolInfo)

        # ============================================================
        # Phase 4: 特殊規則
        # ============================================================
        # 英文專科教室容量已整合進 apply_special_classroom_capacity 中，此處予以註銷
        # print("⚡ [核心約束] 加入英語容量限制...")
        # apply_english_capacity(model, classes_data, schedule, subject_room_count)

        print("⚡ [核心約束] 加入體育不連堂. ..")
        apply_no_consecutive_pe(model, classes_data, schedule)

        print("⚡ [核心約束] 加入音樂美勞至少一組連堂. ..")
        apply_art_consecutive_constraint(model, classes_data, schedule)

        print("⚡ [核心約束] 加入完美互補配對約束...")
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
        )

        print("⚡ [核心約束] 加入游泳引擎 v2. ..")
        apply_swimming_engine_v2(model, classes_data, schedule, ai_settings, phase2_penalty_vars)

        # 通用連堂約束
        print("⚡ [連堂約束] 掃描通用連堂需求. ..")
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

        print(f"  ✅ [連堂約束] 共處理 {consecutive_count} 個科目的連堂需求\n")

        # ============================================================
        # 執行引擎與求解
        # ============================================================
        engine = SchedulePhase2Engine(
            model, schedule, class_names, teacher_names,
            TOTAL_PERIODS, DAYS, PERIODS_PER_DAY,
            teachers_data=teachers_data,
            external_penalty_vars=phase2_penalty_vars,
            # 🆕 傳入教室親和力與主責教師映射
            room_grade_affinity=room_grade_affinity,
            room_primary_teacher_map=room_primary_teacher_map,
            classes_data=classes_data,
        )
        engine.build_soft_constraints()

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 1740.0
        solver.parameters.num_search_workers = 8

        start_time = time.time()
        status = solver.Solve(model)
        end_time = time.time()

        result = {
            "jobId": job_id,
            "status": solver.StatusName(status),
            "time_seconds": round(solver.WallTime(), 3),
            "total_penalty": 0,
            "schedule": [],
            "message": ""
        }

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            result["message"] = "成功產出課表"

            # ========== 🆕 輸出 AI 排定與湊班後的特殊專案/抽離課程 ==========
            result["specialCourses"] = []
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
                        "autoClassConfig": sc.get("autoClassConfig")
                    }
                    result["specialCourses"].append(updated_sc)

            # ── 預先建立 pair 對照表：(group_id, period) -> [class_name]
            active_alt_at = {}
            for (c, p, t, s), var in schedule.items():
                if "音樂美勞_交替" in s and solver.Value(var) == 1:
                    gid = class_pair_group.get(c)
                    if gid:
                        key = (gid, p)
                        active_alt_at.setdefault(key, [])
                        if c not in active_alt_at[key]:
                            active_alt_at[key].append(c)

            # 🆕 建立 (className, period_index) -> roomName 的對照表
            assigned_rooms = {}
            if hasattr(model, "classroom_assignments"):
                for item in model.classroom_assignments:
                    try:
                        if solver.Value(item["var"]) == 1:
                            assigned_rooms[(item["className"], item["period"])] = item["roomName"]
                    except Exception:
                        pass

            # ── 主輸出迴圈
            for (c, p, t, s), var in schedule.items():
                if solver.Value(var) != 1:
                    continue

                day    = (p // PERIODS_PER_DAY) + 1
                period = (p % PERIODS_PER_DAY) + 1

                final_subject = s
                pair_fields   = {}

                # 泛型交替科目判斷
                is_alt = "交替" in s or "/" in s
                if is_alt:
                    # 決定單雙週科目名稱的動態拆分
                    subj_parts = s.split('/')
                    if len(subj_parts) == 2:
                        subj_a, subj_b = subj_parts[0], subj_parts[1]
                    else:
                        subj_a, subj_b = "音樂", "美勞"  # fallback

                    # 查 is_music_odd 方向
                    bool_val = None
                    if (c, t) in alternating_class_is_music_odd:
                        bool_val = solver.Value(alternating_class_is_music_odd[(c, t)])
                    else:
                        art_t = class_teacher_pair.get(c, ("", ""))[1]
                        if (c, art_t) in alternating_class_is_music_odd:
                            bool_val = solver.Value(alternating_class_is_music_odd[(c, art_t)])

                    if bool_val == 1:
                        final_subject  = f"{subj_a}(單)/{subj_b}(雙)"
                        pair_role      = "A"
                        pair_direction = "music-first"
                    else:
                        final_subject  = f"{subj_b}(單)/{subj_a}(雙)"
                        pair_role      = "B"
                        pair_direction = "art-first"

                    gid      = class_pair_group.get(c)
                    partners = [cx for cx in active_alt_at.get((gid, p), []) if cx != c]
                    pair_partner = partners[0] if partners else None

                    if pair_partner is None:
                        print(f"  ⚠️ [Pair 診斷] {c} 第{day}天第{period}節 找不到配對班！group={gid}")

                    pair_fields = {
                        "pairGroupId":      gid,
                        "pairPartnerClass": pair_partner,
                        "pairRole":         pair_role,
                        "pairDirection":    pair_direction,
                    }

                classroom_name = assigned_rooms.get((c, p), "")

                entry = {
                    "day":         day,
                    "period":      period,
                    "className":   c,
                    "teacherName": t,
                    "subject":     final_subject,
                    "classroomName": classroom_name, # 🆕 新增此屬性
                }
                entry.update(pair_fields)
                result["schedule"].append(entry)

            # 🔍 求解後診斷：驗證美勞固定課與交替課連堂
            _validate_art_alternating_consecutive(result["schedule"], classes_data)

        elif status == cp_model.INFEASIBLE:
            result["message"] = "無法產出符合條件的課表 (條件矛盾)"
            _write_infeasible_report(data, classes_data, teachers_data, schedule, subject_room_count, subject_demand_count)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    except Exception as e:
        import traceback
        error_msg = f"演算法崩潰: {str(e)}\n{traceback.format_exc()}"
        print(f"❌ 嚴重錯誤: \n{error_msg}")

        error_result = {
            "jobId": job_id,
            "status": "ERROR",
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
        print("\n🔍 [診斷] 無交替班級，跳過美勞連堂驗證")
        return True

    print(f"\n🔍 [診斷] 檢查 {len(alt_classes)} 個交替班級的美勞連堂狀況...")
    all_ok = True

    for c_name in alt_classes:
        art_fixed_pos = None
        alt_pos = None
        for entry in schedule_entries:
            if entry["className"] != c_name:
                continue
            subj = entry["subject"]
            if "美勞_固定" in subj:
                art_fixed_pos = (entry["day"], entry["period"])
            if "交替" in subj or "(單)" in subj or "(雙)" in subj:
                alt_pos = (entry["day"], entry["period"])

        if art_fixed_pos is None or alt_pos is None:
            print(f"  ⚠️  {c_name}: 找不到完整的美勞_固定或交替課位置 (art={art_fixed_pos}, alt={alt_pos})")
            all_ok = False
            continue

        # 檢查是否同一天且相鄰
        if art_fixed_pos[0] != alt_pos[0]:
            print(f"  ❌ {c_name}: 美勞_固定(第{art_fixed_pos[0]}天)與交替(第{alt_pos[0]}天)不同天!")
            all_ok = False
            continue

        day, p1 = art_fixed_pos
        _, p2 = alt_pos
        diff = abs(p1 - p2)

        if diff != 1:
            print(f"  ❌ {c_name}: 美勞_固定(第{p1}節)與交替(第{p2}節)不相鄰! (差距={diff})")
            all_ok = False
            continue

        # 檢查是否跨午休 (LUNCH_BOUNDARY=4, 即第4節與第5節之間)
        min_p = min(p1, p2)
        if min_p == LUNCH_BOUNDARY:
            print(f"  ❌ {c_name}: 美勞連堂跨午休!(第{min_p}節與第{min_p+1}節)")
            all_ok = False
            continue

        print(f"  ✅ {c_name}: 美勞_固定(第{day}天第{p1}節) + 交替(第{day}天第{p2}節) → 連堂OK")

    if all_ok:
        print("  ✅ 所有交替班級的美勞連堂驗證通過!")
    else:
        print("  ⚠️  部分交替班級的美勞連堂驗證失敗!")

    return all_ok


def _write_infeasible_report(data, classes_data, teachers_data, schedule, subject_room_count, subject_demand_count):
    """
    寫入 INFEASIBLE 診斷報告。
    """
    teacher_loads = {}
    for cls in classes_data:
        for req in cls.get("course_requirements", []):
            t = req.get("teacher", "")
            if t:
                teacher_loads[t] = teacher_loads.get(t, 0) + int(req.get("periods", 0))

    with open('debug_infeasible_report.txt', 'w', encoding='utf-8') as f:
        f.write("=== 🚨 智慧排課 INFEASIBLE 增強診斷報告 ===\n\n")

        f.write("🔍 1. 【班級總節數與空堂極限掃描】\n")
        for cls in classes_data:
            reqs = cls.get("course_requirements", [])
            # 避免交替課被重複計算總節數
            total_p = 0
            alt_counted = False
            for r in reqs:
                subj = r.get("subject", "")
                if "交替" in subj:
                    if not alt_counted:
                        total_p += int(r.get("periods", 0))
                        alt_counted = True
                else:
                    total_p += int(r.get("periods", 0))
            grade = int(cls.get("name")[0]) if cls.get("name") and cls.get("name")[0].isdigit() else 1
            max_slots = 23 if grade in [1, 2] else (29 if grade in [3, 4] else 32)
            f.write(f" - {cls.get('name')}: 共需排 {total_p} 節課 (該年級上限: {max_slots} 節)")
            if total_p > max_slots:
                f.write(" ❌ 嚴重錯誤：排課需求大於可用空堂！\n")
            else:
                f.write(" ✅ 正常\n")

        f.write("\n🔍 2. 【教師負載與專長掃描】\n")
        for t, load in teacher_loads.items():
            f.write(f" - {t}: 被分配了 {load} 節課\n")
            if load > 24:
                f.write("   ⚠️ 警告：該教師超鐘點過多，可能導致空堂不足！\n")

        f.write("\n🔍 3. 【交替課配對可行性】\n")
        alt_teacher_stats = {}
        for (c, p, t, s), var in schedule.items():
            if "音樂美勞_交替" in s:
                alt_teacher_stats[t] = alt_teacher_stats.get(t, set()) | {c}
        for t, classes_set in alt_teacher_stats.items():
            num_classes = len(classes_set)
            f.write(f" - {t}: 負責 {num_classes} 個交替班級 ({', '.join(classes_set)})\n")
            if num_classes > 2:
                f.write(f"   ⚠️ 警告：同一時段最多只能上 2 個交替班級，{num_classes}>2 可能導致衝突！\n")

        f.write("\n🔍 4. 【有效時段充足性】\n")
        for cls in classes_data:
            c_name = cls.get("name", "")
            grade_match = re.search(r'(\d+)年', c_name)
            grade = int(grade_match.group(1)) if grade_match else 1
            reqs = cls.get("course_requirements", [])
            total_sci = 0
            seen_alt = set()
            for r in reqs:
                subj = r.get("subject", "")
                if "導師區塊" in subj:
                    continue
                periods = int(r.get("periods", 0))
                if "交替" in subj:
                    if subj not in seen_alt:
                        total_sci += periods
                        seen_alt.add(subj)
                else:
                    total_sci += periods
            forbidden_days = []
            if grade in [1, 2]:
                forbidden_days = [0, 2, 3, 4]
            elif grade in [3, 4]:
                forbidden_days = [2, 4]
            elif grade in [5, 6]:
                forbidden_days = [2]
            effective_periods = TOTAL_PERIODS - len(forbidden_days) * 3
            f.write(f" - {c_name}: 科任需求 {total_sci} 節 / 有效時段 {effective_periods} 節")
            if total_sci > effective_periods:
                f.write(" ❌ 需求超過有效時段！\n")
            else:
                f.write(" ✅\n")

        f.write("\n🔍 5. 【游泳資源分析】\n")
        swim_classes = [
            cls for cls in classes_data
            if re.search(r'\d+年', cls.get("name", ""))
            and int(re.search(r'(\d+)年', cls.get("name", "")).group(1)) in [4, 5, 6]
        ]
        f.write(f" - 4-6年級班級數: {len(swim_classes)}\n")
        f.write(f" - 泳池容量: 3 個\n")
        if len(swim_classes) > 3:
            f.write(f"   ⚠️ 游泳班數({len(swim_classes)}) > 泳池數(3)，軟懲罰已啟用但可能仍有壓力\n")

        f.write("\n🔍 6. 【教室容量 vs 總需求】\n")
        for room_key, count in subject_room_count.items():
            demand = subject_demand_count.get(room_key, 0)
            max_capacity = count * TOTAL_PERIODS
            f.write(f" - {room_key}: 容量 {count} 間 (週容量={max_capacity}節) / 總需求 {demand} 節")
            if demand > max_capacity:
                f.write(" ❌ 需求超過容量！\n")
            else:
                f.write(" ✅\n")

        f.write("\n🔍 7. 【教師同一時段能力掃描】\n")
        for t_data in teachers_data:
            t_name = t_data.get("name", "")
            safe_max = t_data.get("_safe_max_quota", 20)
            actual = teacher_loads.get(t_name, 0)
            if actual > 0:
                f.write(f" - {t_name}: 需求 {actual} 節 / 配額 {safe_max} 節")
                if actual > safe_max:
                    f.write(" ⚠️ 超出配額！\n")
                else:
                    f.write(" ✅\n")

        f.write("\n🔍 8. 【前端 Payload 原始資料檢查】\n")
        f.write("請同步查看專案根目錄的 debug_payload.json，確認前端送來的老師名字是否有空值或錯字。\n")

    with open('debug_payload.json', 'w', encoding='utf-8') as payload_file:
        json.dump(data, payload_file, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
