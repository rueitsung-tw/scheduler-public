# 檔名：phase2_engine.py
import terminal_sanitizer
from ortools.sat.python import cp_model
from typing import Dict, List, Tuple, Any, Optional
from collections import defaultdict

# [Task 02] Import WEIGHT_REGISTRY to eliminate hard-coded weights
from scheduler_policy import WEIGHT_REGISTRY, get_active_policy, SolveMode


class SchedulePhase2Engine:
    """
    Phase 2 軟約束引擎。
    
    [2026-07-13] build_level 參數說明:
    - "core": 只建 near-hard / 初解必要的軟約束 (用於 strict pass)
    - "quality": 加入所有品質優化 penalty (用於第二階段優化)
    - 預設 "quality" 保持向後相容
    """
    def __init__(
        self, 
        model: cp_model.CpModel, 
        schedule: Dict[Tuple[str, int, str, str], Any],
        classes: List[str], 
        teachers: List[str], 
        total_periods: int,
        days: int = 5,
        periods_per_day: int = 7,
        teachers_data: Optional[List[Dict]] = None,
        external_penalty_vars: Optional[List] = None,
        # [NEW] [gradePreferences] 新增參數
        room_grade_affinity: Optional[Dict] = None,
        room_primary_teacher_map: Optional[Dict] = None,
        classes_data: Optional[List[Dict]] = None,
        # [Task 3.5] coPlanningSettings 資料契約
        school_info: Optional[Dict] = None,
        ai_settings: Optional[Dict] = None,
        # [Task 08] Priority teacher placeholders for solver-driven assignment
        priority_placeholders: Optional[List[Dict]] = None,
        # [repair_03] Runtime policy adapter for weight resolution
        policy: Any = None,
        # [2026-07-13] build_level: "core" | "quality"
        build_level: str = "quality",
    ):
        self.model = model
        self.schedule = schedule
        self.classes = classes
        self.teachers = teachers
        self.total_periods = total_periods
        self.days = days
        self.periods_per_day = periods_per_day
        self.penalty_vars = []
        self.teachers_data = teachers_data or []

        # [NEW] [gradePreferences] 教室親和力與主責教師映射
        self.room_grade_affinity = room_grade_affinity or {}
        self.room_primary_teacher_map = room_primary_teacher_map or {}
        self.classes_data = classes_data or []

        # [Task 3.5] Store school_info for co-planning rules
        self.school_info = school_info or {}
        self.ai_settings = ai_settings or {}

        # [Task 08] Store priority teacher placeholders
        self.priority_placeholders = priority_placeholders or []

        # [repair_03] Store policy adapter for weight resolution
        # Falls back to default strict policy if not provided (backward compat)
        self.policy = policy if policy is not None else get_active_policy(SolveMode.STRICT_TEACHING_SHAPE)

        # [2026-07-13] Store build_level for constraint layering
        self.build_level = build_level
        print(f"[PHASE2] Engine initialized with build_level={build_level}")

        # [NEW] 預先建立 className -> grade 對照表（供軟約束使用）
        self.class_grade_map = {}
        for cls in self.classes_data:
            c_name = cls.get("name", "")
            grade = cls.get("grade")
            if not grade:
                import re as _re
                m = _re.search(r'(\d+)年', c_name)
                grade = int(m.group(1)) if m else 0
            self.class_grade_map[c_name] = int(grade)
        
        # [BugFix #1] 合併外部傳入的懲罰項（如游泳軟約束獎勵）
        if external_penalty_vars:
            self.penalty_vars.extend(external_penalty_vars)

        # 預先建立每位老師的專長科目集合
        self.teacher_expertise_map = {}
        for t_data in self.teachers_data:
            t_name = t_data.get("name", "")
            exp_alloc_raw = t_data.get("expertise_allocations", [])
            if isinstance(exp_alloc_raw, str):
                try:
                    import json
                    exp_alloc_raw = json.loads(exp_alloc_raw)
                except:
                    exp_alloc_raw = []
            expertise_subjects = set()
            if isinstance(exp_alloc_raw, list):
                for alloc in exp_alloc_raw:
                    subj = alloc.get("subject", "")
                    if subj:
                        expertise_subjects.add(subj)
            self.teacher_expertise_map[t_name] = expertise_subjects

    def build_soft_constraints(self):
        """
        建立軟約束。根據 build_level 決定加入哪些 penalty。
        
        build_level:
        - "core": 只建 near-hard / 初解必要的軟約束
          (教師連堂疲勞、科目分散、午休跨堂、教師配額超載、Task 3.x 導師/共備)
        - "quality": 加入所有品質優化 penalty
          (跨專長遞補、負載平衡、交替對齊、priority placeholder)
        """
        build_level = getattr(self, 'build_level', 'quality')
        print(f"[AI] 啟動 Phase 2 軟約束引擎 (build_level={build_level})...")

        # ==========================================
        # [CORE] [Rule C] 教師連堂疲勞管理 (軟約束 - 滑動視窗)
        # 導師限連 3 節，科任限連 4 節 (超出部分施加懲罰權重 5000)
        # 這是 near-hard：連堂過長會嚴重影響教學品質
        # ==========================================
        if build_level == "quality":
            print("[CORE] 啟動教師連堂疲勞管理機制 (滑動視窗)...")
            consecutive_count = 0
            for t_name in self.teachers:
                # 判斷是否為導師 (若找不到預設為科任)
                is_homeroom = any(td.get("name") == t_name and td.get("type") in ["homeroom", "導師"] for td in self.teachers_data)
                
                # 設定最大連續上課節數 (導師連3，科任連4)
                max_consec = 3 if is_homeroom else 4
                window_size = max_consec + 1

                # [INFO] Fix 1: 改用「佔用指示器」避免同一節次多堂課(交替課)被重複計算
                occupied_cache = {}
                for d in range(self.days):
                    for p in range(self.periods_per_day):
                        p_idx = d * self.periods_per_day + p
                        slot_vars = [var for (c, pp, t, s), var in self.schedule.items() if t == t_name and pp == p_idx]
                        if slot_vars:
                            is_occupied = self.model.NewBoolVar(f"occupied_indicator_{t_name}_d{d}_p{p}")
                            self.model.Add(is_occupied >= slot_vars[0])
                            for sv in slot_vars[1:]:
                                self.model.Add(is_occupied >= sv)
                            occupied_cache[(d, p)] = is_occupied
                        else:
                            occupied_cache[(d, p)] = None

                    # 每天使用滑動視窗掃描連堂
                    for i in range(self.periods_per_day - window_size + 1):
                        window_occupancy = []
                        for offset in range(window_size):
                            occ = occupied_cache.get((d, i + offset))
                            if occ is not None:
                                window_occupancy.append(occ)
                        
                        # 只有當該視窗內確實有排課變數時，才加入約束 (重構為帶有懲罰的軟約束)
                        if window_occupancy:
                            overload = self.model.NewIntVar(0, window_size, f"consec_overload_{t_name.replace(' ', '_')}_d{d}_i{i}")
                            self.model.Add(overload >= sum(window_occupancy) - max_consec)
                            self.penalty_vars.append(5000 * overload)
                            consecutive_count += 1
            
            print(f"  > [連堂防護] 已建立 {consecutive_count} 組教師連堂防護網 (導師限連3, 科任限連4，超出懲罰: 5000)")

        subjects = set(s for (c, p, t, s) in self.schedule.keys())

        # ==========================================
        # [SOFT] 軟約束 1：科目分散
        # ==========================================
        # [Task 02] Use WEIGHT_REGISTRY instead of hard-coded weight
        dispersion_weight = WEIGHT_REGISTRY.get("subject_dispersion", 50)
        
        from collections import defaultdict
        schedule_by_class_subject_day = defaultdict(list)
        for (c, p, t, s), var in self.schedule.items():
            day = p // self.periods_per_day
            schedule_by_class_subject_day[(c, s, day)].append(var)

        for c_name in self.classes:
            for d in range(self.days):
                for subject in subjects:
                    daily_subject_vars = schedule_by_class_subject_day.get((c_name, subject, d), [])
                    if len(daily_subject_vars) > 1:
                        excess_var = self.model.NewIntVar(0, self.periods_per_day, f"excess_c{c_name}_d{d}_s{subject}")
                        self.model.Add(excess_var >= sum(daily_subject_vars) - 1)
                        self.penalty_vars.append(dispersion_weight * excess_var)

        # ==========================================
        # [SOFT] 軟約束 2：午休跨堂懲罰
        # [INFO] Phase 3: 游泳連堂豁免 — 若教師處於「游泳連堂（體育+夥伴）」狀態，豁免第3節接第4節的跨午休扣分
        # ==========================================
        # [Task 02] Use WEIGHT_REGISTRY instead of hard-coded weight
        lunch_weight = WEIGHT_REGISTRY.get("lunch_span", 100)
        # 假設 0-based 中，第 3 節(中午前)與第 4 節(中午後)跨堂
        lunch_break_period = 3
        
        for t_name in self.teachers:
            for d in range(self.days):
                morn_idx = d * self.periods_per_day + lunch_break_period
                aft_idx = morn_idx + 1

                morn_vars = [var for (c, p, t, s), var in self.schedule.items() if t == t_name and p == morn_idx]
                aft_vars = [var for (c, p, t, s), var in self.schedule.items() if t == t_name and p == aft_idx]
                
                # [INFO] Phase 3: 檢查是否為游泳連堂狀態（體育/游泳科目）
                # 若上午或下午時段有游泳/體育課，則豁免午休跨堂懲罰
                morn_has_swim = any("游泳" in s or "體育" in s for (c, p, t, s), var in self.schedule.items() if t == t_name and p == morn_idx)
                aft_has_swim = any("游泳" in s or "體育" in s for (c, p, t, s), var in self.schedule.items() if t == t_name and p == aft_idx)
                
                if morn_vars and aft_vars and not (morn_has_swim or aft_has_swim):
                    morn_active = self.model.NewBoolVar(f"morn_{t_name}_d{d}")
                    aft_active = self.model.NewBoolVar(f"aft_{t_name}_d{d}")
                    span_active = self.model.NewBoolVar(f"lunch_span_{t_name}_d{d}")
                    
                    # [OK] 嚴謹寫法：雙向約束 (If and Only If)
                    self.model.Add(sum(morn_vars) >= 1).OnlyEnforceIf(morn_active)
                    self.model.Add(sum(morn_vars) == 0).OnlyEnforceIf(morn_active.Not())
                    
                    self.model.Add(sum(aft_vars) >= 1).OnlyEnforceIf(aft_active)
                    self.model.Add(sum(aft_vars) == 0).OnlyEnforceIf(aft_active.Not())
                    
                    # 邏輯語義：(morn_active AND aft_active) => span_active
                    self.model.AddBoolOr([morn_active.Not(), aft_active.Not(), span_active])
                    self.penalty_vars.append(lunch_weight * span_active)

        # ==========================================
        # [SOFT] 軟約束 3：跨專長遞補懲罰 (Phase 4) — QUALITY-ONLY
        # 當老師被分配教授非專長科目時，施加高額懲罰
        # [2026-07-13] 移到 quality level：不是初解必需的條件
        # ==========================================
        if build_level == "quality":
            cross_expertise_penalty = WEIGHT_REGISTRY.get("cross_expertise", 5000)
            cross_expertise_count = 0
            print(f"[AI] 啟動 Phase 4 跨專長遞補懲罰機制... (權重: {cross_expertise_penalty})")

            for (c_name, p, t_name, subject), var in self.schedule.items():
                # 排除特殊科目（導師區塊、游泳等引擎內部生成的科目）
                if "導師區塊" in subject:
                    continue

                # 獲取該老師的專長科目集合
                teacher_subjects = self.teacher_expertise_map.get(t_name, set())
                
                # 如果該老師沒有設定專長配額，則不適用此懲罰
                if not teacher_subjects:
                    continue

                # 檢查該科目是否在專長列表中
                is_expertise = any(exp_subj in subject for exp_subj in teacher_subjects)
                
                if not is_expertise:
                    is_cross = self.model.NewBoolVar(f"cross_expertise_{t_name}_{c_name}_p{p}_{subject}")
                    self.model.Add(is_cross >= var)
                    self.penalty_vars.append(cross_expertise_penalty * is_cross)
                    cross_expertise_count += 1

            if cross_expertise_count > 0:
                print(f"  [WARN] [跨專長遞補] 共建立 {cross_expertise_count} 個跨專長懲罰變數 (權重: {cross_expertise_penalty})")
            else:
                print("  [OK] [跨專長遞補] 所有排課都在專長範圍內，無需懲罰")
        else:
            print("  [SKIP] [跨專長遞補] build_level=core，跳過 quality-only 約束")

        # ==========================================
        # [BALANCE] 軟約束 4：負載平衡 (Load Balancing) — 解決贏者全拿問題
        # 4A. 覆蓋獎勵 (Coverage Reward)
        #     確保每位有專長配額的老師至少被排 1 節課，防止 0 節邊緣化
        # 4B. 科目集中遞減懲罰 (Subject Concentration Decay Penalty)
        #     當同一老師同科目超過閾值時，每多排一節施加線性遞增懲罰
        # ==========================================
        if build_level == "quality":
            print("[BALANCE] 啟動負載平衡機制 (Load Balancing)...")

            # --- 4A: 覆蓋獎勵 ---
            coverage_penalty_weight = 500
            coverage_count = 0
            for t_name in self.teachers:
                # 只對有專長配額的老師套用覆蓋獎勵
                if not self.teacher_expertise_map.get(t_name):
                    continue

                # 找出老師 t_name 所有可能被排課的布林變數
                t_vars = [var for (c, p, t, s), var in self.schedule.items() if t == t_name]
                if not t_vars:
                    continue

                # has_any_class[t]: True 當老師至少被排 1 節課
                has_any = self.model.NewBoolVar(f"has_any_class_{t_name}")
                # 約束: has_any >= 任意一個 var (如果任一個為1則 has_any=1)
                for v in t_vars:
                    self.model.Add(has_any >= v)
                # 如果 has_any 為 0 (沒有課)，則懲罰
                self.penalty_vars.append(coverage_penalty_weight * (1 - has_any))
                coverage_count += 1

            if coverage_count > 0:
                print(f"  [INFO] [覆蓋獎勵] 已為 {coverage_count} 位有專長配額的老師建立覆蓋約束 (權重: {coverage_penalty_weight})")

            # --- 4B: 階梯式集中懲罰 (Step-wise Concentration Penalty) ---
            # 對每位老師的每個非導師科目，施加多層級閾值懲罰：
            #   超過 5 節 → 每多 1 節懲罰 80
            #   超過 10 節 → 每多 1 節再加懲罰 150
            #   超過 15 節 → 每多 1 節再加懲罰 300
            # 效果：排得越多，邊際懲罰越高，強迫引擎分發給其他老師
            thresholds = [
                (5, 80),    # 第一階：超過 5 節，每多 1 節懲 80
                (10, 150),  # 第二階：超過 10 節，每多 1 節懲 150
                (15, 300),  # 第三階：超過 15 節，每多 1 節懲 300
            ]
            concentration_count = 0

            for t_name in self.teachers:
                # 找出該老師參與的所有科目
                t_subject_set = set(s for (c, p, t, s) in self.schedule.keys() if t == t_name and "導師區塊" not in s)

                for subject in t_subject_set:
                    subj_vars = [var for (c, p, t, s), var in self.schedule.items()
                                 if t == t_name and subject == s]
                    if not subj_vars:
                        continue

                    total = len(subj_vars)
                    load_var = self.model.NewIntVar(0, total, f"load_{t_name}_{subject}")
                    self.model.Add(load_var == sum(subj_vars))

                    # 為每一層閾值建立 excess 變數
                    for threshold, weight in thresholds:
                        excess = self.model.NewIntVar(0, total, f"excess_{t_name}_{subject}_t{threshold}")
                        self.model.Add(excess >= load_var - threshold)
                        self.penalty_vars.append(weight * excess)
                        concentration_count += 1

            if concentration_count > 0:
                print(f"  [INFO] [階梯式集中懲罰] 已建立 {concentration_count} 個懲罰變數 (閾值/權重: {thresholds})")
        else:
            print("  [SKIP] [負載平衡] build_level=core，跳過 quality-only 約束")

        # ==========================================
        # [SOFT] 軟約束 5：教師總配額 Soft Overload (Phase 2)
        # 當老師實際排課數超過 max_periods 時，每超 1 節施加懲罰
        # [NEW] 融合特殊課程時段佔用：特教教師的 actual_load 需加上學習中心/抽離課程的佔用
        # ==========================================
        # [Task 02] Use WEIGHT_REGISTRY instead of hard-coded weight
        quota_overload_weight = WEIGHT_REGISTRY.get("teacher_quota_overtime", 5000)
        quota_overload_count = 0
        print(f"[SOFT] 啟動教師配額 Soft Overload 機制... (權重: {quota_overload_weight})")

        # 預先計算特教教師在特殊課程中的時段佔用
        special_teacher_periods = defaultdict(int)
        if hasattr(self.model, "sc_decision_vars"):
            for sc_entry in self.model.sc_decision_vars:
                sc = sc_entry["sc"]
                teacher = sc.get("teacher", "")
                if teacher:
                    # 每個特殊課程佔用 1 個時段
                    special_teacher_periods[teacher] += 1

        for t_data in self.teachers_data:
            t_name = t_data.get("name", "")
            # [repair_07] Use original max_periods for soft penalty calculation.
            # _safe_max_quota is inflated to actual demand (prevents INFEASIBLE for hard constraints),
            # but soft overload penalty must measure against the user-configured quota limit.
            original_max_quota = t_data.get("max_periods", 28)

            # 找出該老師所有的排課變數
            t_vars = [var for (c, p, t, s), var in self.schedule.items() if t == t_name]
            if not t_vars:
                continue

            total_possible = len(t_vars)
            actual_load = self.model.NewIntVar(0, total_possible, f"actual_load_{t_name}")
            self.model.Add(actual_load == sum(t_vars))

            # [NEW] 若該教師有特殊課程佔用，則從配額中扣除
            special_periods = special_teacher_periods.get(t_name, 0)
            effective_quota = original_max_quota - special_periods if special_periods > 0 else original_max_quota
            if special_periods > 0:
                print(f"  [INFO] [特教融合] {t_name} 特殊課程佔用 {special_periods} 節，有效配額 {original_max_quota} → {effective_quota}")

            # overload 變數：當 actual_load > effective_quota 時，overload = actual_load - effective_quota
            overload = self.model.NewIntVar(0, total_possible, f"quota_overload_{t_name}")
            self.model.Add(overload >= actual_load - effective_quota)
            # [repair_07] Use dict metadata so solver.py penaltyBreakdown can parse it
            self.penalty_vars.append({
                "rule_id": "teacher_quota_overtime",
                "weight": quota_overload_weight,
                "var": overload,
            })
            quota_overload_count += 1

            # [SOFT] 軟約束 5B：科目級配額 Soft Overload
            expertise_quotas = t_data.get("_expertise_quotas", {})
            if expertise_quotas:
                # [repair_07] Use policy weight instead of hard-coded 3000
                subj_overtime_weight = self.policy.get_weight("teacher_quota_overtime")
                for subj, max_q in expertise_quotas.items():
                    subj_vars = [var for (c, p, t, s), var in self.schedule.items()
                                 if t == t_name and subj in s]
                    if not subj_vars:
                        continue

                    subj_load = self.model.NewIntVar(0, len(subj_vars), f"subj_load_{t_name}_{subj}")
                    self.model.Add(subj_load == sum(subj_vars))

                    subj_overload = self.model.NewIntVar(0, len(subj_vars), f"subj_quota_overload_{t_name}_{subj}")
                    self.model.Add(subj_overload >= subj_load - max_q)
                    # [repair_07] Use dict metadata so solver.py penaltyBreakdown can parse it
                    self.penalty_vars.append({
                        "rule_id": "teacher_quota_overtime",
                        "weight": subj_overtime_weight,
                        "var": subj_overload,
                    })

        if quota_overload_count > 0:
            print(f"  [SOFT] [Soft Quota Overload] 已為 {quota_overload_count} 位老師建立配額超載懲罰 (權重: {quota_overload_weight})")

        # ==========================================
        # [PUZZLE] [軟約束] 教師交替課完美對齊 (Alignment Penalty)
        # 確保同師的交替課（單週/雙週）疊合在同一 (day, period)，避免半節空洞
        # 系統中交替課以 "交替" 標記識別，is_music_odd 變量區分單/雙週
        # ====================================
        if build_level == "quality":
            # [Task 02] Use WEIGHT_REGISTRY instead of hard-coded weight
            alternating_alignment_weight = WEIGHT_REGISTRY.get("alternating_alignment_conflict", 10000)
            alternating_alignment_count = 0

            # 先收集所有交替相關的schedule key，找出涉及的老師
            alternating_teachers = set()
            for (c, p, t, s) in self.schedule.keys():
                if "交替" in s:
                    alternating_teachers.add(t)

            for t_name in alternating_teachers:
                for d in range(self.days):
                    for p in range(self.periods_per_day):
                        period_index = d * self.periods_per_day + p
                        # 獲取該老師在特定時段的所有變數
                        slot_vars = [var for (c, per, t, s), var in self.schedule.items()
                                     if t == t_name and per == period_index]

                        if not slot_vars:
                            continue

                        # 找出該時段內的交替課標記
                        # 交替課在solver.py中由音樂老師(單週)與美勞老師(雙週)分別標記
                        alt_vars = [var for (c, per, t, s), var in self.schedule.items()
                                    if t == t_name and per == period_index and "交替" in s]

                        if len(alt_vars) >= 2:
                            # 多個交替課在同一時段可能互相覆蓋，建立衝突懲罰
                            for i in range(len(alt_vars)):
                                for j in range(i + 1, len(alt_vars)):
                                    v1 = alt_vars[i]
                                    v2 = alt_vars[j]
                                    conflict = self.model.NewBoolVar(f"alt_conflict_{t_name}_d{d}_p{p}")
                                    self.model.AddBoolOr([v1.Not(), v2.Not(), conflict])
                                    self.penalty_vars.append(alternating_alignment_weight * conflict)
                                    alternating_alignment_count += 1

            if alternating_alignment_count > 0:
                print(f"  [PUZZLE] [交替對齊] 已建立 {alternating_alignment_count} 個對齊懲罰變數 (權重: {alternating_alignment_weight})")
            else:
                print("  [PUZZLE] [交替對齊] 未檢測到交替課同節次衝突，無需懲罰")
        else:
            print("  [SKIP] [交替對齊] build_level=core，跳過 quality-only 約束")

        # ==========================================
        # [DEBUG] [BugFix #4] 增強診斷：輸出各科總需求與理論容量比值
        # ==========================================
        print("\n[DEBUG] [深度診斷] 資源負荷檢查:")
        from collections import Counter
        subject_demand = Counter()
        for cls in self.classes_data:
            for req in cls.get("course_requirements", []):
                subj = req.get("subject", "")
                periods = float(req.get("periods", 0))
                if "交替" in subj:
                    subject_demand[subj] += periods / 2
                else:
                    subject_demand[subj] += periods

        for subj, demand in subject_demand.most_common(20):
            # 統計有多少班級有此學科需求
            num_classes_with_subj = sum(
                1 for cls in self.classes_data
                if any(r.get("subject") == subj for r in cls.get("course_requirements", []))
            )
            theoretical_cap = num_classes_with_subj * 35
            ratio = demand / theoretical_cap if theoretical_cap > 0 else 0
            status = "[SEARCH] 危險" if ratio > 0.8 else "[WARN] 注意" if ratio > 0.6 else "[OK] 安全"
            print(f"  - {subj}: 需求點數 {demand}, 負荷率 {ratio:.2%} ({status})")

        # ==========================================
        # [SOFT] Task 3.3~3.9: 導師時段與共備軟規則
        # ==========================================
        print("[SOFT] 啟動第 3 階段軟規則 (導師時段 + 共備)...")
        try:
            from constraints.class_rules import (
                build_grade_morning_first_period_homeroom_penalty,
                build_morning_two_homeroom_periods_penalty,
                build_co_planning_afternoon_block_penalty,
                build_co_planning_subject_lesson_penalty,
                build_homeroom_daily_max_periods_penalty,
                build_manual_co_planning_penalty,
            )

            # Task 3.3: 3-6 年級每週一天第一節導師課偏好
            hr_penalty = build_grade_morning_first_period_homeroom_penalty(
                self.model, self.schedule, self.classes_data
            )
            self.penalty_vars.extend(hr_penalty)
            print(f"  [Task 3.3] grade_morning_first_period_homeroom_day: {len(hr_penalty)} penalty terms")

            # Task 3.4: 每班每日早上兩節導師型課程偏好
            morning_hr_penalty = build_morning_two_homeroom_periods_penalty(
                self.model, self.schedule, self.classes_data
            )
            self.penalty_vars.extend(morning_hr_penalty)
            print(f"  [Task 3.4] morning_two_homeroom_periods_per_day: {len(morning_hr_penalty)} penalty terms")

            # Task 3.6: 共備候選區塊軟目標
            co_plan_penalty, indicator_map = build_co_planning_afternoon_block_penalty(
                self.model, self.schedule, self.classes_data,
                school_info=getattr(self, 'school_info', None)
            )
            self.penalty_vars.extend(co_plan_penalty)
            print(f"  [Task 3.6] grade_co_planning_afternoon_block: {len(co_plan_penalty)} penalty terms")

            # Task 3.7: 共備期間科任課偏好 (依賴 3.6 的 indicator_map)
            co_plan_subject_penalty = build_co_planning_subject_lesson_penalty(
                self.model, self.schedule, self.classes_data,
                indicator_map=indicator_map
            )
            self.penalty_vars.extend(co_plan_subject_penalty)
            print(f"  [Task 3.7] co_planning_subject_teacher_lesson: {len(co_plan_subject_penalty)} penalty terms")

            # Task 3.8: 導師每日最大節次軟懲罰 (soft)
            hr_daily_max_penalty = build_homeroom_daily_max_periods_penalty(
                self.model, self.schedule, self.classes_data
            )
            self.penalty_vars.extend(hr_daily_max_penalty)
            print(f"  [Task 3.8] homeroom_daily_max_periods: {len(hr_daily_max_penalty)} penalty terms")

            # Task 3.9: Manual Co-Planning Block Penalty (near-hard soft)
            manual_co_plan_penalty = build_manual_co_planning_penalty(
                self.model, self.schedule, self.classes_data,
                school_info=getattr(self, 'school_info', None)
            )
            self.penalty_vars.extend(manual_co_plan_penalty)
            print(f"  [Task 3.9] manual_co_planning_subject_teacher_lesson: {len(manual_co_plan_penalty)} penalty terms")

        except Exception as e:
            print(f"  [WARN] 第 3 階段軟規則建立失敗 (不影響主流程): {e}")

        # ==========================================
        # [Task 08] Priority Teacher Placeholder Reservation Objective
        # Builds per-(placeholder, candidate_class, candidate_period) reservation BoolVars
        # linked to existing schedule vars. Solver decides final assignment.
        # Rule ID: priority_teacher_placeholder
        # ==========================================
        if build_level == "quality":
            self._build_priority_placeholder_objective()
            self.penalty_vars.extend(self._build_soft_slot_rule_penalty())
            self.penalty_vars.extend(self._build_teacher_daily_load_smoothing())
            self.penalty_vars.extend(self._build_grade_consistency_penalty())
            self.penalty_vars.extend(self._build_period7_flexible_preference())
            self.penalty_vars.extend(self._build_pe_avoid_45())
        else:
            print("  [SKIP] [Priority Placeholder] build_level=core，跳過 quality-only 約束")

        # ==========================================
        # ? 目標函數：最小化總扣分 (含負載平衡 + Soft Quota)
        # ==========================================
        penalty_exprs = [self._penalty_expr(p) for p in self.penalty_vars]
        penalty_exprs = [p for p in penalty_exprs if p is not None]
        if penalty_exprs:
            self.model.Minimize(sum(penalty_exprs))
        else:
            self.model.Minimize(0)

    def _build_soft_slot_rule_penalty(self):
        """Build soft penalty for operator slot rules with mode == 'soft'."""
        penalties = []
        slot_rules = []
        if hasattr(self, 'ai_settings') and isinstance(self.ai_settings, dict):
            slot_rules = self.ai_settings.get("slotRules", [])
        elif hasattr(self, 'school_info') and isinstance(self.school_info, dict):
            slot_rules = self.school_info.get("slotRules", [])

        from scheduler_policy import parse_slot_rules, WEIGHT_REGISTRY
        parsed = [r for r in parse_slot_rules(slot_rules) if r.enabled and r.mode == "soft"]
        base_weight = WEIGHT_REGISTRY.get("soft_slot_rule_avoid", 30)

        for rule in parsed:
            weight = base_weight * rule.weight
            owner_id = rule.owner_id
            days = range(1, 6) if rule.day == "all" else (int(rule.day),)
            periods = rule.periods

            for (c, p, t, s), var in self.schedule.items():
                day = (p // self.periods_per_day) + 1
                period = (p % self.periods_per_day) + 1
                if day in days and period in periods:
                    if rule.owner_type == "teacher" and t == owner_id:
                        penalties.append(weight * var)
                    elif rule.owner_type == "class" and c == owner_id:
                        penalties.append(weight * var)
        return penalties

    def _build_teacher_daily_load_smoothing(self):
        """Build soft penalty for smoothing teacher daily load across the week."""
        penalties = []
        weight = WEIGHT_REGISTRY.get("teacher_daily_load_smoothing", 50)
        for t_name in self.teachers:
            daily_vars = defaultdict(list)
            for (c, p, t, s), var in self.schedule.items():
                if t == t_name:
                    d = p // self.periods_per_day
                    daily_vars[d].append(var)

            if not daily_vars:
                continue

            for d in range(self.days):
                d_vars = daily_vars.get(d, [])
                if d_vars:
                    excess = self.model.NewIntVar(0, self.periods_per_day, f"load_smooth_{t_name}_d{d}")
                    self.model.Add(excess >= sum(d_vars) - 5)
                    penalties.append(weight * excess)
        return penalties

    def _build_grade_consistency_penalty(self):
        """Build soft penalty for teaching across multiple different grades in the same day."""
        penalties = []
        weight = WEIGHT_REGISTRY.get("same_teacher_grade_consistency", 80)
        for t_name in self.teachers:
            for d in range(self.days):
                day_vars = []
                for (c, p, t, s), var in self.schedule.items():
                    if t == t_name and (p // self.periods_per_day) == d:
                        grade = self.class_grade_map.get(c, 1)
                        day_vars.append((grade, var))

                grade_groups = defaultdict(list)
                for g, v in day_vars:
                    grade_groups[g].append(v)

                if len(grade_groups) > 1:
                    active_grades = []
                    for g, g_vars in grade_groups.items():
                        g_act = self.model.NewBoolVar(f"t_g_act_{t_name}_d{d}_g{g}")
                        self.model.Add(sum(g_vars) >= 1).OnlyEnforceIf(g_act)
                        self.model.Add(sum(g_vars) == 0).OnlyEnforceIf(g_act.Not())
                        active_grades.append(g_act)

                    grade_count = self.model.NewIntVar(0, 6, f"t_g_count_{t_name}_d{d}")
                    self.model.Add(grade_count == sum(active_grades))
                    penalty_var = self.model.NewIntVar(0, 6, f"t_g_pen_{t_name}_d{d}")
                    self.model.Add(penalty_var >= grade_count - 1)
                    penalties.append(weight * penalty_var)
        return penalties

    def _build_period7_flexible_preference(self):
        """Build preference penalty for period 7 (prefer flexible/校本/資訊, avoid core academic)."""
        penalties = []
        weight = WEIGHT_REGISTRY.get("period7_flexible_preference", 20)
        avoid_subjects = {"語文-國語", "國語", "數學", "自然科學", "社會"}

        for (c, p, t, s), var in self.schedule.items():
            period = (p % self.periods_per_day) + 1
            if period == 7 and any(avoid in s for avoid in avoid_subjects):
                penalties.append(weight * var)
        return penalties

    def _build_pe_avoid_45(self):
        """Build preference penalty for PE/體育 lessons in period 4 & 5 (noon heat & digestion)."""
        penalties = []
        weight = WEIGHT_REGISTRY.get("pe_avoid_period_45", 20)

        for (c, p, t, s), var in self.schedule.items():
            period = (p % self.periods_per_day) + 1
            if ("體育" in s or "健康與體育" in s) and period in (4, 5):
                penalties.append(weight * var)
        return penalties

    def _build_priority_placeholder_objective(self):
        """[Task 08 / repair_03] Priority teacher placeholder reservation model.

        For each placeholder, create a reservation BoolVar per (candidate_class, candidate_period).
        Each reservation var is linked to an existing schedule var:
          - If a matching schedule var exists: reservation_var <= schedule_var
          - Otherwise: reservation_var == 0
        Satisfaction = sum of reservation vars for the placeholder.
        Deficit = max(0, demandPeriods - satisfaction).
        Penalty = policy_weight * deficit (soft objective, never hard constraint).

        Weight source: policy.get_weight("priority_teacher_placeholder")
            — resolves from WEIGHT_REGISTRY via SolvePolicy adapter
            — default 12000 (near_hard per YAML §432-433)
        """
        if not self.priority_placeholders:
            print("  [Task 08] No priority teacher placeholders to process")
            return

        # Weight from policy adapter (no hard-coded value)
        priority_weight = self.policy.get_weight("priority_teacher_placeholder")

        total_reservation_vars = 0
        placeholder_penalty_count = 0

        for idx, placeholder in enumerate(self.priority_placeholders):
            teacher_name = placeholder.get("teacherName", "")
            subject = placeholder.get("subject", "")
            demand_periods = placeholder.get("demandPeriods", 0)
            candidate_classes = placeholder.get("candidateClasses", [])
            candidate_periods = placeholder.get("candidatePeriods", None)

            if not teacher_name or not candidate_classes or demand_periods <= 0:
                continue

            # If no period restriction, use all periods
            if candidate_periods is None:
                period_indices = list(range(self.total_periods))
            else:
                period_indices = [
                    cp.get("period", cp.get("index", 0))
                    for cp in candidate_periods
                    if isinstance(cp, dict)
                ]

            if not period_indices:
                period_indices = list(range(self.total_periods))

            # Safe name tokens for variable naming
            safe_teacher = teacher_name.replace(' ', '_').replace('/', '_')
            safe_subject = subject.replace(' ', '_').replace('/', '_')

            # Build a lookup of schedule vars keyed by (class_name, period_index)
            # Schedule key format: (class_name, period_index, teacher_name, subject)
            teacher_schedule_vars = {}
            for (c, p, t, s), var in self.schedule.items():
                if t == teacher_name and c in candidate_classes:
                    # Match exact subject first, then substring match
                    if s == subject or subject in s or s in subject:
                        teacher_schedule_vars[(c, p)] = var

            reservation_vars_for_p = []

            for c_name in candidate_classes:
                safe_class = c_name.replace(' ', '_').replace('/', '_')
                for period in period_indices:
                    reservation_var = self.model.NewBoolVar(
                        f"priority_placeholder_{safe_teacher}_{safe_class}_p{period}"
                    )

                    # Link to existing schedule var — reservation cannot fire without the actual schedule
                    schedule_key = (c_name, period)
                    if schedule_key in teacher_schedule_vars:
                        self.model.Add(reservation_var <= teacher_schedule_vars[schedule_key])
                    else:
                        # No matching schedule entry — this reservation can never be satisfied
                        self.model.Add(reservation_var == 0)

                    reservation_vars_for_p.append(reservation_var)
                    total_reservation_vars += 1

            if not reservation_vars_for_p:
                print(f"  [WARN] [Task 08] Placeholder '{teacher_name}' has no reservation vars to create")
                continue

            # Satisfaction = sum of all reservation vars for this placeholder
            satisfaction = sum(reservation_vars_for_p)

            # Deficit = max(0, demandPeriods - satisfaction)
            deficit = self.model.NewIntVar(
                0, demand_periods,
                f"priority_placeholder_deficit_{safe_teacher}"
            )
            self.model.Add(deficit >= demand_periods - satisfaction)

            self.penalty_vars.append({
                "rule_id": "priority_teacher_placeholder",
                "weight": priority_weight,
                "var": deficit,
            })
            placeholder_penalty_count += 1

        print(f"  [Task 08] Priority placeholder reservation model: "
              f"{placeholder_penalty_count} placeholder(s), {total_reservation_vars} reservation vars, weight={priority_weight}")

    @staticmethod
    def _penalty_expr(penalty_entry):
        if isinstance(penalty_entry, dict):
            var = penalty_entry.get("var")
            if var is None:
                var = penalty_entry.get("violation")
            if var is None:
                return None
            return int(penalty_entry.get("weight", 0)) * var
        return penalty_entry
