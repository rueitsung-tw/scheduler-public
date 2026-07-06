"""
排課診斷統計模組
計算 primaryTeacher 命中率、gradePreferences 命中率、容量超載診斷
可作為 CLI 獨立執行，也可被其他 Python 模組 import   
20260706
"""

import terminal_sanitizer
import json
import sys
import re
from collections import defaultdict

from utils import normalize_room_name
from config import CLASSROOM_LIMITS_FALLBACK


def _parse_grade_from_class_name(class_name):
    """從班級名稱解析年級"""
    match = re.search(r'(\d+)年', class_name)
    return int(match.group(1)) if match else 1


def _build_room_maps(classrooms):
    """
    從 classrooms 資料建立 primaryTeacher map 和 gradePreferences affinity。
    回傳 (room_primary_teacher_map, room_grade_affinity)
    """
    room_primary_teacher_map = {}   # {subject_normalized: teacher_name}
    room_grade_affinity = {}        # {subject_normalized: set(grades)}

    def normalize_subject_for_room(subj_raw):
        """對應 solver.py 的 normalize_subject_for_room 邏輯"""
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

        # gradePreferences
        gp_raw = room.get("gradePreferences", [])
        if isinstance(gp_raw, str):
            try:
                gp_raw = json.loads(gp_raw)
            except Exception:
                gp_raw = []
        gp = [int(g) for g in gp_raw if str(g).isdigit()] if isinstance(gp_raw, list) else []

        if subj not in room_grade_affinity:
            room_grade_affinity[subj] = set()
        for g in gp:
            room_grade_affinity[subj].add(g)

        # primaryTeacher：同一科目多間時，取第一個有設定的
        pt = room.get("primaryTeacher", "") or ""
        if pt and subj not in room_primary_teacher_map:
            room_primary_teacher_map[subj] = pt

    return room_primary_teacher_map, room_grade_affinity


def _build_classroom_limits(payload):
    """
    從 payload 建立 (subject_normalized, capacity) 容量對照表。
    優先使用 schoolInfo.classroomLimits，fallback 到 CLASSROOM_LIMITS_FALLBACK。
    """
    school_info = payload.get("schoolInfo", {})
    limits_raw = school_info.get("classroomLimits", {})

    # 也從 classrooms 建實體數量
    classrooms = payload.get("classrooms", [])
    classrooms_count_map = {}
    for room in classrooms:
        norm = normalize_room_name(room.get("name", ""))
        classrooms_count_map[norm] = classrooms_count_map.get(norm, 0) + 1

    limits = {}

    # 匯總所有可能的科目 key
    all_keys = set()
    all_keys.update(classrooms_count_map.keys())
    all_keys.update(limits_raw.keys())
    all_keys.update(CLASSROOM_LIMITS_FALLBACK.keys())

    for key in all_keys:
        cap = 0
        source = "unknown"

        # ① 實體教室
        if classrooms_count_map.get(key, 0) > 0:
            cap = classrooms_count_map[key]
            source = "classrooms"
        # ② schoolInfo.classroomLimits
        elif key in limits_raw:
            try:
                val = int(limits_raw[key])
                if val > 0:
                    cap = val
                    source = "schoolInfo"
            except (ValueError, TypeError):
                pass
        # ③ fallback
        if cap == 0 and key in CLASSROOM_LIMITS_FALLBACK:
            cap = CLASSROOM_LIMITS_FALLBACK[key]
            source = "fallback"

        if cap > 0:
            limits[key] = cap

    return limits


def _subject_is_special(subject_name):
    """
    判斷一個科目是否為專科（非導師區塊）。
    """
    if "導師區塊" in subject_name:
        return False
    return True


def compute_primary_teacher_hitrate(schedule_entries, room_primary_teacher_map, class_grade_map, subjects_in_payload):
    """
    計算 primaryTeacher 命中率。

    規則：
    - 只統計有設定 primaryTeacher 的教室科目
    - 對每一個可評估的課堂安排，若該科目對應的實際授課教師等於 primaryTeacher，就算命中
    - 不把沒有設定 primaryTeacher 的教室算進分母
    - 不把導師區塊或不適用的科目算進去

    Args:
        schedule_entries: solver/repair 輸出的 schedule list
        room_primary_teacher_map: {subject: teacher_name}
        class_grade_map: {class_name: grade_int}
        subjects_in_payload: 有 primaryTeacher 設定的科目 set

    Returns:
        (hit_rate, hit_count, evaluated_count)
    """
    if not room_primary_teacher_map:
        return (0.0, 0, 0)

    hit_count = 0
    evaluated_count = 0

    for entry in schedule_entries:
        subj = entry.get("subject", "")
        teacher = entry.get("teacherName", "")
        if not _subject_is_special(subj):
            continue

        # 找到該科目在有 primaryTeacher 的 mapping 中
        matched_room_subject = None
        for room_subj, pt_teacher in room_primary_teacher_map.items():
            # 用 contains 匹配，因為 subject 在 schedule 中可能是 "音樂(單)/美勞(雙)" 等變體
            if room_subj in subj or subj in room_subj:
                matched_room_subject = room_subj
                break

        if matched_room_subject is None:
            continue

        evaluated_count += 1
        if teacher == pt_teacher:
            hit_count += 1

    hit_rate = hit_count / evaluated_count if evaluated_count > 0 else 0.0
    return (hit_rate, hit_count, evaluated_count)


def compute_grade_preference_hitrate(schedule_entries, room_grade_affinity, class_grade_map):
    """
    計算 gradePreferences 命中率。

    規則：
    - 只統計有設定 gradePreferences 且 gradePreferences 不為空的教室科目
    - 當班級年級落在該科目的優先年級清單內時，算命中
    - gradePreferences = [] 視為共享，不納入年級命中率統計

    Args:
        schedule_entries: solver/repair 輸出的 schedule list
        room_grade_affinity: {subject: set(grades)}
        class_grade_map: {class_name: grade_int}

    Returns:
        (hit_rate, hit_count, evaluated_count)
    """
    # 過濾掉空偏好（共享）的科目
    graded_subjects = {s: grades for s, grades in room_grade_affinity.items() if len(grades) > 0}
    if not graded_subjects:
        return (0.0, 0, 0)

    hit_count = 0
    evaluated_count = 0

    for entry in schedule_entries:
        subj = entry.get("subject", "")
        class_name = entry.get("className", "")
        if not _subject_is_special(subj):
            continue

        cls_grade = class_grade_map.get(class_name)
        if cls_grade is None:
            continue

        # 找到匹配的 room subject
        matched_room_subject = None
        for room_subj, grades in graded_subjects.items():
            if room_subj in subj or subj in room_subj:
                matched_room_subject = room_subj
                break

        if matched_room_subject is None:
            continue

        evaluated_count += 1
        if cls_grade in graded_subjects[matched_room_subject]:
            hit_count += 1

    hit_rate = hit_count / evaluated_count if evaluated_count > 0 else 0.0
    return (hit_rate, hit_count, evaluated_count)


def compute_capacity_overload(schedule_entries, classroom_limits, days=5, periods_per_day=7):
    """
    計算容量超載情況。

    規則：
    - 以 classroom_limits 為準
    - 逐時段檢查 (day, period, subject) 的同時上課班數
    - 若同時上課班數 > 教室容量，記為 1 次超載
    - 回傳每個科目的超載次數

    Args:
        schedule_entries: solver/repair 輸出的 schedule list
        classroom_limits: {subject_normalized: capacity_int}
        days: 天數
        periods_per_day: 每天節數

    Returns:
        (total_overload_count, overload_by_subject_dict)
    """
    # 建立 (day, period, subject_normalized) -> 班數 的計數
    usage = defaultdict(lambda: defaultdict(int))  # (day, period) -> {subject: count}

    for entry in schedule_entries:
        day = entry.get("day", 1)
        period = entry.get("period", 1)
        subj_raw = entry.get("subject", "")
        if not _subject_is_special(subj_raw):
            continue

        # 正規化科目名稱以匹配 classroom_limits 的 key
        matched_key = None
        for limit_key in classroom_limits:
            if limit_key in subj_raw or subj_raw in limit_key:
                matched_key = limit_key
                break

        if matched_key is None:
            # 嘗試用 normalize_room_name 反向匹配
            for limit_key in classroom_limits:
                if limit_key in subj_raw:
                    matched_key = limit_key
                    break

        if matched_key:
            usage[(day, period)][matched_key] += 1

    total_overload = 0
    overload_by_subject = defaultdict(int)

    for (day, period), subject_counts in usage.items():
        for subj, count in subject_counts.items():
            cap = classroom_limits.get(subj, 999)
            if count > cap:
                overload_by_subject[subj] += 1
                total_overload += 1

    return (total_overload, dict(overload_by_subject))


def compute_diagnostic_stats(payload_path, schedule_result_path):
    """
    主入口：計算完整的診斷統計。

    Args:
        payload_path: payload JSON 檔案路徑
        schedule_result_path: solver 或 repair 輸出的 schedule result JSON 路徑

    Returns:
        StatisticsResult dict
    """
    with open(payload_path, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    with open(schedule_result_path, 'r', encoding='utf-8') as f:
        schedule_result = json.load(f)

    classrooms = payload.get("classrooms", [])
    classes_data = payload.get("classes", [])
    schedule_entries = schedule_result.get("schedule", [])

    # 建立對照表
    room_primary_teacher_map, room_grade_affinity = _build_room_maps(classrooms)
    classroom_limits = _build_classroom_limits(payload)

    class_grade_map = {}
    for cls in classes_data:
        class_grade_map[cls.get("name", "")] = _parse_grade_from_class_name(cls.get("name", ""))

    # 將 set 轉回 list 供後續使用
    room_grade_affinity_lists = {s: list(grades) for s, grades in room_grade_affinity.items()}

    # 1. primaryTeacher 命中率
    pt_hit_rate, pt_hit_count, pt_evaluated = compute_primary_teacher_hitrate(
        schedule_entries, room_primary_teacher_map, class_grade_map,
        set(room_primary_teacher_map.keys())
    )

    # 2. gradePreferences 命中率
    gp_hit_rate, gp_hit_count, gp_evaluated = compute_grade_preference_hitrate(
        schedule_entries, room_grade_affinity_lists, class_grade_map
    )

    # 3. 容量超載
    overload_count, overload_by_subject = compute_capacity_overload(
        schedule_entries, classroom_limits
    )

    return {
        "primaryTeacherHitRate": round(pt_hit_rate, 4),
        "primaryTeacherHitCount": pt_hit_count,
        "primaryTeacherEvaluatedCount": pt_evaluated,
        "gradePreferenceHitRate": round(gp_hit_rate, 4),
        "gradePreferenceHitCount": gp_hit_count,
        "gradePreferenceEvaluatedCount": gp_evaluated,
        "capacityOverloadCount": overload_count,
        "capacityOverloadBySubject": overload_by_subject,
    }


def _generate_recommendation(pre, post, delta):
    """根據診斷結果產生調整建議"""
    tips = []

    pt_pre = pre["primaryTeacherHitRate"]
    pt_post = post["primaryTeacherHitRate"]
    gp_pre = pre["gradePreferenceHitRate"]
    gp_post = post["gradePreferenceHitRate"]
    overload_pre = pre["capacityOverloadCount"]
    overload_post = post["capacityOverloadCount"]

    # primaryTeacher 命中率判定
    if pt_post < 0.7:
        tips.append("primaryTeacher 命中率偏低 (<70%)，建議提升 PRIMARY_TEACHER_MISS_PENALTY 權重")
    elif pt_post < 0.85:
        tips.append("primaryTeacher 命中率中等 (70-85%)，可觀察或微調 PRIMARY_TEACHER_MISS_PENALTY")
    else:
        tips.append("primaryTeacher 命中率良好 (>=85%)，無需調整")

    # gradePreferences 命中率判定
    if gp_post < 0.7:
        tips.append("gradePreferences 命中率偏低 (<70%)，建議提升 GRADE_AFFINITY_MISS_PENALTY 權重")
    elif gp_post < 0.85:
        tips.append("gradePreferences 命中率中等 (70-85%)，可觀察或微調 GRADE_AFFINITY_MISS_PENALTY")
    else:
        tips.append("gradePreferences 命中率良好 (>=85%)，無需調整")

    # 容量超載判定
    if overload_post > overload_pre:
        tips.append(f"[WARN] Repair 後容量超載惡化 ({overload_pre}→{overload_post})，請檢查 Repair Agent 的容量防護邏輯")
    elif overload_post < 0:
        tips.append("容量超載數為負值，統計可能有誤")
    elif overload_post == 0:
        tips.append("容量超載已完全消除")
    else:
        tips.append(f"容量超載 {overload_pre}→{overload_post}，仍有 {overload_post} 次超載")

    # 綜合判斷
    if pt_post >= 0.85 and gp_post >= 0.85 and overload_post <= overload_pre:
        tips.append("\n[OK] 綜合判斷：目前權重設定合理，不需要調整")
    elif pt_post < 0.7 and gp_post < 0.7:
        tips.append("\n[WARN] 綜合判斷：兩個命中率都偏低，建議優先提升 PRIMARY_TEACHER_MISS_PENALTY")
    elif pt_post >= 0.85 and gp_post < 0.7:
        tips.append("\n[WARN] 綜合判斷：primaryTeacher 正常但 gradePreferences 偏低，建議提升 GRADE_AFFINITY_MISS_PENALTY")
    elif overload_post > overload_pre:
        tips.append("\n[WARN] 綜合判斷：Repair 後超載惡化，先查 Repair Agent 再調權重")

    return " | ".join(tips)


if __name__ == "__main__":
    """
    CLI 模式：
    python diagnostic_stats.py <payload.json> <schedule_result.json>
    輸出 JSON 統計結果到 stdout
    """
    if len(sys.argv) < 3:
        print("用法: python diagnostic_stats.py <payload.json> <schedule_result.json>")
        sys.exit(1)

    payload_path = sys.argv[1]
    schedule_result_path = sys.argv[2]

    result = compute_diagnostic_stats(payload_path, schedule_result_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
