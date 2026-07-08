"""
排課系統前處理模組
負責純資料變形：grade 修正、ghost art 清理、homeroom blockization、音樂/美勞 1.5+1.5 拆分
不碰 OR-Tools model
"""

import terminal_sanitizer
import re
import math
from utils import parse_grade


_DEFAULT_GRADE_RULES = {
    "生活": {1, 2},
    "自然科學": {3, 4, 5, 6},
    "音樂": {3, 4, 5, 6},
    "美勞": {3, 4, 5, 6},
    "社會": {3, 4, 5, 6},
    "綜合活動": {3, 4, 5, 6},
    "科技-資訊": {3, 4, 5, 6},
}


def _canonical_subject_for_grade_rules(subject):
    subject = str(subject or "").strip()
    if not subject:
        return ""
    if subject.startswith("音樂"):
        return "音樂"
    if subject.startswith("美勞"):
        return "美勞"
    if subject.startswith("自然"):
        return "自然科學"
    if subject.startswith("科技-資訊") or subject.startswith("資訊") or subject.startswith("電腦"):
        return "科技-資訊"
    return subject


def _build_grade_rules_from_standard_domain_settings(standard_domain_settings):
    grade_rules = {}
    for entry in standard_domain_settings or []:
        subject = _canonical_subject_for_grade_rules(entry.get("name") or entry.get("subject") or entry.get("subjectName"))
        periods = entry.get("periods", {})
        if not subject or not isinstance(periods, dict):
            continue

        allowed_grades = set()
        for grade_key, value in periods.items():
            try:
                grade = int(grade_key)
                if float(value or 0) > 0:
                    allowed_grades.add(grade)
            except (TypeError, ValueError):
                continue

        grade_rules[subject] = allowed_grades
    return grade_rules


def _normalize_subject_grade_rules(subject_grade_rules):
    normalized = {}
    for subj, grades in (subject_grade_rules or {}).items():
        if not isinstance(grades, (list, set, tuple)) or len(grades) <= 0:
            continue

        allowed_grades = set()
        for grade in grades:
            try:
                allowed_grades.add(int(grade))
            except (TypeError, ValueError):
                continue

        if allowed_grades:
            normalized[_canonical_subject_for_grade_rules(subj)] = allowed_grades

    return normalized


def build_effective_grade_rules(standard_domain_settings=None, subject_grade_rules=None):
    effective_rules = {subject: set(grades) for subject, grades in _DEFAULT_GRADE_RULES.items()}
    effective_rules.update(_build_grade_rules_from_standard_domain_settings(standard_domain_settings))
    effective_rules.update(_normalize_subject_grade_rules(subject_grade_rules))
    return effective_rules


def allowed_grades_for_subject(subject, grade_rules=None):
    canonical = _canonical_subject_for_grade_rules(subject)
    rules = grade_rules if grade_rules is not None else _DEFAULT_GRADE_RULES
    return rules.get(canonical)


def _sanitize_requirements_by_grade(cls, metadata, grade_rules=None):
    grade = parse_grade(cls)
    if grade is None:
        return

    reqs = cls.get("course_requirements", [])
    kept = []
    removed = []

    for req in reqs:
        periods = float(req.get("periods", 0) or 0)
        subject = req.get("subject", "")
        allowed_grades = allowed_grades_for_subject(subject, grade_rules=grade_rules)

        # 建議三：後端 Preprocessor 清洗機制——過濾空白/空值科目（幽靈科目防禦）
        if not subject or str(subject).strip() == "":
            removed.append({
                "className": cls.get("name", ""),
                "subject": subject,
                "reason": "empty_subject",
            })
            print(f"  [CLEAN] [Ghost Subject] 過濾空白科目 @ {cls.get('name', '')}")
            continue

        if periods <= 0:
            removed.append({
                "className": cls.get("name", ""),
                "subject": subject,
                "reason": "periods<=0",
            })
            continue

        if allowed_grades is not None and grade not in allowed_grades:
            removed.append({
                "className": cls.get("name", ""),
                "subject": subject,
                "reason": f"grade {grade} not in {sorted(allowed_grades)}",
            })
            continue

        kept.append(req)

    cls["course_requirements"] = kept
    if removed:
        metadata.setdefault("removed_requirements", []).extend(removed)


def preprocess_classes(classes_data, ai_settings=None, standard_domain_settings=None, subject_grade_rules=None):
    """
    對 classes_data 執行完整前處理，回傳 (normalized_classes, metadata)。

    Args:
        classes_data: list of class dicts
        ai_settings: dict with AI tuning settings
        standard_domain_settings: list of domain setting entries (fallback for grade rules)
        subject_grade_rules: dict {canonical_subject: [grade, ...]} from SystemSetting.subjectGradeRules.
                            If provided, takes priority over standard_domain_settings derivation.

    注意：metadata 目前暫不輸出 alternating_info（由 base_rules 直接從課程需求推導），
    因此回傳空 dict 保持契約一致。未來若需啟用 alternating_info，取消 _split_arts_15_15 中的註解即可。
    """
    metadata = {}
    grade_rules = build_effective_grade_rules(
        standard_domain_settings=standard_domain_settings,
        subject_grade_rules=subject_grade_rules,
    )

    # 📊 記錄每個班級前處理前的總節數
    pre_totals = {
        cls.get("name", ""): sum(float(r.get("periods", 0)) for r in cls.get("course_requirements", []))
        for cls in classes_data
    }

    for cls in classes_data:
        _fix_grade(cls)
        _sanitize_requirements_by_grade(cls, metadata, grade_rules=grade_rules)
        _clean_ghost_art(cls)
        _homeroom_blockization(cls, ai_settings, metadata)
        _split_arts_15_15(cls, metadata)
        _process_generic_alternating_subjects(cls)
        _fix_existing_pair_group_ids(cls)

    # 🛡️ 全域 invariant: 前處理後總節數不應增加（_sanitize 和 _clean_ghost_art 會減少）
    post_totals = {
        cls.get("name", ""): sum(float(r.get("periods", 0)) for r in cls.get("course_requirements", []))
        for cls in classes_data
    }

    period_changes = []
    for c_name, pre_total in pre_totals.items():
        post_total = post_totals.get(c_name, 0)
        change = round(post_total - pre_total, 2)
        if change > 0.01:  # 總節數增加了 → 異常
            period_changes.append({
                "className": c_name,
                "preprocessTotalPeriods": pre_total,
                "postprocessTotalPeriods": post_total,
                "periodIncrease": change,
                "validationError": "INVALID_INPUT_CLASS_LOAD",
            })
            print(f"  [ERROR] [Preprocess Invariant] {c_name}: 總節數從 {pre_total} 增加到 {post_total}！")

    if period_changes:
        metadata["periodIncreaseViolations"] = period_changes

    return classes_data, metadata


def _fix_grade(cls):
    """修正班級年級，確保 grade 欄位與名稱一致。"""
    raw_grade = cls.get("grade")
    c_name = cls.get("name", "")

    name_match = re.search(r'(\d+)年', c_name)
    name_grade = int(name_match.group(1)) if name_match else None

    if raw_grade is not None:
        try:
            grade = int(raw_grade)
            if name_grade is not None and grade != name_grade:
                cls["grade"] = name_grade
                return
            return
        except (ValueError, TypeError):
            pass

    if name_grade is not None:
        cls["grade"] = name_grade


def _clean_ghost_art(cls):
    """
    清理 ghost art/music 科目：
    若課程需求中出現重複的音樂/美勞條目（如名稱多一空格或標點），
    僅保留一份，避免重複排課。
    """
    reqs = cls.get("course_requirements", [])
    cleaned = []
    seen_normalized = set()
    art_music_keywords = ["音樂", "美勞"]

    for req in reqs:
        subject = req.get("subject", "")
        # 對音樂/美勞做 normalize 去重
        if any(kw in subject for kw in art_music_keywords):
            norm = re.sub(r'\s+', '', subject)
            # 移除 _固定、_交替、_homeroom 等 suffix 再做判斷
            base = re.sub(r'_(固定|交替|homeroom)', '', norm)
            key = (base, req.get("teacher_name", ""))
            if key in seen_normalized:
                print(f"  [CLEAN] [Ghost Art 清理] 跳過重複科目: {subject} ({req.get('teacher_name', '')}) @ {cls.get('name', '')}")
                continue
            seen_normalized.add(key)
        cleaned.append(req)

    cls["course_requirements"] = cleaned


def _homeroom_blockization(cls, ai_settings, metadata=None):
    """
    導師科目自動區塊化：
    若啟用此功能，將所有 defaultTeacher == 'homeroom' 且非生活、非游泳、非體育的導師自授科目，
    全部合併壓縮為名為「導師區塊」的單一條目，以減少演算法約束負擔並將排課權交還給導師。
    
    Invariant: homeroom blockization 只能「重組」不能「增量」。
    前後總節數必須一致，若不一致則標記 INVALID_INPUT_CLASS_LOAD。
    """
    if ai_settings is None:
        ai_settings = {}
    
    block_enabled = ai_settings.get("homeroomBlockizationEnabled", False)
    if not block_enabled:
        # 未啟用時，執行原有的 1-2 年級基本導師區塊合併
        _homeroom_blockization_legacy(cls)
        return

    reqs = cls.get("course_requirements", [])
    
    # 📊 Invariant trace：記錄原始總節數
    raw_total_periods = sum(float(r.get("periods", 0)) for r in reqs)
    
    homeroom_subs_to_block = []
    exempt_homeroom_subs = []
    other_reqs = []
    
    for req in reqs:
        subj = req.get("subject", "")
        default_t = req.get("defaultTeacher", "")
        if subj == "導師區塊":
            other_reqs.append(req)
            continue
        
        # 判定是否為導師自授科目，並排除特規科目
        is_homeroom_sub = (default_t == "homeroom")
        is_exempt = "生活" in subj or "游泳" in subj or "體育" in subj
        
        if is_homeroom_sub and not is_exempt:
            homeroom_subs_to_block.append(req)
        elif is_homeroom_sub and is_exempt:
            exempt_homeroom_subs.append(req)
            other_reqs.append(req)
        else:
            other_reqs.append(req)

    existing_hr = next((r for r in other_reqs if r.get("subject") == "導師區塊"), None)
    existing_hr_periods = float(existing_hr.get("periods", 0)) if existing_hr else 0
            
    if homeroom_subs_to_block:
        # 1. 累加節數
        total_blocked_periods = sum(float(r.get("periods", 0)) for r in homeroom_subs_to_block)
        
        # 2. 獲取導師姓名
        teacher_name = (cls.get("homeroom_teacher") or "").strip()
        if not teacher_name:
            for r in homeroom_subs_to_block:
                tn = r.get("teacher_name") or r.get("teacher", "")
                if tn:
                    teacher_name = tn
                    break
                
        # 3. 合併至既有的「導師區塊」或新增一筆
        if existing_hr:
            existing_hr["periods"] = float(existing_hr.get("periods", 0)) + total_blocked_periods
            if not existing_hr.get("teacher_name") and teacher_name:
                existing_hr["teacher_name"] = teacher_name
        else:
            merged = {
                "subject": "導師區塊",
                "periods": total_blocked_periods,
                "teacher_name": teacher_name or "",
                "defaultTeacher": "homeroom",
                "allow_consecutive": True
            }
            other_reqs.insert(0, merged)
            
        cls["course_requirements"] = other_reqs
        print(f"  [LINK] [Homeroom Blockization] {cls.get('name', '')}: 已合併 {len(homeroom_subs_to_block)} 個導師科目，共 {total_blocked_periods} 節課至「導師區塊」")
    elif not existing_hr and not exempt_homeroom_subs:
        _homeroom_blockization_legacy(cls)

    # 📊 Invariant trace：記錄最終總節數並驗證
    final_total_periods = sum(float(r.get("periods", 0)) for r in cls.get("course_requirements", []))
    
    if metadata is not None and (homeroom_subs_to_block or existing_hr or exempt_homeroom_subs):
        trace_entry = {
            "className": cls.get("name", ""),
            "rawTotalPeriods": raw_total_periods,
            "existingHomeroomBlockPeriods": existing_hr_periods,
            "mergedPeriods": sum(float(r.get("periods", 0)) for r in homeroom_subs_to_block),
            "finalHomeroomBlockPeriods": next(
                (
                    float(r.get("periods", 0))
                    for r in cls.get("course_requirements", [])
                    if r.get("subject") == "導師區塊"
                ),
                existing_hr_periods,
            ),
            "finalTotalPeriods": final_total_periods,
            "teacherName": (cls.get("homeroom_teacher") or "").strip(),
            "mergedSubjects": [
                {
                    "subject": r.get("subject", ""),
                    "periods": float(r.get("periods", 0) or 0),
                }
                for r in homeroom_subs_to_block
            ],
            "exemptSubjects": [
                {
                    "subject": r.get("subject", ""),
                    "periods": float(r.get("periods", 0) or 0),
                }
                for r in exempt_homeroom_subs
            ],
            "hasPreexistingHomeroomBlock": bool(existing_hr),
            "note": (
                "payload_already_contains_homeroom_block"
                if existing_hr and homeroom_subs_to_block
                else "homeroom_subjects_merged"
                if homeroom_subs_to_block
                else "existing_homeroom_block_only"
            ),
        }
        
        # 🛡️ Invariant 檢查：若總節數增加，標記為 INVALID_INPUT_CLASS_LOAD
        if final_total_periods > raw_total_periods + 0.01:  # 容許浮點誤差
            trace_entry["validationError"] = "INVALID_INPUT_CLASS_LOAD"
            trace_entry["periodIncrease"] = round(final_total_periods - raw_total_periods, 2)
            print(f"  [ERROR] [Homeroom Blockization] {cls.get('name', '')}: 總節數從 {raw_total_periods} 增加到 {final_total_periods}！標記 INVALID_INPUT_CLASS_LOAD")
        
        metadata.setdefault("homeroomBlockizationTrace", []).append(trace_entry)

def _homeroom_blockization_legacy(cls):
    reqs = cls.get("course_requirements", [])
    grade = parse_grade(cls)
    if grade not in [1, 2]:
        return

    # 📊 Invariant trace：記錄原始總節數
    raw_total = sum(float(r.get("periods", 0)) for r in reqs)

    homeroom_reqs = [r for r in reqs if "導師區塊" in r.get("subject", "")]
    other_reqs = [r for r in reqs if "導師區塊" not in r.get("subject", "")]

    if len(homeroom_reqs) > 1:
        # 合併所有導師區塊節數
        total_hr_periods = sum(float(r.get("periods", 0)) for r in homeroom_reqs)
        teacher_name = (cls.get("homeroom_teacher") or "").strip()
        if not teacher_name:
            for r in homeroom_reqs:
                tn = r.get("teacher_name", "")
                if tn:
                    teacher_name = tn
                    break

        merged = {
            "subject": "導師區塊",
            "periods": total_hr_periods,
            "teacher_name": teacher_name or "",
            "defaultTeacher": "homeroom",
            "allow_consecutive": True
        }
        cls["course_requirements"] = [merged] + other_reqs

        # 🛡️ Invariant 驗證：合併後總節數不應改變
        final_total = sum(float(r.get("periods", 0)) for r in cls.get("course_requirements", []))
        c_name = cls.get("name", "")
        if abs(final_total - raw_total) > 0.01:
            print(f"  [ERROR] [Homeroom Legacy Invariant] {c_name}: 總節數從 {raw_total} 變為 {final_total}！")
        else:
            print(f"  [LINK] [Homeroom Block] {c_name}: 合併 {len(homeroom_reqs)} 個導師區塊 → {total_hr_periods} 節 (invariant OK)")


def _split_arts_15_15(cls, metadata):
    """
    將 音樂 1.5 + 美勞 1.5 拆分為 音樂_固定(1) + 美勞_固定(1) + 音樂美勞_交替(1)。
    交替部分由兩位老師共享，透過 is_music_odd 變數區分單雙週。

    🛡️ Invariant: 拆分前後總節數必須一致（1.5+1.5=3 → 1+1+1=3）。
    """
    reqs = cls.get("course_requirements", [])
    c_name = cls.get("name", "")

    # 📊 Invariant trace：記錄原始總節數
    raw_total = sum(float(r.get("periods", 0)) for r in reqs)

    # 找音樂和美勞的需求
    music_reqs = [r for r in reqs if "音樂" in r.get("subject", "") and "_固定" not in r.get("subject", "") and "_交替" not in r.get("subject", "")]
    art_reqs = [r for r in reqs if "美勞" in r.get("subject", "") and "_固定" not in r.get("subject", "") and "_交替" not in r.get("subject", "")]
    
    if not music_reqs or not art_reqs:
        return

    total_music = sum(float(r.get("periods", 0)) for r in music_reqs)
    total_art = sum(float(r.get("periods", 0)) for r in art_reqs)

    # 僅當兩者都有 1.5 節時才執行拆分
    if abs(total_music - 1.5) > 0.01 or abs(total_art - 1.5) > 0.01:
        return

    # 獲取老師名稱
    music_teacher = music_reqs[0].get("teacher_name", "")
    art_teacher = art_reqs[0].get("teacher_name", "")
    c_name = cls.get("name", "")

    # 移除原本的音樂/美勞 req
    other_reqs = [r for r in reqs if r not in music_reqs and r not in art_reqs]

    new_reqs = []

    # 音樂_固定 (1 節) — 由音樂老師授課
    if music_teacher:
        new_reqs.append({
            "subject": "音樂_固定",
            "periods": 1,
            "teacher_name": music_teacher,
            "defaultTeacher": "subject",
            "allow_consecutive": False
        })

    # 美勞_固定 (1 節) — 由美勞老師授課
    if art_teacher:
        new_reqs.append({
            "subject": "美勞_固定",
            "periods": 1,
            "teacher_name": art_teacher,
            "defaultTeacher": "subject",
            "allow_consecutive": False
        })

    # 音樂美勞_交替 (1 節) — 每班只建 1 筆，保留雙老師資訊
    # solver 會依 is_music_odd 方向自動決定該班上音樂還是美勞
    if music_teacher or art_teacher:
        # pair_group_id：以「師資組合 + 年級」為識別碼，同年級班級才共用同一群組
        import hashlib
        raw_grade = cls.get("grade")
        raw_key = f"{music_teacher}|{art_teacher}|{raw_grade}"
        pair_group_id = "g_" + hashlib.md5(raw_key.encode()).hexdigest()[:8]

        new_reqs.append({
            "subject": "音樂美勞_交替",
            "periods": 1,
            "teacher_name": music_teacher,  # 主老師（音樂），作為 schedule dict key
            "teacher_music": music_teacher,
            "teacher_art": art_teacher,
            "pair_group_id": pair_group_id,  # ← 新增
            "defaultTeacher": "subject",
            "allow_consecutive": False,
            "is_alternating": True
        })

    cls["course_requirements"] = other_reqs + new_reqs

    # 🛡️ Invariant 驗證：拆分後總節數不應改變
    final_total = sum(float(r.get("periods", 0)) for r in cls.get("course_requirements", []))

    if abs(final_total - raw_total) > 0.01:
        error_entry = {
            "className": c_name,
            "stage": "_split_arts_15_15",
            "rawTotalPeriods": raw_total,
            "finalTotalPeriods": final_total,
            "validationError": "INVALID_INPUT_CLASS_LOAD",
            "periodChange": round(final_total - raw_total, 2),
        }
        metadata.setdefault("artsSplitTrace", []).append(error_entry)
        print(f"  [ERROR] [Arts Split Invariant] {c_name}: 總節數從 {raw_total} 變為 {final_total}！")
    else:
        metadata.setdefault("artsSplitTrace", []).append({
            "className": c_name,
            "stage": "_split_arts_15_15",
            "rawTotalPeriods": raw_total,
            "finalTotalPeriods": final_total,
            "status": "OK",
        })
        print(f"  [Arts Split] {c_name}: 音樂 1.5 + 美勞 1.5 → 音樂_固定(1) + 美勞_固定(1) + 交替(1) [group={pair_group_id}] (invariant OK)")


def _process_generic_alternating_subjects(cls):
    """
    掃描並識別 course_requirements 中的 / 字樣科目（如 健/s, s/社, s/國），
    自動將其標記為 is_alternating: True，並根據授課教師組建 pair_group_id。
    這可使非音美的交替科目也能套用對稱配對模型。
    """
    reqs = cls.get("course_requirements", [])
    c_name = cls.get("name", "")
    for req in reqs:
        subj = req.get("subject", "")
        # 匹配類似 健/s, s/社, s/國 這種帶斜線的科目，且尚未被標記為 is_alternating
        if "/" in subj and not req.get("is_alternating"):
            t_name = req.get("teacher_name") or req.get("teacher", "")
            if not t_name:
                continue
            # 建立 pair_group_id：以 老師名稱 + 科目名稱 作為群組分組識別
            import hashlib
            raw_key = f"{t_name}|{subj}|{cls.get('grade')}"
            pair_group_id = "g_alt_" + hashlib.md5(raw_key.encode()).hexdigest()[:8]

            req["is_alternating"] = True
            req["pair_group_id"] = pair_group_id
            # 默認不可連堂，每週1節
            req["allow_consecutive"] = False
            print(f"  [WARN] [Generic Alt] {c_name}: 識別交替科目 {subj} (老師: {t_name}) [group={pair_group_id}]")


"""
Task 08 — Priority Scheduling: Specialty Room Metadata Normalization & Placeholder Model
參考: docs/20260618-task-08_priority_scheduling_room_grade_and_placeholder_plan.md
     docs/20260617_scheduler_policy_constraints_plan.yaml §327-374, §766-782
"""


def _parse_list_field(value, field_name):
    """安全解析 list 欄位：支援 Python list、JSON 字串、逗號分隔字串。"""
    if isinstance(value, (list, tuple)):
        result = []
        for v in value:
            try:
                result.append(int(v))
            except (TypeError, ValueError):
                try:
                    result.append(str(v).strip())
                except Exception:
                    pass
        return result
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        import json
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                result = []
                for v in parsed:
                    try:
                        result.append(int(v))
                    except (TypeError, ValueError):
                        try:
                            result.append(str(v).strip())
                        except Exception:
                            pass
                return result
        except (json.JSONDecodeError, TypeError):
            pass
        parts = [p.strip() for p in s.split(",") if p.strip()]
        result = []
        for p in parts:
            try:
                result.append(int(p))
            except ValueError:
                result.append(p)
        return result
    return []


def _parse_bool_field(value, default=True):
    """安全解析 boolean 欄位。missing / None → default。"""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.lower() in ("true", "1", "yes")
    return default


def _normalize_classroom_metadata(classrooms):
    """
    [Task 08.1] Specialty Room Metadata Normalization
    
    確保每間 room dict 包含三個標準欄位:
      - gradePreferences: list, 預設 []
      - primaryTeacher: string, 預設 ""
      - allowSharing: boolean, 預設 true (YAML §340)
    
    Args:
        classrooms: list of room dicts (mutated in-place)
    
    Returns:
        dict — normalization trace with keys:
            total_rooms, rooms_with_grade_prefs, rooms_with_primary_teacher,
            rooms_with_allow_sharing, defaults_applied (list of warnings)
    """
    if not classrooms:
        return {
            "total_rooms": 0,
            "rooms_with_grade_prefs": 0,
            "rooms_with_primary_teacher": 0,
            "rooms_with_allow_sharing": 0,
            "defaults_applied": [],
        }

    defaults_log = []
    gp_count = 0
    pt_count = 0
    as_count = 0

    for room in classrooms:
        rid = room.get("id", room.get("name", "unknown"))

        # gradePreferences → list, default []
        raw_gp = room.get("gradePreferences")
        if raw_gp is None or (isinstance(raw_gp, (list, tuple)) and len(raw_gp) == 0):
            if raw_gp is None:
                defaults_log.append(f"Room {rid}: gradePreferences missing → default []")
            room["gradePreferences"] = []
        else:
            room["gradePreferences"] = _parse_list_field(raw_gp, "gradePreferences")
        
        if room["gradePreferences"]:
            gp_count += 1

        # primaryTeacher → string, default ""
        raw_pt = room.get("primaryTeacher")
        if raw_pt is None or (isinstance(raw_pt, str) and raw_pt.strip() == ""):
            if raw_pt is None:
                defaults_log.append(f"Room {rid}: primaryTeacher missing → default ''")
            room["primaryTeacher"] = ""
        else:
            room["primaryTeacher"] = str(raw_pt).strip()
        
        if room["primaryTeacher"]:
            pt_count += 1

        # allowSharing → boolean, default true (YAML §340)
        raw_as = room.get("allowSharing")
        if raw_as is None:
            defaults_log.append(f"Room {rid}: allowSharing missing → default true")
            room["allowSharing"] = True
        else:
            room["allowSharing"] = _parse_bool_field(raw_as, default=True)
        
        as_count += 1

    trace = {
        "total_rooms": len(classrooms),
        "rooms_with_grade_prefs": gp_count,
        "rooms_with_primary_teacher": pt_count,
        "rooms_with_allow_sharing": as_count,
        "defaults_applied": defaults_log,
    }

    if defaults_log:
        print(f"  [WARN] [Task 08.1] Classroom metadata normalization applied {len(defaults_log)} default(s) across {len(classrooms)} room(s)")
        for msg in defaults_log[:10]:
            print(f"    - {msg}")
        if len(defaults_log) > 10:
            print(f"    ... and {len(defaults_log) - 10} more")

    return trace


def _build_priority_teacher_placeholders(classrooms, classes_data=None):
    """
    [Task 08.4] Priority Teacher Placeholder / Candidate Reservation Model

    From classrooms.primaryTeacher, identify priority teachers and build
    placeholder dicts that carry candidate metadata — NOT final assignments.

    Key invariant: candidateClasses is derived from every class whose course
    requirements reference the priority teacher + subject demand.
    `gradePreferences` is stored as metadata ONLY and must NEVER be used as a
    hard eligibility filter for candidate classes.

    Args:
        classrooms: list of normalized room dicts (must have been through _normalize_classroom_metadata)
        classes_data: optional list of class dicts for candidate class derivation

    Returns:
        list of placeholder dicts, each with:
            - teacherName: str
            - subject: str (from room.subject)
            - roomId: str | None
            - roomName: str | None
            - demandPeriods: int
            - candidateClasses: list[str] — all classes with matching demand
            - candidatePeriods: None | list[dict] — None means no period restriction
            - isPlaceholder: True
    """
    placeholders = []
    seen_teachers = set()

    for room in classrooms or []:
        pt = room.get("primaryTeacher", "") or ""
        if not pt:
            continue

        subject = room.get("subject", "") or ""
        rid = room.get("id", "")
        rname = room.get("name", None) or None

        # Use (teacher, subject) as unique key to avoid duplicate placeholders
        key = (pt, subject)
        if key in seen_teachers:
            continue
        seen_teachers.add(key)

        # ---- Step 1: Compute demand periods AND candidate classes together ----
        # Iterate every class and find course requirements that match this
        # priority teacher + subject. This is the SOURCE OF TRUTH for which
        # classes actually need this teacher — gradePreferences does NOT gate eligibility.
        demand_periods = 0
        candidate_classes = []

        if classes_data:
            for cls in classes_data:
                c_name = cls.get("name", "")
                for req in cls.get("course_requirements", []):
                    req_teacher = req.get("teacher_name") or req.get("teacher", "")
                    req_subject = req.get("subject", "")
                    # Match teacher name and subject relevance
                    if req_teacher == pt and (not subject or subject in req_subject or req_subject in subject):
                        demand_periods += int(float(req.get("periods", 0) or 0))
                        if c_name and c_name not in candidate_classes:
                            candidate_classes.append(c_name)

        # Fallback: if no matching demand found, use gradePreferences to derive candidates.
        # This is a fallback only — gradePreferences is a preference signal, not hard eligibility.
        if not candidate_classes and classes_data:
            grade_prefs = room.get("gradePreferences", []) or []
            if grade_prefs:
                for cls in classes_data:
                    cls_grade = cls.get("grade")
                    try:
                        cls_grade = int(cls_grade) if cls_grade is not None else 0
                    except (TypeError, ValueError):
                        cls_grade = 0
                    if cls_grade in grade_prefs:
                        c_name = cls.get("name", "")
                        if c_name and c_name not in candidate_classes:
                            candidate_classes.append(c_name)

        # Second fallback: if still no candidates, include all classes.
        if not candidate_classes and classes_data:
            for cls in classes_data:
                c_name = cls.get("name", "")
                if c_name:
                    candidate_classes.append(c_name)

        placeholders.append({
            "teacherName": pt,
            "subject": subject,
            "roomId": rid,
            "roomName": rname,
            "demandPeriods": demand_periods,
            "candidateClasses": candidate_classes,
            "candidatePeriods": None,  # None = no period restriction; phase2 uses all periods
            "isPlaceholder": True,
        })

    if placeholders:
        print(f"  [INFO] [Task 08.4] Built {len(placeholders)} priority teacher placeholder(s)")
        for ph in placeholders:
            print(f"    - {ph['teacherName']} ({ph['subject']}): "
                  f"{ph['demandPeriods']} periods, {len(ph['candidateClasses'])} candidate classes")

    return placeholders


def normalize_classroom_metadata(classrooms):
    """
    [Task 08.1] Public wrapper: Normalize specialty room metadata and return normalized classrooms.
    
    Ensures each room dict contains:
      - gradePreferences: list, default []
      - primaryTeacher: string, default ""
      - allowSharing: boolean, default true (YAML §340)
    
    Args:
        classrooms: list of room dicts (mutated in-place)
    
    Returns:
        list — the normalized classrooms (same objects, mutated in-place)
    """
    if not classrooms:
        return classrooms or []
    
    trace = _normalize_classroom_metadata(classrooms)
    
    # Log summary
    print(f"  [INFO] [Task 08.1] Normalized {trace['total_rooms']} classroom(s): "
          f"{trace['rooms_with_grade_prefs']} with gradePrefs, "
          f"{trace['rooms_with_primary_teacher']} with primaryTeacher, "
          f"{trace['rooms_with_allow_sharing']} with allowSharing")
    
    return classrooms


def build_priority_teacher_placeholders(classrooms, classes_data=None):
    """
    [Task 08.4] Public wrapper: Build priority teacher placeholders from normalized classrooms.
    
    Identifies priority teachers from room.primaryTeacher and creates placeholder dicts
    with candidate classes (not pre-bound to specific classes).
    
    Args:
        classrooms: list of normalized room dicts (must have been through normalize_classroom_metadata)
        classes_data: optional list of class dicts for candidate class derivation
    
    Returns:
        list of placeholder dicts with teacherName, subject, roomId, roomName,
        demandPeriods, candidateClasses, candidatePeriods, isPlaceholder
    """
    return _build_priority_teacher_placeholders(classrooms, classes_data=classes_data)


def _fix_existing_pair_group_ids(cls):
    """
    如果傳入的 requirements 已經被拆分過且自帶 pair_group_id，
    重新套用目前的分組規則：
    - 音樂美勞交替：依「師資組合 + 年級」分組（同年級配對）
    - 泛型交替科目：維持年級分組，避免過度全局化
    """
    reqs = cls.get("course_requirements", [])
    grade = cls.get("grade")
    for req in reqs:
        subj = req.get("subject", "")
        if req.get("is_alternating") or "交替" in subj or "/" in subj:
            t_name = req.get("teacher_name") or req.get("teacher", "")
            music_t = req.get("teacher_music") or t_name
            art_t = req.get("teacher_art") or req.get("teacher_partner") or t_name
            
            import hashlib
            if "音樂美勞" in subj or ("音樂" in subj and "美勞" in subj):
                raw_key = f"{music_t}|{art_t}|{grade}"
                new_gid = "g_" + hashlib.md5(raw_key.encode("utf-8")).hexdigest()[:8]
            else:
                raw_key = f"{t_name}|{subj}|{grade}"
                new_gid = "g_alt_" + hashlib.md5(raw_key.encode("utf-8")).hexdigest()[:8]
            
            req["pair_group_id"] = new_gid
            req["is_alternating"] = True
