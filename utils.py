"""
排課系統工具函式
所有純函式、無副作用的公用邏輯都放在此模組。
"""

import re
from config import VIRTUAL_TEACHER_KEYWORDS, CLASSROOM_LIMITS_FALLBACK


def parse_grade(cls):
    """安全解析班級年級，帶有合理性驗證"""
    raw_grade = cls.get("grade")
    c_name = cls.get("name", "")
    
    # 從名稱解析年級作為參考
    name_match = re.search(r'(\d+)年', c_name)
    name_grade = int(name_match.group(1)) if name_match else None
    
    # 若 raw_grade 有效且與名稱解析結果一致（或無法從名稱解析），直接使用
    if raw_grade is not None:
        try:
            grade = int(raw_grade)
            # 驗證：如果名稱中有年級資訊且與 grade 不同，相信名稱
            if name_grade is not None and grade != name_grade:
                print(f"  ⚠️ [Grade 修正] {c_name}: grade={raw_grade} 與名稱不符，修正為 {name_grade}")
                return name_grade
            return grade
        except (ValueError, TypeError):
            pass
    
    # Fallback: 從名稱解析
    if name_grade is not None:
        return name_grade


def is_virtual_teacher(name: str) -> bool:
    """判斷是否為虛擬/外聘/待排教師，此類教師享有分身豁免權"""
    return any(kw in name for kw in VIRTUAL_TEACHER_KEYWORDS)


def normalize_room_name(name):
    """白名單名稱正規化 (Canonical Alias Map)
    
    將教室名稱正規化為 canonical key，與系統標準領域設定一致：
    - 自然科學教室X → 自然科學
    - 英語教室X → 語文-英語
    - 電腦教室X / 資訊教室X → 資訊
    - 體育館X → 體育
    - 音樂教室X → 音樂
    - 美勞教室X → 美勞
    """
    if "自然" in name:
        return "自然科學"
    if "資訊" in name or "電腦" in name or "科技" in name:
        return "資訊"
    if "英語" in name or "英文" in name:
        return "語文-英語"
    if "體育" in name or "游泳" in name:
        return "體育"
    if "音樂" in name:
        return "音樂"
    if "美勞" in name or "藝術" in name:
        return "美勞"
    if "本土" in name:
        return "本土語"
    if "閱讀" in name:
        return "閱讀"
    return name


def get_subject_capacity(subject_key, classrooms_count_map, classroom_limits_config=None, fallback_map=None):
    """
    取得指定科目的場地容量上限，同時回傳來源標籤供 log 使用。
    
    Args:
        subject_key (str): 科目名稱（如 "自然科學"、"科技-資訊"），內部會自動正規化
        classrooms_count_map (dict): 從 classrooms_data 統計出的 {科目: 間數} 對照表
        classroom_limits_config (dict, optional): schoolInfo.classroomLimits 設定
        fallback_map (dict, optional): 硬編碼 fallback
    
    Returns:
        tuple: (int 容量上限, str 來源標籤)
    """
    if classroom_limits_config is None:
        classroom_limits_config = {}
    if fallback_map is None:
        fallback_map = CLASSROOM_LIMITS_FALLBACK
    
    # 🔔 修復核心：將傳入的原始科目名稱進行正規化 (例如 "自然科學" -> "自然", "科技-資訊" -> "資訊")
    norm_key = normalize_room_name(subject_key)
    
    # ① 優先：若有實體教室資料，使用真實教室數量
    if classrooms_count_map.get(norm_key, 0) > 0:
        return classrooms_count_map[norm_key], "classrooms實體建檔"
    
    # ② 次選：從 schoolInfo.classroomLimits 讀取使用者設定
    if norm_key in classroom_limits_config:
        val = classroom_limits_config[norm_key]
        try:
            result = int(val)
            if result > 0:
                return result, "schoolInfo.classroomLimits"
        except (ValueError, TypeError):
            pass
    
    # ③ 最終：硬編碼 fallback（保底，永遠不會崩潰）
    return fallback_map.get(norm_key, 3), "硬編碼fallback"


def add_consecutive_constraint(model, schedule, class_name, subject, consecutive_groups=1, days=5, periods_per_day=7):
    """
    強制指定科目在同一天安排連續節次，且不跨越午休邊界。
    schedule: dict，key 為 (class, period_idx, teacher, subject)
    consecutive_groups: 1 = 一組連堂(2節)，2 = 兩組連堂(4節)
    days: 一週天數 (預設 5)
    periods_per_day: 每天節次 (預設 7)
    
    LUNCH_BOUNDARY = 4 表示第 4 節（0-based index 3）之後是午休
    禁止 index 3 和 index 4 之間連堂（即第4節與第5節不能連堂）。
    """
    total_periods = days * periods_per_day
    
    # Step 1: 找出所有屬於該班級 + 該科目的 BoolVar，按 period_idx 分組
    subject_vars_by_period = {}  # period_idx -> [BoolVar, ...]
    for (c, p, t, s), var in schedule.items():
        if c == class_name and subject in s:
            if p not in subject_vars_by_period:
                subject_vars_by_period[p] = []
            subject_vars_by_period[p].append(var)
    
    if not subject_vars_by_period:
        print(f"  ⚠️ [連堂約束] {class_name} - {subject}: 找不到對應的 schedule 變數，跳過")
        return
    
    # Step 2: 為每一天建立「連堂配對」布林變數
    # 合法連續配對: (0,1), (1,2), (2,3) 上午；(4,5), (5,6) 下午
    # 禁止 (3,4) 因為跨越午休 (LUNCH_BOUNDARY)
    total_consecutive_pairs = []
    
    for d in range(days):
        # 列舉所有合法的連續起始節次（0-based，每天內）
        # 0,1,2 是上午連續；3 是第4節(午休前最後一節)；4,5 是下午連續
        # pr=3 會被跳過，因為 3-4 跨越午休邊界
        valid_starts = [0, 1, 2, 4, 5]
        for pr in valid_starts:
            p1 = d * periods_per_day + pr
            p2 = d * periods_per_day + pr + 1
            if p2 >= total_periods:
                continue
            vars_1 = subject_vars_by_period.get(p1, [])
            vars_2 = subject_vars_by_period.get(p2, [])
            if vars_1 and vars_2:
                # 取第一個匹配的 var（同一時段同一科目通常只有一個）
                v1 = vars_1[0]
                v2 = vars_2[0]
                safe_class = class_name.replace('年', '_').replace('班', '_')
                safe_subj = subject.replace(' ', '_')
                is_pair = model.NewBoolVar(
                    f"consec_pair_{safe_class}_{safe_subj}_p{p1}_p{p2}"
                )
                # is_pair == 1 當且僅當 v1 == 1 且 v2 == 1
                model.Add(is_pair <= v1)
                model.Add(is_pair <= v2)
                model.Add(is_pair >= v1 + v2 - 1)
                total_consecutive_pairs.append(is_pair)
    
    # Step 3: 強制至少達到 consecutive_groups 組連堂
    if total_consecutive_pairs:
        model.Add(sum(total_consecutive_pairs) >= consecutive_groups)
        print(f"  ✅ [連堂約束] {class_name} - {subject}: 強制至少 {consecutive_groups} 組連堂 (共 {len(total_consecutive_pairs)} 個合法配對位置)")
    else:
        print(f"  ⚠️ [連堂約束] {class_name} - {subject}: 無合法連堂配對位置")
