import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ortools.sat.python import cp_model

from constraints.class_rules import (
    apply_afternoon_prohibition,
    get_effective_class_period_capacity,
    apply_special_classroom_capacity,
    apply_week_specific_art_capacity_entries,
)
from constraints.utils import grade_needs_special_room
from constraints.teacher_rules import apply_alternating_teacher_anti_collision, apply_anti_collision
from preprocessor import preprocess_classes
from repair_agent import RepairAgent
import solver as solver_module


def _solve_max(model, vars_to_maximize):
    model.Maximize(sum(vars_to_maximize))
    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    return status, solver


class SchedulerRegressionTests(unittest.TestCase):
    def test_grade_needs_special_room_normalizes_config_keys_before_lookup(self):
        self.assertTrue(
            grade_needs_special_room(
                "自然科學",
                3,
                {"自然科學": [3, 4, 5, 6]},
            )
        )

    def test_grade_needs_special_room_falls_back_for_info_when_unconfigured(self):
        self.assertTrue(grade_needs_special_room("資訊", 3, {}))

    def test_repair_agent_room_capacity_normalizes_room_subject_keys(self):
        agent = RepairAgent.__new__(RepairAgent)
        agent.classrooms = [
            {"subject": "資訊"},
            {"subject": "科技-資訊"},
            {"subject": "電腦"},
        ]

        capacity = agent._build_room_capacity()

        self.assertEqual(capacity["科技-资讯"], 3)

    def test_preprocess_removes_low_grade_invalid_subjects_and_uses_homeroom_teacher(self):
        classes = [
            {
                "name": "1年1班",
                "grade": 1,
                "homeroom_teacher": "正確導師",
                "course_requirements": [
                    {"subject": "語文-國語", "periods": 6, "teacher_name": "錯誤導師", "defaultTeacher": "homeroom"},
                    {"subject": "數學", "periods": 4, "teacher_name": "錯誤導師", "defaultTeacher": "homeroom"},
                    {"subject": "自然科學", "periods": 2, "teacher_name": "自然老師", "defaultTeacher": "subject"},
                    {"subject": "音樂_固定", "periods": 1, "teacher_name": "音樂老師", "defaultTeacher": "subject"},
                    {"subject": "美勞_固定", "periods": 1, "teacher_name": "美勞老師", "defaultTeacher": "subject"},
                    {"subject": "音樂美勞_交替", "periods": 1, "teacher_name": "音樂老師", "teacher_art": "美勞老師", "defaultTeacher": "subject", "is_alternating": True},
                    {"subject": "生活", "periods": 6, "teacher_name": "正確導師", "defaultTeacher": "homeroom"},
                ],
            }
        ]

        normalized, metadata = preprocess_classes(classes, {"homeroomBlockizationEnabled": True})
        reqs = normalized[0]["course_requirements"]
        subjects = [req["subject"] for req in reqs]

        self.assertNotIn("自然科學", subjects)
        self.assertNotIn("音樂_固定", subjects)
        self.assertNotIn("美勞_固定", subjects)
        self.assertNotIn("音樂美勞_交替", subjects)
        self.assertIn("導師區塊", subjects)

        homeroom_block = next(req for req in reqs if req["subject"] == "導師區塊")
        self.assertEqual(homeroom_block["teacher_name"], "正確導師")
        self.assertEqual(metadata["removed_requirements"][0]["subject"], "自然科學")

    def test_preprocess_music_art_pair_group_id_is_shared_across_grades(self):
        classes = [
            {
                "name": "3年8班",
                "grade": 3,
                "course_requirements": [
                    {"subject": "音樂", "periods": 1.5, "teacher_name": "吳品璇", "defaultTeacher": "subject"},
                    {"subject": "美勞", "periods": 1.5, "teacher_name": "吳筱南", "defaultTeacher": "subject"},
                ],
            },
            {
                "name": "5年4班",
                "grade": 5,
                "course_requirements": [
                    {"subject": "音樂", "periods": 1.5, "teacher_name": "吳品璇", "defaultTeacher": "subject"},
                    {"subject": "美勞", "periods": 1.5, "teacher_name": "吳筱南", "defaultTeacher": "subject"},
                ],
            },
        ]

        normalized, _metadata = preprocess_classes(classes, {"homeroomBlockizationEnabled": True})
        pair_ids = []
        for cls in normalized:
            alt_req = next(req for req in cls["course_requirements"] if req["subject"] == "音樂美勞_交替")
            pair_ids.append(alt_req["pair_group_id"])

        self.assertEqual(pair_ids[0], pair_ids[1])

    def test_preprocess_generic_alternating_pair_group_id_remains_grade_scoped(self):
        classes = [
            {
                "name": "3年1班",
                "grade": 3,
                "course_requirements": [
                    {"subject": "健/s", "periods": 1, "teacher_name": "王老師", "defaultTeacher": "subject"},
                ],
            },
            {
                "name": "5年1班",
                "grade": 5,
                "course_requirements": [
                    {"subject": "健/s", "periods": 1, "teacher_name": "王老師", "defaultTeacher": "subject"},
                ],
            },
        ]

        normalized, _metadata = preprocess_classes(classes, {"homeroomBlockizationEnabled": True})
        pair_ids = []
        for cls in normalized:
            alt_req = next(req for req in cls["course_requirements"] if req["subject"] == "健/s")
            pair_ids.append(alt_req["pair_group_id"])

        self.assertNotEqual(pair_ids[0], pair_ids[1])

    def test_apply_afternoon_prohibition_exempts_arts_class_when_feature_enabled(self):
        model = cp_model.CpModel()
        arts_slot = model.NewBoolVar("arts_slot")
        schedule = {
            ("3年5班", 18, "藝才老師", "舞蹈"): arts_slot,
        }

        apply_afternoon_prohibition(
            model,
            [{"name": "3年5班", "grade": 3, "isArtsClass": True}],
            schedule,
            ai_settings={"artsClassEnabled": True},
        )

        status, solver = _solve_max(model, [arts_slot])

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(arts_slot), 1)
        self.assertEqual(
            get_effective_class_period_capacity(3, is_arts_class=True, ai_settings={"artsClassEnabled": True}),
            35,
        )

    def test_apply_afternoon_prohibition_keeps_general_grade34_afternoon_ban(self):
        model = cp_model.CpModel()
        general_slot = model.NewBoolVar("general_slot")
        schedule = {
            ("3年6班", 18, "一般老師", "社會"): general_slot,
        }

        apply_afternoon_prohibition(
            model,
            [{"name": "3年6班", "grade": 3, "isArtsClass": False}],
            schedule,
            ai_settings={"artsClassEnabled": True},
        )

        status, solver = _solve_max(model, [general_slot])

        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(general_slot), 0)
        self.assertEqual(
            get_effective_class_period_capacity(3, is_arts_class=False, ai_settings={"artsClassEnabled": True}),
            29,
        )

    def test_preprocess_homeroom_blockization_trace_flags_preexisting_block_overlap(self):
        classes = [
            {
                "name": "3年5班",
                "grade": 3,
                "homeroom_teacher": "謝雅涵",
                "course_requirements": [
                    {"subject": "導師區塊", "periods": 1, "teacher_name": "謝雅涵", "defaultTeacher": "homeroom"},
                    {"subject": "語文-國語", "periods": 5, "teacher_name": "謝雅涵", "defaultTeacher": "homeroom"},
                    {"subject": "數學", "periods": 4, "teacher_name": "謝雅涵", "defaultTeacher": "homeroom"},
                    {"subject": "社會", "periods": 3, "teacher_name": "謝雅涵", "defaultTeacher": "homeroom"},
                    {"subject": "健康", "periods": 1, "teacher_name": "謝雅涵", "defaultTeacher": "homeroom"},
                    {"subject": "美勞", "periods": 1, "teacher_name": "謝雅涵", "defaultTeacher": "homeroom"},
                    {"subject": "綜合活動", "periods": 1, "teacher_name": "謝雅涵", "defaultTeacher": "homeroom"},
                ],
            }
        ]

        normalized, metadata = preprocess_classes(classes, {"homeroomBlockizationEnabled": True})

        homeroom_block = next(
            req
            for req in normalized[0]["course_requirements"]
            if req["subject"] == "導師區塊"
        )
        trace = metadata["homeroomBlockizationTrace"][0]

        self.assertEqual(homeroom_block["periods"], 16)
        self.assertEqual(trace["mergedPeriods"], 15)
        self.assertEqual(trace["existingHomeroomBlockPeriods"], 1)
        self.assertEqual(trace["finalHomeroomBlockPeriods"], 16)
        self.assertEqual(trace["note"], "payload_already_contains_homeroom_block")

    def test_alternating_teacher_diagnostic_summary_is_info_only_for_total_load(self):
        classes = []
        for index in range(13):
            classes.append({
                "name": f"3年{index + 1}班",
                "grade": 3,
                "course_requirements": [
                    {
                        "subject": "音樂美勞_交替",
                        "periods": 1,
                        "teacher_name": "吳品璇",
                        "teacher_music": "吳品璇",
                        "teacher_art": "吳筱南",
                    }
                ],
            })

        summaries = solver_module._summarize_alternating_teacher_loads(classes)

        self.assertEqual(len(summaries), 2)
        self.assertTrue(all(item["level"] == "INFO" for item in summaries))
        self.assertTrue(all("不代表同一時段衝突" in item["message"] for item in summaries))
        self.assertTrue(all("最多只能上 2 個交替班級" not in item["message"] for item in summaries))

    def test_swimming_resource_summary_is_info_only_for_total_pressure(self):
        classes = [{"name": f"{grade}年1班"} for grade in (4, 5, 6, 6)]

        summary = solver_module._summarize_swimming_resource_pressure(classes)

        self.assertEqual(summary["level"], "INFO")
        self.assertIn("總量壓力提示", summary["message"])

    def test_apply_anti_collision_uses_schedule_teachers_even_when_teacher_names_list_is_empty(self):
        model = cp_model.CpModel()
        v1 = model.NewBoolVar("c1_teacher")
        v2 = model.NewBoolVar("c2_teacher")
        schedule = {
            ("1年1班", 0, "林秀梅", "語文-國語"): v1,
            ("2年4班", 0, "林秀梅", "語文-國語"): v2,
        }

        apply_anti_collision(
            model,
            schedule,
            ["1年1班", "2年4班"],
            [],
            [
                {"name": "1年1班", "grade": 1},
                {"name": "2年4班", "grade": 2},
            ],
            {"artsClassEnabled": False},
        )

        status, solver = _solve_max(model, [v1, v2])
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(v1) + solver.Value(v2), 1)

    def test_apply_anti_collision_prevents_same_class_same_period_music_and_art_overlap(self):
        model = cp_model.CpModel()
        music = model.NewBoolVar("same_slot_music")
        art = model.NewBoolVar("same_slot_art")
        schedule = {
            ("3年2班", 0, "音樂老師", "音樂_固定"): music,
            ("3年2班", 0, "美勞老師", "美勞_固定"): art,
        }

        apply_anti_collision(
            model,
            schedule,
            ["3年2班"],
            ["音樂老師", "美勞老師"],
            [{"name": "3年2班", "grade": 3}],
            {"artsClassEnabled": False},
        )

        status, solver = _solve_max(model, [music, art])
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(music) + solver.Value(art), 1)

    def test_virtual_teacher_is_only_exempt_for_arts_classes(self):
        model = cp_model.CpModel()
        v1 = model.NewBoolVar("arts_class")
        v2 = model.NewBoolVar("general_class")
        schedule = {
            ("藝才班", 0, "虛擬外聘教師", "舞蹈"): v1,
            ("一般班", 0, "虛擬外聘教師", "舞蹈"): v2,
        }

        apply_anti_collision(
            model,
            schedule,
            ["藝才班", "一般班"],
            ["虛擬外聘教師"],
            [
                {"name": "藝才班", "grade": 3, "isArtsClass": True},
                {"name": "一般班", "grade": 3, "isArtsClass": False},
            ],
            {"artsClassEnabled": True},
        )

        status, solver = _solve_max(model, [v1, v2])
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(v1) + solver.Value(v2), 1)

    def test_alternating_partner_teacher_is_week_specific_collision_protected(self):
        model = cp_model.CpModel()
        c1_alt = model.NewBoolVar("c1_alt")
        c2_alt = model.NewBoolVar("c2_alt")
        c1_music_odd = model.NewBoolVar("c1_music_odd")
        c2_music_odd = model.NewBoolVar("c2_music_odd")
        schedule = {
            ("3年1班", 0, "音樂老師A", "音樂美勞_交替"): c1_alt,
            ("3年2班", 0, "音樂老師B", "音樂美勞_交替"): c2_alt,
        }

        apply_alternating_teacher_anti_collision(
            model,
            schedule,
            {
                "3年1班": ("音樂老師A", "美勞老師"),
                "3年2班": ("音樂老師B", "美勞老師"),
            },
            {
                ("3年1班", "音樂老師A"): c1_music_odd,
                ("3年1班", "美勞老師"): c1_music_odd,
                ("3年2班", "音樂老師B"): c2_music_odd,
                ("3年2班", "美勞老師"): c2_music_odd,
            },
        )

        model.Add(c1_alt == 1)
        model.Add(c2_alt == 1)
        model.Add(c1_music_odd == 0)
        model.Add(c2_music_odd == 0)

        solver = cp_model.CpSolver()
        self.assertEqual(solver.Solve(model), cp_model.INFEASIBLE)

    def test_special_classroom_capacity_is_hard_constraint(self):
        model = cp_model.CpModel()
        v1 = model.NewBoolVar("c1_eng")
        v2 = model.NewBoolVar("c2_eng")
        schedule = {
            ("3年1班", 0, "英語老師A", "語文-英語"): v1,
            ("3年2班", 0, "英語老師B", "語文-英語"): v2,
        }

        apply_special_classroom_capacity(
            model,
            [
                {"name": "3年1班", "grade": 3},
                {"name": "3年2班", "grade": 3},
            ],
            schedule,
            [{"id": "eng-a", "name": "英語教室A", "subject": "英語"}],
            school_info={
                "subjectClassroomGrades": {"語文-英語": [3, 4, 5, 6]},
                "classroomLimits": {"語文-英語": 1},
            },
        )

        status, solver = _solve_max(model, [v1, v2])
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(v1) + solver.Value(v2), 1)

    def test_special_classroom_capacity_can_relax_to_soft_when_requested(self):
        model = cp_model.CpModel()
        v1 = model.NewBoolVar("c1_eng_soft")
        v2 = model.NewBoolVar("c2_eng_soft")
        penalty_vars = []
        schedule = {
            ("3年1班", 0, "英語老師A", "語文-英語"): v1,
            ("3年2班", 0, "英語老師B", "語文-英語"): v2,
        }

        apply_special_classroom_capacity(
            model,
            [
                {"name": "3年1班", "grade": 3},
                {"name": "3年2班", "grade": 3},
            ],
            schedule,
            [{"id": "eng-a", "name": "英語教室A", "subject": "英語"}],
            school_info={
                "subjectClassroomGrades": {"語文-英語": [3, 4, 5, 6]},
                "classroomLimits": {"語文-英語": 1},
            },
            relax_to_soft=True,
            penalty_vars=penalty_vars,
        )

        status, solver = _solve_max(model, [v1, v2])
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(v1) + solver.Value(v2), 2)
        self.assertEqual(len(penalty_vars), 1)

    def test_room_overloads_do_not_invalidate_soft_fallback_results(self):
        validation_report = {
            "teacher_conflicts": [],
            "room_overloads": [{"subject": "資訊", "day": 1, "period": 1, "used": 3, "capacity": 2}],
            "grade_subject_issues": [],
        }

        self.assertFalse(
            solver_module._has_hard_validation_errors(validation_report, allow_room_overloads=True)
        )
        self.assertTrue(
            solver_module._has_hard_validation_errors(validation_report, allow_room_overloads=False)
        )

    def test_science_capacity_counts_each_active_science_class(self):
        model = cp_model.CpModel()
        v1 = model.NewBoolVar("c1_science")
        v2 = model.NewBoolVar("c2_science")
        schedule = {
            ("3年1班", 0, "自然老師A", "自然科學"): v1,
            ("3年2班", 0, "自然老師B", "自然科學"): v2,
        }

        apply_special_classroom_capacity(
            model,
            [
                {"name": "3年1班", "grade": 3},
                {"name": "3年2班", "grade": 3},
            ],
            schedule,
            [{"id": "science-a", "name": "自然教室A", "subject": "自然科學"}],
            science_consec_map={},
            school_info={
                "subjectClassroomGrades": {"自然科學": [3, 4, 5, 6]},
                "classroomLimits": {"自然科學": 1},
            },
        )

        status, solver = _solve_max(model, [v1, v2])
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(v1) + solver.Value(v2), 1)

    def test_general_subjects_without_special_rooms_do_not_block_capacity(self):
        model = cp_model.CpModel()
        homeroom = model.NewBoolVar("homeroom_block")
        life = model.NewBoolVar("life")
        health = model.NewBoolVar("health")
        native = model.NewBoolVar("native")
        science = model.NewBoolVar("science")
        schedule = {
            ("3年1班", 0, "導師A", "導師區塊"): homeroom,
            ("1年1班", 0, "導師B", "生活"): life,
            ("3年2班", 0, "導師C", "健康"): health,
            ("3年3班", 0, "本土語老師", "語文-本土語"): native,
            ("3年4班", 0, "自然老師", "自然科學"): science,
        }

        apply_special_classroom_capacity(
            model,
            [
                {"name": "3年1班", "grade": 3},
                {"name": "1年1班", "grade": 1},
                {"name": "3年2班", "grade": 3},
                {"name": "3年3班", "grade": 3},
                {"name": "3年4班", "grade": 3},
            ],
            schedule,
            [{"id": "science-a", "name": "自然教室A", "subject": "自然科學"}],
            school_info={
                "subjectClassroomGrades": {"自然科學": [3, 4, 5, 6]},
                "classroomLimits": {"自然科學": 1},
            },
        )

        status, solver = _solve_max(model, [homeroom, life, health, native, science])
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(
            sum(solver.Value(var) for var in [homeroom, life, health, native, science]),
            5,
        )

    def test_native_language_alias_does_not_create_zero_capacity_room_requirement(self):
        model = cp_model.CpModel()
        native_a = model.NewBoolVar("native_a")
        native_b = model.NewBoolVar("native_b")
        schedule = {
            ("3年1班", 0, "本土語老師A", "語文-本土語"): native_a,
            ("3年2班", 0, "本土語老師B", "本土語"): native_b,
        }

        apply_special_classroom_capacity(
            model,
            [
                {"name": "3年1班", "grade": 3},
                {"name": "3年2班", "grade": 3},
            ],
            schedule,
            [],
            school_info={"subjectClassroomGrades": {}, "classroomLimits": {}},
        )

        status, solver = _solve_max(model, [native_a, native_b])
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(native_a) + solver.Value(native_b), 2)

    def test_standard_domain_settings_drive_backend_grade_filter(self):
        classes = [
            {
                "name": "1年1班",
                "grade": 1,
                "course_requirements": [
                    {"subject": "語文-英語", "periods": 2, "teacher_name": "英語老師", "defaultTeacher": "subject"},
                    {"subject": "自然科學", "periods": 2, "teacher_name": "自然老師", "defaultTeacher": "subject"},
                ],
            }
        ]
        standard_domain_settings = [
            {"name": "語文-英語", "periods": {"1": 2, "2": 2, "3": 3}},
            {"name": "自然科學", "periods": {"1": 0, "2": 0, "3": 3}},
        ]

        normalized, metadata = preprocess_classes(
            classes,
            {"homeroomBlockizationEnabled": False},
            standard_domain_settings=standard_domain_settings,
        )

        subjects = [req["subject"] for req in normalized[0]["course_requirements"]]
        self.assertIn("語文-英語", subjects)
        self.assertNotIn("自然科學", subjects)
        self.assertTrue(any(item["subject"] == "自然科學" for item in metadata.get("removed_requirements", [])))

    def test_preprocess_merges_partial_subject_grade_rules_with_domain_and_defaults(self):
        classes = [
            {
                "name": "1年1班",
                "grade": 1,
                "course_requirements": [
                    {"subject": "語文-英語", "periods": 2, "teacher_name": "英語老師", "defaultTeacher": "subject"},
                    {"subject": "自然科學", "periods": 2, "teacher_name": "自然老師", "defaultTeacher": "subject"},
                    {"subject": "音樂", "periods": 1, "teacher_name": "音樂老師", "defaultTeacher": "subject"},
                ],
            }
        ]
        standard_domain_settings = [
            {"name": "語文-英語", "periods": {"1": 2, "2": 2, "3": 3}},
            {"name": "自然科學", "periods": {"1": 0, "2": 0, "3": 3}},
        ]

        normalized, metadata = preprocess_classes(
            classes,
            {"homeroomBlockizationEnabled": False},
            standard_domain_settings=standard_domain_settings,
            subject_grade_rules={"語文-英語": [1, 2, 3]},
        )

        subjects = [req["subject"] for req in normalized[0]["course_requirements"]]
        self.assertIn("語文-英語", subjects)
        self.assertNotIn("自然科學", subjects)
        self.assertNotIn("音樂", subjects)
        removed = {item["subject"] for item in metadata.get("removed_requirements", [])}
        self.assertIn("自然科學", removed)
        self.assertIn("音樂", removed)

    def test_preprocess_normalizes_subject_grade_rule_keys_before_lookup(self):
        classes = [
            {
                "name": "1年1班",
                "grade": 1,
                "course_requirements": [
                    {"subject": "資訊", "periods": 1, "teacher_name": "資訊老師", "defaultTeacher": "subject"},
                ],
            }
        ]

        normalized, metadata = preprocess_classes(
            classes,
            {"homeroomBlockizationEnabled": False},
            subject_grade_rules={"電腦": [3, 4, 5, 6]},
        )

        self.assertEqual(normalized[0]["course_requirements"], [])
        self.assertEqual(metadata["removed_requirements"][0]["subject"], "資訊")

    def test_validate_schedule_result_merges_partial_grade_rules_with_standard_domain_settings(self):
        validation_report = solver_module._validate_schedule_result(
            [
                {
                    "className": "1年1班",
                    "teacherName": "英語老師",
                    "subject": "語文-英語",
                    "day": 1,
                    "period": 1,
                }
            ],
            [{"name": "1年1班", "grade": 1}],
            {"subjectGradeRules": {"自然科學": [3, 4, 5, 6]}},
            [],
            {},
            standard_domain_settings=[
                {"name": "語文-英語", "periods": {"1": 0, "2": 0, "3": 3, "4": 3}},
            ],
        )

        self.assertEqual(len(validation_report["grade_subject_issues"]), 1)
        self.assertEqual(validation_report["grade_subject_issues"][0]["subject"], "語文-英語")

    def test_validate_schedule_result_reports_same_class_same_period_conflicts(self):
        validation_report = solver_module._validate_schedule_result(
            [
                {
                    "className": "3年2班",
                    "teacherName": "音樂老師",
                    "subject": "音樂_固定",
                    "day": 1,
                    "period": 1,
                },
                {
                    "className": "3年2班",
                    "teacherName": "美勞老師",
                    "subject": "美勞_固定",
                    "day": 1,
                    "period": 1,
                },
            ],
            [{"name": "3年2班", "grade": 3}],
            {},
            [],
            {},
        )

        self.assertEqual(len(validation_report["class_slot_conflicts"]), 2)
        self.assertEqual(
            {item["week"] for item in validation_report["class_slot_conflicts"]},
            {"odd", "even"},
        )
        self.assertTrue(
            all(item["className"] == "3年2班" for item in validation_report["class_slot_conflicts"])
        )

    def test_validate_schedule_result_expands_both_week_entries_against_odd_even_conflicts(self):
        validation_report = solver_module._validate_schedule_result(
            [
                {
                    "className": "5年4班",
                    "teacherName": "吳筱南",
                    "subject": "美勞_固定",
                    "day": 1,
                    "period": 2,
                },
                {
                    "className": "3年8班",
                    "teacherName": "吳筱南",
                    "subject": "美勞",
                    "day": 1,
                    "period": 2,
                    "week": "odd",
                },
            ],
            [
                {"name": "5年4班", "grade": 5},
                {"name": "3年8班", "grade": 3},
            ],
            {
                "subjectClassroomGrades": {"美勞": [3, 4, 5, 6]},
                "classroomLimits": {"美勞": 1},
            },
            [{"name": "美勞教室A", "subject": "美勞"}],
            {},
        )

        self.assertEqual(len(validation_report["teacher_conflicts"]), 1)
        self.assertEqual(validation_report["teacher_conflicts"][0]["teacherName"], "吳筱南")
        self.assertEqual(validation_report["teacher_conflicts"][0]["week"], "odd")
        self.assertEqual(len(validation_report["room_overloads"]), 1)
        self.assertEqual(validation_report["room_overloads"][0]["subject"], "美勞")
        self.assertEqual(validation_report["room_overloads"][0]["week"], "odd")
        self.assertTrue(
            solver_module._has_hard_validation_errors(
                validation_report,
                allow_room_overloads=False,
            )
        )

    def test_validate_art_alternating_consecutive_accepts_week_specific_entries(self):
        classes_data = [
            {
                "name": "3年1班",
                "course_requirements": [
                    {"subject": "美勞_固定", "periods": 1},
                    {"subject": "音樂美勞_交替", "periods": 1, "is_alternating": True},
                ],
            }
        ]
        schedule_entries = [
            {
                "className": "3年1班",
                "teacherName": "美勞老師",
                "subject": "美勞_固定",
                "day": 2,
                "period": 3,
            },
            {
                "className": "3年1班",
                "teacherName": "音樂老師",
                "subject": "音樂",
                "day": 2,
                "period": 4,
                "week": "odd",
                "pairGroupId": "g1",
                "pairDirection": "music-first",
            },
            {
                "className": "3年1班",
                "teacherName": "美勞老師",
                "subject": "美勞",
                "day": 2,
                "period": 4,
                "week": "even",
                "pairGroupId": "g1",
                "pairDirection": "music-first",
            },
        ]

        self.assertTrue(
            solver_module._validate_art_alternating_consecutive(schedule_entries, classes_data)
        )

    def test_local_music_art_optimizer_flips_direction_and_slot_to_form_cross_grade_pair(self):
        classes = [
            {
                "name": "3年8班",
                "grade": 3,
                "course_requirements": [
                    {"subject": "音樂", "periods": 1.5, "teacher_name": "吳品璇", "defaultTeacher": "subject"},
                    {"subject": "美勞", "periods": 1.5, "teacher_name": "吳筱南", "defaultTeacher": "subject"},
                ],
            },
            {
                "name": "5年4班",
                "grade": 5,
                "course_requirements": [
                    {"subject": "音樂", "periods": 1.5, "teacher_name": "吳品璇", "defaultTeacher": "subject"},
                    {"subject": "美勞", "periods": 1.5, "teacher_name": "吳筱南", "defaultTeacher": "subject"},
                ],
            },
        ]
        normalized, _metadata = preprocess_classes(classes, {"homeroomBlockizationEnabled": True})
        pair_group_id = next(
            req["pair_group_id"]
            for req in normalized[0]["course_requirements"]
            if req["subject"] == "音樂美勞_交替"
        )
        schedule_entries = [
            {
                "day": 1,
                "period": 1,
                "className": "3年8班",
                "teacherName": "吳筱南",
                "subject": "美勞_固定",
                "classroomName": "美勞教室A",
            },
            {
                "day": 1,
                "period": 2,
                "className": "3年8班",
                "teacherName": "吳品璇",
                "subject": "音樂",
                "classroomName": "音樂教室A",
                "week": "odd",
                "pairGroupId": pair_group_id,
                "pairDirection": "music-first",
                "pairRole": "A",
            },
            {
                "day": 1,
                "period": 2,
                "className": "3年8班",
                "teacherName": "吳筱南",
                "subject": "美勞",
                "classroomName": "音樂教室A",
                "week": "even",
                "pairGroupId": pair_group_id,
                "pairDirection": "music-first",
                "pairRole": "A",
            },
            {
                "day": 1,
                "period": 2,
                "className": "5年4班",
                "teacherName": "吳筱南",
                "subject": "美勞_固定",
                "classroomName": "美勞教室B",
            },
            {
                "day": 1,
                "period": 3,
                "className": "5年4班",
                "teacherName": "吳品璇",
                "subject": "音樂",
                "classroomName": "音樂教室B",
                "week": "odd",
                "pairGroupId": pair_group_id,
                "pairDirection": "music-first",
                "pairRole": "A",
            },
            {
                "day": 1,
                "period": 3,
                "className": "5年4班",
                "teacherName": "吳筱南",
                "subject": "美勞",
                "classroomName": "音樂教室B",
                "week": "even",
                "pairGroupId": pair_group_id,
                "pairDirection": "music-first",
                "pairRole": "A",
            },
        ]

        optimized, _skipped = solver_module._optimize_music_art_alternating_locally(
            schedule_entries,
            normalized,
            [
                {"subject": "音樂", "name": "音樂教室A"},
                {"subject": "音樂", "name": "音樂教室B"},
                {"subject": "美勞", "name": "美勞教室A"},
                {"subject": "美勞", "name": "美勞教室B"},
            ],
            {
                "subjectClassroomGrades": {
                    "音樂": [3, 4, 5, 6],
                    "美勞": [3, 4, 5, 6],
                },
                "classroomLimits": {
                    "音樂": 2,
                    "美勞": 2,
                },
            },
        )

        class_54_entries = [entry for entry in optimized if entry["className"] == "5年4班"]
        art_fixed = next(entry for entry in class_54_entries if entry["subject"] == "美勞_固定")
        odd_entry = next(entry for entry in class_54_entries if entry.get("week") == "odd")
        even_entry = next(entry for entry in class_54_entries if entry.get("week") == "even")
        class_38_odd = next(
            entry
            for entry in optimized
            if entry["className"] == "3年8班" and entry.get("week") == "odd"
        )

        self.assertEqual((art_fixed["day"], art_fixed["period"]), (1, 3))
        self.assertEqual((odd_entry["day"], odd_entry["period"]), (1, 2))
        self.assertEqual((even_entry["day"], even_entry["period"]), (1, 2))
        self.assertEqual(odd_entry["subject"], "美勞")
        self.assertEqual(odd_entry["teacherName"], "吳筱南")
        self.assertEqual(even_entry["subject"], "音樂")
        self.assertEqual(even_entry["teacherName"], "吳品璇")
        self.assertEqual(odd_entry["pairDirection"], "art-first")
        self.assertEqual(even_entry["pairDirection"], "art-first")
        self.assertEqual(odd_entry["pairPartnerClass"], "3年8班")
        self.assertEqual(class_38_odd["pairPartnerClass"], "5年4班")

    def test_week_specific_capacity_report_uses_final_week_specific_entries_after_local_optimization(self):
        classes = [
            {
                "name": "3年8班",
                "grade": 3,
                "course_requirements": [
                    {"subject": "音樂", "periods": 1.5, "teacher_name": "吳品璇", "defaultTeacher": "subject"},
                    {"subject": "美勞", "periods": 1.5, "teacher_name": "吳筱南", "defaultTeacher": "subject"},
                ],
            },
            {
                "name": "5年4班",
                "grade": 5,
                "course_requirements": [
                    {"subject": "音樂", "periods": 1.5, "teacher_name": "吳品璇", "defaultTeacher": "subject"},
                    {"subject": "美勞", "periods": 1.5, "teacher_name": "吳筱南", "defaultTeacher": "subject"},
                ],
            },
        ]
        normalized, _metadata = preprocess_classes(classes, {"homeroomBlockizationEnabled": True})
        pair_group_id = next(
            req["pair_group_id"]
            for req in normalized[0]["course_requirements"]
            if req["subject"] == "音樂美勞_交替"
        )
        schedule_entries = [
            {"day": 1, "period": 1, "className": "3年8班", "teacherName": "吳筱南", "subject": "美勞_固定"},
            {
                "day": 1,
                "period": 2,
                "className": "3年8班",
                "teacherName": "吳品璇",
                "subject": "音樂",
                "week": "odd",
                "pairGroupId": pair_group_id,
            },
            {
                "day": 1,
                "period": 2,
                "className": "3年8班",
                "teacherName": "吳筱南",
                "subject": "美勞",
                "week": "even",
                "pairGroupId": pair_group_id,
            },
            {"day": 1, "period": 2, "className": "5年4班", "teacherName": "吳筱南", "subject": "美勞_固定"},
            {
                "day": 1,
                "period": 3,
                "className": "5年4班",
                "teacherName": "吳品璇",
                "subject": "音樂",
                "week": "odd",
                "pairGroupId": pair_group_id,
            },
            {
                "day": 1,
                "period": 3,
                "className": "5年4班",
                "teacherName": "吳筱南",
                "subject": "美勞",
                "week": "even",
                "pairGroupId": pair_group_id,
            },
        ]

        optimized, _skipped = solver_module._optimize_music_art_alternating_locally(
            schedule_entries,
            normalized,
            [
                {"subject": "音樂", "name": "音樂教室A"},
                {"subject": "美勞", "name": "美勞教室A"},
            ],
            {
                "subjectClassroomGrades": {
                    "音樂": [3, 4, 5, 6],
                    "美勞": [3, 4, 5, 6],
                },
                "classroomLimits": {
                    "音樂": 1,
                    "美勞": 1,
                },
            },
        )

        ws_check = apply_week_specific_art_capacity_entries(
            optimized,
            normalized,
            [
                {"subject": "音樂", "name": "音樂教室A"},
                {"subject": "美勞", "name": "美勞教室A"},
            ],
            school_info={
                "subjectClassroomGrades": {
                    "音樂": [3, 4, 5, 6],
                    "美勞": [3, 4, 5, 6],
                },
                "classroomLimits": {
                    "音樂": 1,
                    "美勞": 1,
                },
            },
        )

        self.assertEqual(ws_check["ws_overload"], 0)
        self.assertEqual(ws_check["overload_details"], [])

    def test_compute_result_flags_keeps_week_specific_conflict_separate_from_degrade_loop(self):
        flags = solver_module._compute_result_flags(
            used_soft_capacity_fallback=False,
            week_specific_conflict=True,
        )

        self.assertTrue(flags["weekSpecificConflict"])
        self.assertFalse(flags["degraded"])
        self.assertEqual(flags["degradeLevel"], 0)

    def test_repair_agent_preserves_week_specific_alternating_entries_on_export(self):
        agent = RepairAgent.__new__(RepairAgent)
        agent.phase1_result = {
            "jobId": "job-1",
            "status": "FEASIBLE",
            "schedule": [
                {"day": 1, "period": 1, "className": "3年1班", "teacherName": "導師A", "subject": "語文-國語"},
                {
                    "day": 1,
                    "period": 2,
                    "className": "3年1班",
                    "teacherName": "音樂老師",
                    "subject": "音樂",
                    "week": "odd",
                    "pairGroupId": "g1",
                },
                {
                    "day": 1,
                    "period": 2,
                    "className": "3年1班",
                    "teacherName": "美勞老師",
                    "subject": "美勞",
                    "week": "even",
                    "pairGroupId": "g1",
                },
            ],
        }
        agent.class_names = {"3年1班"}
        agent.days = 5
        agent.periods_per_day = 7
        agent.total_periods = 35
        agent.schedule = {}
        agent.week_specific_entries = []
        agent.calculate_penalty = lambda: 0

        agent.build_schedule_grid()

        self.assertEqual(len(agent.week_specific_entries), 2)
        self.assertEqual(agent.schedule[(0, 0, "3年1班")]["subject"], "語文-國語")
        self.assertIsNone(agent.schedule[(0, 1, "3年1班")])

        with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            exported = agent.export_result(tmp_path)
            self.assertEqual(len(exported["schedule"]), 3)
            weeks = sorted(
                entry.get("week")
                for entry in exported["schedule"]
                if entry.get("day") == 1 and entry.get("period") == 2
            )
            self.assertEqual(weeks, ["even", "odd"])
        finally:
            os.unlink(tmp_path)

    def test_repair_agent_freezes_music_art_structure_slots(self):
        agent = RepairAgent.__new__(RepairAgent)
        agent.phase1_result = {
            "jobId": "job-1",
            "status": "FEASIBLE",
            "schedule": [
                {
                    "day": 1,
                    "period": 2,
                    "className": "5年4班",
                    "teacherName": "吳筱南",
                    "subject": "美勞_固定",
                },
                {
                    "day": 1,
                    "period": 3,
                    "className": "5年4班",
                    "teacherName": "國語老師",
                    "subject": "語文-國語",
                },
                {
                    "day": 1,
                    "period": 2,
                    "className": "5年4班",
                    "teacherName": "吳品璇",
                    "subject": "音樂",
                    "week": "odd",
                    "pairGroupId": "g1",
                },
                {
                    "day": 1,
                    "period": 2,
                    "className": "5年4班",
                    "teacherName": "吳筱南",
                    "subject": "美勞",
                    "week": "even",
                    "pairGroupId": "g1",
                },
            ],
        }
        agent.class_names = {"5年4班"}
        agent.days = 5
        agent.periods_per_day = 7
        agent.total_periods = 35
        agent.schedule = {}
        agent.week_specific_entries = []
        agent.teacher_names = {"吳筱南", "吳品璇", "國語老師"}
        agent.grade_forbidden_afternoon = {}
        agent.subject_room_capacity = {}
        agent.subject_type_map = {}

        agent.build_schedule_grid()

        self.assertFalse(agent.try_swap((0, 1, "5年4班"), (0, 2, "5年4班")))


if __name__ == "__main__":
    unittest.main()
