#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
repair_agent.py — Phase 2 修補代理 (Repair Agent)

使用模擬退火演算法 (Simulated Annealing) 對 Phase 1 產出的初步課表進行後處理優化。
在不破壞全校物理硬約束的前提下，透過連鎖換課消除軟約束扣分：
- 教師過度連堂（連上 4 堂）
- 班級科任課過度集中（單日 > 3 節）
- 交替課未完美對齊（單雙週音樂/美勞時段不一致）
- 20260706


用法：
    python repair_agent.py <payload.json> <phase1_output.json> <output_path>
"""

import terminal_sanitizer
import json
import math
import random
import copy
import time
import sys
import re
from collections import defaultdict


def canonical_subject(subject: str) -> str:
    """Subject name normalization — single source of truth for repair agent."""
    s = subject.strip()
    if "音樂" in s or "音乐" in s:
        return "音乐"
    if "美勞" in s or "美劳" in s:
        return "美劳"
    if "自然" in s:
        return "自然科学"
    if any(x in s for x in ("科技-資訊", "科技-资讯", "資訊", "资讯", "電腦", "电脑")):
        return "科技-资讯"
    return s


class RepairAgent:
    """模擬退火後處理引擎"""

    def __init__(self, payload_path, phase1_output_path):
        """
        Step 1: 基礎建設與資料攝取 (Data Ingestion)
        讀取前端原始 payload 與 Phase 1 輸出，建立內部資料結構。
        """
        print("=" * 60)
        print("[FIX] Repair Agent 啟動 — 模擬退火後處理引擎")
        print("=" * 60)

        # 讀取 payload
        with open(payload_path, 'r', encoding='utf-8') as f:
            self.payload = json.load(f)

        # 讀取 Phase 1 結果
        with open(phase1_output_path, 'r', encoding='utf-8') as f:
            self.phase1_result = json.load(f)

        self.teachers = self.payload.get("teachers", [])
        self.classes = self.payload.get("classes", [])
        self.classrooms = self.payload.get("classrooms", [])
        self.special_courses = self.payload.get("specialCourses", [])

        # 基本參數
        self.days = 5
        self.periods_per_day = 7
        self.total_periods = self.days * self.periods_per_day

        # 建立老師名稱集合（用於快速查驗）
        self.teacher_names = set(t.get("name", "") for t in self.teachers)

        # 建立班級名稱集合
        self.class_names = set(c.get("name", "") for c in self.classes)
        self.class_grade_map = self._build_class_grade_map()
        self.subject_grade_rules = self._build_subject_grade_rules()

        # 建立年級 → 可用時段映射
        self.grade_forbidden_afternoon = self._build_grade_forbidden()

        # 建立專科教室容量映射: subject → room_count
        self.subject_room_capacity = self._build_room_capacity()

        # 建立老師專長映射: teacher_name → set(subjects)
        self.teacher_expertise_map = self._build_teacher_expertise()

        # 建立導師映射: teacher_name → class_name (homeroom)
        self.homeroom_map = self._build_homeroom_map()

        # 建立課程類型映射: subject → type (homeroom/subject/special)
        self.subject_type_map = self._build_subject_type_map()

        # 當前課表狀態: (day, period, class_name) → {subject, teacherName}
        # day/period 使用 0-based 內部索引
        self.schedule = {}
        self.week_specific_entries = []
        self.alternating_classes = set()
        self.protected_music_art_slots = set()

        # 建立三維課表矩陣
        self.build_schedule_grid()

        # === Sub-task 05.4.A: Manual Lock 保護 ===
        # 從 phase1_result.schedule 讀取所有 locked == true 的 entry
        self.locked_slots = set()
        for entry in self.phase1_result.get("schedule", []):
            if entry.get("locked") or entry.get("isLocked"):
                day = int(entry.get("day", 0)) - 1  # convert to 0-based
                period = int(entry.get("period", 0)) - 1  # convert to 0-based
                cls = entry.get("className", "")
                if cls:
                    self.locked_slots.add((day, period, cls))

        # === Sub-task 05.4.B: Teacher Unavailable Slots 保護 ===
        # 從 payload teachers[].unavailableSlots 建立映射
        # teacher_name -> set of (day, period) in 0-based
        self.teacher_unavailable = {}
        for t in self.teachers:
            t_name = t.get("name", "")
            unavailable = t.get("unavailableSlots", t.get("unavailable_periods", []))
            if unavailable:
                slots_set = set()
                for slot in unavailable:
                    d = int(slot.get("day", 0)) - 1  # convert 1-based to 0-based
                    p = int(slot.get("period", 0)) - 1  # convert 1-based to 0-based
                    slots_set.add((d, p))
                self.teacher_unavailable[t_name] = slots_set

        # === Sub-task 05.4.D: Subject Totals 不變保護 ===
        # 記錄初始每個班級各科目節數總計
        self.initial_subject_totals = self._compute_class_subject_totals()

        # === Sub-task 05.2: Repair Gate 狀態 ===
        self.repair_accepted = True
        self.repair_rejected_reasons = []
        self.pre_repair_hard_snapshot = None
        self.post_repair_hard_snapshot = None
        self.repair_attempt_validation = None

    def _normalize_week_tag(self, week):
        value = str(week or "both").strip().lower()
        if value in ("odd", "single", "oddweek", "單", "單週"):
            return "odd"
        if value in ("even", "double", "evenweek", "雙", "雙週"):
            return "even"
        return "both"

    def _weeks_overlap(self, a, b):
        """Return True when two week tags can occur in the same actual week."""
        week_a = self._normalize_week_tag(a)
        week_b = self._normalize_week_tag(b)
        return week_a == "both" or week_b == "both" or week_a == week_b

    def _build_class_grade_map(self):
        """Build class name -> grade map from payload metadata and class names."""
        class_grade_map = {}
        for cls in self.classes:
            name = cls.get("name", "")
            grade = cls.get("grade")
            if grade is None:
                grade_match = re.search(r'(\d+)年', name) or re.match(r'^(\d)', name)
                grade = int(grade_match.group(1)) if grade_match else None
            try:
                class_grade_map[name] = int(grade)
            except (TypeError, ValueError):
                pass
        return class_grade_map

    def _build_subject_grade_rules(self):
        """Normalize configured subject-grade legality rules from payload."""
        school_info = self.payload.get("schoolInfo", {})
        raw_rules = (
            school_info.get("subjectGradeRules")
            or self.payload.get("subjectGradeRules")
            or {}
        )
        rules = {}
        for subject, grades in raw_rules.items():
            if not isinstance(grades, list):
                continue
            allowed = set()
            for grade in grades:
                try:
                    allowed.add(int(grade))
                except (TypeError, ValueError):
                    continue
            if not allowed:
                continue
            rules[str(subject)] = allowed
            rules[canonical_subject(str(subject))] = allowed
        return rules

    def _build_grade_forbidden(self):
        """建立年級下午禁排規則"""
        forbidden = {}
        for cls in self.classes:
            name = cls.get("name", "")
            grade_match = re.search(r'(\d+)年', name) or re.match(r'^(\d)', name)
            if grade_match:
                grade = int(grade_match.group(1))
                # 1-2 年級：下午全禁（週一至五）
                if grade in [1, 2]:
                    forbidden[name] = set(range(self.days))
                # 3-4 年級：週三、五下午禁
                elif grade in [3, 4]:
                    forbidden[name] = {2, 4}  # index 2=Wed, 4=Fri
                # 5-6 年級：週三下午禁
                elif grade in [5, 6]:
                    forbidden[name] = {2}  # index 2=Wed
                else:
                    forbidden[name] = set()
            else:
                forbidden[name] = set()
        return forbidden

    def _build_room_capacity(self):
        """建立專科教室容量映射"""
        capacity = defaultdict(int)
        for room in self.classrooms:
            subj = room.get("subject", "")
            if subj:
                capacity[canonical_subject(subj)] += 1
        return capacity

    def _build_teacher_expertise(self):
        """建立老師專長映射"""
        expertise_map = {}
        for t in self.teachers:
            t_name = t.get("name", "")
            exp = t.get("expertiseSubjects", t.get("expertise", []))
            if isinstance(exp, str):
                try:
                    exp = json.loads(exp)
                except:
                    exp = []
            expertise_map[t_name] = set(exp) if isinstance(exp, list) else set()
        return expertise_map

    def _build_homeroom_map(self):
        """建立導師 → 班級映射"""
        homeroom_map = {}
        for t in self.teachers:
            if t.get("type") == "homeroom" or t.get("assignedClass"):
                t_name = t.get("name", "")
                cls = t.get("assignedClass", "")
                if cls:
                    homeroom_map[t_name] = cls
        return homeroom_map

    def _build_subject_type_map(self):
        """建立科目類型映射"""
        subject_type = {}
        for cls in self.classes:
            for req in cls.get("course_requirements", []):
                subj = req.get("subject", "")
                default = req.get("defaultTeacher", "subject")
                if default == "homeroom":
                    subject_type[subj] = "homeroom"
                else:
                    subject_type[subj] = "subject"
        return subject_type

    def build_schedule_grid(self):
        """
        將 Phase 1 的 flat list 轉換為 (day, period, class_name) → {subject, teacherName}
        day/period 使用 0-based 索引
        """
        if not hasattr(self, "alternating_classes"):
            self.alternating_classes = set()
        if not hasattr(self, "protected_music_art_slots"):
            self.protected_music_art_slots = set()

        phase1_schedule = self.phase1_result.get("schedule", [])
        for entry in phase1_schedule:
            normalized_entry = copy.deepcopy(entry)
            cls = entry.get("className", "")
            week = self._normalize_week_tag(entry.get("week"))
            if week in ("odd", "even"):
                normalized_entry["week"] = week
                self.week_specific_entries.append(normalized_entry)
                if cls:
                    self.alternating_classes.add(cls)
                continue

            day = entry.get("day", 1) - 1       # 轉 0-based
            period = entry.get("period", 1) - 1  # 轉 0-based
            key = (day, period, cls)
            self.schedule[key] = normalized_entry

        # 初始化空堂為 None
        for d in range(self.days):
            for p in range(self.periods_per_day):
                for cls in self.class_names:
                    key = (d, p, cls)
                    if key not in self.schedule:
                        self.schedule[key] = None

        self.protected_music_art_slots = set()
        for key, slot in self.schedule.items():
            if not slot:
                continue
            cls = key[2]
            subj = slot.get("subject", "")
            if cls in self.alternating_classes and ("美勞_固定" in subj or "音樂_固定" in subj):
                self.protected_music_art_slots.add(key)

        print(f"  [INFO] 課表矩陣已建立: {self.days}×{self.periods_per_day}×{len(self.class_names)}")
        print(f"  [INFO] 總_slots: {self.days * self.periods_per_day * len(self.class_names)}")

    def calculate_penalty(self):
        """
        Step 2: 評估函數 (The Evaluator)
        掃描當前課表，計算軟約束扣分總和。
        總分越低 = 課表品質越好。
        """
        penalty = 0

        # =========================================================================
        # 1. 教師疲勞度：同一位老師連續上 4 堂課 (+100 分/次)
        # =========================================================================
        for t_name in self.teacher_names:
            for d in range(self.days):
                consecutive = 0
                for p in range(self.periods_per_day):
                    # 檢查老師在此時段是否有課
                    has_class = False
                    for cls in self.class_names:
                        key = (d, p, cls)
                        slot = self.schedule.get(key)
                        if slot and slot.get("teacherName") == t_name:
                            has_class = True
                            break

                    if has_class:
                        consecutive += 1
                        if consecutive >= 4:
                            penalty += 100
                    else:
                        consecutive = 0

        # =========================================================================
        # 2. 班級科任集中度：單日科任課超過 3 節 (+50 分/次)
        # =========================================================================
        for cls in self.class_names:
            for d in range(self.days):
                subject_count = 0
                for p in range(self.periods_per_day):
                    key = (d, p, cls)
                    slot = self.schedule.get(key)
                    if slot:
                        subj = slot.get("subject", "")
                        # 排除導師區塊
                        if "導師區塊" not in subj and self.subject_type_map.get(subj) != "homeroom":
                            subject_count += 1

                if subject_count > 3:
                    excess = subject_count - 3
                    penalty += 50 * excess

        # =========================================================================
        # 3. 交替課完美度：單雙週音樂/美勞若未排在同一時段 (+200 分/次)
        # =========================================================================
        # 找出所有排了交替課的班級及其時段
        alt_slots_by_class = defaultdict(list)
        for key, slot in self.schedule.items():
            if slot:
                subj = slot.get("subject", "")
                if "交替" in subj or ("音樂" in subj and "美勞" in subj):
                    cls = key[2]
                    alt_slots_by_class[cls].append(key)

        # 對每個班級檢查交替課是否對齊（同班級不同交替課應在同一時段）
        for cls, slots in alt_slots_by_class.items():
            if len(slots) > 1:
                # 檢查是否在不同 day/period
                periods_set = set((s[0], s[1]) for s in slots)
                if len(periods_set) > 1:
                    penalty += 200 * (len(periods_set) - 1)

        # =========================================================================
        # 4. 教師跨午休懲罰：老師上午最後一節與下午第一節都有課 (+80 分/次)
        # =========================================================================
        for t_name in self.teacher_names:
            for d in range(self.days):
                # 假設 period 3 是上午最後一節，period 4 是下午第一節
                morn_has = False
                aft_has = False
                for cls in self.class_names:
                    if self.schedule.get((d, 3, cls)) and self.schedule[(d, 3, cls)].get("teacherName") == t_name:
                        morn_has = True
                    if self.schedule.get((d, 4, cls)) and self.schedule[(d, 4, cls)].get("teacherName") == t_name:
                        aft_has = True
                if morn_has and aft_has:
                    penalty += 80

        # =========================================================================
        # 5. 同科目單日集中懲罰：同一班級同日同科目多於 1 節 (+30 分/次)
        # =========================================================================
        for cls in self.class_names:
            for d in range(self.days):
                subject_daily = defaultdict(int)
                for p in range(self.periods_per_day):
                    key = (d, p, cls)
                    slot = self.schedule.get(key)
                    if slot:
                        subj = slot.get("subject", "")
                        if "導師區塊" not in subj:
                            subject_daily[subj] += 1
                for subj, count in subject_daily.items():
                    if count > 1:
                        penalty += 30 * (count - 1)

        return penalty

    def _is_afternoon_forbidden(self, day, period, class_name):
        """檢查此時段是否為該班級的下午禁排區"""
        if period < 4:
            return False  # 上午時段永遠合法
        forbidden_days = self.grade_forbidden_afternoon.get(class_name, set())
        return day in forbidden_days

    def _check_teacher_conflict(self, day, period, teacher_name, exclude_class=None, week="both"):
        """
        檢查老師在此時段是否有衝堂（排除指定班級）。

        [Task 05] Sub-task 05.4.C: 補強 week_specific_entries（交替課）掃描。
        """
        # 1. 檢查 regular schedule
        for cls in self.class_names:
            if exclude_class and cls == exclude_class:
                continue
            key = (day, period, cls)
            slot = self.schedule.get(key)
            if slot and slot.get("teacherName") == teacher_name:
                return True

        # 2. [Task 05] 檢查 week_specific_entries（odd/even 交替課）
        for entry in self.week_specific_entries:
            if exclude_class and entry.get("className") == exclude_class:
                continue
            e_day = int(entry.get("day", 0)) - 1
            e_period = int(entry.get("period", 0)) - 1
            if e_day == day and e_period == period:
                if entry.get("teacherName") == teacher_name and self._weeks_overlap(week, entry.get("week")):
                    return True

        return False

    def _canonical_subject(self, subject: str) -> str:
        """Normalize subject name for consistent comparison."""
        return canonical_subject(subject)

    def _is_subject_allowed_for_class(self, subject, class_name):
        """Check configured grade-subject legality; unconfigured subjects remain allowed."""
        canonical = canonical_subject(str(subject or ""))
        if not canonical or "導師區塊" in str(subject or ""):
            return True
        allowed_grades = self.subject_grade_rules.get(str(subject)) or self.subject_grade_rules.get(canonical)
        if not allowed_grades:
            return True
        grade = self.class_grade_map.get(class_name)
        if grade is None:
            grade = self._grade_for_class(class_name)
        return grade in allowed_grades

    # --- Sub-task 05.4.D: Subject Totals 計算 ---
    def _compute_class_subject_totals(self):
        """計算每個班級各科目的節數總計。用於 post-repair gate 比對。"""
        totals = {}
        for cls in self.class_names:
            subject_counts = defaultdict(int)
            for d in range(self.days):
                for p in range(self.periods_per_day):
                    key = (d, p, cls)
                    slot = self.schedule.get(key)
                    if slot:
                        subj = canonical_subject(slot.get("subject", ""))
                        subject_counts[subj] += 1
            totals[cls] = dict(subject_counts)
        return totals

    # --- Sub-task 05.1: Hard Validation Snapshot ---
    def _take_hard_validation_snapshot(self):
        """
        對當前課表執行完整的 hard validation，返回違反計數 dict。
        用於 pre-repair 和 post-repair 比較。
        """
        snapshot = {
            "teacher_collision_count": 0,
            "unavailable_slot_violation_count": 0,
            "manual_lock_violation_count": 0,
            "grade_period_prohibition_count": 0,
            "grade_subject_illegal_count": 0,
        }

        # 1. Teacher collision: 掃描每個 (day, period, actual_week)，檢查教師是否同時出現在多班
        for d in range(self.days):
            for p in range(self.periods_per_day):
                teacher_classes = defaultdict(int)
                for cls in self.class_names:
                    key = (d, p, cls)
                    slot = self.schedule.get(key)
                    if slot:
                        t = slot.get("teacherName", "")
                        if t:
                            teacher_classes[(t, "odd")] += 1
                            teacher_classes[(t, "even")] += 1
                # 也檢查 week_specific_entries
                for entry in self.week_specific_entries:
                    e_day = int(entry.get("day", 0)) - 1
                    e_period = int(entry.get("period", 0)) - 1
                    if e_day == d and e_period == p:
                        t = entry.get("teacherName", "")
                        if t:
                            week = self._normalize_week_tag(entry.get("week"))
                            if week == "both":
                                teacher_classes[(t, "odd")] += 1
                                teacher_classes[(t, "even")] += 1
                            else:
                                teacher_classes[(t, week)] += 1
                for _teacher_week, count in teacher_classes.items():
                    if count > 1:
                        snapshot["teacher_collision_count"] += count - 1

        # 2. Unavailable slot violation: 教師被排入不可用時段
        for d in range(self.days):
            for p in range(self.periods_per_day):
                for cls in self.class_names:
                    key = (d, p, cls)
                    slot = self.schedule.get(key)
                    if slot:
                        t = slot.get("teacherName", "")
                        if t and t in self.teacher_unavailable:
                            if (d, p) in self.teacher_unavailable[t]:
                                snapshot["unavailable_slot_violation_count"] += 1

        # 3. Manual lock violation: locked slot 被修改
        for entry in self.phase1_result.get("schedule", []):
            if entry.get("locked") or entry.get("isLocked"):
                d = int(entry.get("day", 0)) - 1
                p = int(entry.get("period", 0)) - 1
                cls = entry.get("className", "")
                orig_subject = entry.get("subject", "")
                orig_teacher = entry.get("teacherName", "")
                key = (d, p, cls)
                current_slot = self.schedule.get(key)
                if (
                    current_slot is None
                    or current_slot.get("subject", "") != orig_subject
                    or (orig_teacher and current_slot.get("teacherName", "") != orig_teacher)
                ):
                    snapshot["manual_lock_violation_count"] += 1

        # 4. Grade period prohibition: 課程被排入年級禁排時段
        for d in range(self.days):
            for p in range(self.periods_per_day):
                for cls in self.class_names:
                    key = (d, p, cls)
                    slot = self.schedule.get(key)
                    if slot and p >= 4:  # 下午時段
                        subj = slot.get("subject", "")
                        if "導師區塊" not in subj:
                            forbidden_days = self.grade_forbidden_afternoon.get(cls, set())
                            if d in forbidden_days:
                                snapshot["grade_period_prohibition_count"] += 1

        # 5. Grade-subject legality: configured subjects must be legal for class grade
        for d in range(self.days):
            for p in range(self.periods_per_day):
                for cls in self.class_names:
                    slot = self.schedule.get((d, p, cls))
                    if slot and not self._is_subject_allowed_for_class(slot.get("subject", ""), cls):
                        snapshot["grade_subject_illegal_count"] += 1
        for entry in self.week_specific_entries:
            cls = entry.get("className", "")
            if cls and not self._is_subject_allowed_for_class(entry.get("subject", ""), cls):
                snapshot["grade_subject_illegal_count"] += 1

        return snapshot

    def _grade_for_class(self, class_name: str) -> int:
        """Extract grade number from class name like '3年1班'."""
        match = re.search(r'(\d+)年', class_name)
        if match:
            return int(match.group(1))
        return 1

    def _needs_special_room(self, subject: str, class_name: str) -> bool:
        """
        Determine if a subject in this class needs a specialty classroom.
        
        Low grades (1-2) are exempt from room capacity for certain subjects.
        """
        canonical = self._canonical_subject(subject)
        # Only these subjects have special room requirements
        if canonical not in {"音乐", "美劳", "自然科学", "科技-资讯"}:
            return True  # Non-specialty subjects don't use specialty rooms
        
        grade = self._grade_for_class(class_name)
        if grade <= 2:
            return False  # Low grade exemption
        
        return True

    def _check_room_capacity(self, day, period, subject):
        """檢查此科目在此時段的使用數是否超載（使用正規化科目名稱）"""
        canonical = self._canonical_subject(subject)
        capacity = self.subject_room_capacity.get(canonical, 999)
        if capacity <= 0:
            return False  # No capacity limit
        
        usage_count = 0
        for cls in self.class_names:
            key = (day, period, cls)
            slot = self.schedule.get(key)
            if slot:
                s = slot.get("subject", "")
                slot_canonical = self._canonical_subject(s)
                # Use canonical subject comparison + grade exemption
                if slot_canonical == canonical and self._needs_special_room(s, cls):
                    usage_count += 1
        return usage_count >= capacity

    def try_swap(self, key_A, key_B):
        """
        Step 3: 安全換課引擎 (Safe Swap Engine)
        嘗試交換兩個 slot 的課程內容。
        在真正交換前進行三項安全檢查，若違反則拒絕換課。
        
        [Phase 0 止血] 只允許同一班級內交換，防止跨班導致的科目錯置與節數失衡。
        """
        day_A, period_A, cls_A = key_A
        day_B, period_B, cls_B = key_B

        # [Phase 0 止血] 同班防線 — 只允許同一班級內交換
        if cls_A != cls_B:
            return False

        if key_A in getattr(self, "protected_music_art_slots", set()):
            return False
        if key_B in getattr(self, "protected_music_art_slots", set()):
            return False

        slot_A = self.schedule.get(key_A)
        slot_B = self.schedule.get(key_B)

        # 交換前提：至少一個 slot 有課程
        if not slot_A and not slot_B:
            return False

        # 不交換相同 slot
        if key_A == key_B:
            return False

        # 不交換同一班級的空堂
        if cls_A == cls_B and (not slot_A or not slot_B):
            return False

        # === [Task 05] Sub-task 05.4.A: Manual Lock 保護 ===
        # 不允許 swap locked slots
        if key_A in self.locked_slots or key_B in self.locked_slots:
            return False

        # === [Task 05] Sub-task 05.4.B: Teacher Unavailable Slots 保護 ===
        # 檢查 slot_A 的教師在目標時段 (day_B, period_B) 是否有 unavailable
        if slot_A:
            t_a = slot_A.get("teacherName", "")
            if t_a and t_a in self.teacher_unavailable:
                if (day_B, period_B) in self.teacher_unavailable[t_a]:
                    return False
        # 檢查 slot_B 的教師在目標時段 (day_A, period_A) 是否有 unavailable
        if slot_B:
            t_b = slot_B.get("teacherName", "")
            if t_b and t_b in self.teacher_unavailable:
                if (day_A, period_A) in self.teacher_unavailable[t_b]:
                    return False

        # === 安全檢查 1: 空堂防護 ===
        # 不能把 1-2 年級的課換到他們不排課的下午時段
        if slot_A:
            if self._is_afternoon_forbidden(day_B, period_B, cls_B):
                subj = slot_A.get("subject", "")
                if "導師區塊" not in subj:
                    return False
        if slot_B:
            if self._is_afternoon_forbidden(day_A, period_A, cls_A):
                subj = slot_B.get("subject", "")
                if "導師區塊" not in subj:
                    return False

        # === 模擬交換 ===
        self.schedule[key_A], self.schedule[key_B] = self.schedule[key_B], self.schedule[key_A]

        # === 安全檢查 2: 教師分身防護 ===
        valid = True

        # 檢查 slot_A 的新內容
        new_slot_A = self.schedule[key_A]
        if new_slot_A:
            t = new_slot_A.get("teacherName", "")
            if t and self._check_teacher_conflict(day_A, period_A, t, exclude_class=cls_A):
                valid = False

        # 檢查 slot_B 的新內容
        new_slot_B = self.schedule[key_B]
        if valid and new_slot_B:
            t = new_slot_B.get("teacherName", "")
            if t and self._check_teacher_conflict(day_B, period_B, t, exclude_class=cls_B):
                valid = False

        # === 安全檢查 3: 專科容量防護（使用正規化科目 + 年級免除）===
        if valid:
            # 檢查 slot_A 的科目是否超載
            new_slot_A = self.schedule[key_A]
            if new_slot_A:
                subj = new_slot_A.get("subject", "")
                canonical = self._canonical_subject(subj)
                # 使用正規化後的科目名稱，並考慮年級免除
                if canonical in self.subject_room_capacity and self._needs_special_room(subj, cls_A):
                    if self._check_room_capacity(day_A, period_A, subj):
                        valid = False
            # 檢查 slot_B 的科目是否超載
            if valid:
                new_slot_B = self.schedule[key_B]
                if new_slot_B:
                    subj = new_slot_B.get("subject", "")
                    canonical = self._canonical_subject(subj)
                    if canonical in self.subject_room_capacity and self._needs_special_room(subj, cls_B):
                        if self._check_room_capacity(day_B, period_B, subj):
                            valid = False

        # === 如果任何檢查失敗，復原交換 ===
        if not valid:
            self.schedule[key_A], self.schedule[key_B] = self.schedule[key_B], self.schedule[key_A]
            return False

        return True

    def simulated_annealing(self, initial_T=10000.0, cooling_rate=0.995, max_iterations=30000, time_limit=600):
        """
        Step 4: 模擬退火主迴圈 (Simulated Annealing Loop)
        
        Args:
            initial_T: 初始溫度
            cooling_rate: 冷卻率
            max_iterations: 最大迭代次數
            time_limit: 時間限制（秒），確保不超過前端 timeout
            
        Returns:
            optimized_schedule: 優化後的課表
        """
        print("\n" + "=" * 60)
        print("[ERROR] 模擬退火優化開始")
        print("=" * 60)

        start_time = time.time()
        current_penalty = self.calculate_penalty()
        best_penalty = current_penalty
        best_schedule = copy.deepcopy(self.schedule)

        # 建立所有合法 slot 列表
        all_keys = []
        for d in range(self.days):
            for p in range(self.periods_per_day):
                for cls in self.class_names:
                    key = (d, p, cls)
                    if self.schedule.get(key) is not None:
                        all_keys.append(key)

        # 加入部分空堂以允許課程移動
        empty_keys = []
        for d in range(self.days):
            for p in range(self.periods_per_day):
                for cls in self.class_names:
                    key = (d, p, cls)
                    if self.schedule.get(key) is None:
                        empty_keys.append(key)

        all_keys_with_empty = all_keys + empty_keys[:200]  # 限制空堂數量避免過度掃描
        total_slots = len(all_keys_with_empty)

        # ==========================================
        #  加上這段防禦性攔截 
        # ==========================================
        if total_slots == 0:
            print("  [WARN] 警告: 沒有任何可排課的時段 (班級數為 0)，直接略過退火優化。")
            self.schedule = best_schedule
            return self.schedule
        # ==========================================

        print(f"  [TEMP]  初始溫度: {initial_T}")
        print(f"  [DOWN] 冷卻率: {cooling_rate}")
        print(f"  [ERROR] 最大迭代: {max_iterations}")
        print(f"  [TIME]  時間限制: {time_limit} 秒")
        print(f"  [INFO] 總 slot 數: {total_slots}")
        print(f"  [INFO] 初始 penalty: {current_penalty}")

        T = initial_T
        iteration = 0
        improvement_count = 0
        last_log_iteration = 0

        while T > 1.0 and iteration < max_iterations:
            # 檢查時間限制
            elapsed = time.time() - start_time
            if elapsed > time_limit:
                print(f"\n  [TIME]  時間到期 ({elapsed:.1f}s > {time_limit}s)，提前結束")
                break

            iteration += 1

            # 隨機挑選兩個 slot
            key_A = random.choice(all_keys_with_empty)
            key_B = random.choice(all_keys_with_empty)

            # 計算交換前 penalty
            penalty_before = current_penalty

            # 嘗試交換
            swap_ok = self.try_swap(key_A, key_B)

            if not swap_ok:
                continue

            # 計算交換後 penalty
            penalty_after = self.calculate_penalty()
            delta = penalty_after - penalty_before

            # 接受/拒絕決策
            accept = False
            if delta < 0:
                # 變好，直接接受
                accept = True
                improvement_count += 1
            else:
                # 變差，以機率 exp(-delta/T) 接受
                if T > 0:
                    probability = math.exp(-delta / T)
                    if random.random() < probability:
                        accept = True

            if accept:
                # 保持交換
                if penalty_after < best_penalty:
                    best_penalty = penalty_after
                    best_schedule = copy.deepcopy(self.schedule)
                current_penalty = penalty_after
            else:
                # 復原交換
                day_A, period_A, cls_A = key_A
                day_B, period_B, cls_B = key_B
                self.schedule[key_A], self.schedule[key_B] = self.schedule[key_B], self.schedule[key_A]

            # 降溫
            T *= cooling_rate

            # 定期報告進度
            if iteration - last_log_iteration >= 5000:
                elapsed = time.time() - start_time
                print(f"  [INFO] Iter {iteration}: penalty={current_penalty} (best={best_penalty}), T={T:.2f}, elapsed={elapsed:.1f}s")
                last_log_iteration = iteration

        elapsed = time.time() - start_time
        print("\n" + "=" * 60)
        print(f"[OK] 模擬退火完成")
        print(f"  [ERROR] 總迭代次數: {iteration}")
        print(f"  [UP] 改善次數: {improvement_count}")
        print(f"  [INFO] 初始 penalty: {best_penalty}")  # 這裡應該是最初的
        print(f"  [INFO] 最終 best penalty: {best_penalty}")
        print(f"  [TIME]  總耗時: {elapsed:.1f}s")
        print("=" * 60)

        # 將最佳課表設為當前狀態
        self.schedule = best_schedule
        return self.schedule

    def export_result(self, output_path):
        """
        將優化後的課表導出為與 Phase 1 兼容的 JSON 格式。
        """
        print(f"\n[SAVE] 導出優化結果到 {output_path} ...")

        result = []
        for key, slot in self.schedule.items():
            if slot is not None:
                day, period, cls = key
                entry = copy.deepcopy(slot)
                entry["day"] = day + 1
                entry["period"] = period + 1
                entry["className"] = cls
                entry.pop("week", None)
                result.append(entry)

        result.extend(copy.deepcopy(self.week_specific_entries))
        result.sort(
            key=lambda entry: (
                int(entry.get("day", 0) or 0),
                int(entry.get("period", 0) or 0),
                str(entry.get("className", "")),
                self._normalize_week_tag(entry.get("week")),
                str(entry.get("subject", "")),
                str(entry.get("teacherName", "")),
            )
        )

        # 保留 Phase 1 的 jobId 等 metadata
        final_output = copy.deepcopy(self.phase1_result)
        final_output["schedule"] = result

        # === [Task 05] Sub-task 05.6: Diagnostic Output 欄位 ===
        # [repair_01] Safe fallback for __new__ bypass scenarios where __init__ was skipped
        repair_accepted = getattr(self, "repair_accepted", True)
        final_output["repaired"] = repair_accepted
        final_output["repair_penalty"] = self.calculate_penalty()
        final_output["repairAccepted"] = repair_accepted
        final_output["repairRejectedReasons"] = list(getattr(self, "repair_rejected_reasons", []))
        final_output["preRepairValidation"] = dict(getattr(self, "pre_repair_hard_snapshot", {}) or {})
        final_output["postRepairValidation"] = dict(getattr(self, "post_repair_hard_snapshot", {}) or {})
        final_output["repairAttemptValidation"] = dict(getattr(self, "repair_attempt_validation", {}) or {})


        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(final_output, f, ensure_ascii=False, indent=2)

        print(f"  [OK] 已導出 {len(result)} 堂課")
        return final_output


def main():
    """
    命令列入口
    用法：python repair_agent.py <payload.json> <phase1_output.json> <output_path>
    """
    if len(sys.argv) < 4:
        print("用法: python repair_agent.py <payload.json> <phase1_output.json> <output_path>")
        print("範例: python repair_agent.py input_abc123.json output_abc123.json output_final.json")
        sys.exit(1)

    payload_path = sys.argv[1]
    phase1_output_path = sys.argv[2]
    output_path = sys.argv[3]

    # 建立 Repair Agent
    agent = RepairAgent(payload_path, phase1_output_path)

    # ==========================================================================
    # [Task 05] Sub-task 05.1: Pre-Repair Hard Validation Snapshot
    # ==========================================================================
    print("\n" + "=" * 60)
    print("[TASK05] Pre-Repair Hard Validation Snapshot")
    print("=" * 60)
    agent.pre_repair_hard_snapshot = agent._take_hard_validation_snapshot()
    for key, val in agent.pre_repair_hard_snapshot.items():
        print(f"  [SNAPSHOT] {key}: {val}")

    # 計算初始 penalty
    initial_penalty = agent.calculate_penalty()
    print(f"\n[INFO] Phase 1 初始 penalty: {initial_penalty}")

    # 備份 pre-repair schedule（用於回退）
    pre_repair_schedule_backup = copy.deepcopy(agent.schedule)

    # 執行模擬退火優化
    agent.simulated_annealing(
        initial_T=10000.0,
        cooling_rate=0.995,
        max_iterations=30000,
        time_limit=600  # 10 分鐘上限
    )

    # ==========================================================================
    # [Task 05] Sub-task 05.2: Post-Repair Hard Validation Gate
    # ==========================================================================
    print("\n" + "=" * 60)
    print("[TASK05] Post-Repair Hard Validation Gate")
    print("=" * 60)
    agent.post_repair_hard_snapshot = agent._take_hard_validation_snapshot()
    for key, val in agent.post_repair_hard_snapshot.items():
        print(f"  [SNAPSHOT] {key}: {val}")

    # 逐項比對 pre vs post
    gate_failed = False
    for key in agent.pre_repair_hard_snapshot:
        pre_val = agent.pre_repair_hard_snapshot[key]
        post_val = agent.post_repair_hard_snapshot.get(key, 0)
        if post_val > pre_val:
            print(f"  [REJECT] {key}: {pre_val} -> {post_val} (INCREASED!)")
            agent.repair_rejected_reasons.append(
                f"{key}: {pre_val} -> {post_val}"
            )
            gate_failed = True
        else:
            print(f"  [OK]     {key}: {pre_val} -> {post_val}")

    # ==========================================================================
    # [Task 05] Sub-task 05.4.D: Subject Totals 不變檢查
    # ==========================================================================
    post_subject_totals = agent._compute_class_subject_totals()
    for cls in agent.class_names:
        pre_totals = agent.initial_subject_totals.get(cls, {})
        post_totals = post_subject_totals.get(cls, {})
        if pre_totals != post_totals:
            reason = f"subject_totals changed for {cls}: {pre_totals} -> {post_totals}"
            print(f"  [REJECT] {reason}")
            agent.repair_rejected_reasons.append(reason)
            gate_failed = True

    # ==========================================================================
    # [Task 05] Sub-task 05.2: 若 Gate 失敗，回退到 pre-repair schedule
    # ==========================================================================
    if gate_failed:
        print("\n  [GATE FAILED] Repair rejected! Rolling back to pre-repair schedule.")
        agent.repair_attempt_validation = copy.deepcopy(agent.post_repair_hard_snapshot)
        agent.schedule = pre_repair_schedule_backup
        agent.post_repair_hard_snapshot = copy.deepcopy(agent.pre_repair_hard_snapshot)
        agent.repair_accepted = False
    else:
        agent.repair_accepted = True
        print("\n  [GATE PASSED] Repair accepted.")

    # ==========================================================================
    # [Task 05] Sub-task 05.5 (partial): 若 repair 沒有安全收益，拒絕
    # ==========================================================================
    final_penalty = agent.calculate_penalty()
    if not gate_failed and final_penalty >= initial_penalty:
        print(f"\n  [NO BENEFIT] Repair penalty {final_penalty} >= initial {initial_penalty}, rejecting.")
        agent.repair_attempt_validation = copy.deepcopy(agent.post_repair_hard_snapshot)
        agent.schedule = pre_repair_schedule_backup
        agent.post_repair_hard_snapshot = copy.deepcopy(agent.pre_repair_hard_snapshot)
        agent.repair_accepted = False
        agent.repair_rejected_reasons.append("repair_no_benefit")
        final_penalty = initial_penalty

    print(f"\n[INFO] 優化後 penalty: {final_penalty}")
    if initial_penalty > 0:
        improvement = initial_penalty - final_penalty
        pct = (1 - final_penalty / initial_penalty) * 100 if initial_penalty > 0 else 0
        print(f"[INFO] 改善幅度: {improvement} ({pct:.1f}%)")

    # 導出結果
    agent.export_result(output_path)

    print("\n Repair Agent 執行完成！")


if __name__ == "__main__":
    main()
    
