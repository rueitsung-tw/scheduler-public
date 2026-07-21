"""
test_task08_priority_scheduling.py
Verifies repair_03_finish_task08_priority_placeholder_model requirements:
1. No hard-coded PRIORITY_TEACHER_PLACEHOLDER_WEIGHT in phase2_engine.py
2. Preprocessor output has no pre-bound fields (assignedClass/targetClass/className on placeholder)
3. penaltyBreakdown contains priority_teacher_placeholder key
4. penaltyBreakdown contains specialty_room_non_preferred_grade key
5. Placeholder metadata contains candidatePeriods field
6. candidateClasses includes non-preferred-grade classes that have demand
7. Phase2 builds reservation BoolVars linked to schedule vars
"""

import ast
import json
import os
import sys
import unittest

# Ensure project root is on path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)


class TestNoHardcodedPriorityWeight(unittest.TestCase):
    """Verify PRIORITY_TEACHER_PLACEHOLDER_WEIGHT hard-coded constant is removed."""

    def test_no_hardcoded_priority_weight_in_phase2(self):
        phase2_path = os.path.join(PROJECT_ROOT, "phase2_engine.py")
        with open(phase2_path, "r", encoding="utf-8") as f:
            content = f.read()

        # The hard-coded constant name must NOT appear as an assignment
        self.assertNotIn(
            "PRIORITY_TEACHER_PLACEHOLDER_WEIGHT =",
            content,
            "phase2_engine.py still contains hard-coded PRIORITY_TEACHER_PLACEHOLDER_WEIGHT assignment"
        )

    def test_priority_weight_comes_from_policy_adapter(self):
        phase2_path = os.path.join(PROJECT_ROOT, "phase2_engine.py")
        with open(phase2_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn(
            'get_weight("priority_teacher_placeholder")',
            content,
            "phase2_engine.py should resolve priority weight via policy.get_weight()"
        )


class TestPlaceholderMetadataCandidatePeriods(unittest.TestCase):
    """Verify every placeholder dict contains candidatePeriods field."""

    def test_placeholder_metadata_contains_candidate_periods(self):
        from preprocessor import build_priority_teacher_placeholders, normalize_classroom_metadata

        classrooms = [
            {
                "id": "computer-1",
                "name": "電腦教室A",
                "subject": "電腦",
                "primaryTeacher": "電腦老師",
                "allowSharing": True,
                "gradePreferences": [6],
            }
        ]
        classes_data = [
            {
                "name": "4年A班",
                "grade": 4,
                "course_requirements": [
                    {"subject": "電腦", "periods": 2, "teacher_name": "電腦老師", "defaultTeacher": "subject"},
                ],
            },
            {
                "name": "6年A班",
                "grade": 6,
                "course_requirements": [
                    {"subject": "電腦", "periods": 2, "teacher_name": "電腦老師", "defaultTeacher": "subject"},
                ],
            },
        ]

        normalize_classroom_metadata(classrooms)
        placeholders = build_priority_teacher_placeholders(classrooms, classes_data)

        self.assertEqual(len(placeholders), 1)
        ph = placeholders[0]

        # candidatePeriods must exist as a key
        self.assertIn(
            "candidatePeriods",
            ph,
            "Placeholder metadata must contain 'candidatePeriods' field"
        )
        # Default when no period restriction is specified should be None
        self.assertIsNone(
            ph["candidatePeriods"],
            "candidatePeriods default should be None (no period restriction)"
        )


class TestCandidateClassesIncludeNonPreferredDemandClasses(unittest.TestCase):
    """Verify candidateClasses includes classes from non-preferred grades IF they have demand."""

    def test_candidate_classes_include_non_preferred_demand_classes(self):
        from preprocessor import build_priority_teacher_placeholders, normalize_classroom_metadata

        # Room prefers grade 6 only, but both grade 4 and grade 6 have demand for this teacher+subject
        classrooms = [
            {
                "id": "computer-1",
                "name": "電腦教室A",
                "subject": "電腦",
                "primaryTeacher": "電腦老師",
                "allowSharing": True,
                "gradePreferences": [6],  # Only grade 6 is preferred
            }
        ]
        classes_data = [
            {
                "name": "4年A班",
                "grade": 4,
                "course_requirements": [
                    {"subject": "電腦", "periods": 2, "teacher_name": "電腦老師", "defaultTeacher": "subject"},
                ],
            },
            {
                "name": "6年A班",
                "grade": 6,
                "course_requirements": [
                    {"subject": "電腦", "periods": 2, "teacher_name": "電腦老師", "defaultTeacher": "subject"},
                ],
            },
        ]

        normalize_classroom_metadata(classrooms)
        placeholders = build_priority_teacher_placeholders(classrooms, classes_data)

        self.assertEqual(len(placeholders), 1)
        candidate_classes = set(placeholders[0]["candidateClasses"])

        # Both grade 4 and grade 6 must be in candidates because both have demand
        self.assertIn(
            "4年A班",
            candidate_classes,
            "candidateClasses must include grade-4 class that has demand for the priority teacher"
            " — gradePreferences must NOT act as hard eligibility filter"
        )
        self.assertIn(
            "6年A班",
            candidate_classes,
            "candidateClasses must include grade-6 preferred class"
        )


class TestPlaceholderMetadataHasNoPreboundFields(unittest.TestCase):
    """Verify placeholder dicts do not contain pre-bound assignment fields."""

    def test_placeholder_metadata_has_no_prebound_fields(self):
        from preprocessor import build_priority_teacher_placeholders, normalize_classroom_metadata

        classrooms = [
            {
                "id": "computer-1",
                "name": "電腦教室A",
                "subject": "電腦",
                "primaryTeacher": "電腦老師",
                "allowSharing": True,
                "gradePreferences": [6],
            }
        ]
        classes_data = [
            {
                "name": "4年A班",
                "grade": 4,
                "course_requirements": [
                    {"subject": "電腦", "periods": 2, "teacher_name": "電腦老師", "defaultTeacher": "subject"},
                ],
            },
        ]

        normalize_classroom_metadata(classrooms)
        placeholders = build_priority_teacher_placeholders(classrooms, classes_data)

        forbidden_fields = {"assignedClass", "targetClass", "className"}
        for ph in placeholders:
            for field in forbidden_fields:
                self.assertNotIn(
                    field,
                    ph,
                    f"Placeholder must NOT contain pre-bound field '{field}'"
                )


class TestPhase2ReservationVars(unittest.TestCase):
    """Verify phase2 builds reservation BoolVars linked to schedule vars."""

    def test_phase2_builds_reservation_vars_not_only_load_var(self):
        """Source inspection: confirm phase2_engine.py contains the reservation model pattern.

        Checks for:
          - NewBoolVar with 'priority_placeholder' in name
          - 'reservation_var <= ' constraint linking to schedule var
          - Absence of 'incomplete placeholder model' comment
        """
        phase2_path = os.path.join(PROJECT_ROOT, "phase2_engine.py")
        with open(phase2_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Must create reservation BoolVars (not just load vars)
        self.assertIn(
            "NewBoolVar",
            content,
            "phase2_engine.py must use NewBoolVar for reservation variables"
        )

        # Must contain 'priority_placeholder' variable naming pattern
        self.assertIn(
            "priority_placeholder_",
            content,
            "phase2_engine.py must name reservation vars with 'priority_placeholder_' prefix"
        )

        # Must link reservation var to schedule var: reservation_var <= schedule_var
        has_le_constraint = False
        lines = content.split("\n")
        for i, line in enumerate(lines):
            if "reservation_var <=" in line or "reservation_var<= " in line.replace(" ", ""):
                has_le_constraint = True
                break

        self.assertTrue(
            has_le_constraint,
            "phase2_engine.py must contain 'reservation_var <= schedule_var' constraint "
            "(reservation linked to actual schedule variable)"
        )

        # Must NOT contain stale "incomplete placeholder model" comment
        self.assertNotIn(
            "incomplete placeholder model",
            content.lower(),
            "phase2_engine.py should not contain 'incomplete placeholder model' comments after repair_03"
        )

        # Must NOT contain "out of scope" in the placeholder section context
        tree = ast.parse(content)
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and "placeholder" in node.name.lower():
                func_source = ast.get_source_segment(content, node)
                if func_source:
                    self.assertNotIn(
                        "out of scope",
                        func_source.lower(),
                        f"{node.name} should not contain 'out of scope' comments after repair_03"
                    )


class TestPreprocessorNoPreBoundFields(unittest.TestCase):
    """Verify preprocessor does NOT produce pre-bound fields for placeholders."""

    def test_preprocessor_no_assigned_class_in_placeholder(self):
        preprocessor_path = os.path.join(PROJECT_ROOT, "preprocessor.py")
        with open(preprocessor_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Check that placeholder construction does NOT assign assignedClass / targetClass
        tree = ast.parse(content)

        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and "placeholder" in target.id.lower():
                        # Check the value doesn't contain assignedClass / targetClass keys
                        if isinstance(node.value, ast.Dict):
                            key_strings = []
                            for k in node.value.keys:
                                if isinstance(k, ast.Constant):
                                    key_strings.append(k.value)
                            self.assertNotIn(
                                "assignedClass", key_strings,
                                f"Placeholder variable '{target.id}' contains pre-bound 'assignedClass'"
                            )
                            self.assertNotIn(
                                "targetClass", key_strings,
                                f"Placeholder variable '{target.id}' contains pre-bound 'targetClass'"
                            )


class TestPenaltyBreakdownKeys(unittest.TestCase):
    """Verify penaltyBreakdown contains required task_08 keys."""

    def test_priority_scheduling_output_has_penalty_keys(self):
        output_path = os.path.join(
            PROJECT_ROOT, "fixtures", "output_priority_scheduling.json"
        )

        if not os.path.exists(output_path):
            self.skipTest("output_priority_scheduling.json not yet generated")

        with open(output_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        breakdown = data.get("penaltyBreakdown", {})

        self.assertIn(
            "priority_teacher_placeholder",
            breakdown,
            "penaltyBreakdown must contain 'priority_teacher_placeholder' key"
        )
        self.assertIn(
            "specialty_room_non_preferred_grade",
            breakdown,
            "penaltyBreakdown must contain 'specialty_room_non_preferred_grade' key"
        )

    def test_output_contract_intact(self):
        """Verify output contract fields are present."""
        output_path = os.path.join(
            PROJECT_ROOT, "fixtures", "output_priority_scheduling.json"
        )

        if not os.path.exists(output_path):
            self.skipTest("output_priority_scheduling.json not yet generated")

        with open(output_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        required_fields = ["status", "solvePass", "degraded", "degradationReasons", "penaltyBreakdown"]
        for field in required_fields:
            self.assertIn(
                field, data,
                f"Output contract requires '{field}' field"
            )


class TestPolicyWeightRegistry(unittest.TestCase):
    """Verify scheduler_policy.py WEIGHT_REGISTRY has correct task_08 weights."""

    def test_priority_teacher_placeholder_in_registry(self):
        from scheduler_policy import WEIGHT_REGISTRY
        self.assertIn(
            "priority_teacher_placeholder",
            WEIGHT_REGISTRY,
            "WEIGHT_REGISTRY must contain 'priority_teacher_placeholder'"
        )
        self.assertEqual(
            WEIGHT_REGISTRY["priority_teacher_placeholder"],
            12000,
            "priority_teacher_placeholder weight should be 12000 per YAML spec"
        )

    def test_specialty_room_non_preferred_grade_in_registry(self):
        from scheduler_policy import WEIGHT_REGISTRY
        self.assertIn(
            "specialty_room_non_preferred_grade",
            WEIGHT_REGISTRY,
            "WEIGHT_REGISTRY must contain 'specialty_room_non_preferred_grade'"
        )
        self.assertEqual(
            WEIGHT_REGISTRY["specialty_room_non_preferred_grade"],
            3000,
            "specialty_room_non_preferred_grade weight should be 3000 per YAML spec"
        )


if __name__ == "__main__":
    unittest.main()