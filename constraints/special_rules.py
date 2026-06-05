"""
special_rules.py — 特殊規則（例外型、專題型）

負責：
  - [硬約束 11] 英語容量限制
  - [硬約束 12] 體育不連堂
  - [硬約束 13] 音樂美勞：至少一組美勞連堂
  - [硬約束 14] 交替課完美配對（軟懲罰版）
  - [硬約束 14.5] 游泳引擎 v2（混合連堂）
  - [硬約束 15] 通用連堂約束

依賴：config, utils
"""

import terminal_sanitizer
import re

from config import DAYS, PERIODS_PER_DAY, LUNCH_BOUNDARY, TOTAL_PERIODS

# --------------------------------------------------------------
# 有效相鄰節次對：唯一規則來源（single source of truth）
#
# 規則說明：
#   上午合法：(0,1), (1,2), (2,3)
#   下午合法：(4,5), (5,6)
#   禁止：    (3,4) 跨午休邊界
#
# [WARN] special_rules.py 的建模端與 solver.py 的驗證端
#    必須共用此函式，不得各自重新判斷邊界。
# --------------------------------------------------------------

def get_valid_consecutive_pairs(base: int) -> list[tuple[int, int]]:
    """
    回傳指定日 base offset 下，所有合法的相鄰節次對。

    這是整個排程系統中「合法連堂」的唯一定義。
    建模端（apply_art_consecutive_constraint）與
    驗證端（_validate_art_alternating_consecutive）都必須呼叫此函式，
    不得另行手寫 LUNCH_BOUNDARY 判斷式。

    合法定義：
    - 必須相鄰（pr 與 pr+1）
    - 不可跨午休邊界（即不允許 pr == LUNCH_BOUNDARY - 1）
      → 封鎖的是 (base+3, base+4)，不是 (base+4, base+5)

    Args:
        base: 該日第一節的全域 period index（= day * PERIODS_PER_DAY）

    Returns:
        合法配對列表，例如 base=0 時回傳 [(0,1),(1,2),(2,3),(4,5),(5,6)]
    """
    pairs = []
    for pr in range(PERIODS_PER_DAY - 1):
        if pr == LUNCH_BOUNDARY - 1:   # 封鎖 (3,4)：pr=3 → p1=base+3, p2=base+4
            continue
        p1 = base + pr
        p2 = base + pr + 1
        pairs.append((p1, p2))
    return pairs



def apply_english_capacity(model, classes_data, schedule, subject_room_count):
    """
    [硬約束 11] 英語容量限制

    同一時段使用英語教室的班級數不得超過實際英語教室數量。
    排除 1 年級英語課（不使用專科英語教室）。

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
        subject_room_count: dict 專科教室數
    """
    eng_room_count = subject_room_count.get("語文-英語", subject_room_count.get("英語", 5))
    
    for p in range(TOTAL_PERIODS):
        eng_vars = []
        for (c, per, t, s), var in schedule.items():
            if per == p and "英語" in s:
                if not re.search(r'1年', c):
                    eng_vars.append(var)
                    
        if eng_vars:
            model.Add(sum(eng_vars) <= eng_room_count)


def apply_no_consecutive_pe(model, classes_data, schedule):
    """
    [硬約束 12] 體育不連堂

    同一班級同一天體育不排相連時段

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
    """
    for cls in classes_data:
        c_name = cls.get("name", "")
        for d in range(DAYS):
            base = d * PERIODS_PER_DAY
            for pr in range(PERIODS_PER_DAY - 1):
                p1 = base + pr
                p2 = base + pr + 1
                if p2 >= TOTAL_PERIODS:
                    continue
                v1 = [var for (c, per, t, s), var in schedule.items()
                      if c == c_name and per == p1 and "體育" in s]
                v2 = [var for (c, per, t, s), var in schedule.items()
                      if c == c_name and per == p2 and "體育" in s]
                if v1 and v2:
                    model.Add(v1[0] + v2[0] <= 1)


def apply_art_consecutive_constraint(model, classes_data, schedule):
    """
    [硬約束 13] 美勞固定課必須與音樂美勞交替課連堂

    對於經過 1.5+1.5 拆分後的班級（有 美勞_固定 + 音樂美勞_交替）：
    - 美勞_固定 必須與 音樂美勞_交替 排在同一天
    - 兩者必須相鄰節次
    - 不可跨午休（pr=3 時 p1=base+3, p2=base+4）
    - 不適用於沒有這兩種課的班級

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
    """
    for cls in classes_data:
        c_name = cls.get("name", "")
        reqs = cls.get("course_requirements", [])

        # 1. 確認此班同時有 美勞_固定 與 音樂美勞_交替
        has_art_fixed = any("美勞_固定" in r.get("subject", "") for r in reqs)
        has_alternating = any("音樂美勞_交替" in r.get("subject", "") for r in reqs)

        if not (has_art_fixed and has_alternating):
            continue  # 無交替課的班級不套用此規則

        # 2. 收集兩類變數 (period -> BoolVar)
        # "美勞_固定" in "音樂美勞_交替" → False (後者不含 _固定)
        # "音樂美勞_交替" in "美勞_固定" → False (前者不含 _交替)
        art_fixed_vars = {}
        alt_vars = {}

        for (c, per, t, s), var in schedule.items():
            if c != c_name:
                continue
            if "美勞_固定" in s:
                art_fixed_vars[per] = var
            if "音樂美勞_交替" in s:
                alt_vars[per] = var

        if not art_fixed_vars or not alt_vars:
            continue  # 安全防護：變數未建立時跳過

        # 3. 建立每日的連堂配對 BoolVar
        consecutive_patterns = []

        for d in range(DAYS):
            base = d * PERIODS_PER_DAY

            for (p1, p2) in get_valid_consecutive_pairs(base):  # ← 統一用 helper

                # 兩節次都必須有 art_fixed 和 alt 變數才構成配對
                if p1 not in art_fixed_vars or p2 not in art_fixed_vars:
                    continue
                if p1 not in alt_vars or p2 not in alt_vars:
                    continue

                art_p1 = art_fixed_vars[p1]
                art_p2 = art_fixed_vars[p2]
                alt_p1 = alt_vars[p1]
                alt_p2 = alt_vars[p2]

                # 模式 A (forward): 美勞_固定在 p1, 交替在 p2
                fwd = model.NewBoolVar(f'art_fwd_{c_name}_d{d}_p{p1}')
                model.Add(fwd >= art_p1 + alt_p2 - 1)
                model.Add(fwd <= art_p1)
                model.Add(fwd <= alt_p2)

                # 模式 B (backward): 交替在 p1, 美勞_固定在 p2
                bwd = model.NewBoolVar(f'art_bwd_{c_name}_d{d}_p{p1}')
                model.Add(bwd >= alt_p1 + art_p2 - 1)
                model.Add(bwd <= alt_p1)
                model.Add(bwd <= art_p2)

                # 此配對成立 = 任一模式成立
                pair_ok = model.NewBoolVar(f'art_pair_{c_name}_d{d}_p{p1}')
                model.Add(pair_ok >= fwd)
                model.Add(pair_ok >= bwd)
                model.Add(pair_ok <= fwd + bwd)

                consecutive_patterns.append(pair_ok)

        # 4. 強制至少一組連堂
        if consecutive_patterns:
            model.Add(sum(consecutive_patterns) >= 1)
            print(f"  [OK] [連堂約束] {c_name}: 美勞_固定 + 交替課連堂 (共 {len(consecutive_patterns)} 個可能配對)")


def apply_alternating_perfect_pairing(
    model,
    classes_data,
    schedule,
    teacher_names,
    alternating_class_is_music_odd,
    alternating_group_map,
    class_pair_group,
    class_teacher_pair,
    phase2_penalty_vars,
    ai_settings=None,  # [NEW] 傳入 ai_settings 以讀取配置
):
    """
    [硬/軟約束 14] 班對班互補配對約束（支援硬性/軟性/奇數班級降級）

    同一時段、同一 pair_group_id 下，若兩班都排了交替課（both_active=1）：
      - hard 模式下：is_music_odd[A] + is_music_odd[B] == 1 (硬約束)
      - soft 模式下：若兩班同方向，加入 mismatch 罰分 (預設 5000)

    自動防禦：若該群組總班級數為奇數，一律降級為 soft 模式，避免奇數環導致全局 Infeasible。
    """
    if ai_settings is None:
        ai_settings = {}

    from config import CLASSROOM_LIMITS_FALLBACK
    music_room_limit = CLASSROOM_LIMITS_FALLBACK.get("音樂", 4)
    art_room_limit   = CLASSROOM_LIMITS_FALLBACK.get("美勞", 3)
    pair_capacity    = min(music_room_limit, art_room_limit)

    # 讀取全局或年級配對設定
    pairing_strictness = ai_settings.get("pairingStrictness", {})
    default_strictness = ai_settings.get("defaultPairingStrictness", "hard")

    # 預建：class_name -> is_music_odd BoolVar（優先用主老師 key）
    class_music_odd_var = {}
    for (c_name, t_name), bvar in alternating_class_is_music_odd.items():
        if c_name not in class_music_odd_var:
            class_music_odd_var[c_name] = bvar

    # 統計每個群組的總班級數，以便判斷是否為奇數班級群組
    group_classes_count = {gid: len(classes) for gid, classes in alternating_group_map.items()}

    for p in range(TOTAL_PERIODS):

        # 收集此時段每個 group 的交替班級與對應 schedule_BoolVar
        group_active = {}   # pair_group_id -> [(class_name, schedule_BoolVar)]

        for (c, per, t, s), var in schedule.items():
            if per != p:
                continue
            # 泛型交替判斷： subject 名稱含 "交替" 或 "/"
            is_alt = "交替" in s or "/" in s
            if not is_alt:
                continue

            gid = class_pair_group.get(c)
            if not gid:
                continue
            group_active.setdefault(gid, [])
            if not any(cx == c for cx, _ in group_active[gid]):
                group_active[gid].append((c, var))

        for gid, class_vars in group_active.items():
            if len(class_vars) < 2:
                continue

            # -- 容量軟懲罰：同時段活躍班數 > pair_capacity × 2
            active_bvars = [v for _, v in class_vars]
            if len(active_bvars) > pair_capacity * 2:
                overload = model.NewIntVar(
                    0, len(active_bvars),
                    f'alt_cap_overload_{gid}_p{p}'
                )
                model.Add(overload >= sum(active_bvars) - pair_capacity * 2)
                phase2_penalty_vars.append(10000 * overload)

            # -- 決定約束強度：
            # 1. 總班級數不等於 2 的大群組或奇數群組，自動降為軟性約束 (soft)，防範著色矛盾 (完全圖 K_k 當 k >= 3 時為 2-不可著色)
            # 2. 只有剛好 2 個班的完美配對群組才保留 hard 模式
            total_members = group_classes_count.get(gid, 0)
            is_perfect_pair = (total_members == 2)

            # 取得該群組中班級的年級（以第一個班級為代表）
            first_c = class_vars[0][0]
            grade_match = re.search(r'(\d+)年', first_c)
            grade = grade_match.group(1) if grade_match else "unknown"

            if is_perfect_pair:
                strictness = pairing_strictness.get(f"grade{grade}", default_strictness)
            else:
                strictness = "soft"

            # -- 兩兩互補約束建立
            for i in range(len(class_vars)):
                for j in range(i + 1, len(class_vars)):
                    c_i, var_i = class_vars[i]
                    c_j, var_j = class_vars[j]

                    bool_i = class_music_odd_var.get(c_i)
                    bool_j = class_music_odd_var.get(c_j)

                    if bool_i is None or bool_j is None:
                        continue

                    # both_active = 1 當且僅當兩班在此時段都排了交替課
                    both_active = model.NewBoolVar(f'pair_both_{gid}_p{p}_{c_i}_{c_j}')
                    model.Add(both_active >= var_i + var_j - 1)
                    model.Add(both_active <= var_i)
                    model.Add(both_active <= var_j)

                    if strictness == "hard":
                        # [OK] 硬約束模式
                        model.Add(bool_i + bool_j >= 1).OnlyEnforceIf(both_active)
                        model.Add(bool_i + bool_j <= 1).OnlyEnforceIf(both_active)
                        # print(f"  [LOCK] [Pair 硬約束] p={p} | {c_i} ↔ {c_j} (group={gid}) 互補方向已硬鎖定")
                    else:
                        # -- 軟性約束模式（奇數班群或特定設定下使用）
                        # 我們希望：both_active 成立時，bool_i != bool_j
                        # 若相同 (bool_i == bool_j)，則產生 mismatch
                        same = model.NewBoolVar(f'alt_same_{gid}_p{p}_{c_i}_{c_j}')
                        model.Add(same >= bool_i + bool_j - 1)
                        model.Add(same >= (1 - bool_i) + (1 - bool_j) - 1)
                        model.Add(same <= bool_i + (1 - bool_j))
                        model.Add(same <= (1 - bool_i) + bool_j)
                        
                        mismatch = model.NewBoolVar(f'alt_mismatch_{gid}_p{p}_{c_i}_{c_j}')
                        model.Add(mismatch >= both_active + same - 1)
                        model.Add(mismatch <= both_active)
                        model.Add(mismatch <= same)
                        
                        penalty_weight = ai_settings.get("pairingPenaltyWeight", 5000)
                        phase2_penalty_vars.append(penalty_weight * mismatch)
                        # print(f"  [CONSTRAINT] [Pair 軟約束] p={p} | {c_i} ↔ {c_j} (group={gid}) 互補方向已建立為軟約束 (權重: {penalty_weight})")


def apply_swimming_engine_v2(model, classes_data, schedule, ai_settings, phase2_penalty_vars):
    """
    [硬約束 14.5] 游泳引擎 v2（混合連堂：體育+導師區塊/健康）

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        classes_data: list of class dicts
        ai_settings: dict 開關設定
        phase2_penalty_vars: list of penalty ints
    """
    if not ai_settings.get("swimmingCapEnabled", True):
        return

    pool_usage_at_p = {p: [] for p in range(TOTAL_PERIODS)}

    # Step 1: 識別游泳夥伴科目
    swim_partner_info = {}
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

        if grade in [4, 5, 6]:
            partner_subjects = ["導師區塊"]
            health_subject = None
            for req in cls.get("course_requirements", []):
                subj = req.get("subject", "")
                if "健康" in subj and req.get("defaultTeacher") == "subject":
                    health_subject = subj
                    partner_subjects.append(subj)
                    break

            swim_partner_info[c_name] = {
                "subjects": partner_subjects,
                "health_subject": health_subject,
                "grade": grade
            }

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

        if grade in [4, 5, 6] and c_name in swim_partner_info:
            info = swim_partner_info[c_name]
            partner_subjects = info["subjects"]

            # Step 2: 建立綜合夥伴變數
            partner_active = {}
            for p in range(TOTAL_PERIODS):
                p_vars = []
                for subj in partner_subjects:
                    for (c, per, t, s), var in schedule.items():
                        if c == c_name and per == p and subj in s:
                            p_vars.append(var)
                if p_vars:
                    pa = model.NewBoolVar(f'partner_active_{c_name}_p{p}')
                    model.AddMaxEquality(pa, p_vars)
                    partner_active[p] = pa

            # 收集體育課變數
            pe_vars = {}
            for p in range(TOTAL_PERIODS):
                pve = [v for (c, per, t, s), v in schedule.items()
                       if c == c_name and per == p and "體育" in s]
                if pve:
                    pe_vars[p] = pve[0]

            # Step 3: 禁止 PE-PE 連堂
            for p in range(TOTAL_PERIODS - 1):
                if p in pe_vars and (p + 1) in pe_vars:
                    model.Add(pe_vars[p] + pe_vars[p + 1] <= 1)

            class_swim_vars = []
            pairing_vars_at_p = {p: [] for p in range(TOTAL_PERIODS)}

            for d in range(DAYS):
                for pr in [0, 1, 2, 4, 5]:
                    p1 = d * PERIODS_PER_DAY + pr
                    p2 = d * PERIODS_PER_DAY + pr + 1

                    if p1 in pe_vars and p2 in partner_active:
                        is_swim_fwd = model.NewBoolVar(f'swim_fwd_{c_name}_d{d}_pr{pr}')
                        model.Add(is_swim_fwd <= pe_vars[p1])
                        model.Add(is_swim_fwd <= partner_active[p2])
                        model.Add(is_swim_fwd >= pe_vars[p1] + partner_active[p2] - 1)
                        class_swim_vars.append(is_swim_fwd)
                        pairing_vars_at_p[p1].append(is_swim_fwd)
                        pairing_vars_at_p[p2].append(is_swim_fwd)

                    if p2 in pe_vars and p1 in partner_active:
                        is_swim_bwd = model.NewBoolVar(f'swim_bwd_{c_name}_d{d}_pr{pr}')
                        model.Add(is_swim_bwd <= pe_vars[p2])
                        model.Add(is_swim_bwd <= partner_active[p1])
                        model.Add(is_swim_bwd >= pe_vars[p2] + partner_active[p1] - 1)
                        class_swim_vars.append(is_swim_bwd)
                        pairing_vars_at_p[p1].append(is_swim_bwd)
                        pairing_vars_at_p[p2].append(is_swim_bwd)

            # Step 3b: 建立 pool_active 變數（修正：只計算實際游泳連堂時段，排除常規體育課）
            for p in range(TOTAL_PERIODS):
                all_active_sources = list(pairing_vars_at_p[p])

                if all_active_sources:
                    pool_active = model.NewBoolVar(f'pool_active_{c_name}_p{p}')
                    model.AddMaxEquality(pool_active, all_active_sources)
                    pool_usage_at_p[p].append(pool_active)

            # Step 4: 強制每班至少 1 組游泳連堂
            if class_swim_vars:
                model.Add(sum(class_swim_vars) >= 1)

    # Step 5: 泳池容量限制（軟懲罰）
    for p, usage_vars in pool_usage_at_p.items():
        if usage_vars:
            pool_overload_p = model.NewIntVar(0, len(usage_vars), f"pool_overload_p{p}")
            model.Add(pool_overload_p >= sum(usage_vars) - 3)
            phase2_penalty_vars.append(10000 * pool_overload_p)


def add_consecutive_constraint(model, schedule, class_name, subject, consecutive_groups, days, periods_per_day):
    """
    [硬約束 15] 通用連堂約束

    Args:
        model: CpModel
        schedule: dict (c, p, t, s) -> BoolVar
        class_name: str
        subject: str
        consecutive_groups: int
        days: int
        periods_per_day: int
    """
    subj_vars = [var for (c, per, t, s), var in schedule.items()
                 if c == class_name and subject in s]

    for d in range(days):
        d_start = d * periods_per_day
        pairing_vars = []
        for pr in range(periods_per_day - 1):
            p1 = d_start + pr
            p2 = d_start + pr + 1
            v1 = [var for (c, per, t, s), var in schedule.items()
                  if c == class_name and per == p1 and subject in s]
            v2 = [var for (c, per, t, s), var in schedule.items()
                  if c == class_name and per == p2 and subject in s]
            if v1 and v2:
                pair_var = model.NewBoolVar(f'consec_{class_name}_{subject}_d{d}_p{pr}')
                model.Add(pair_var <= v1[0])
                model.Add(pair_var <= v2[0])
                model.Add(pair_var >= v1[0] + v2[0] - 1)
                pairing_vars.append(pair_var)
        if pairing_vars and consecutive_groups > 0:
            model.Add(sum(pairing_vars) >= consecutive_groups)


# ====================================================================
# 匯出所有公共函式
# ====================================================================
__all__ = [
    "get_valid_consecutive_pairs",
    "apply_english_capacity",
    "apply_no_consecutive_pe",
    "apply_art_consecutive_constraint",
    "apply_alternating_perfect_pairing",
    "apply_swimming_engine_v2",
    "add_consecutive_constraint",
]
