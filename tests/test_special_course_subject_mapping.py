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

from ortools.sat.python import cp_model
from constraints.teacher_rules import (
    resolve_effective_special_course_subject,
    classify_special_course_overlaps,
    apply_special_course_locks,
)
from solver import (
    _entries_match_same_resolved_special_course_event,
    _validate_schedule_result,
    _has_hard_validation_errors,
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


# ============================================================================
# Step 4: Special Course Shared Events (Task 2) 測試
# ============================================================================

class TestSpecialCourseSharedEvents:
    """測試共同授課事件 (sharedEventId) 求解器分組與教師佔用。"""

    def test_shared_event_single_teacher_occupancy(self):
        """ID 77/80 混齡課：同教師佑瑩、週四第1節、不同班級集合、相同 sharedEventId -> FEASIBLE。"""
        model = cp_model.CpModel()
        schedule = {}
        classes = ["4年2班", "4年6班", "5年1班", "5年4班", "5年6班", "5年9班"]
        subjects = ["數學", "語文-國語"]
        teachers = ["佑瑩", "導師A", "導師B"]

        for c in classes:
            for p in range(35):
                for t in teachers:
                    for s in subjects:
                        var = model.NewBoolVar(f"sch_{c}_{p}_{t}_{s}")
                        schedule[(c, p, t, s)] = var

        special_courses = [
            {
                "id": 77,
                "type": "pullout",
                "name": "學習中心",
                "targetSubject": "數學",
                "teacher": "佑瑩",
                "targetClasses": ["4年2班", "4年6班"],
                "lockedSlots": [{"day": 4, "period": 1}],
                "sharedEventId": "evt-77-80",
            },
            {
                "id": 80,
                "type": "pullout",
                "name": "學習中心",
                "targetSubject": "數學",
                "teacher": "佑瑩",
                "targetClasses": ["5年1班", "5年4班", "5年6班", "5年9班"],
                "lockedSlots": [{"day": 4, "period": 1}],
                "sharedEventId": "evt-77-80",
            },
        ]

        classes_data = [{"name": c, "grade": int(c[0])} for c in classes]
        teachers_data = [{"name": t, "max_periods": 20} for t in teachers]

        apply_special_course_locks(
            model,
            schedule,
            special_courses,
            classes_data,
            teachers_data,
            ai_settings={},
        )

        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), "Shared event should be FEASIBLE with single teacher occupancy"

    def test_independent_courses_same_teacher_collision_infeasible(self):
        """缺少 sharedEventId 或不同 sharedEventId 的同教師同時段兩堂獨立課必為 INFEASIBLE。"""
        model = cp_model.CpModel()
        schedule = {}
        classes = ["4年2班", "5年1班"]
        teachers = ["佑瑩"]
        subjects = ["數學"]

        for c in classes:
            for p in range(35):
                for t in teachers:
                    for s in subjects:
                        var = model.NewBoolVar(f"sch_{c}_{p}_{t}_{s}")
                        schedule[(c, p, t, s)] = var

        special_courses = [
            {
                "id": 101,
                "type": "pullout",
                "name": "學習中心",
                "targetSubject": "數學",
                "teacher": "佑瑩",
                "targetClasses": ["4年2班"],
                "lockedSlots": [{"day": 4, "period": 1}],
                "sharedEventId": None,
            },
            {
                "id": 102,
                "type": "pullout",
                "name": "學習中心",
                "targetSubject": "數學",
                "teacher": "佑瑩",
                "targetClasses": ["5年1班"],
                "lockedSlots": [{"day": 4, "period": 1}],
                "sharedEventId": None,
            },
        ]

        classes_data = [{"name": c, "grade": int(c[0])} for c in classes]
        teachers_data = [{"name": t, "max_periods": 20} for t in teachers]

        apply_special_course_locks(
            model,
            schedule,
            special_courses,
            classes_data,
            teachers_data,
            ai_settings={},
        )

        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status == cp_model.INFEASIBLE, "Independent courses without sharedEventId must remain INFEASIBLE"

    def test_entries_match_same_resolved_special_course_event_shared(self):
        """驗證 _entries_match_same_resolved_special_course_event 能辨識跨班級的共同授課事件。"""
        resolved_sc = [
            {
                "name": "學習中心",
                "teacher": "佑瑩",
                "targetSubject": "數學",
                "targetClasses": ["4年2班", "4年6班"],
                "lockedSlots": [{"day": 4, "period": 1}],
                "sharedEventId": "evt-77-80",
            },
            {
                "name": "學習中心",
                "teacher": "佑瑩",
                "targetSubject": "數學",
                "targetClasses": ["5年1班", "5年4班"],
                "lockedSlots": [{"day": 4, "period": 1}],
                "sharedEventId": "evt-77-80",
            },
        ]

        entries = [
            {"className": "4年2班", "subject": "數學", "teacherName": "佑瑩"},
            {"className": "4年6班", "subject": "數學", "teacherName": "佑瑩"},
            {"className": "5年1班", "subject": "數學", "teacherName": "佑瑩"},
            {"className": "5年4班", "subject": "數學", "teacherName": "佑瑩"},
        ]

        matched = _entries_match_same_resolved_special_course_event(
            entries,
            "佑瑩",
            day=4,
            period=1,
            resolved_special_courses=resolved_sc,
        )
        assert matched is True

        entries_extra = entries + [{"className": "6年1班", "subject": "數學", "teacherName": "佑瑩"}]
        matched_extra = _entries_match_same_resolved_special_course_event(
            entries_extra,
            "佑瑩",
            day=4,
            period=1,
            resolved_special_courses=resolved_sc,
        )
        assert matched_extra is False


# ============================================================================
# Step 5: Validation Consistency and Homeroom Block Resolution (Task 3) 測試
# ============================================================================

class TestValidationConsistencyTask3:
    """測試自動排時後的驗證一致性與導師區塊解析邊界。"""

    def test_homeroom_chinese_merged_passes_validation_without_false_conflict(self):
        """國語為導師自授、已合併為導師區塊：通過驗證，不產生假陽性衝突。"""
        sc1 = {
            "name": "學習中心",
            "teacher": "特教老師A",
            "targetSubject": "國語",
            "targetClasses": ["3年1班"],
            "lockedSlots": [{"day": 2, "period": 3}],
        }
        sc2 = {
            "name": "學習中心",
            "teacher": "特教老師B",
            "targetSubject": "國1",
            "targetClasses": ["3年1班"],
            "lockedSlots": [{"day": 2, "period": 3}],
        }
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年1班",
                "mergedSubjects": [{"subject": "語文-國語", "periods": 5}],
            }]
        }
        eff1 = resolve_effective_special_course_subject(sc1, "3年1班", metadata)
        eff2 = resolve_effective_special_course_subject(sc2, "3年1班", metadata)
        assert eff1 == "導師區塊"
        assert eff2 == "導師區塊"

        resolved_sc = [
            {**sc1, "_effective_subjects": {"3年1班": eff1}},
            {**sc2, "_effective_subjects": {"3年1班": eff2}},
        ]

        # 模擬班級主課表：該時段為「導師區塊」
        schedule_entries = [
            {"className": "3年1班", "day": 2, "period": 3, "week": 1, "subject": "導師區塊", "teacherName": "導師王"},
        ]

        report = _validate_schedule_result(
            schedule_entries,
            classes_data=[{"name": "3年1班", "grade": 3, "course_requirements": []}],
            school_info={},
            classrooms=[],
            ai_settings={},
            resolved_special_courses=resolved_sc,
        )

        assert len(report.get("special_course_overlap_conflicts", [])) == 0
        assert len(report.get("special_course_allowed_overlaps", [])) == 1
        assert _has_hard_validation_errors(report) is False

    def test_non_homeroom_chinese_not_merged_flags_conflict_on_mismatch(self):
        """國語非導師自授（未合併進導師區塊）：回傳原始國語，若遇不同有效科目仍回報為衝突。"""
        sc = {
            "name": "學習中心",
            "teacher": "特教老師",
            "targetSubject": "國語",
            "targetClasses": ["3年1班"],
            "lockedSlots": [{"day": 2, "period": 3}],
        }
        # metadata 中國語並未被 merge（例如專任教師自授，exemptSubjects）
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年1班",
                "mergedSubjects": [{"subject": "數學", "periods": 4}],
                "exemptSubjects": [{"subject": "語文-國語", "periods": 5}],
            }]
        }
        eff_subj = resolve_effective_special_course_subject(sc, "3年1班", metadata)
        assert eff_subj == "國語"

        resolved_sc = [{
            **sc,
            "_effective_subjects": {"3年1班": eff_subj},
        }]

        # 模擬排課輸出：此時若有另一筆不同有效科目的學習中心記錄重疊
        sc_other = {
            "name": "學習中心",
            "teacher": "另一特教",
            "targetSubject": "數學",
            "targetClasses": ["3年1班"],
            "lockedSlots": [{"day": 2, "period": 3}],
            "_effective_subjects": {"3年1班": "導師區塊"},
        }

        overlap_res = classify_special_course_overlaps([resolved_sc[0], sc_other])
        assert len(overlap_res.get("conflicts", [])) >= 1
        assert overlap_res["conflicts"][0]["disposition"] == "conflict_different_effective_subject"

    def test_gifted_center_never_maps_to_homeroom_block(self):
        """創思中心（資優抽離）即使該班國語已合併，也絕不映射為導師區塊。"""
        sc = {
            "name": "創思中心",
            "targetSubject": "語文-國語",
            "targetClasses": ["3年1班"],
            "lockedSlots": [{"day": 1, "period": 1}],
        }
        metadata = {
            "homeroomBlockizationTrace": [{
                "className": "3年1班",
                "mergedSubjects": [{"subject": "語文-國語", "periods": 5}],
            }]
        }
        eff_subj = resolve_effective_special_course_subject(sc, "3年1班", metadata)
        assert eff_subj == "語文-國語"


# ============================================================================
# Step 6: Shared Event Same-Class Multi-Subject Guard (Task 5) 測試
# ============================================================================

class TestSameClassMultiSubjectGuardTask5:
    """測試共同事件同班多科目防護與 ID 83/89 混齡跨科目支援。"""

    def test_shared_event_multi_class_different_subjects_allowed(self):
        """ID 83/89 類型：何采珍老師週四第2節，2年級數學 vs 5年級國語，不同班群承載不同科目 -> FEASIBLE。"""
        model = cp_model.CpModel()
        schedule = {}
        classes = ["2年4班", "2年6班", "2年7班", "5年1班", "5年6班", "5年9班"]
        subjects = ["數學", "語文-國語", "導師區塊"]
        teachers = ["何采珍", "導師A", "導師B"]

        for c in classes:
            for p in range(35):
                for t in teachers:
                    for s in subjects:
                        var = model.NewBoolVar(f"sch_{c}_{p}_{t}_{s}")
                        schedule[(c, p, t, s)] = var

        special_courses = [
            {
                "id": 83,
                "type": "pullout",
                "name": "學習中心",
                "targetSubject": "數學",
                "teacher": "何采珍",
                "targetClasses": ["2年4班", "2年6班", "2年7班"],
                "lockedSlots": [{"day": 4, "period": 2}],
                "sharedEventId": "evt-lc-83-89",
            },
            {
                "id": 89,
                "type": "pullout",
                "name": "學習中心",
                "targetSubject": "語文-國語",
                "teacher": "何采珍",
                "targetClasses": ["5年1班", "5年6班", "5年9班"],
                "lockedSlots": [{"day": 4, "period": 2}],
                "sharedEventId": "evt-lc-83-89",
            },
        ]

        classes_data = [{"name": c, "grade": int(c[0])} for c in classes]
        teachers_data = [{"name": t, "max_periods": 20} for t in teachers]

        apply_special_course_locks(
            model,
            schedule,
            special_courses,
            classes_data,
            teachers_data,
            ai_settings={},
        )

        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), "ID 83/89 multi-subject shared event should be FEASIBLE"

    def test_shared_event_same_class_multi_subject_rejected(self):
        """反例：同一 sharedEventId 內同一班級（5年1班）被指派數學與國語兩種有效科目 -> 拒絕建模並拋出 ValueError。"""
        model = cp_model.CpModel()
        schedule = {}
        classes = ["5年1班"]
        subjects = ["數學", "語文-國語"]
        teachers = ["何采珍"]

        for c in classes:
            for p in range(35):
                for t in teachers:
                    for s in subjects:
                        var = model.NewBoolVar(f"sch_{c}_{p}_{t}_{s}")
                        schedule[(c, p, t, s)] = var

        special_courses = [
            {
                "id": 83,
                "type": "pullout",
                "name": "學習中心",
                "targetSubject": "數學",
                "teacher": "何采珍",
                "targetClasses": ["5年1班"],
                "lockedSlots": [{"day": 4, "period": 2}],
                "sharedEventId": "evt-invalid-same-class",
            },
            {
                "id": 89,
                "type": "pullout",
                "name": "學習中心",
                "targetSubject": "語文-國語",
                "teacher": "何采珍",
                "targetClasses": ["5年1班"],
                "lockedSlots": [{"day": 4, "period": 2}],
                "sharedEventId": "evt-invalid-same-class",
            },
        ]

        classes_data = [{"name": "5年1班", "grade": 5}]
        teachers_data = [{"name": "何采珍", "max_periods": 20}]

        with pytest.raises(ValueError) as exc_info:
            apply_special_course_locks(
                model,
                schedule,
                special_courses,
                classes_data,
                teachers_data,
                ai_settings={},
            )
        assert "INVALID_SHARED_EVENT_SAME_CLASS_MULTI_SUBJECT" in str(exc_info.value)
        assert "5年1班" in str(exc_info.value)

    def test_entries_match_same_resolved_special_course_event_multi_subject(self):
        """驗證 ID 83/89 跨班群不同科目的條目比對能正確通過，且若有班級科目不符則拒絕。"""
        resolved_sc = [
            {
                "name": "學習中心",
                "teacher": "何采珍",
                "targetSubject": "數學",
                "targetClasses": ["2年4班", "2年6班"],
                "lockedSlots": [{"day": 4, "period": 2}],
                "sharedEventId": "evt-lc-83-89",
                "_effective_subjects": {"2年4班": "數學", "2年6班": "數學"},
            },
            {
                "name": "學習中心",
                "teacher": "何采珍",
                "targetSubject": "語文-國語",
                "targetClasses": ["5年1班", "5年6班"],
                "lockedSlots": [{"day": 4, "period": 2}],
                "sharedEventId": "evt-lc-83-89",
                "_effective_subjects": {"5年1班": "導師區塊", "5年6班": "導師區塊"},
            },
        ]

        # 2年級為數學，5年級為導師區塊
        valid_entries = [
            {"className": "2年4班", "subject": "數學", "teacherName": "何采珍"},
            {"className": "2年6班", "subject": "數學", "teacherName": "何采珍"},
            {"className": "5年1班", "subject": "導師區塊", "teacherName": "何采珍"},
            {"className": "5年6班", "subject": "導師區塊", "teacherName": "何采珍"},
        ]
        assert _entries_match_same_resolved_special_course_event(
            valid_entries, "何采珍", day=4, period=2, resolved_special_courses=resolved_sc
        ) is True

        # 若 2年4班被錯誤排成英語，應拒絕 (False)
        invalid_entries = [
            {"className": "2年4班", "subject": "語文-英語", "teacherName": "何采珍"},
            {"className": "2年6班", "subject": "數學", "teacherName": "何采珍"},
        ]
        assert _entries_match_same_resolved_special_course_event(
            invalid_entries, "何采珍", day=4, period=2, resolved_special_courses=resolved_sc
        ) is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])