"""
test_special_course_subject_mapping.py

測試學習中心 → 導師區塊的語意映射與重疊驗證。

覆蓋:
  1. resolve_effective_special_course_subject() 映射規則
  2. classify_special_course_overlaps() 分類規則
  3. _validate_schedule_result() 整合驗證
"""

import pytest
import sys
import os

# 確保 project root 在 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from constraints.teacher_rules import (
    resolve_effective_special_course_subject,
    classify_special_course_overlaps,
)


# ============================================================================
# Step 1: resolve_effective_special_course_subject() 單元測試
# ============================================================================

class TestResolveEffectiveSpecialCourseSubject:
    """測試 effective subject 映射規則。"""

    def test_learning_center_chinese_maps_to_homeroom_block(self):
        """
        該班 語文-國語 已被 merge 進 導師區塊。
        effectiveScheduleSubject 應為 '導師區塊'。
        """
        sc = {"name": "學習中心", "targetSubject": "語文-國語"}
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年1班",
                "mergedSubjects": [
                    {"subject": "語文-國語", "periods": 5},
                    {"subject": "數學", "periods": 4},
                ],
            }]
        }
        result = resolve_effective_special_course_subject(sc, "3年1班", metadata)
        assert result == "導師區塊"

    def test_learning_center_math_maps_to_homeroom_block(self):
        """
        該班 數學 已被 merge 進 導師區塊。
        """
        sc = {"name": "學習中心", "targetSubject": "數學"}
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年1班",
                "mergedSubjects": [
                    {"subject": "語文-國語", "periods": 5},
                    {"subject": "數學", "periods": 4},
                ],
            }]
        }
        result = resolve_effective_special_course_subject(sc, "3年1班", metadata)
        assert result == "導師區塊"

    def test_non_learning_center_no_mapping(self):
        """
        非學習中心（如創思中心）不觸發映射。
        """
        sc = {"name": "創思中心", "targetSubject": "語文-國語"}
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年1班",
                "mergedSubjects": [{"subject": "語文-國語", "periods": 5}],
            }]
        }
        result = resolve_effective_special_course_subject(sc, "3年1班", metadata)
        assert result == "語文-國語"

    def test_learning_center_subject_not_merged(self):
        """
        學習中心但 targetSubject 不在 mergedSubjects 中。
        應回傳原始 targetSubject。
        """
        sc = {"name": "學習中心", "targetSubject": "英語"}
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年1班",
                "mergedSubjects": [{"subject": "語文-國語", "periods": 5}],
            }]
        }
        result = resolve_effective_special_course_subject(sc, "3年1班", metadata)
        assert result == "英語"

    def test_learning_center_wrong_class_no_mapping(self):
        """
        學習中心但班級不同。
        應回傳原始 targetSubject。
        """
        sc = {"name": "學習中心", "targetSubject": "語文-國語"}
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年2班",  # 不同班級
                "mergedSubjects": [{"subject": "語文-國語", "periods": 5}],
            }]
        }
        result = resolve_effective_special_course_subject(sc, "3年1班", metadata)
        assert result == "語文-國語"

    def test_empty_metadata_returns_original(self):
        """
        metadata 為空或 None 時，回傳原始 targetSubject。
        """
        sc = {"name": "學習中心", "targetSubject": "語文-國語"}
        result = resolve_effective_special_course_subject(sc, "3年1班", None)
        assert result == "語文-國語"

        result2 = resolve_effective_special_course_subject(sc, "3年1班", {})
        assert result2 == "語文-國語"

    def test_empty_target_subject(self):
        """
        targetSubject 為空時，回傳空字串。
        """
        sc = {"name": "學習中心", "targetSubject": ""}
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年1班",
                "mergedSubjects": [{"subject": "語文-國語", "periods": 5}],
            }]
        }
        result = resolve_effective_special_course_subject(sc, "3年1班", metadata)
        assert result == ""


# ============================================================================
# Step 2: classify_special_course_overlaps() 單元測試
# ============================================================================

class TestClassifySpecialCourseOverlaps:
    """測試重疊分類規則。"""

    def test_same_class_same_period_two_learning_centers_allowed(self):
        """
        不同老師，原始 targetSubject 不同，但都映射到 導師區塊。
        應視為 allowed overlap，不判錯。
        """
        resolved = [
            {
                "name": "學習中心", "teacher": "王老師",
                "targetSubject": "語文-國語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
            {
                "name": "學習中心", "teacher": "李老師",
                "targetSubject": "數學",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
        ]
        result = classify_special_course_overlaps(resolved)
        assert len(result["allowed_overlaps"]) == 1
        assert len(result["conflicts"]) == 0
        assert result["allowed_overlaps"][0]["disposition"] == "allowed_same_effective_subject"

    def test_same_class_same_period_different_effective_subject_conflict(self):
        """
        effective subject 不同，應被判定為衝突。
        """
        resolved = [
            {
                "name": "學習中心", "teacher": "王老師",
                "targetSubject": "語文-國語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
            {
                "name": "學習中心", "teacher": "李老師",
                "targetSubject": "英語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "英語"},
            },
        ]
        result = classify_special_course_overlaps(resolved)
        assert len(result["conflicts"]) == 1
        assert result["conflicts"][0]["disposition"] == "conflict_different_effective_subject"

    def test_diagnostic_output_contains_required_fields(self):
        """
        衝突或放行情況中，每個 entry 都必須含必要欄位。
        """
        resolved = [
            {
                "name": "學習中心", "teacher": "王老師",
                "targetSubject": "語文-國語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
            {
                "name": "學習中心", "teacher": "李老師",
                "targetSubject": "數學",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
        ]
        result = classify_special_course_overlaps(resolved)
        for group in result["allowed_overlaps"] + result["conflicts"]:
            assert "className" in group
            assert "day" in group
            assert "period" in group
            for entry in group["entries"]:
                assert "originalTargetSubject" in entry
                assert "effectiveScheduleSubject" in entry
                assert "teacher" in entry

    def test_classify_produces_conflicts_for_different_effective_subject(self):
        """
        classify helper 層級：effective subject 不同的同時段重疊
        應產生 conflicts 且 disposition 正確。
        """
        resolved = [
            {
                "name": "學習中心", "teacher": "王老師",
                "targetSubject": "語文-國語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
            {
                "name": "學習中心", "teacher": "李老師",
                "targetSubject": "英語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "英語"},
            },
        ]
        analysis = classify_special_course_overlaps(resolved)
        assert len(analysis["conflicts"]) >= 1
        assert analysis["conflicts"][0]["disposition"] == "conflict_different_effective_subject"
        assert len(analysis["allowed_overlaps"]) == 0

    def test_no_overlap_when_different_periods(self):
        """
        不同時段的重疊不應被判定為衝突。
        """
        resolved = [
            {
                "name": "學習中心", "teacher": "王老師",
                "targetSubject": "語文-國語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
            {
                "name": "學習中心", "teacher": "李老師",
                "targetSubject": "英語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 5}],  # 不同時段
                "_effective_subjects": {"3年1班": "英語"},
            },
        ]
        result = classify_special_course_overlaps(resolved)
        assert len(result["conflicts"]) == 0
        assert len(result["allowed_overlaps"]) == 0

    def test_no_overlap_when_different_classes(self):
        """
        不同班級的重疊不應被判定為衝突。
        """
        resolved = [
            {
                "name": "學習中心", "teacher": "王老師",
                "targetSubject": "語文-國語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
            {
                "name": "學習中心", "teacher": "李老師",
                "targetSubject": "英語",
                "targetClasses": ["3年2班"],  # 不同班級
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年2班": "英語"},
            },
        ]
        result = classify_special_course_overlaps(resolved)
        assert len(result["conflicts"]) == 0
        assert len(result["allowed_overlaps"]) == 0

    def test_empty_input_returns_empty_result(self):
        """
        空輸入應回傳空的 allowed_overlaps 和 conflicts。
        """
        result = classify_special_course_overlaps([])
        assert result["allowed_overlaps"] == []
        assert result["conflicts"] == []

    def test_none_input_returns_empty_result(self):
        """
        None 輸入應回傳空的 allowed_overlaps 和 conflicts。
        """
        result = classify_special_course_overlaps(None)
        assert result["allowed_overlaps"] == []
        assert result["conflicts"] == []


# ============================================================================
# Step 3: _validate_schedule_result() 整合測試
# ============================================================================

class TestValidateScheduleResultIntegration:
    """測試 _validate_schedule_result() 的 overlap 驗證整合。"""

    def test_validate_schedule_result_reports_overlap_conflict_as_failure(self):
        """
        整合測試：構造含 effective subject 衝突的排課結果，
        經 _validate_schedule_result() 後，report 應含
        非空的 special_course_overlap_conflicts，
        且該結果應被視為驗證失敗。
        """
        from solver import _validate_schedule_result, _has_hard_validation_errors

        schedule_result = []  # 最小 fixture（無一般課程衝突）
        resolved_for_validation = [
            {
                "name": "學習中心", "teacher": "王老師",
                "targetSubject": "語文-國語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
            {
                "name": "學習中心", "teacher": "李老師",
                "targetSubject": "英語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "英語"},
            },
        ]

        report = _validate_schedule_result(
            schedule_result,
            classes_data=[{"name": "3年1班", "grade": 3, "course_requirements": []}],
            school_info={},
            classrooms=[],
            ai_settings={},
            resolved_special_courses=resolved_for_validation,
        )

        # 確認有衝突
        assert len(report["special_course_overlap_conflicts"]) >= 1
        # 確認無 allowed overlaps
        assert len(report["special_course_allowed_overlaps"]) == 0
        # 確認 _has_hard_validation_errors 回傳 True
        assert _has_hard_validation_errors(report) is True

    def test_validate_schedule_result_allows_same_effective_subject(self):
        """
        整合測試：same effective subject 的重疊不應視為驗證失敗。
        """
        from solver import _validate_schedule_result, _has_hard_validation_errors

        schedule_result = []
        resolved_for_validation = [
            {
                "name": "學習中心", "teacher": "王老師",
                "targetSubject": "語文-國語",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
            {
                "name": "學習中心", "teacher": "李老師",
                "targetSubject": "數學",
                "targetClasses": ["3年1班"],
                "lockedSlots": [{"day": 2, "period": 3}],
                "_effective_subjects": {"3年1班": "導師區塊"},
            },
        ]

        report = _validate_schedule_result(
            schedule_result,
            classes_data=[{"name": "3年1班", "grade": 3, "course_requirements": []}],
            school_info={},
            classrooms=[],
            ai_settings={},
            resolved_special_courses=resolved_for_validation,
        )

        # 確認無衝突
        assert len(report["special_course_overlap_conflicts"]) == 0
        # 確認有 allowed overlap
        assert len(report["special_course_allowed_overlaps"]) >= 1
        # 確認 _has_hard_validation_errors 回傳 False（無硬錯誤）
        assert _has_hard_validation_errors(report) is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])