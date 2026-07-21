"""
tests/test_art_consecutive.py

回歸測試：美勞/交替連堂合法配對邊界
確保 get_valid_consecutive_pairs 在以下三個 case 行為正確：
  1. (3,4) 跨午休 → 不在合法列表中（被拒絕）
  2. (4,5) 下午連堂 → 在合法列表中（被允許）
  3. 非午休邊界的相鄰對 (0,1),(1,2),(2,3) → 全部合法
"""

import pytest
import sys
import os

# 確保可以 import 專案模組
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from constraints.special_rules import get_valid_consecutive_pairs
from config import DAYS, PERIODS_PER_DAY


class TestGetValidConsecutivePairs:
    """測試 helper：每日合法相鄰配對列表"""

    def test_lunch_boundary_pair_is_rejected(self):
        """Case 1：(3,4) 跨午休邊界，必須不在合法列表中"""
        pairs = get_valid_consecutive_pairs(base=0)
        assert (3, 4) not in pairs, (
            f"BUG：(3,4) 是跨午休配對，不應出現在合法列表。實際列表：{pairs}"
        )

    def test_afternoon_consecutive_is_allowed(self):
        """Case 2：(4,5) 是下午合法連堂，必須在合法列表中"""
        pairs = get_valid_consecutive_pairs(base=0)
        assert (4, 5) in pairs, (
            f"BUG：(4,5) 是合法下午連堂，應出現在合法列表。實際列表：{pairs}"
        )

    def test_morning_consecutives_all_allowed(self):
        """Case 3：上午 (0,1),(1,2),(2,3) 全部合法"""
        pairs = get_valid_consecutive_pairs(base=0)
        for pair in [(0, 1), (1, 2), (2, 3)]:
            assert pair in pairs, (
                f"BUG：{pair} 是合法上午連堂，應出現在合法列表。實際列表：{pairs}"
            )

    def test_afternoon_second_pair_allowed(self):
        """(5,6) 是合法下午連堂"""
        pairs = get_valid_consecutive_pairs(base=0)
        assert (5, 6) in pairs, (
            f"BUG：(5,6) 應為合法配對。實際列表：{pairs}"
        )

    def test_total_pair_count(self):
        """每日應恰好有 5 組合法配對（6節中排除1個午休邊界）"""
        pairs = get_valid_consecutive_pairs(base=0)
        assert len(pairs) == PERIODS_PER_DAY - 2, (
            f"配對數應為 {PERIODS_PER_DAY - 2}（{PERIODS_PER_DAY} 節 - 2），"
            f"實際：{len(pairs)}。列表：{pairs}"
        )

    def test_base_offset_is_applied(self):
        """第二天 base=7 時，所有配對應加上 offset"""
        base = PERIODS_PER_DAY  # day=1 的 base
        pairs = get_valid_consecutive_pairs(base=base)
        # 第二天的午休邊界是 (base+3, base+4) = (10, 11)
        assert (base + 3, base + 4) not in pairs, (
            f"BUG：跨午休配對 ({base+3},{base+4}) 不應出現"
        )
        assert (base + 4, base + 5) in pairs, (
            f"BUG：下午配對 ({base+4},{base+5}) 應合法"
        )

    def test_all_days_no_lunch_boundary_pair(self):
        """所有天的合法列表中，都不應出現跨午休配對"""
        for d in range(DAYS):
            base = d * PERIODS_PER_DAY
            pairs = get_valid_consecutive_pairs(base)
            forbidden = (base + 3, base + 4)
            assert forbidden not in pairs, (
                f"Day {d}：跨午休配對 {forbidden} 不應出現。列表：{pairs}"
            )


class TestArtConsecutiveIntegration:
    """整合測試：確認模型端不再產生 (3,4) 配對的 BoolVar"""

    def test_no_lunch_boundary_boolvar_created(self):
        """
        apply_art_consecutive_constraint 建立的 BoolVar 名稱中，
        不應出現代表跨午休邊界的配對。
        透過 Monkey-patch NewBoolVar 來追蹤變數名稱。
        """
        try:
            from ortools.sat.python import cp_model
        except ImportError:
            pytest.skip("ortools 未安裝，跳過整合測試")

        from constraints.special_rules import apply_art_consecutive_constraint

        model = cp_model.CpModel()

        # Monkey-patch NewBoolVar 來追蹤變數名稱
        created_names = []
        original_new_boolvar = model.NewBoolVar
        def tracked_new_boolvar(name):
            var = original_new_boolvar(name)
            created_names.append(name)
            return var
        model.NewBoolVar = tracked_new_boolvar

        # 建立最小化的 schedule：一個班，有 美勞_固定 和 音樂美勞_交替
        from config import TOTAL_PERIODS
        schedule = {}
        for p in range(TOTAL_PERIODS):
            schedule[("3年1班", p, "王老師", "美勞_固定")] = model.NewBoolVar(f"art_fixed_p{p}")
            schedule[("3年1班", p, "李老師", "音樂美勞_交替")] = model.NewBoolVar(f"alt_p{p}")

        classes_data = [{
            "name": "3年1班",
            "course_requirements": [
                {"subject": "美勞_固定"},
                {"subject": "音樂美勞_交替"},
            ]
        }]

        apply_art_consecutive_constraint(model, classes_data, schedule)

        # 檢查 art_block_* 變數：不應出現跨午休邊界的配對
        # 跨午休配對的 period index: day*d*7+3 → p3, p10, p17, p24, p31
        forbidden_bases = {d * PERIODS_PER_DAY + 3 for d in range(DAYS)}
        lunch_boundary_vars = [
            n for n in created_names
            if "art_block" in n and any(f"_p{b}_" in n for b in forbidden_bases)
        ]

        assert len(lunch_boundary_vars) == 0, (
            f"BUG：仍有跨午休的 art_block BoolVar：{lunch_boundary_vars}"
        )

        # 額外驗證：配對總數應為 DAYS * (PERIODS_PER_DAY - 2) * 2 = 5 * 5 * 2 = 50
        pair_vars = [n for n in created_names if "art_block" in n]
        expected_count = DAYS * (PERIODS_PER_DAY - 2) * 2
        assert len(pair_vars) == expected_count, (
            f"配對數應為 {expected_count}，實際：{len(pair_vars)}"
        )