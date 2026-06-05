"""
排課系統前處理模組
負責純資料變形：grade 修正、ghost art 清理、homeroom blockization、音樂/美勞 1.5+1.5 拆分
不碰 OR-Tools model
"""

import terminal_sanitizer
import re
import math
from utils import parse_grade


def preprocess_classes(classes_data, ai_settings=None):
    """
    對 classes_data 執行完整前處理，回傳 (normalized_classes, metadata)。

    注意：metadata 目前暫不輸出 alternating_info（由 base_rules 直接從課程需求推導），
    因此回傳空 dict 保持契約一致。未來若需啟用 alternating_info，取消 _split_arts_15_15 中的註解即可。
    """
    metadata = {}

    for cls in classes_data:
        _fix_grade(cls)
        _clean_ghost_art(cls)
        _homeroom_blockization(cls, ai_settings)
        _split_arts_15_15(cls, metadata)
        _process_generic_alternating_subjects(cls)
        _fix_existing_pair_group_ids(cls)

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


def _homeroom_blockization(cls, ai_settings):
    """
    導師科目自動區塊化：
    若啟用此功能，將所有 defaultTeacher == 'homeroom' 且非生活、非游泳、非體育的導師自授科目，
    全部合併壓縮為名為「導師區塊」的單一條目，以減少演算法約束負擔並將排課權交還給導師。
    """
    if ai_settings is None:
        ai_settings = {}
    
    block_enabled = ai_settings.get("homeroomBlockizationEnabled", False)
    if not block_enabled:
        # 未啟用時，執行原有的 1-2 年級基本導師區塊合併
        _homeroom_blockization_legacy(cls)
        return

    reqs = cls.get("course_requirements", [])
    
    homeroom_subs_to_block = []
    other_reqs = []
    
    for req in reqs:
        subj = req.get("subject", "")
        default_t = req.get("defaultTeacher", "")
        
        # 判定是否為導師自授科目，並排除特規科目
        is_homeroom_sub = (default_t == "homeroom")
        is_exempt = "生活" in subj or "游泳" in subj or "體育" in subj
        
        if is_homeroom_sub and not is_exempt:
            homeroom_subs_to_block.append(req)
        else:
            other_reqs.append(req)
            
    if homeroom_subs_to_block:
        # 1. 累加節數
        total_blocked_periods = sum(float(r.get("periods", 0)) for r in homeroom_subs_to_block)
        
        # 2. 獲取導師姓名
        teacher_name = None
        for r in homeroom_subs_to_block:
            tn = r.get("teacher_name") or r.get("teacher", "")
            if tn:
                teacher_name = tn
                break
                
        # 3. 合併至既有的「導師區塊」或新增一筆
        existing_hr = next((r for r in other_reqs if r.get("subject") == "導師區塊"), None)
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
    else:
        _homeroom_blockization_legacy(cls)

def _homeroom_blockization_legacy(cls):
    reqs = cls.get("course_requirements", [])
    grade = parse_grade(cls)
    if grade not in [1, 2]:
        return

    homeroom_reqs = [r for r in reqs if "導師區塊" in r.get("subject", "")]
    other_reqs = [r for r in reqs if "導師區塊" not in r.get("subject", "")]

    if len(homeroom_reqs) > 1:
        # 合併所有導師區塊節數
        total_hr_periods = sum(float(r.get("periods", 0)) for r in homeroom_reqs)
        teacher_name = None
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
        print(f"  [LINK] [Homeroom Block] {cls.get('name', '')}: 合併 {len(homeroom_reqs)} 個導師區塊 → {total_hr_periods} 節")


def _split_arts_15_15(cls, metadata):
    """
    將 音樂 1.5 + 美勞 1.5 拆分為 音樂_固定(1) + 美勞_固定(1) + 音樂美勞_交替(1)。
    交替部分由兩位老師共享，透過 is_music_odd 變數區分單雙週。
    """
    reqs = cls.get("course_requirements", [])
    
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
        # pair_group_id：以師資組合為識別碼，同一組音美老師的所有班級共用同一 group
        import hashlib
        raw_key = f"{music_teacher}|{art_teacher}|{cls.get('grade')}"
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
    print(f"  ️ [Arts Split] {c_name}: 音樂 1.5 + 美勞 1.5 → 音樂_固定(1) + 美勞_固定(1) + 交替(1) [group={pair_group_id}]")


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


def _fix_existing_pair_group_ids(cls):
    """
    如果傳入的 requirements 已經被拆分過且自帶 pair_group_id，
    我們必須根據班級年級重新計算 pair_group_id，以防止跨年級過度全局化。
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
