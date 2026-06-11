# 檔名：phase2_engine.py
from ortools.sat.python import cp_model
from typing import Dict, List, Tuple, Any, Optional
from collections import defaultdict


class SchedulePhase2Engine:
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
        # 🆕 [gradePreferences] 新增參數
        room_grade_affinity: Optional[Dict] = None,
        room_primary_teacher_map: Optional[Dict] = None,
        classes_data: Optional[List[Dict]] = None,
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

        # 🆕 [gradePreferences] 教室親和力與主責教師映射
        self.room_grade_affinity = room_grade_affinity or {}
        self.room_primary_teacher_map = room_primary_teacher_map or {}
        self.classes_data = classes_data or []

        # 🆕 預先建立 className -> grade 對照表（供軟約束使用）
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
        print("🧠 啟動 Phase 2 軟約束引擎...")

        # ==========================================
        # 🧱 [Rule C] 教師連堂疲勞管理 (軟約束 - 滑動視窗)
        # 導師限連 3 節，科任限連 4 節 (超出部分施加懲罰權重 5000)
        # ==========================================
        print("🧱 啟動教師連堂疲勞管理機制 (滑動視窗)...")
        consecutive_count = 0
        for t_name in self.teachers:
            # 判斷是否為導師 (若找不到預設為科任)
            is_homeroom = any(td.get("name") == t_name and td.get("type") in ["homeroom", "導師"] for td in self.teachers_data)
            
            # 設定最大連續上課節數 (導師連3，科任連4)
            max_consec = 3 if is_homeroom else 4
            window_size = max_consec + 1

            # 🚀 Fix 1: 改用「佔用指示器」避免同一節次多堂課(交替課)被重複計算
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
        
        print(f"  ➤ [連堂防護] 已建立 {consecutive_count} 組教師連堂防護網 (導師限連3, 科任限連4，超出懲罰: 5000)")

        subjects = set(s for (c, p, t, s) in self.schedule.keys())

        # ==========================================
        # ☁️ 軟約束 1：科目分散
        # ==========================================
        dispersion_weight = 50 
        for c_name in self.classes:
            for d in range(self.days):
                day_start = d * self.periods_per_day
                day_end = day_start + self.periods_per_day
                
                for subject in subjects:
                    daily_subject_vars = [
                        var for (c, p, t, s), var in self.schedule.items()
                        if c == c_name and s == subject and day_start <= p < day_end
                    ]
                    if len(daily_subject_vars) > 1:
                        excess_var = self.model.NewIntVar(0, self.periods_per_day, f"excess_c{c_name}_d{d}_s{subject}")
                        self.model.Add(excess_var >= sum(daily_subject_vars) - 1)
                        self.penalty_vars.append(dispersion_weight * excess_var)

        # ==========================================
        # ☁️ 軟約束 2：午休跨堂懲罰
        # 🚀 Phase 3: 游泳連堂豁免 — 若教師處於「游泳連堂（體育+夥伴）」狀態，豁免第3節接第4節的跨午休扣分
        # ==========================================
        lunch_weight = 100
        # 假設 0-based 中，第 3 節(中午前)與第 4 節(中午後)跨堂
        lunch_break_period = 3
        
        for t_name in self.teachers:
            for d in range(self.days):
                morn_idx = d * self.periods_per_day + lunch_break_period
                aft_idx = morn_idx + 1

                morn_vars = [var for (c, p, t, s), var in self.schedule.items() if t == t_name and p == morn_idx]
                aft_vars = [var for (c, p, t, s), var in self.schedule.items() if t == t_name and p == aft_idx]
                
                # 🚀 Phase 3: 檢查是否為游泳連堂狀態（體育/游泳科目）
                # 若上午或下午時段有游泳/體育課，則豁免午休跨堂懲罰
                morn_has_swim = any("游泳" in s or "體育" in s for (c, p, t, s), var in self.schedule.items() if t == t_name and p == morn_idx)
                aft_has_swim = any("游泳" in s or "體育" in s for (c, p, t, s), var in self.schedule.items() if t == t_name and p == aft_idx)
                
                if morn_vars and aft_vars and not (morn_has_swim or aft_has_swim):
                    morn_active = self.model.NewBoolVar(f"morn_{t_name}_d{d}")
                    aft_active = self.model.NewBoolVar(f"aft_{t_name}_d{d}")
                    span_active = self.model.NewBoolVar(f"lunch_span_{t_name}_d{d}")
                    
                    # ✅ 嚴謹寫法：雙向約束 (If and Only If)
                    self.model.Add(sum(morn_vars) >= 1).OnlyEnforceIf(morn_active)
                    self.model.Add(sum(morn_vars) == 0).OnlyEnforceIf(morn_active.Not())
                    
                    self.model.Add(sum(aft_vars) >= 1).OnlyEnforceIf(aft_active)
                    self.model.Add(sum(aft_vars) == 0).OnlyEnforceIf(aft_active.Not())
                    
                    # 邏輯語義：(morn_active AND aft_active) => span_active
                    self.model.AddBoolOr([morn_active.Not(), aft_active.Not(), span_active])
                    self.penalty_vars.append(lunch_weight * span_active)

        # ==========================================
        # ☁️ 軟約束 3：跨專長遞補懲罰 (Phase 4)
        # 當老師被分配教授非專長科目時，施加高額懲罰
        # 求解器會優先用專長老師，只有在專長老師節數用完時才觸發遞補
        # ==========================================
        # 🚀 Phase 3: 調降跨專長懲罰權重，確保系統優先守住泳池/教室等實體資源
        cross_expertise_penalty = 5000
        cross_expertise_count = 0
        print("🧠 啟動 Phase 4 跨專長遞補懲罰機制... (權重已調降至 5000)")

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
            # 使用 substring 匹配（如 "體育" in "體育 s"）
            is_expertise = any(exp_subj in subject for exp_subj in teacher_subjects)
            
            if not is_expertise:
                # 建立跨專長布林變數
                is_cross = self.model.NewBoolVar(f"cross_expertise_{t_name}_{c_name}_p{p}_{subject}")
                # 如果該排課變數被選中，則 is_cross 必須為 True
                self.model.Add(is_cross >= var)
                self.penalty_vars.append(cross_expertise_penalty * is_cross)
                cross_expertise_count += 1

        if cross_expertise_count > 0:
            print(f"  ⚠️ [跨專長遞補] 共建立 {cross_expertise_count} 個跨專長懲罰變數 (權重: {cross_expertise_penalty})")
        else:
            print("  ✅ [跨專長遞補] 所有排課都在專長範圍內，無需懲罰")

        # ==========================================
        # ⚖️ 軟約束 4：負載平衡 (Load Balancing) — 解決贏者全拿問題
        # 4A. 覆蓋獎勵 (Coverage Reward)
        #     確保每位有專長配額的老師至少被排 1 節課，防止 0 節邊緣化
        # 4B. 科目集中遞減懲罰 (Subject Concentration Decay Penalty)
        #     當同一老師同科目超過閾值時，每多排一節施加線性遞增懲罰
        # ==========================================
        print("⚖️ 啟動負載平衡機制 (Load Balancing)...")

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
            print(f"  📊 [覆蓋獎勵] 已為 {coverage_count} 位有專長配額的老師建立覆蓋約束 (權重: {coverage_penalty_weight})")

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
            print(f"  📊 [階梯式集中懲罰] 已建立 {concentration_count} 個懲罰變數 (閾值/權重: {thresholds})")

        # ==========================================
        # ☁️ 軟約束 5：教師總配額 Soft Overload (Phase 2)
        # 當老師實際排課數超過 max_periods 時，每超 1 節施加懲罰
        # 🆕 融合特殊課程時段佔用：特教教師的 actual_load 需加上學習中心/抽離課程的佔用
        # ==========================================
        quota_overload_weight = 5000
        quota_overload_count = 0
        print("☁️ 啟動教師配額 Soft Overload 機制...")

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
            safe_max_quota = t_data.get("_safe_max_quota", 28)

            # 找出該老師所有的排課變數
            t_vars = [var for (c, p, t, s), var in self.schedule.items() if t == t_name]
            if not t_vars:
                continue

            total_possible = len(t_vars)
            actual_load = self.model.NewIntVar(0, total_possible, f"actual_load_{t_name}")
            self.model.Add(actual_load == sum(t_vars))

            # 🆕 若該教師有特殊課程佔用，則從配額中扣除
            special_periods = special_teacher_periods.get(t_name, 0)
            effective_quota = safe_max_quota - special_periods if special_periods > 0 else safe_max_quota
            if special_periods > 0:
                print(f"  📌 [特教融合] {t_name} 特殊課程佔用 {special_periods} 節，有效配額 {safe_max_quota} → {effective_quota}")

            # overload 變數：當 actual_load > effective_quota 時，overload = actual_load - effective_quota
            overload = self.model.NewIntVar(0, total_possible, f"quota_overload_{t_name}")
            self.model.Add(overload >= actual_load - effective_quota)
            self.penalty_vars.append(quota_overload_weight * overload)
            quota_overload_count += 1

            # ☁️ 軟約束 5B：科目級配額 Soft Overload
            expertise_quotas = t_data.get("_expertise_quotas", {})
            if expertise_quotas:
                for subj, max_q in expertise_quotas.items():
                    subj_vars = [var for (c, p, t, s), var in self.schedule.items()
                                 if t == t_name and subj in s]
                    if not subj_vars:
                        continue

                    subj_load = self.model.NewIntVar(0, len(subj_vars), f"subj_load_{t_name}_{subj}")
                    self.model.Add(subj_load == sum(subj_vars))

                    subj_overload = self.model.NewIntVar(0, len(subj_vars), f"subj_quota_overload_{t_name}_{subj}")
                    self.model.Add(subj_overload >= subj_load - max_q)
                    # 科目級懲罰略低於總配額，避免衝突
                    self.penalty_vars.append(3000 * subj_overload)

        if quota_overload_count > 0:
            print(f"  ☁️ [Soft Quota Overload] 已為 {quota_overload_count} 位老師建立配額超載懲罰 (權重: {quota_overload_weight})")

        # ==========================================
        # 🧩 [軟約束] 教師交替課完美對齊 (Alignment Penalty)
        # 確保同師的交替課（單週/雙週）疊合在同一 (day, period)，避免半節空洞
        # 系統中交替課以 "交替" 標記識別，is_music_odd 變量區分單/雙週
        # ====================================
        alternating_alignment_weight = 10000
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
            print(f"  🧩 [交替對齊] 已建立 {alternating_alignment_count} 個對齊懲罰變數 (權重: {alternating_alignment_weight})")
        else:
            print("  🧩 [交替對齊] 未檢測到交替課同節次衝突，無需懲罰")

        # ==========================================
        # 🔍 [BugFix #4] 增強診斷：輸出各科總需求與理論容量比值
        # ==========================================
        print("\n🔍 [深度診斷] 資源負荷檢查:")
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
            status = "🔴 危險" if ratio > 0.8 else "🟡 注意" if ratio > 0.6 else "🟢 安全"
            print(f"  - {subj}: 需求點數 {demand}, 負荷率 {ratio:.2%} ({status})")

        # ==========================================
        # � 目標函數：最小化總扣分 (含負載平衡 + Soft Quota)
        # ==========================================
        if self.penalty_vars:
            self.model.Minimize(sum(self.penalty_vars))
        else:
            self.model.Minimize(0)
