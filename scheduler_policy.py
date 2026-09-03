# -*- coding: utf-8 -*-
"""
Runtime Policy Adapter — scheduler_policy.py

單一政策與權重管理模組，供 solver、phase2_engine、constraints、repair_agent 共用。

設計依據：
  - docs/20260617_scheduler_policy_constraints_plan.yaml (§376-438 weight_registry)
  - docs/20260618-task-01-runtime-policy-adapter-plan.md (§4-6 Runtime Policy Object 草案)

核心原則：
  1. 所有 soft constraint 權重集中管理於 WEIGHT_REGISTRY。
  2. Teacher quota 保持 soft constraint，不改為 hard。
  3. Solve mode（strict / fallback）由 SolveMode enum 明確表示。
  4. 缺失 weight key 時回傳 fallback default (100)，不拋異常。
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# ============================================================================
# 1. SolveMode Enum
# ============================================================================
# 對應 YAML two_pass_fallback.strict_pass.name / fallback_pass.name (§193-208)

class SolveMode(enum.Enum):
    """求解模式枚舉。

    STRICT_TEACHING_SHAPE:
        strict pass — natural/art-music shape 為 hard constraint。
        對應 YAML two_pass_fallback.strict_pass.name = "strict_teaching_shape"

    FEASIBILITY_RECOVERY:
        fallback pass — natural/art-music shape 降為 ultra-high-weight soft constraint。
        對應 YAML two_pass_fallback.fallback_pass.name = "feasibility_recovery"
    """
    STRICT_TEACHING_SHAPE = "strict_teaching_shape"
    FEASIBILITY_RECOVERY = "feasibility_recovery"


# ============================================================================
# 2. WEIGHT_REGISTRY
# ============================================================================
# 完整權重表，來源：
#   - YAML §412-433 initial_numeric_weights
#   - MD §6.1 完整權重表
#   - MD §6.4 Legacy Weight Mapping 新增歸戶

WEIGHT_REGISTRY: Dict[str, int] = {
    # --- high (1000-5000) ---
    "english_room_slack_fallback": 8000,
        # C1 Prototype: English room overload penalty in fallback mode
    "teacher_quota_overtime": 5000,
        # teacher quota 超載懲罰；phase2_engine.py & constraints/teacher_rules.py 共用此 key

    "odd_or_large_alternating_pairing": 5000,
        # 奇數/大組交替配對方向偏好

    "classroom_grade_affinity": 3000,
        # 專科教室年級親和度偏好

    "teacher_fatigue": 5000,
        # 教師疲勞懲罰（避免連續授課過長）

    "cross_expertise": 5000,
        # 跨專長遞補懲罰

    "grade_morning_first_period_homeroom_day": 3500,
        # 3-6 年級早讀第一節導師偏好

    "morning_two_homeroom_periods_per_day": 3000,
        # 每天兩節晨間導師課偏好

    "daily_subject_teacher_minimum": 3000,
        # 每天至少一節科任課偏好

    "specialty_room_non_preferred_grade": 3000,
        # 專科教室非偏好年級使用懲罰

    "partial_pullout_anchor_miss": 2500,
        # v2 partial pullout 定錨偏離基礎懲罰

    "partial_pullout_anchor_distance": 300,
        # v2 partial pullout 定錨偏離同日節次距離懲罰 (每節 300)

    # --- medium_high (800-2500) ---
    "swimming_consecutive": 1200,
        # 游泳連堂偏好

    "classroom_primary_teacher_affinity": 2500,
        # 教室與主要導師親和度偏好

        # 5-6 年級下午共備區塊偏好

        # 共備期間科任課偏好

    # --- low (10-100) ---
    "subject_dispersion": 50,
        # 科目分散懲罰（避免同日同科過度集中）

    "lunch_span": 100,
        # 跨午休懲罰

    # --- near_hard (5000-20000) ---
    "exact_two_alternating_pairing_fallback": 18000,
        # 精確兩班交替配對在 fallback mode 的降級 penalty

    "natural_shape_fallback": 16000,
        # 自然科學連堂在 fallback mode 的 ultra-high-weight soft penalty

    "art_music_shape_fallback": 16000,
        # 音美教學型態在 fallback mode 的 ultra-high-weight soft penalty

    "swimming_pool_overload": 10000,
        # 泳池容量超載懲罰

    "grade12_tuesday_afternoon_life_course_fallback": 14000,
        # 1-2 年級週二下午生活課在 fallback mode 的 near-hard penalty

    "priority_teacher_placeholder": 12000,
        # 優先教師佔位符懲罰

    # --- §6.4 Legacy Weight Mapping 新增歸戶 ---
    "alternating_alignment_conflict": 10000,
        # §6.4-1: phase2_engine.py — 同師交替課同節次衝突懲罰
        # 原 hard-coded: phase2_engine.py:360 alternating_alignment_weight = 10000

    "art_music_week_specific_room_overload": 10000,
        # §6.4-3: constraints/class_rules.py — week-specific 音美教室容量超載
        # 原 hard-coded: class_rules.py:996 10000 * ov

    "classroom_capacity_overload": 5000,
        # constraints/class_rules.py — 專科教室容量超載（relax_to_soft mode）
        # 原 hard-coded fallback: apply_special_classroom_capacity 5000

    # --- [2026-06-28] 五六年級共備 + 導師每日四節上限 ---
    "homeroom_daily_max_periods": 3200,
        # phase2_engine.py — 導師每日超過 4 節的 soft penalty
        # 政策檔: docs/2026-06-28_co_planning_manual_block_and_homeroom_daily_cap_policy.yaml

        # constraints/class_rules.py — manual 共備區塊內未安排科任課的 near-hard penalty
        # 政策檔: docs/2026-06-28_co_planning_manual_block_and_homeroom_daily_cap_policy.yaml

    "subject_day_spread_adjacent": 800,
        # constraints/class_rules.py — subject_day_spread Rule B (相鄰兩天至多出現一天)
        # 產品決策: Rule A (同日最多1堂) 保留 hard; Rule B 改為 soft penalty
        # 原因: Rule A 接近合法性規則; Rule B 是課表品質偏好，不應讓整份課表 INFEASIBLE

    # --- [2026-07-21] 排課品質 soft rules (本次新增) ---
    "teacher_daily_load_smoothing": 50,
        # 教師日負載平滑: 偏好每日負載更平均，不破壞基本可排性

    "same_teacher_grade_consistency": 80,
        # 同師年段一致性: 降低同一天跨不同年段授課的切換成本

    "period7_flexible_preference": 20,
        # 第七節優先安排【校本/彈性】與資訊課（最低權重）

    "pe_avoid_period_45": 20,
        # 體育課避開第 4、5 節（最低權重，僅偏好非硬禁排）

    # --- [2026-07-21] 通用時段規則引擎 soft penalties ---
    "slot_rule_soft_avoid": 500,
    "soft_slot_rule_avoid": 30,
        # 通用時段規則引擎: soft mode 的 avoid penalty
        # 可被 AI 設定頁的 weight (low/medium/high) 覆蓋

    # --- [2026-07-28] Grade Time Rules soft & near-hard penalty keys ---
    "grade_time_require_subject": 9000,
    "grade_time_require_subject_category": 9000,
    "grade_time_forbid_teacher_type": 9000,
    "grade_time_require_teacher_type": 9000,
    "grade_time_co_planning_prefer": 9000,
}

POLICY_WEIGHTS = WEIGHT_REGISTRY

# Fallback default: 當 key 不存在時使用的預設權重
# 對應 YAML scale.low 下限 (§389)
WEIGHT_FALLBACK_DEFAULT: int = 100


# ============================================================================
# 3. SolvePolicy Dataclass
# ============================================================================
# 對應 MD §5.2 SolvePolicy 資料結構草案

@dataclass
class SolvePolicy:
    """Runtime 求解政策物件。

    封裝了當前求解模式、有效權重、hard/soft rule modes 以及輸出 metadata。
    各模組應透過此物件取得權重與模式，而非自行硬編碼。

    Attributes:
        solve_pass: 當前求解模式（STRICT 或 FALLBACK）
        fallback_enabled: 是否允許 strict→fallback 自動切換
        degraded: 最終結果是否為降級接受

        weights: soft constraint key → numeric weight 的完整映射
        weight_fallback_default: 缺失 key 時的預設權重

        hard_rule_modes: 在 strict pass 中為 hard、在 fallback pass 中可能降級的規則
            - natural_shape: 自然科學連堂型態
            - art_music_shape: 音美教學型態連堂
            - exact_two_alternating_pairing: 精確兩班交替配對方向
            - grade12_tuesday_afternoon_life: 1-2 年級週二下午生活課

        soft_rule_modes: 始終為 soft 的規則（weight 隨 mode 變化但永不變 hard）
            - teacher_quota_overtime: 教師配額超載（永遠 soft）
            - swimming_consecutive: 游泳連堂偏好（永遠 soft）
            - odd_or_large_alternating_pairing: 奇數/大組交替配對（永遠 soft）

        output_metadata_fields: solver output JSON 必須包含的 metadata keys
        penalty_breakdown_keys: penaltyBreakdown 中允許出現的 rule id keys
    """

    # --- Solve mode ---
    solve_pass: SolveMode = SolveMode.STRICT_TEACHING_SHAPE
    fallback_enabled: bool = True
    degraded: bool = False
    degradation_reasons: List[str] = field(default_factory=list)

    # --- Weight registry ---
    weights: Dict[str, int] = field(default_factory=dict)
    weight_fallback_default: int = WEIGHT_FALLBACK_DEFAULT

    # --- Hard rule modes (strict=hard, fallback=soft) ---
    hard_rule_modes: Dict[str, bool] = field(default_factory=lambda: {
        "natural_shape": True,
        "art_music_shape": True,
        "exact_two_alternating_pairing": True,
        "grade12_tuesday_afternoon_life": True,
    })

    # --- Soft rule modes (always soft) ---
    soft_rule_modes: Dict[str, bool] = field(default_factory=lambda: {
        "teacher_quota_overtime": True,
        "swimming_consecutive": True,
        "odd_or_large_alternating_pairing": True,
    })

    # --- Output metadata fields ---
    output_metadata_fields: List[str] = field(default_factory=lambda: [
        "solvePass",
        "degraded",
        "degradationReasons",
        "penaltyBreakdown",
    ])

    # --- Penalty breakdown keys (必須與 weight_registry key 對齊) ---
    penalty_breakdown_keys: List[str] = field(default_factory=lambda: [
        "teacher_quota_overtime",
        "odd_or_large_alternating_pairing",
        "exact_two_alternating_pairing_fallback",
        "natural_shape_fallback",
        "art_music_shape_fallback",
        "swimming_consecutive",
        "swimming_pool_overload",
        "classroom_grade_affinity",
        "classroom_primary_teacher_affinity",
        "teacher_fatigue",
        "subject_dispersion",
        "lunch_span",
        "cross_expertise",
        "grade_morning_first_period_homeroom_day",
        "morning_two_homeroom_periods_per_day",
        "grade12_tuesday_afternoon_life_course_fallback",
        "daily_subject_teacher_minimum",
        "specialty_room_non_preferred_grade",
        "priority_teacher_placeholder",
        # §6.4 Legacy Weight Mapping 新增歸戶
        "alternating_alignment_conflict",
        "art_music_week_specific_room_overload",
        # [2026-06-28] 五六年級共備 + 導師每日四節上限
        "homeroom_daily_max_periods",
        # [2026-07-21] 排課品質 soft rules
        "teacher_daily_load_smoothing",
        "same_teacher_grade_consistency",
        "period7_flexible_preference",
        "pe_avoid_period_45",
        # [2026-07-21] 通用時段規則引擎
        "slot_rule_soft_avoid",
        # [2026-09-02] v2 partial pullout 定錨偏好
        "partial_pullout_anchor_miss",
        "partial_pullout_anchor_distance",
    ])

    # --- Helper methods ---

    def get_weight(self, key: str, default: Optional[int] = None) -> int:
        """取得指定 key 的權重。

        Args:
            key: soft constraint 的 registry key（例如 "teacher_quota_overtime"）
            default: 可選的預設值。若提供且 key 不存在，回傳此值；
                     若未提供則使用 weight_fallback_default (100)。

        Returns:
            對應的 numeric weight；若 key 不存在則回傳 default 或 fallback default。

        Examples:
            >>> policy = get_active_policy()
            >>> policy.get_weight("teacher_quota_overtime")
            5000
            >>> policy.get_weight("nonexistent_key")
            100
            >>> policy.get_weight("nonexistent_key", default=200)
            200
        """
        if key in self.weights:
            return self.weights[key]
        if default is not None:
            return default
        return self.weight_fallback_default

    def is_hard_rule(self, rule_name: str) -> bool:
        """檢查指定規則在當前模式下是否為 hard constraint。

        Args:
            rule_name: hard_rule_modes 中的 key（例如 "natural_shape"）

        Returns:
            True 表示當前模式下此規則為 hard constraint；
            False 表示降級為 soft constraint（fallback mode）。
        """
        return self.hard_rule_modes.get(rule_name, False)

    def to_output_metadata(self) -> Dict:
        """產生 solver output JSON 的 metadata 區塊。

        Returns:
            dict 包含 solvePass, degraded, degradationReasons。
            penaltyBreakdown 由各模組獨立累加，不在此處預設。
        """
        return {
            "solvePass": self.solve_pass.value,
            "degraded": self.degraded,
            "degradationReasons": list(self.degradation_reasons),
        }


# ============================================================================
# 4. Factory Function: get_active_policy()
# ============================================================================
# 對應 MD §5.3 Factory Function 行為草案

def get_active_policy(
    mode: SolveMode = SolveMode.STRICT_TEACHING_SHAPE,
    overrides: Optional[Dict[str, int]] = None,
    fallback_enabled: bool = True,
) -> SolvePolicy:
    """建立並回傳當前有效的求解政策物件。

    這是 WEIGHT_REGISTRY 和 SolveMode 的統一入口。各模組應透過此函式
    取得 policy，而非直接 import WEIGHT_REGISTRY。

    Args:
        mode: 求解模式。STRICT_TEACHING_SHAPE（預設）或 FEASIBILITY_RECOVERY。
        overrides: 可選的權重覆蓋 dict。key 為 weight_registry key，
                   value 為新的 numeric weight。供未來從資料庫或 API 覆蓋特定 weight。
        fallback_enabled: 是否允許 strict→fallback 自動切換（預設 true）。

    Returns:
        SolvePolicy instance，包含有效的 weights、hard_rule_modes、soft_rule_modes。

    Examples:
        >>> # Strict mode (default)
        >>> policy = get_active_policy()
        >>> policy.is_hard_rule("natural_shape")
        True

        >>> # Fallback mode
        >>> policy = get_active_policy(mode=SolveMode.FEASIBILITY_RECOVERY)
        >>> policy.is_hard_rule("natural_shape")
        False
        >>> policy.get_weight("natural_shape_fallback")
        16000

        >>> # Override specific weight
        >>> policy = get_active_policy(overrides={"teacher_quota_overtime": 8000})
        >>> policy.get_weight("teacher_quota_overtime")
        8000
    """
    # Step 1: 載入 WEIGHT_REGISTRY 作為 base weights
    effective_weights = dict(WEIGHT_REGISTRY)

    # Step 2: 根據 mode 設定 hard_rule_modes
    if mode == SolveMode.STRICT_TEACHING_SHAPE:
        hard_modes = {
            "natural_shape": True,
            "art_music_shape": True,
            "exact_two_alternating_pairing": True,
            "grade12_tuesday_afternoon_life": True,
        }
    else:  # FEASIBILITY_RECOVERY
        hard_modes = {
            "natural_shape": False,
            "art_music_shape": False,
            "exact_two_alternating_pairing": False,
            "grade12_tuesday_afternoon_life": False,
        }

    # Step 3: 若 fallback mode，調整 near-hard weight keys
    if mode == SolveMode.FEASIBILITY_RECOVERY:
        # Fallback mode 下，natural/art-music/exact-two 的 weight 已經是
        # *_fallback key 中的 near-hard 值（16000/18000），不需額外調整。
        # 此處保留供未來校準使用。
        pass

    # Step 4: 套用 overrides
    if overrides:
        for key, value in overrides.items():
            effective_weights[key] = value

    # Step 5: 建立並回傳 SolvePolicy instance
    return SolvePolicy(
        solve_pass=mode,
        fallback_enabled=fallback_enabled,
        degraded=False,
        degradation_reasons=[],
        weights=effective_weights,
        weight_fallback_default=WEIGHT_FALLBACK_DEFAULT,
        hard_rule_modes=hard_modes,
        soft_rule_modes={
            "teacher_quota_overtime": True,
            "swimming_consecutive": True,
            "odd_or_large_alternating_pairing": True,
        },
    )


@dataclass(frozen=True)
class SlotRule:
    id: str
    enabled: bool
    owner_type: str
    owner_id: str
    day: int | str
    periods: tuple[int, ...]
    mode: str
    action: str
    weight: int
    note: str = ""


def _normalize_periods(value):
    if value == "all":
        return tuple(range(1, 8))
    if isinstance(value, list):
        return tuple(sorted({max(1, min(7, int(period))) for period in value}))
    return (max(1, min(7, int(value or 1))),)


def parse_slot_rules(raw_rules):
    parsed = []
    for index, raw in enumerate(raw_rules or []):
        if not isinstance(raw, dict) or raw.get("enabled") is False:
            continue
        mode = raw.get("mode") if raw.get("mode") in {"hard", "soft"} else "soft"
        owner_type = raw.get("ownerType") if raw.get("ownerType") in {"teacher", "admin_role", "team_instructor", "class"} else "teacher"
        parsed.append(SlotRule(
            id=str(raw.get("id") or f"slot-rule-{index}"),
            enabled=True,
            owner_type=owner_type,
            owner_id=str(raw.get("ownerId") or ""),
            day=raw.get("day") if raw.get("day") == "all" else max(1, min(5, int(raw.get("day") or 1))),
            periods=_normalize_periods(raw.get("period") or 1),
            mode=mode,
            action="avoid",
            weight=max(1, min(10, int(raw.get("weight") or 3))),
            note=str(raw.get("note") or ""),
        ))
    return parsed


def build_hard_slot_mask(slot_rules):
    mask = {}
    for rule in slot_rules or []:
        if not rule.enabled or rule.mode != "hard" or rule.owner_type != "teacher" or not rule.owner_id:
            continue
        days = range(1, 6) if rule.day == "all" else (int(rule.day),)
        mask.setdefault(rule.owner_id, set()).update((day, period) for day in days for period in rule.periods)
    return mask


# ============================================================================
# 5. Convenience Exports
# ============================================================================
# 供外部模組便捷 import

__all__ = [
    "SolveMode",
    "SolvePolicy",
    "WEIGHT_REGISTRY",
    "WEIGHT_FALLBACK_DEFAULT",
    "POLICY_WEIGHTS",
    "get_active_policy",
    "SlotRule",
    "parse_slot_rules",
    "build_hard_slot_mask",
]