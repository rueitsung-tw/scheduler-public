"""Tests for repair_05b: special room validator false-positive fix.

_configured_special_room_subjects must not activate special-room validation
for subjects that appear only in fallback_limits. Fallback limits provide
capacity defaults; they do not imply the fixture configured classrooms.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from solver import _configured_special_room_subjects as solver_configured
from constraints.class_rules import (
    _configured_special_room_subjects as class_rules_configured,
)


FALLBACK = {
    "自然科學": 2,
    "語文-英語": 2,
    "音樂": 2,
    "美勞": 2,
    "體育": 3,
    "資訊": 2,
}

# Both implementations should behave identically
CONFIGURERS = [
    ("solver", solver_configured),
    ("class_rules", class_rules_configured),
]


class TestConfiguredSpecialRoomSubjects(unittest.TestCase):
    """_configured_special_room_subjects must not include fallback-only subjects."""

    def test_fallback_only_should_not_activate_any_subject(self):
        for name, fn in CONFIGURERS:
            with self.subTest(impl=name):
                result = fn(
                    classrooms=[],
                    classroom_limits={},
                    school_info={},
                    fallback_limits=FALLBACK,
                )
                self.assertEqual(
                    result, set(),
                    f"{name}: empty config + fallback should return empty set",
                )

    def test_fallback_only_with_none_classrooms(self):
        for name, fn in CONFIGURERS:
            with self.subTest(impl=name):
                result = fn(
                    classrooms=None,
                    classroom_limits=None,
                    school_info=None,
                    fallback_limits=FALLBACK,
                )
                self.assertEqual(result, set())

    def test_classrooms_activate_subject(self):
        for name, fn in CONFIGURERS:
            with self.subTest(impl=name):
                result = fn(
                    classrooms=[{"subject": "英語"}],
                    classroom_limits={},
                    school_info={},
                    fallback_limits=FALLBACK,
                )
                self.assertIn("語文-英語", result)

    def test_classroom_limits_activate_subject(self):
        for name, fn in CONFIGURERS:
            with self.subTest(impl=name):
                result = fn(
                    classrooms=[],
                    classroom_limits={"音樂": 3},
                    school_info={},
                    fallback_limits=FALLBACK,
                )
                self.assertIn("音樂", result)

    def test_subject_classroom_grades_activate_subject(self):
        for name, fn in CONFIGURERS:
            with self.subTest(impl=name):
                result = fn(
                    classrooms=[],
                    classroom_limits={},
                    school_info={"subjectClassroomGrades": {"美勞": [3, 4]}},
                    fallback_limits=FALLBACK,
                )
                self.assertIn("美勞", result)

    def test_strict_feasible_real_scenario(self):
        """strict_feasible_real defines only English classrooms.
        Validator should NOT require science rooms for '自然' periods."""
        for name, fn in CONFIGURERS:
            with self.subTest(impl=name):
                result = fn(
                    classrooms=[
                        {"subject": "英語"},
                        {"subject": "英語"},
                    ],
                    classroom_limits={},
                    school_info={},
                    fallback_limits=FALLBACK,
                )
                self.assertIn("語文-英語", result)
                # 自然科學 should NOT be included just because it's in fallback
                self.assertNotIn(
                    "自然科學",
                    result,
                    f"{name}: science must not be activated by fallback alone",
                )

    def test_alternating_odd_group_scenario(self):
        """alternating_odd_group has zero classrooms.
        Music and art should NOT be constrained subjects."""
        for name, fn in CONFIGURERS:
            with self.subTest(impl=name):
                result = fn(
                    classrooms=[],
                    classroom_limits={},
                    school_info={},
                    fallback_limits=FALLBACK,
                )
                self.assertNotIn("音樂", result)
                self.assertNotIn("美勞", result)

    def test_mixed_config(self):
        """When some subjects have real config and others don't, only the
        configured ones should be active."""
        for name, fn in CONFIGURERS:
            with self.subTest(impl=name):
                result = fn(
                    classrooms=[{"subject": "英語"}],
                    classroom_limits={"體育": 3},
                    school_info={"subjectClassroomGrades": {"資訊": [5, 6]}},
                    fallback_limits=FALLBACK,
                )
                self.assertIn("語文-英語", result)
                self.assertIn("體育", result)
                self.assertIn("資訊", result)
                # These are only in fallback, not configured
                self.assertNotIn("自然科學", result)
                self.assertNotIn("音樂", result)
                self.assertNotIn("美勞", result)


if __name__ == "__main__":
    unittest.main()
