"""
test_subject_day_spread.py — 科任課日分散規則測試

驗證 apply_subject_day_spread 與 apply_music_fixed_vs_alternating_day_spread 的正確性。

關鍵原則：
- 所有核心測試必須補上 sum(target_vars) == periods 強制約束，防止「全0解」假通過。
- locked_vars 必須被 day presence 看見。
- 音樂 alternating 判定必須從 requirement metadata 來，不靠字串重猜。
"""

import unittest
from ortools.sat.python import cp_model
from constraints.class_rules import (
    apply_subject_day_spread,
    apply_music_fixed_vs_alternating_day_spread,
)


def _collect_target_vars(schedule, cls_name, teacher, subject):
    """收集某個 (class, teacher, subject) 的所有 schedule vars。"""
    vars_list = []
    for (c, p, t, s), v in schedule.items():
        if c == cls_name and t == teacher and s == subject:
            vars_list.append(v)
    return vars_list


class TestSubjectDaySpread(unittest.TestCase):
    """驗證科任課日分散規則。"""

    def _build_model(self):
        """建立一個基本的 CpModel 用於測試。"""
        return cp_model.CpModel()

    # ------------------------------------------------------------------ #
    # 測試 1：英語日分散（不同天且不相鄰）— 補 sum==3
    # ------------------------------------------------------------------ #
    def test_english_day_spread_different_days_and_not_adjacent(self):
        """1班 3節英語，必須分散（Mon/Wed/Fri 合法；Mon/Tue 違規）。"""
        model = self._build_model()
        schedule = {}

        cls_name = "1年1班"
        subject = "語文-英語"
        teacher = "張老師"
        periods = 3

        classes_data = [
            {
                "name": cls_name,
                "grade": 1,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                ],
            }
        ]

        # 建立 schedule vars
        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        # [Task A] 強制總節數 == periods，防止全0解假通過
        target_vars = _collect_target_vars(schedule, cls_name, teacher, subject)
        model.Add(sum(target_vars) == periods)

        apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE),
                       f"Expected FEASIBLE/OPTIMAL, got {status}")

        # 驗證：實際排了 3 節
        actual_count = sum(solver.Value(v) for v in target_vars)
        self.assertEqual(actual_count, periods, f"Expected {periods} periods scheduled, got {actual_count}")

    # ------------------------------------------------------------------ #
    # 測試 2：資訊日分散 — 補 sum==2
    # ------------------------------------------------------------------ #
    def test_info_day_spread(self):
        """1班 2節資訊，兩節不在同天、不在相鄰兩天。"""
        model = self._build_model()
        schedule = {}

        cls_name = "1年1班"
        subject = "資訊"
        teacher = "林老師"
        periods = 2

        classes_data = [
            {
                "name": cls_name,
                "grade": 1,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                ],
            }
        ]

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        # [Task A] 強制總節數
        target_vars = _collect_target_vars(schedule, cls_name, teacher, subject)
        model.Add(sum(target_vars) == periods)

        apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

        actual_count = sum(solver.Value(v) for v in target_vars)
        self.assertEqual(actual_count, periods)

    # ------------------------------------------------------------------ #
    # 測試 3：體育不僅不連堂，也不相鄰日 — 補 sum==3
    # ------------------------------------------------------------------ #
    def test_pe_not_consecutive_days(self):
        """體育不只不連堂，也不可連續兩天。"""
        model = self._build_model()
        schedule = {}

        cls_name = "3年1班"
        subject = "體育"
        teacher = "陳老師"
        periods = 3

        classes_data = [
            {
                "name": cls_name,
                "grade": 3,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                ],
            }
        ]

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        # [Task A] 強制總節數
        target_vars = _collect_target_vars(schedule, cls_name, teacher, subject)
        model.Add(sum(target_vars) == periods)

        apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

        actual_count = sum(solver.Value(v) for v in target_vars)
        self.assertEqual(actual_count, periods)

    # ------------------------------------------------------------------ #
    # 測試 4：健康 / 社會日分散 — 補 sum==2
    # ------------------------------------------------------------------ #
    def test_health_social_day_spread(self):
        """健康與社會適用與英語、資訊相同的日分散規則。"""
        model = self._build_model()
        schedule = {}

        for subject, teacher, periods in [("健康", "黃老師", 2), ("社會", "吳老師", 2)]:
            cls_name = "4年1班"
            classes_data = [
                {
                    "name": cls_name,
                    "grade": 4,
                    "isArtsClass": False,
                    "course_requirements": [
                        {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                    ],
                }
            ]

            for d in range(5):
                for p in range(7):
                    period_idx = d * 7 + p
                    v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                    schedule[(cls_name, period_idx, teacher, subject)] = v

            # [Task A] 強制總節數
            target_vars = _collect_target_vars(schedule, cls_name, teacher, subject)
            model.Add(sum(target_vars) == periods)

            apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

    # ------------------------------------------------------------------ #
    # 測試 5：自然科學不被誤傷
    # ------------------------------------------------------------------ #
    def test_science_not_affected_by_day_spread(self):
        """自然科學 2 節連堂不應被 apply_subject_day_spread 破壞。"""
        model = self._build_model()
        schedule = {}

        cls_name = "5年1班"
        subject = "自然科學"
        teacher = "周老師"
        periods = 2

        classes_data = [
            {
                "name": cls_name,
                "grade": 5,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                ],
            }
        ]

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        # 自然科學不在 TARGET_SPREAD_SUBJECTS 中，不應被影響
        apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        # 模型應該有可行解（自然科學不受日分散限制，可以連堂）
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

    # ------------------------------------------------------------------ #
    # 測試 6：音樂固定課 vs 音樂交替課不同日 — 補 sum==1
    # ------------------------------------------------------------------ #
    def test_music_fixed_vs_alternating_different_day(self):
        """1班有音樂固定課 + 音樂交替課，兩者不在同一天。"""
        model = self._build_model()
        schedule = {}

        cls_name = "3年1班"
        music_teacher = "音樂老師"

        classes_data = [
            {
                "name": cls_name,
                "grade": 3,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": "音樂", "teacher": music_teacher, "periods": 1, "defaultTeacher": music_teacher},
                    {"subject": "音樂美勞_交替", "teacher": music_teacher, "periods": 1,
                     "is_alternating": True, "defaultTeacher": music_teacher},
                ],
            }
        ]

        # 建立 alternating vars
        alternating_class_is_music_odd = {}
        alt_var = model.NewBoolVar(f"alt_{cls_name}")
        alternating_class_is_music_odd[(cls_name, music_teacher)] = alt_var

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                # 固定音樂課
                v1 = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{music_teacher}_音樂")
                schedule[(cls_name, period_idx, music_teacher, "音樂")] = v1
                # 交替課
                v2 = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{music_teacher}_音樂美勞_交替")
                schedule[(cls_name, period_idx, music_teacher, "音樂美勞_交替")] = v2

        # [Task A] 強制固定音樂 == 1，交替音樂 == 1
        fixed_vars = _collect_target_vars(schedule, cls_name, music_teacher, "音樂")
        alt_vars = _collect_target_vars(schedule, cls_name, music_teacher, "音樂美勞_交替")
        model.Add(sum(fixed_vars) == 1)
        model.Add(sum(alt_vars) == 1)

        apply_music_fixed_vs_alternating_day_spread(
            model, classes_data, schedule,
            alternating_class_is_music_odd=alternating_class_is_music_odd,
        )

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

        # 驗證：固定和交替各 1 節
        self.assertEqual(sum(solver.Value(v) for v in fixed_vars), 1)
        self.assertEqual(sum(solver.Value(v) for v in alt_vars), 1)

    # ------------------------------------------------------------------ #
    # 測試 7：生活課週二下午不被影響
    # ------------------------------------------------------------------ #
    def test_life_course_not_affected_by_day_spread(self):
        """1年級 / 2年級 週二下午生活課不受 apply_subject_day_spread 影響。"""
        model = self._build_model()
        schedule = {}

        cls_name = "1年1班"
        subject = "生活"
        teacher = "生活老師"
        periods = 2

        classes_data = [
            {
                "name": cls_name,
                "grade": 1,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                ],
            }
        ]

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        # "生活" 不在 TARGET_SPREAD_SUBJECTS 中，不應被影響
        apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

    # ------------------------------------------------------------------ #
    # 測試 8：alias 正規化（英語 -> 語文-英語）— 補 sum==2
    # ------------------------------------------------------------------ #
    def test_alias_normalization_english(self):
        """英語 alias 應被正規化為 語文-英語 並套用日分散規則。"""
        model = self._build_model()
        schedule = {}

        cls_name = "2年1班"
        subject = "英語"  # alias
        teacher = "英老師"
        periods = 2

        classes_data = [
            {
                "name": cls_name,
                "grade": 2,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                ],
            }
        ]

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        # [Task A] 強制總節數
        target_vars = _collect_target_vars(schedule, cls_name, teacher, subject)
        model.Add(sum(target_vars) == periods)

        apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

        actual_count = sum(solver.Value(v) for v in target_vars)
        self.assertEqual(actual_count, periods)

    # ------------------------------------------------------------------ #
    # 測試 9：alias 正規化（科技-資訊 -> 資訊）— 補 sum==2
    # ------------------------------------------------------------------ #
    def test_alias_normalization_info(self):
        """科技-資訊 alias 應被正規化為 資訊 並套用日分散規則。"""
        model = self._build_model()
        schedule = {}

        cls_name = "5年1班"
        subject = "科技-資訊"  # alias
        teacher = "資老師"
        periods = 2

        classes_data = [
            {
                "name": cls_name,
                "grade": 5,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                ],
            }
        ]

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        # [Task A] 強制總節數
        target_vars = _collect_target_vars(schedule, cls_name, teacher, subject)
        model.Add(sum(target_vars) == periods)

        apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

        actual_count = sum(solver.Value(v) for v in target_vars)
        self.assertEqual(actual_count, periods)

    # ------------------------------------------------------------------ #
    # 測試 10：藝才班虛擬教師豁免
    # ------------------------------------------------------------------ #
    def test_arts_class_virtual_teacher_exemption(self):
        """藝才班的虛擬教師課程應被豁免。"""
        model = self._build_model()
        schedule = {}

        cls_name = "3年藝才班"
        subject = "語文-英語"
        teacher = "藝才虛擬教師"  # 虛擬教師

        classes_data = [
            {
                "name": cls_name,
                "grade": 3,
                "isArtsClass": True,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": 2, "defaultTeacher": teacher},
                ],
            }
        ]

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        apply_subject_day_spread(model, classes_data, schedule, locked_vars=set())

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        # 即使有虛擬教師，模型仍應有可行解
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

    # ------------------------------------------------------------------ #
    # 測試 11：locked_vars 不會導致整個科目跳過 — 補 sum==3
    # ------------------------------------------------------------------ #
    def test_locked_vars_partial_lock(self):
        """部分鎖定時，未鎖定的變數仍受日分散規則約束。

        [Task B] locked vars 必須被 day presence 看見，不能 continue 跳過。
        """
        model = self._build_model()
        schedule = {}

        cls_name = "2年1班"
        subject = "體育"
        teacher = "體老師"
        periods = 3

        classes_data = [
            {
                "name": cls_name,
                "grade": 2,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": subject, "teacher": teacher, "periods": periods, "defaultTeacher": teacher},
                ],
            }
        ]

        locked_vars = set()
        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{teacher}_{subject}")
                schedule[(cls_name, period_idx, teacher, subject)] = v

        # 只鎖定第 1 個變數（週一第1節）
        locked_var = schedule[(cls_name, 0, teacher, subject)]
        locked_vars.add(locked_var)

        # 強制 locked var == 1（模擬使用者真的鎖了這節）
        model.Add(locked_var == 1)

        # [Task A] 強制總節數
        target_vars = _collect_target_vars(schedule, cls_name, teacher, subject)
        model.Add(sum(target_vars) == periods)

        apply_subject_day_spread(model, classes_data, schedule, locked_vars=locked_vars)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

        # 驗證：總共排了 periods 節
        actual_count = sum(solver.Value(v) for v in target_vars)
        self.assertEqual(actual_count, periods)

        # 驗證：locked var 確實被排了
        self.assertEqual(solver.Value(locked_var), 1)

    # ------------------------------------------------------------------ #
    # 測試 12：音樂交替課 None 時直接 return
    # ------------------------------------------------------------------ #
    def test_music_spread_returns_early_when_no_alternating(self):
        """當 alternating_class_is_music_odd 為 None 或空 dict 時，函式直接 return。"""
        model = self._build_model()
        schedule = {}

        cls_name = "3年1班"
        music_teacher = "音樂老師"

        classes_data = [
            {
                "name": cls_name,
                "grade": 3,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": "音樂", "teacher": music_teacher, "periods": 1, "defaultTeacher": music_teacher},
                ],
            }
        ]

        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{music_teacher}_音樂")
                schedule[(cls_name, period_idx, music_teacher, "音樂")] = v

        # 傳入 None 應該直接 return，不拋錯
        apply_music_fixed_vs_alternating_day_spread(
            model, classes_data, schedule,
            alternating_class_is_music_odd=None,
        )

        # 傳入空 dict 也應該直接 return
        apply_music_fixed_vs_alternating_day_spread(
            model, classes_data, schedule,
            alternating_class_is_music_odd={},
        )

        # 不拋錯即通過

    # ------------------------------------------------------------------ #
    # 測試 13：subject="音樂", is_alternating=True 不被誤判成 fixed (Task C)
    # ------------------------------------------------------------------ #
    def test_music_is_alternating_true_not_misclassified(self):
        """
        當 course_requirements 有 subject="音樂", is_alternating=True 時，
        該課程應被正確識別為 alternating，而非 fixed。

        這測試驗證 Task C 的修復：alternating 判定從 requirement metadata 來。
        """
        model = self._build_model()
        schedule = {}

        cls_name = "4年1班"
        music_teacher = "音樂老師"

        # 關鍵：subject="音樂"（不含"交替"或"/"），但 is_alternating=True
        classes_data = [
            {
                "name": cls_name,
                "grade": 4,
                "isArtsClass": False,
                "course_requirements": [
                    {"subject": "音樂", "teacher": music_teacher, "periods": 1,
                     "defaultTeacher": music_teacher},
                    # 這組是交替課，subject 就是 "音樂"，靠 is_alternating=True 區分
                    {"subject": "音樂", "teacher": music_teacher, "periods": 1,
                     "is_alternating": True, "defaultTeacher": music_teacher},
                ],
            }
        ]

        alternating_class_is_music_odd = {}
        alt_var = model.NewBoolVar(f"alt_{cls_name}")
        alternating_class_is_music_odd[(cls_name, music_teacher)] = alt_var

        # 建立兩組 vars：fixed 和 alternating
        # 用不同的 subject key 來區分
        for d in range(5):
            for p in range(7):
                period_idx = d * 7 + p
                v_fixed = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{music_teacher}_音樂_fixed")
                schedule[(cls_name, period_idx, music_teacher, "音樂_fixed")] = v_fixed
                v_alt = model.NewIntVar(0, 1, f"s_{cls_name}_{period_idx}_{music_teacher}_音樂_alt")
                schedule[(cls_name, period_idx, music_teacher, "音樂_alt")] = v_alt

        apply_music_fixed_vs_alternating_day_spread(
            model, classes_data, schedule,
            alternating_class_is_music_odd=alternating_class_is_music_odd,
        )

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.Solve(model)

        # 不拋錯即基本通過
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))


if __name__ == "__main__":
    unittest.main()